// [20260912_Feat_269_McpServer] MCP server skeleton for Murmur (ticket
// #269): a stdio MCP server exposing two honestly-annotated tools that
// proxy the running app's local channel (tickets #265/#267):
//   - transcribe_file  → channel `transcribe_file` (save=false default →
//     the request carries persist:false, so the tool can honestly advertise
//     itself as non-persisting; save=true opts into history)
//   - get_murmur_status → channel `status`
//
// DESIGN (ticket #269, "keep it simple"): this module is transport + tool
// logic ONLY. Endpoint/token discovery and the exit-4-style connect
// classification live in cli/lib/channelBridge.mjs (single source), whose
// connector wraps the SAME bundled client kernel used by the CLI
// (cli/dist/channelClient.mjs, built from src/helpers/localChannel/client.ts
// by `pnpm run build:cli`). The connector is therefore injected via
// `deps.connect` and `build:mcp` bundles ONLY this file into
// cli/dist/mcpServer.mjs (esbuild pulls the SDK + zod in); in-process tests
// inject a connector built on the real createChannelClient against a real
// createChannelServer, so the client kernel is exercised for real.
//
// STDOUT RED LINE: stdout is the MCP protocol channel (StdioServerTransport
// owns it). Every diagnostic this module emits goes through the `log` sink,
// which defaults to process.stderr — console.log is never used, and the
// protocol transports (stdio or in-memory) never receive log output.
//
// [20260912_Feat_270_McpFullTools] Ticket #270 grows the surface to SIX
// tools, split by the single-writer principle:
//   - CHANNEL-BACKED (the running app owns every write): polish_text and
//     delete_transcription ride the existing `polish` / `history_delete`
//     channel methods (ticket #268) through the injected bridge — the app
//     MUST be running, and app-down surfaces the actionable exit-4-class
//     bridge message (same handling as transcribe_file).
//   - LOCAL READONLY READS (no channel round-trip): list_transcriptions and
//     get_transcription read the SQLite file DIRECTLY through the CLI's
//     read model (cli/lib/historyReader.mjs — readonly opens never take the
//     writer lock), so they work while the app runs AND while it does not
//     (same rationale as the CLI's local subcommands, ticket #264).
// The DB path for the local reads defaults to the CLI's resolveDatabasePath
// over process.env, so the shipped CLI wiring (connect/version/log only)
// needs no new argument; tests inject the temp path via deps.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import fs from "node:fs";
import { z } from "zod";
// [20260912_Feat_270_McpFullTools] Ticket #270: the local-read model and
// path resolution are the CLI's own modules (single source — build:mcp
// bundles them in via these relative imports). The not-found wording is
// MIRRORED here in JS because cli/ cannot import the TS historyService
// constant; the parity is locked by a test in mcpServer.test.ts.
import {
  DEFAULT_HISTORY_LIMIT,
  TRANSCRIPTION_NOT_FOUND_MESSAGE,
  getTranscriptionById,
  listTranscriptions,
} from "../../../cli/lib/historyReader.mjs";
import { resolveDatabasePath } from "../../../cli/lib/paths.mjs";
import { CLI_POLISH_MODES } from "../../../cli/lib/channelBridge.mjs";

/** Tool names exposed on the MCP surface (locked by mcpServer.test.ts). */
export const MCP_TOOL_TRANSCRIBE_FILE = "transcribe_file";
export const MCP_TOOL_GET_STATUS = "get_murmur_status";
// [20260912_Feat_270_McpFullTools] Ticket #270 tool names (locked by
// mcpServer.test.ts together with the #269 pair — six-tool surface).
export const MCP_TOOL_POLISH_TEXT = "polish_text";
export const MCP_TOOL_LIST_TRANSCRIPTIONS = "list_transcriptions";
export const MCP_TOOL_GET_TRANSCRIPTION = "get_transcription";
export const MCP_TOOL_DELETE_TRANSCRIPTION = "delete_transcription";

/** Server identity reported during MCP initialize. */
export const MCP_SERVER_NAME = "murmur";
const DEFAULT_SERVER_VERSION = "0.0.0";

/** Fallback sink when the caller provides none: stderr ONLY (stdout is the
 * protocol channel — see the STDOUT RED LINE note in the header). */
function defaultStderrLog(chunk: string): void {
  process.stderr.write(chunk);
}

/**
 * The slice of the CLI channel bridge (cli/lib/channelBridge.mjs
 * connectChannelBridge) the MCP tools need. Kept structural so the CLI
 * wiring passes its existing bridge object straight in and tests can build
 * the same shape on the real client kernel.
 */
export interface McpChannelBridge {
  requestStatus(): Promise<unknown>;
  requestTranscribe(
    audioPath: string,
    params?: Record<string, unknown>,
    onProgress?: (progress: unknown) => void,
    persist?: boolean,
  ): Promise<unknown>;
  // [20260912_Feat_270_McpFullTools] Ticket #270 channel methods — the #268
  // bridge (cli/lib/channelBridge.mjs connectChannelBridge) already provides
  // both; the interface stays structural so tests can build the same shape
  // on the real client kernel.
  requestPolish(
    text: string,
    mode: string | undefined,
    onProgress?: (progress: unknown) => void,
  ): Promise<unknown>;
  requestHistoryDelete(id: number): Promise<unknown>;
  close(): void;
}

/** Collaborators injected into the MCP server factory. */
export interface MurmurMcpServerDeps {
  /** Opens one channel bridge per tool call; may reject when the app is
   * unreachable (the rejection message is user-facing and actionable). */
  connect: () => Promise<McpChannelBridge>;
  /** Version reported in the MCP initialize handshake. */
  version?: string;
  /** Diagnostic sink; defaults to process.stderr (never stdout). */
  log?: (chunk: string) => void;
  // [20260912_Feat_270_McpFullTools] DB path for the LOCAL-READ tools
  // (list_transcriptions / get_transcription). Defaults to the CLI's
  // resolveDatabasePath over process.env (MURMUR_DB_PATH override wins,
  // else dataDirectory/transcriptions.db) so the shipped CLI wiring — which
  // passes only connect/version/log — needs no new argument. Resolved per
  // call, mirroring the bridge's connect-per-call style.
  resolveHistoryDbPath?: () => string;
}

/** Narrow an unknown channel result to a plain object record. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Single text content block (the only content shape this server emits). */
function textBlock(text: string): { type: "text"; text: string } {
  return { type: "text", text };
}

// [20260912_Feat_270_McpFullTools] Default DB resolution for the local-read
// tools: the SAME derivation the CLI uses (cli/lib/paths.mjs — MURMUR_DB_PATH
// env override wins, else dataDirectory/transcriptions.db, which mirrors
// database.ts initialize()).
function defaultResolveHistoryDbPath(): string {
  return resolveDatabasePath({ env: process.env });
}

/** One record in list_transcriptions' structuredContent (ticket #270): the
 * FULL text, not a preview — the reader returns uncapped rows (the CLI's
 * preview/truncation is a display concern applied by its renderer, not by
 * the read model), and structured-content consumers can truncate themselves.
 */
interface McpHistoryListRecord {
  id: number;
  text: string;
  created_at: string;
}

/** Narrow one raw history row (unknown across the .mjs interop boundary) to
 * the list-record shape. Null only for a row without a numeric id — the
 * reader's SELECT always yields the id column, so such a row is skipped,
 * never fabricated. */
function toHistoryListRecord(row: unknown): McpHistoryListRecord | null {
  if (!isRecord(row) || typeof row.id !== "number") return null;
  return {
    id: row.id,
    text: typeof row.text === "string" ? row.text : "",
    created_at: typeof row.created_at === "string" ? row.created_at : "",
  };
}

/** Split a channel polish result into the polished text plus every other
 * field verbatim MINUS the envelope (`success`) — the ticket #270
 * structuredContent contract for polish_text (e.g. model/usage pass
 * through untouched). A non-string `text` coalesces to "". */
function splitChannelResultText(record: Record<string, unknown>): {
  text: string;
  extra: Record<string, unknown>;
} {
  let text = "";
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (key === "text") {
      if (typeof value === "string") text = value;
      continue;
    }
    if (key !== "success") extra[key] = value;
  }
  return { text, extra };
}

/** Format a channel polish progress chunk as a stderr log line (null for
 * non-progress chunks — finish/abort deltas are noise in a diagnostic log).
 * Mirrors the CLI's formatPolishProgressLine gate: chunkIndex/chunkCount are
 * optional on the chunk. */
function polishProgressLogLine(progress: unknown): string | null {
  const record = isRecord(progress) ? progress : {};
  if (record.type !== "progress") return null;
  const { chunkIndex, chunkCount } = record;
  if (
    typeof chunkIndex === "number" &&
    typeof chunkCount === "number" &&
    Number.isFinite(chunkIndex) &&
    Number.isFinite(chunkCount)
  ) {
    return `murmur mcp: polish_text progress 第 ${chunkIndex}/${chunkCount} 块\n`;
  }
  return "murmur mcp: polish_text progress\n";
}

/** Human summary line for the history list tool's content block.
 * [20260912_Fix_270_Review] "返回" not "共" — with a limit applied the count
 * is what this call returned, not the history total (structuredContent's
 * records array stays authoritative for callers). */
function recordCountSummary(count: number): string {
  return `返回 ${count} 条记录`;
}

/**
 * Build the Murmur MCP server. One McpServer instance serves one transport;
 * call `runMcpStdio` for the CLI entry or `server.connect(...)` directly in
 * tests (InMemoryTransport).
 */
export function createMurmurMcpServer(deps: MurmurMcpServerDeps): McpServer {
  const log = deps.log ?? defaultStderrLog;
  // [20260912_Feat_270_McpFullTools] Local-read DB path resolver (per-call).
  const resolveHistoryDbPath =
    deps.resolveHistoryDbPath ?? defaultResolveHistoryDbPath;
  const server = new McpServer(
    {
      name: MCP_SERVER_NAME,
      version: deps.version ?? DEFAULT_SERVER_VERSION,
    },
    // No extra capabilities: exactly the six tools registered below
    // (#269 core two + #270 full surface; tools capability is enabled
    // implicitly by registerTool).
  );

  // --- transcribe_file ---------------------------------------------------
  // Annotation honesty (ticket #269, verified against SDK 1.30 ToolAnnotations:
  // title / readOnlyHint / destructiveHint / idempotentHint / openWorldHint):
  //   - readOnlyHint FALSE: `save: true` writes a history row — the tool must
  //     never claim read-only.
  //   - destructiveHint FALSE: transcription only ADDS data; it never
  //     deletes or overwrites anything.
  //   - idempotentHint FALSE: a save=true call appends a new row on every
  //     invocation, so repeats are not side-effect-free.
  //   - openWorldHint FALSE: the tool talks only to the local Murmur app.
  server.registerTool(
    MCP_TOOL_TRANSCRIBE_FILE,
    {
      title: "Transcribe an audio file with Murmur",
      description:
        "Transcribe a local audio file through the running Murmur desktop " +
        "app. By default the transcript is returned WITHOUT being written " +
        "to Murmur's history; pass save:true to also store it in history.",
      inputSchema: {
        path: z.string().describe("Absolute path of the audio file"),
        diarize: z
          .boolean()
          .optional()
          .describe("Speaker diarization — NOT supported yet (honest refusal)"),
        save: z
          .boolean()
          .optional()
          .describe(
            "Also save the transcription to Murmur history (default false)",
          ),
      },
      annotations: {
        title: "Transcribe audio file",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args) => {
      // Diarize is not exposed on the local channel yet — same honest
      // refusal as the CLI's --diarize (tickets #267/#269). Never fake it.
      if (args.diarize === true) {
        return {
          isError: true,
          content: [
            textBlock(
              "diarize 尚未支持：说话人分离尚未通过本地通道开放（计划在后续 ticket 中暴露）",
            ),
          ],
        };
      }
      // persist is threaded top-level on the channel request (ticket #269):
      // save defaults to FALSE for the MCP surface, so the default call is
      // genuinely read-only over the wire.
      const persist = args.save === true;
      let bridge: McpChannelBridge;
      try {
        bridge = await deps.connect();
      } catch (error) {
        // Connect failures carry an already-actionable Chinese message
        // (BridgeUnavailableError from the CLI bridge kernel).
        const message = error instanceof Error ? error.message : String(error);
        log(`murmur mcp: transcribe_file connect failed: ${message}\n`);
        return { isError: true, content: [textBlock(message)] };
      }
      try {
        const result = await bridge.requestTranscribe(
          args.path,
          {},
          undefined,
          persist,
        );
        const record = isRecord(result) ? result : {};
        if (record.success === false) {
          // The service ran and reported a failure envelope: surface the
          // message as a tool error (the caller cannot do anything with a
          // fake success).
          const message =
            typeof record.error === "string" ? record.error : "未知错误";
          return { isError: true, content: [textBlock(message)] };
        }
        // structuredContent carries the transcript (+ id/duration when the
        // row was persisted, i.e. only when save:true was passed).
        const text = typeof record.text === "string" ? record.text : "";
        const structured: { text: string; id?: number; duration?: number } = {
          text,
        };
        if (typeof record.id === "number") {
          structured.id = record.id;
        }
        if (typeof record.duration === "number") {
          structured.duration = record.duration;
        }
        return {
          content: [textBlock(text)],
          structuredContent: structured,
        };
      } catch (error) {
        // Channel-level failure (error frame, disconnect, timeout) —
        // actionable by the caller (retry after starting the app etc.).
        const message = error instanceof Error ? error.message : String(error);
        log(`murmur mcp: transcribe_file request failed: ${message}\n`);
        return { isError: true, content: [textBlock(message)] };
      } finally {
        bridge.close();
      }
    },
  );

  // --- get_murmur_status -------------------------------------------------
  // Unreachable-app semantics (ticket #269 decision): a status probe that
  // RAN and reports "the app is not reachable" is a SUCCESSFUL tool result,
  // not an error — per MCP convention isError is for failures actionable as
  // "the tool did not do what it promised", and here the caller gets exactly
  // the answer it asked for ({ reachable: false }). Callers branch on the
  // structured field, so no misleading error semantics are attached.
  // models_downloaded is OMITTED when unreachable: the on-disk model state
  // is unknowable without the app, and inventing `false` would be a lie.
  //   - readOnlyHint TRUE: pure status probe, no writes anywhere.
  //   - idempotentHint TRUE: repeated calls neither write nor change effect.
  server.registerTool(
    MCP_TOOL_GET_STATUS,
    {
      title: "Get Murmur engine status",
      description:
        "Check whether the Murmur desktop app is reachable and whether its " +
        "speech models are downloaded.",
      inputSchema: {},
      annotations: {
        title: "Get Murmur engine status",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      let bridge: McpChannelBridge;
      try {
        bridge = await deps.connect();
      } catch (error) {
        // [20260912_Fix_269_ReviewStatusDiag] Keep the reachable=false
        // contract, but do not collapse failure classes silently — the
        // stderr sink records whether this was not-running, a handshake
        // rejection, or a timeout.
        log(
          `murmur mcp: status connect failed: ${error instanceof Error ? error.message : String(error)}\n`,
        );
        return {
          content: [
            textBlock(
              "Murmur 应用未运行或不可达（状态查询本身成功返回：reachable=false 不视为工具错误，可提示用户先启动 Murmur 桌面应用）",
            ),
          ],
          structuredContent: { reachable: false },
        };
      }
      try {
        const status = await bridge.requestStatus();
        const record = isRecord(status) ? status : {};
        return {
          content: [
            textBlock(
              record.models_downloaded === true
                ? "Murmur 应用可达，模型已下载"
                : "Murmur 应用可达，模型未下载",
            ),
          ],
          structuredContent: {
            reachable: true,
            models_downloaded: record.models_downloaded === true,
          },
        };
      } finally {
        bridge.close();
      }
    },
  );

  // [20260912_Feat_270_McpFullTools] --- polish_text (ticket #270) ---------
  // Channel-backed AI polish: the SAME `polish` method the CLI uses
  // (ticket #268). The AI key NEVER crosses the channel — only the task
  // (text + mode) does; the app decrypts the key in-process and runs the
  // GUI-identical polish orchestrator. The mode gate mirrors the CLI's local
  // validation against channelBridge.mjs CLI_POLISH_MODES (the same mirrored
  // built-in list, parity-locked against getAIModes in cli-bridge.test.ts):
  // custom app template modes are not statically enumerable, so they are not
  // offered here either — the authoritative fallback stays server-side.
  //
  // PROGRESS DECISION (ticket #270, documented): channel progress chunks
  // become `log` (stderr) lines — NOT MCP notifications/progress. The MCP
  // progress notification is only delivered when the CLIENT opts in with a
  // per-request _meta.progressToken, which the registerTool handler would
  // have to thread through every call for marginal value (a notification
  // without a token is dropped by clients); stderr keeps the stdout
  // protocol channel pure (this module's red line) and keeps progress
  // visible in every MCP host that surfaces server stderr.
  //
  // Annotation honesty (SDK 1.30 ToolAnnotations semantics):
  //   - readOnlyHint FALSE: the call spends the user's AI-provider quota —
  //     it drives an external provider call, an externally-visible effect.
  //   - destructiveHint FALSE: polish only PRODUCES text; nothing stored is
  //     deleted or overwritten (polish never writes history).
  //   - idempotentHint FALSE: the provider may return different text per
  //     call and every call costs quota — repeats are not free/no-op.
  //   - openWorldHint FALSE: the tool talks only to the local Murmur app
  //     (the app→provider hop is the app's own configuration).
  server.registerTool(
    MCP_TOOL_POLISH_TEXT,
    {
      title: "Polish text with Murmur AI",
      description:
        "Polish/rewrite text through the running Murmur desktop app using " +
        "the user's configured AI provider and mode templates (the same " +
        "modes as the Murmur GUI). The AI key stays inside the app process.",
      inputSchema: {
        text: z.string().min(1).describe("Text to polish"),
        mode: z
          .string()
          .optional()
          .describe(
            `Polish mode (built-in modes: ${CLI_POLISH_MODES.join(", ")}); ` +
              "omit for the app's entry-level default (optimize)",
          ),
      },
      annotations: {
        title: "Polish text with Murmur AI",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args) => {
      // Local mode gate BEFORE any connection (same order as the CLI): an
      // unknown built-in mode is a usage error, not an app failure.
      if (args.mode !== undefined && !CLI_POLISH_MODES.includes(args.mode)) {
        return {
          isError: true,
          content: [
            textBlock(
              `未知的润色模式: ${args.mode}（可用模式: ${CLI_POLISH_MODES.join(", ")}）`,
            ),
          ],
        };
      }
      let bridge: McpChannelBridge;
      try {
        bridge = await deps.connect();
      } catch (error) {
        // Connect failures carry an already-actionable Chinese message
        // (BridgeUnavailableError from the CLI bridge kernel).
        const message = error instanceof Error ? error.message : String(error);
        log(`murmur mcp: polish_text connect failed: ${message}\n`);
        return { isError: true, content: [textBlock(message)] };
      }
      try {
        const result = await bridge.requestPolish(
          args.text,
          args.mode,
          (progress) => {
            const line = polishProgressLogLine(progress);
            if (line !== null) log(line);
          },
        );
        const record = isRecord(result) ? result : {};
        if (record.success === false) {
          // The service ran and reported a failure envelope: surface the
          // message as a tool error (same shape as transcribe_file).
          const message =
            typeof record.error === "string" ? record.error : "未知错误";
          return { isError: true, content: [textBlock(message)] };
        }
        // structuredContent: {text} plus every other channel result field
        // verbatim minus the envelope (success) — model/usage/etc. pass
        // through untouched (ticket #270 contract).
        const { text, extra } = splitChannelResultText(record);
        return {
          content: [textBlock(text)],
          structuredContent: { ...extra, text },
        };
      } catch (error) {
        // Channel-level failure (error frame, disconnect, timeout).
        const message = error instanceof Error ? error.message : String(error);
        log(`murmur mcp: polish_text request failed: ${message}\n`);
        return { isError: true, content: [textBlock(message)] };
      } finally {
        bridge.close();
      }
    },
  );

  // [20260912_Feat_270_McpFullTools] --- list_transcriptions ---------------
  // LOCAL readonly history read (NO channel round-trip). Same rationale as
  // the CLI's local subcommands (ticket #264): SQLite read-only opens never
  // take the writer lock, so the read is single-writer-safe while the app
  // runs AND works when the app is not running at all. The read model is
  // the CLI's own historyReader.mjs — one implementation, two consumers.
  //
  // MISSING-DB SEMANTICS (ticket #270 decision, documented): a database file
  // that does not exist means Murmur has never transcribed anything (the
  // app creates the DB on first save). That is honestly an EMPTY history,
  // so the tool answers a successful {records: []} — inventing an error
  // would misreport a normal fresh-install state as a failure.
  //
  // Annotations: readOnlyHint TRUE (pure read via a readonly SQLite open),
  // destructiveHint FALSE, idempotentHint TRUE (repeats neither write nor
  // change effect), openWorldHint FALSE (local file only).
  server.registerTool(
    MCP_TOOL_LIST_TRANSCRIPTIONS,
    {
      title: "List Murmur transcription history",
      description:
        "List transcription records from Murmur's local history database " +
        "(read-only; works even when the Murmur app is not running). " +
        "Newest first; optional literal-substring query and limit. Each " +
        "record carries id, full text and created_at.",
      inputSchema: {
        query: z
          .string()
          .optional()
          .describe(
            "Literal substring filter over text and processed_text " +
              "(LIKE wildcards are matched literally)",
          ),
        limit: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            `Maximum records to return (default ${DEFAULT_HISTORY_LIMIT})`,
          ),
      },
      annotations: {
        title: "List Murmur transcription history",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      const dbPath = resolveHistoryDbPath();
      // Missing DB: never-transcribed == empty history (see block comment).
      // The existsSync check also guarantees the readonly open below never
      // materialises an empty DB as a side effect.
      if (!fs.existsSync(dbPath)) {
        return {
          content: [textBlock(recordCountSummary(0))],
          structuredContent: { records: [] },
        };
      }
      try {
        const rows = listTranscriptions(dbPath, {
          query: args.query ?? null,
          limit: args.limit ?? DEFAULT_HISTORY_LIMIT,
        });
        const records: McpHistoryListRecord[] = [];
        for (const row of rows) {
          const record = toHistoryListRecord(row);
          if (record) records.push(record);
        }
        return {
          content: [textBlock(recordCountSummary(records.length))],
          structuredContent: { records },
        };
      } catch (error) {
        // The DB exists but cannot be read (locked/corrupt) — an error the
        // caller cannot resolve by retrying blindly; surface the message.
        const message = error instanceof Error ? error.message : String(error);
        log(`murmur mcp: list_transcriptions read failed: ${message}\n`);
        return { isError: true, content: [textBlock(message)] };
      }
    },
  );

  // [20260912_Feat_270_McpFullTools] --- get_transcription -----------------
  // LOCAL readonly single-row read through historyReader.getTranscriptionById
  // (mirrors the app's DatabaseManager.getTranscriptionById: SELECT * WHERE
  // id = ?). Same no-channel rationale as list_transcriptions above.
  //
  // NOT-FOUND SEMANTICS: a missing id — including the missing-DB case
  // (nothing was ever transcribed, so no id can exist) — answers isError
  // with 转录记录不存在: the SAME wording the GUI/CLI delete path uses
  // (historyService's TRANSCRIPTION_NOT_FOUND_MESSAGE, mirrored in JS in
  // historyReader.mjs; the parity is locked by mcpServer.test.ts).
  //
  // Annotations: readOnlyHint TRUE, destructiveHint FALSE, idempotentHint
  // TRUE (pure read), openWorldHint FALSE.
  server.registerTool(
    MCP_TOOL_GET_TRANSCRIPTION,
    {
      title: "Get one Murmur transcription",
      description:
        "Read ONE transcription record (full row: id, text, processed_text, " +
        "duration, created_at, ...) from Murmur's local history database, " +
        "read-only (works even when the Murmur app is not running).",
      inputSchema: {
        id: z
          .number()
          .int()
          .positive()
          .describe("Transcription record id (from list_transcriptions)"),
      },
      annotations: {
        title: "Get one Murmur transcription",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      const dbPath = resolveHistoryDbPath();
      if (fs.existsSync(dbPath)) {
        try {
          const row: unknown = getTranscriptionById(dbPath, args.id);
          if (isRecord(row)) {
            return {
              content: [
                textBlock(typeof row.text === "string" ? row.text : ""),
              ],
              // The full row verbatim — the reader mirrors the app's
              // getTranscriptionById columns (SELECT *).
              structuredContent: row,
            };
          }
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          log(`murmur mcp: get_transcription read failed: ${message}\n`);
          return { isError: true, content: [textBlock(message)] };
        }
      }
      // Missing row OR missing DB → the same single not-found answer.
      return {
        isError: true,
        content: [textBlock(TRANSCRIPTION_NOT_FOUND_MESSAGE)],
      };
    },
  );

  // [20260912_Feat_270_McpFullTools] --- delete_transcription --------------
  // Channel-backed delete via `history_delete` (ticket #268). WRITES go
  // through the running app ON PURPOSE — the single-writer principle: the
  // app process owns the DB writer, so the tool REQUIRES the app to be
  // running and surfaces the actionable bridge message otherwise (same
  // handling as transcribe_file).
  //
  // NOT-FOUND SEMANTICS: deleting a missing id makes the channel service
  // throw 转录记录不存在 (historyService's constant via the #268 wrapper) —
  // surfaced as isError below, so the wording stays identical across
  // GUI/CLI/MCP for the same condition.
  //
  // Annotations (honest per SDK semantics): destructiveHint TRUE (permanently
  // deletes one history row; there is no undo), readOnlyHint FALSE,
  // idempotentHint FALSE — a REPEAT of a successful delete hits the
  // missing-row error, so "same arguments → no error" does NOT hold.
  // openWorldHint FALSE.
  server.registerTool(
    MCP_TOOL_DELETE_TRANSCRIPTION,
    {
      title: "Delete a Murmur transcription",
      description:
        "Permanently delete ONE transcription record from Murmur's history " +
        "through the running Murmur desktop app (the app is the single " +
        "DB writer). There is no undo; deleting an unknown id is an error.",
      inputSchema: {
        id: z
          .number()
          .int()
          .positive()
          .describe("Transcription record id (from list_transcriptions)"),
      },
      annotations: {
        title: "Delete a Murmur transcription",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args) => {
      let bridge: McpChannelBridge;
      try {
        bridge = await deps.connect();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log(`murmur mcp: delete_transcription connect failed: ${message}\n`);
        return { isError: true, content: [textBlock(message)] };
      }
      try {
        await bridge.requestHistoryDelete(args.id);
        return {
          content: [textBlock(`已删除记录 #${args.id}`)],
          structuredContent: { deleted: true, id: args.id },
        };
      } catch (error) {
        // Includes the 转录记录不存在 not-found error frame for a missing id.
        const message = error instanceof Error ? error.message : String(error);
        log(`murmur mcp: delete_transcription request failed: ${message}\n`);
        return { isError: true, content: [textBlock(message)] };
      } finally {
        bridge.close();
      }
    },
  );

  return server;
}

/**
 * CLI entry (`murmur mcp`): run the server over stdio and resolve once the
 * client disconnects (stdin close). Returns the process exit code — always
 * 0 for a clean EOF disconnect; stdout carries protocol frames only.
 */
export async function runMcpStdio(deps: MurmurMcpServerDeps): Promise<number> {
  const log = deps.log ?? defaultStderrLog;
  const server = createMurmurMcpServer(deps);
  const transport = new StdioServerTransport();
  // Resolves on client disconnect (stdin EOF). Safe to set BEFORE connect:
  // the SDK's Protocol.connect CHAINS a pre-existing transport.onclose
  // instead of replacing it.
  const stdinClosed = new Promise<void>((resolve) => {
    transport.onclose = () => resolve();
    // [20260912_Fix_269_ReviewStdinEof] SDK 1.30's StdioServerTransport
    // registers no end/close listener on stdin, so transport.onclose alone
    // never fires on client disconnect (verified live: the promise stayed
    // pending and the process only exited via event-loop drain). Watch
    // stdin explicitly so shutdown is structural, not incidental.
    process.stdin.once("end", () => resolve());
    process.stdin.once("close", () => resolve());
  });
  await server.connect(transport);
  log("murmur mcp: MCP server ready on stdio\n");
  await stdinClosed;
  log("murmur mcp: client disconnected, shutting down\n");
  return 0;
}
