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
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

/** Tool names exposed on the MCP surface (locked by mcpServer.test.ts). */
export const MCP_TOOL_TRANSCRIBE_FILE = "transcribe_file";
export const MCP_TOOL_GET_STATUS = "get_murmur_status";

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
}

/** Narrow an unknown channel result to a plain object record. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Single text content block (the only content shape this server emits). */
function textBlock(text: string): { type: "text"; text: string } {
  return { type: "text", text };
}

/**
 * Build the Murmur MCP server. One McpServer instance serves one transport;
 * call `runMcpStdio` for the CLI entry or `server.connect(...)` directly in
 * tests (InMemoryTransport).
 */
export function createMurmurMcpServer(deps: MurmurMcpServerDeps): McpServer {
  const log = deps.log ?? defaultStderrLog;
  const server = new McpServer(
    {
      name: MCP_SERVER_NAME,
      version: deps.version ?? DEFAULT_SERVER_VERSION,
    },
    // No extra capabilities: exactly the two tools below (tools capability
    // is enabled implicitly by registerTool).
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
