// [20260912_Feat_269_McpServer] MCP server tests (ticket #269). REAL
// tool-call level coverage: the SDK's in-process client (Client +
// InMemoryTransport.createLinkedPair) is connected to the server instance
// built by createMurmurMcpServer, and the `connect` dependency is the
// PRODUCTION bridge connector (cli/lib/channelBridge.mjs over the bundled
// cli/dist/channelClient.mjs — built in-process via esbuild, same pattern
// as cli-bridge.test.ts) against a REAL in-process channel server. Locked
// here: the exact six-tool surface with honest annotations (transcribe_file
// must NOT claim readOnly), the save→persist threading, the diarize honest
// refusal, status semantics (unreachable = successful {reachable:false},
// NOT an error), and the stderr-only logging rule (stdout is the protocol
// channel and must stay untouched).
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { build } from "esbuild";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  createMurmurMcpServer,
  MCP_SERVER_NAME,
  MCP_TOOL_GET_STATUS,
  MCP_TOOL_TRANSCRIBE_FILE,
  type MurmurMcpServerDeps,
} from "../../src/helpers/mcp/mcpServer";
import { transcribeFileService } from "../../src/helpers/services/transcriptionService";
import {
  createChannelServer,
  type ChannelServices,
  type LocalChannelServer,
} from "../../src/helpers/localChannel";
import type { Logger } from "../../src/helpers/services/transcriptionService";
import { connectChannelBridge } from "../../cli/lib/channelBridge.mjs";
import {
  writeChannelEndpointFile,
  writeChannelTokenFile,
} from "../../src/helpers/localChannel/endpoint";
// [20260912_Feat_270_McpFullTools] Ticket #270 additions: the new tool-name
// constants, the JS-mirrored not-found constant plus the TS source of truth
// for the parity lock, and node:sqlite for the temp history DB behind the
// local-read tools.
import { DatabaseSync } from "node:sqlite";
import {
  MCP_TOOL_DELETE_TRANSCRIPTION,
  MCP_TOOL_GET_TRANSCRIPTION,
  MCP_TOOL_LIST_TRANSCRIPTIONS,
  MCP_TOOL_POLISH_TEXT,
} from "../../src/helpers/mcp/mcpServer";
import { TRANSCRIPTION_NOT_FOUND_MESSAGE } from "../../src/helpers/services/historyService";
import { TRANSCRIPTION_NOT_FOUND_MESSAGE as TRANSCRIPTION_NOT_FOUND_MESSAGE_MIRRORED } from "../../cli/lib/historyReader.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

const TOKEN = "local-channel-269-test-token-0123456789abcdef";

/** Audio path that passes audioPathValidator on every platform (tmpdir is
 * an allowed root; the file need not exist for the fallback branch). */
const AUDIO_PATH = path.join(os.tmpdir(), "murmur-269-sample.wav");

/** Silent logger satisfying the channel services Logger interface. */
const silentLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
} as unknown as Logger;

type MockFn = ReturnType<typeof vi.fn>;

/** Loosely-typed mock bag for the REAL transcribeFileService under test. */
function makeServiceDeps(transcribeResult?: unknown): {
  funasrManager: { transcribeFile: MockFn };
  databaseManager: {
    saveTranscription: MockFn;
    getSetting: MockFn;
  };
  logger: Record<string, MockFn>;
} {
  return {
    funasrManager: {
      transcribeFile: vi.fn(
        async () =>
          transcribeResult ?? {
            success: true,
            text: "MCP 转写结果",
            duration: 2.5,
          },
      ),
    },
    databaseManager: {
      saveTranscription: vi.fn(() => ({ lastInsertRowid: 42n, changes: 1 })),
      getSetting: vi.fn(() => null),
    },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  };
}

describe("murmur mcp server (ticket #269)", () => {
  let tmpDir: string;
  let endpointPath: string;
  let channelServer: LocalChannelServer | null;
  let endpointCounter = 0;

  // The MCP `connect` dependency is the PRODUCTION bridge connector, which
  // loads the bundled TS client kernel from cli/dist/channelClient.mjs
  // (gitignored build:cli output). Build it in-process via esbuild's JS API
  // so the suite is hermetic and always exercises the current client source.
  beforeAll(async () => {
    await build({
      entryPoints: [path.join(REPO_ROOT, "src/helpers/localChannel/client.ts")],
      outfile: path.join(REPO_ROOT, "cli/dist/channelClient.mjs"),
      bundle: true,
      platform: "node",
      format: "esm",
      logLevel: "silent",
    });
  });

  function freshTmp(): string {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-269-"));
    endpointCounter += 1;
    // Platform-aware endpoint, same construction as cli-bridge.test.ts:
    // Node on win32 only accepts \\.\pipe\ paths for IPC listening; pipes
    // are flat-namespaced so pid+counter keeps workers unique.
    endpointPath =
      process.platform === "win32"
        ? `\\\\.\\pipe\\murmur-test-269-${process.pid}-${endpointCounter}`
        : path.join(tmpDir, `chan-${endpointCounter}.sock`);
    return tmpDir;
  }

  afterEach(async () => {
    if (channelServer) {
      await channelServer.stop();
      channelServer = null;
    }
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  /** Start a real channel server on the platform-aware endpoint. */
  async function startServer(
    services: ChannelServices,
  ): Promise<LocalChannelServer> {
    const instance = createChannelServer({
      endpointPath,
      token: TOKEN,
      services,
      logger: silentLogger,
    });
    channelServer = instance;
    await instance.listen();
    return instance;
  }

  /** Publish the discovery files exactly like startLocalChannel does. */
  function publishChannelFiles(dir: string, token: string): void {
    writeChannelEndpointFile(dir, endpointPath, process.platform);
    writeChannelTokenFile(dir, token, process.platform);
  }

  /**
   * Production bridge connector (connectChannelBridge resolves endpoint +
   * token from the temp userData and loads the bundled client kernel).
   */
  function makeConnectDeps(overrides: Partial<MurmurMcpServerDeps> = {}) {
    return {
      connect: () =>
        connectChannelBridge({ env: { ELECTRON_USER_DATA: tmpDir } }),
      version: "1.5.1-test",
      ...overrides,
    } as MurmurMcpServerDeps;
  }

  /** Connect an SDK in-process client to a fresh server instance. */
  async function makeSession(deps: MurmurMcpServerDeps): Promise<{
    client: Client;
    server: ReturnType<typeof createMurmurMcpServer>;
  }> {
    const server = createMurmurMcpServer(deps);
    const client = new Client({
      name: "mcp-269-test-client",
      version: "0.0.0",
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
    return { client, server };
  }

  async function callTool(
    client: Client,
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<CallToolResult> {
    return (await client.callTool({
      name,
      arguments: args,
    })) as CallToolResult;
  }

  describe("tools/list surface", () => {
    // [20260912_Feat_270_McpFullTools] Ticket #270 grows the locked surface
    // from two to SIX tools; the annotation locks below are the drift guard
    // for all of them.
    it("enumerates exactly the six tools with honest annotations", async () => {
      freshTmp();
      const { client } = await makeSession(makeConnectDeps());
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(6);
      const names = tools.map((tool) => tool.name).sort();
      expect(names).toEqual([
        MCP_TOOL_DELETE_TRANSCRIPTION,
        MCP_TOOL_GET_STATUS,
        MCP_TOOL_GET_TRANSCRIPTION,
        MCP_TOOL_LIST_TRANSCRIPTIONS,
        MCP_TOOL_POLISH_TEXT,
        MCP_TOOL_TRANSCRIBE_FILE,
      ]);

      // Honesty lock (ticket #269): save:true CAN write history, so
      // transcribe_file must NOT claim readOnly. It never deletes
      // (destructive:false), repeats can append rows (idempotent:false),
      // and it only talks to the local app (openWorld:false).
      const transcribe = tools.find(
        (tool) => tool.name === MCP_TOOL_TRANSCRIBE_FILE,
      );
      expect(transcribe?.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      });

      // The status probe is a pure read: read-only and idempotent.
      const status = tools.find((tool) => tool.name === MCP_TOOL_GET_STATUS);
      expect(status?.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
      expect(tools[0]?.inputSchema).toMatchObject({ type: "object" });

      // Ticket #270 honesty locks. polish_text CALLS the AI provider — it
      // must never claim read-only, produces text only (destructive:false),
      // and costs quota per repeat (idempotent:false).
      const polish = tools.find((tool) => tool.name === MCP_TOOL_POLISH_TEXT);
      expect(polish?.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      });
      // Both local reads are pure reads (readonly SQLite, no writes).
      const list = tools.find(
        (tool) => tool.name === MCP_TOOL_LIST_TRANSCRIPTIONS,
      );
      expect(list?.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
      const getOne = tools.find(
        (tool) => tool.name === MCP_TOOL_GET_TRANSCRIPTION,
      );
      expect(getOne?.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
      // delete_transcription removes a row: destructive, and NOT idempotent
      // (repeating a successful delete errors on the now-missing row).
      const del = tools.find(
        (tool) => tool.name === MCP_TOOL_DELETE_TRANSCRIPTION,
      );
      expect(del?.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      });
    });

    it("reports the injected version and server name in initialize", async () => {
      freshTmp();
      const { client } = await makeSession(makeConnectDeps());
      // The SDK client's getServerVersion() is the SERVER's initialize
      // identity: name must be "murmur" and the version the CLI passed in.
      expect(client.getServerVersion()).toEqual({
        name: "murmur",
        version: "1.5.1-test",
      });
      expect(MCP_SERVER_NAME).toBe("murmur");
    });
  });

  describe("transcribe_file", () => {
    it("returns structuredContent {text, id, duration} from the channel result and threads persist=false by default", async () => {
      freshTmp();
      // Channel-level spy: the 4th service argument is the persist flag.
      const transcribeFile = vi.fn(
        async (
          _audioPath: string,
          _options: Record<string, unknown>,
          _onProgress?: (progress: unknown) => void,
          _persist?: boolean,
        ) => ({
          success: true,
          text: "你好世界",
          id: 7,
          duration: 3.2,
        }),
      );
      await startServer({
        transcribeFile: (audioPath, options, onProgress, persist) =>
          transcribeFile(audioPath, options, onProgress, persist),
        checkEngineStatus: async () => ({ models_downloaded: true }),
      });
      publishChannelFiles(tmpDir, TOKEN);
      const { client } = await makeSession(makeConnectDeps());
      const result = await callTool(client, MCP_TOOL_TRANSCRIBE_FILE, {
        path: AUDIO_PATH,
      });
      expect(result.isError).toBeUndefined();
      expect(result.structuredContent).toEqual({
        text: "你好世界",
        id: 7,
        duration: 3.2,
      });
      expect(result.content).toEqual([{ type: "text", text: "你好世界" }]);
      expect(transcribeFile).toHaveBeenCalledTimes(1);
      // MCP default (no save field) MUST be persist=false over the channel.
      expect(transcribeFile.mock.calls[0]?.[3]).toBe(false);
    });

    it("save=false: the real service transcribes but saveTranscription is NEVER called", async () => {
      freshTmp();
      const mockDeps = makeServiceDeps();
      // The channel service IS the real transcribeFileService, fed the
      // channel's persist flag — the production wiring shape.
      const transcribeSpy = vi.fn(
        (
          audioPath: string,
          options: Record<string, unknown>,
          onProgress?: (progress: unknown) => void,
          persist?: boolean,
        ) =>
          transcribeFileService(
            mockDeps as unknown as Parameters<typeof transcribeFileService>[0],
            audioPath,
            options,
            onProgress,
            persist,
          ),
      );
      await startServer({
        transcribeFile: transcribeSpy,
        checkEngineStatus: async () => ({ models_downloaded: true }),
      });
      publishChannelFiles(tmpDir, TOKEN);
      const { client } = await makeSession(makeConnectDeps());
      const result = await callTool(client, MCP_TOOL_TRANSCRIBE_FILE, {
        path: AUDIO_PATH,
        save: false,
      });
      expect(result.isError).toBeUndefined();
      expect(result.structuredContent).toMatchObject({
        text: "MCP 转写结果",
      });
      // No persist → no row → no id in the structured payload.
      expect(result.structuredContent).not.toHaveProperty("id");
      expect(transcribeSpy.mock.calls[0]?.[3]).toBe(false);
      expect(mockDeps.funasrManager.transcribeFile).toHaveBeenCalledTimes(1);
      expect(mockDeps.databaseManager.saveTranscription).not.toHaveBeenCalled();
    });

    it("save=true: persist=true reaches the service and the row is saved (id surfaces)", async () => {
      freshTmp();
      const mockDeps = makeServiceDeps();
      const transcribeSpy = vi.fn(
        (
          audioPath: string,
          options: Record<string, unknown>,
          onProgress?: (progress: unknown) => void,
          persist?: boolean,
        ) =>
          transcribeFileService(
            mockDeps as unknown as Parameters<typeof transcribeFileService>[0],
            audioPath,
            options,
            onProgress,
            persist,
          ),
      );
      await startServer({
        transcribeFile: transcribeSpy,
        checkEngineStatus: async () => ({ models_downloaded: true }),
      });
      publishChannelFiles(tmpDir, TOKEN);
      const { client } = await makeSession(makeConnectDeps());
      const result = await callTool(client, MCP_TOOL_TRANSCRIBE_FILE, {
        path: AUDIO_PATH,
        save: true,
      });
      expect(result.isError).toBeUndefined();
      expect(result.structuredContent).toEqual({
        text: "MCP 转写结果",
        id: 42,
        duration: 2.5,
      });
      expect(transcribeSpy.mock.calls[0]?.[3]).toBe(true);
      expect(mockDeps.databaseManager.saveTranscription).toHaveBeenCalledTimes(
        1,
      );
    });

    it("diarize=true is honestly unsupported: isError + 尚未支持, no channel traffic", async () => {
      freshTmp();
      const transcribeFile = vi.fn(async () => ({ success: true }));
      await startServer({
        transcribeFile,
        checkEngineStatus: async () => ({ models_downloaded: true }),
      });
      publishChannelFiles(tmpDir, TOKEN);
      const { client } = await makeSession(makeConnectDeps());
      const result = await callTool(client, MCP_TOOL_TRANSCRIBE_FILE, {
        path: AUDIO_PATH,
        diarize: true,
      });
      expect(result.isError).toBe(true);
      expect(result.content).toEqual([
        { type: "text", text: expect.stringContaining("尚未支持") },
      ]);
      // The refusal happens BEFORE any channel work.
      expect(transcribeFile).not.toHaveBeenCalled();
    });

    it("surfaces a service-side failure envelope as isError with the message", async () => {
      freshTmp();
      await startServer({
        transcribeFile: async () => ({ success: false, error: "引擎未就绪" }),
        checkEngineStatus: async () => ({ models_downloaded: true }),
      });
      publishChannelFiles(tmpDir, TOKEN);
      const { client } = await makeSession(makeConnectDeps());
      const result = await callTool(client, MCP_TOOL_TRANSCRIBE_FILE, {
        path: AUDIO_PATH,
      });
      expect(result.isError).toBe(true);
      expect(result.content).toEqual([{ type: "text", text: "引擎未就绪" }]);
    });

    it("app not running: isError with the actionable bridge message", async () => {
      freshTmp();
      // No discovery files at all — the production connector classifies
      // this as unreachable (the same failure the CLI maps to exit 4).
      const { client } = await makeSession(makeConnectDeps());
      const result = await callTool(client, MCP_TOOL_TRANSCRIBE_FILE, {
        path: AUDIO_PATH,
      });
      expect(result.isError).toBe(true);
      const text = result.content[0];
      expect(text).toMatchObject({
        type: "text",
        text: expect.stringContaining("应用可能未运行"),
      });
    });
  });

  describe("get_murmur_status", () => {
    it("reachable app → structuredContent {reachable:true, models_downloaded:true}, not an error", async () => {
      freshTmp();
      await startServer({
        transcribeFile: async () => ({ success: true }),
        checkEngineStatus: async () => ({ models_downloaded: true }),
      });
      publishChannelFiles(tmpDir, TOKEN);
      const { client } = await makeSession(makeConnectDeps());
      const result = await callTool(client, MCP_TOOL_GET_STATUS, {});
      expect(result.isError).toBeUndefined();
      expect(result.structuredContent).toEqual({
        reachable: true,
        models_downloaded: true,
      });
    });

    it("reachable app with missing models → models_downloaded:false", async () => {
      freshTmp();
      await startServer({
        transcribeFile: async () => ({ success: true }),
        checkEngineStatus: async () => ({ models_downloaded: false }),
      });
      publishChannelFiles(tmpDir, TOKEN);
      const { client } = await makeSession(makeConnectDeps());
      const result = await callTool(client, MCP_TOOL_GET_STATUS, {});
      expect(result.structuredContent).toEqual({
        reachable: true,
        models_downloaded: false,
      });
    });

    it("unreachable app → SUCCESSFUL result {reachable:false} (a status probe that ran is not an error)", async () => {
      freshTmp();
      // No discovery files, no server: the connector throws, the tool
      // answers {reachable:false} WITHOUT isError (ticket #269 decision).
      const { client } = await makeSession(makeConnectDeps());
      const result = await callTool(client, MCP_TOOL_GET_STATUS, {});
      expect(result.isError).toBeUndefined();
      expect(result.structuredContent).toEqual({ reachable: false });
      // models_downloaded is omitted: unknowable without the app.
      expect(result.structuredContent).not.toHaveProperty("models_downloaded");
    });
  });

  describe("stderr-only logging", () => {
    it("diagnostics go to the injected stderr sink; stdout is never touched", async () => {
      freshTmp();
      const logged: string[] = [];
      const stdoutWrites: string[] = [];
      const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(((
        chunk: unknown,
      ) => {
        stdoutWrites.push(String(chunk));
        return true;
      }) as typeof process.stdout.write);
      try {
        // A connect-failing session produces a diagnostic (no server).
        const failing = await makeSession(
          makeConnectDeps({ log: (chunk) => logged.push(chunk) }),
        );
        const failed = await callTool(
          failing.client,
          MCP_TOOL_TRANSCRIBE_FILE,
          { path: AUDIO_PATH },
        );
        expect(failed.isError).toBe(true);

        // A healthy session round-trips over the in-memory transport only.
        await startServer({
          transcribeFile: async () => ({ success: true, text: "ok" }),
          checkEngineStatus: async () => ({ models_downloaded: true }),
        });
        publishChannelFiles(tmpDir, TOKEN);
        const healthy = await makeSession(
          makeConnectDeps({ log: (chunk) => logged.push(chunk) }),
        );
        const okResult = await callTool(
          healthy.client,
          MCP_TOOL_TRANSCRIBE_FILE,
          { path: AUDIO_PATH },
        );
        expect(okResult.isError).toBeUndefined();
      } finally {
        stdoutSpy.mockRestore();
      }
      // STDOUT RED LINE: not a single byte of log output reached stdout —
      // it is reserved for protocol frames.
      expect(stdoutWrites).toEqual([]);
      // The connect failure WAS diagnosed on the stderr sink.
      expect(logged.join("")).toContain("transcribe_file connect failed");
    });
  });

  // [20260912_Feat_270_McpFullTools] --- ticket #270 tool surface ---
  // polish_text / delete_transcription are CHANNEL-backed (single-writer:
  // the running app owns every DB write); list_transcriptions /
  // get_transcription are LOCAL readonly reads via cli/lib/historyReader.mjs
  // against a real temp SQLite DB mirroring the app schema (same pattern as
  // cli-history.test.ts).

  /** One seed row for the temp history DB; unspecified columns default. */
  interface SeedRow270 {
    text: string;
    processed_text?: string | null;
    created_at: string;
  }

  /**
   * Create a transcriptions DB with the app's post-migration schema
   * (database.ts createTables + ALTERs) and insert the rows in order.
   */
  function createAppDb270(dbPath: string, rows: SeedRow270[]): void {
    const db = new DatabaseSync(dbPath);
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS transcriptions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          text TEXT NOT NULL,
          raw_text TEXT,
          processed_text TEXT,
          confidence REAL,
          language TEXT DEFAULT 'zh-CN',
          duration REAL,
          file_size INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          source_type TEXT DEFAULT 'recording',
          source_file_path TEXT,
          segments TEXT,
          manually_edited INTEGER DEFAULT 0
        )
      `);
      const insert = db.prepare(`
        INSERT INTO transcriptions
          (text, processed_text, created_at)
        VALUES (?, ?, ?)
      `);
      for (const row of rows) {
        insert.run(row.text, row.processed_text ?? null, row.created_at);
      }
    } finally {
      db.close();
    }
  }

  describe("polish_text (ticket #270)", () => {
    /** A channel server with a spy polish service. */
    async function startPolishServer(
      impl?: (
        text: string,
        mode: string | undefined,
        onProgress?: (progress: unknown) => void,
      ) => Promise<unknown>,
    ) {
      const polish = vi.fn(
        (
          text: string,
          mode: string | undefined,
          onProgress?: (progress: unknown) => void,
        ) =>
          impl
            ? impl(text, mode, onProgress)
            : Promise.resolve({ success: true, text: "润色结果" }),
      );
      await startServer({
        transcribeFile: async () => ({ success: true }),
        checkEngineStatus: async () => ({ models_downloaded: true }),
        polish,
      });
      publishChannelFiles(tmpDir, TOKEN);
      return polish;
    }

    it("happy path: structuredContent is {text} plus extra channel fields verbatim minus the envelope; mode omitted → undefined reaches the service", async () => {
      freshTmp();
      const polish = await startPolishServer(() =>
        Promise.resolve({ success: true, text: "润色结果", model: "glm-4" }),
      );
      const { client } = await makeSession(makeConnectDeps());
      const result = await callTool(client, MCP_TOOL_POLISH_TEXT, {
        text: "你好世界",
      });
      expect(result.isError).toBeUndefined();
      // Envelope (success) stripped; model passes through verbatim.
      expect(result.structuredContent).toEqual({
        text: "润色结果",
        model: "glm-4",
      });
      expect(result.content).toEqual([{ type: "text", text: "润色结果" }]);
      expect(polish).toHaveBeenCalledTimes(1);
      expect(polish.mock.calls[0]?.[0]).toBe("你好世界");
      // No mode → undefined reaches the service (the app applies its
      // entry-level "optimize" default, same as the GUI/CLI).
      expect(polish.mock.calls[0]?.[1]).toBeUndefined();
    });

    it("mode passes through to the channel service", async () => {
      freshTmp();
      const polish = await startPolishServer();
      const { client } = await makeSession(makeConnectDeps());
      const result = await callTool(client, MCP_TOOL_POLISH_TEXT, {
        text: "你好世界",
        mode: "summarize",
      });
      expect(result.isError).toBeUndefined();
      expect(polish.mock.calls[0]?.[1]).toBe("summarize");
    });

    it("unknown mode is refused BEFORE any channel traffic (local gate, mirrors the CLI)", async () => {
      freshTmp();
      const polish = await startPolishServer();
      const { client } = await makeSession(makeConnectDeps());
      const result = await callTool(client, MCP_TOOL_POLISH_TEXT, {
        text: "你好世界",
        mode: "no-such-mode",
      });
      expect(result.isError).toBe(true);
      expect(result.content).toEqual([
        { type: "text", text: expect.stringContaining("未知的润色模式") },
      ]);
      expect(polish).not.toHaveBeenCalled();
    });

    it("service failure envelope → isError with the message", async () => {
      freshTmp();
      await startPolishServer(() =>
        Promise.resolve({ success: false, error: "AI 调用失败" }),
      );
      const { client } = await makeSession(makeConnectDeps());
      const result = await callTool(client, MCP_TOOL_POLISH_TEXT, {
        text: "你好世界",
      });
      expect(result.isError).toBe(true);
      expect(result.content).toEqual([{ type: "text", text: "AI 调用失败" }]);
    });

    it("channel progress chunks become stderr log lines (never stdout/protocol)", async () => {
      freshTmp();
      await startPolishServer((_text, _mode, onProgress) => {
        onProgress?.({ type: "progress", chunkIndex: 1, chunkCount: 2 });
        return Promise.resolve({ success: true, text: "分块结果" });
      });
      const logged: string[] = [];
      const stdoutWrites: string[] = [];
      const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(((
        chunk: unknown,
      ) => {
        stdoutWrites.push(String(chunk));
        return true;
      }) as typeof process.stdout.write);
      try {
        const { client } = await makeSession(
          makeConnectDeps({ log: (chunk) => logged.push(chunk) }),
        );
        const result = await callTool(client, MCP_TOOL_POLISH_TEXT, {
          text: "长文本",
        });
        expect(result.isError).toBeUndefined();
        expect(result.structuredContent).toEqual({ text: "分块结果" });
      } finally {
        stdoutSpy.mockRestore();
      }
      expect(stdoutWrites).toEqual([]);
      expect(logged.join("")).toContain("polish_text progress");
      expect(logged.join("")).toContain("1/2");
    });

    it("app not running: isError with the actionable bridge message", async () => {
      freshTmp();
      // No discovery files at all — the production connector classifies this
      // as unreachable (the same failure the CLI maps to exit 4).
      const { client } = await makeSession(makeConnectDeps());
      const result = await callTool(client, MCP_TOOL_POLISH_TEXT, {
        text: "你好世界",
      });
      expect(result.isError).toBe(true);
      expect(result.content).toEqual([
        { type: "text", text: expect.stringContaining("应用可能未运行") },
      ]);
    });
  });

  describe("list_transcriptions (ticket #270)", () => {
    it("empty DB → successful {records: []}", async () => {
      freshTmp();
      const dbPath = path.join(tmpDir, "transcriptions.db");
      createAppDb270(dbPath, []);
      const { client } = await makeSession(
        makeConnectDeps({ resolveHistoryDbPath: () => dbPath }),
      );
      const result = await callTool(client, MCP_TOOL_LIST_TRANSCRIPTIONS, {});
      expect(result.isError).toBeUndefined();
      expect(result.structuredContent).toEqual({ records: [] });
    });

    it("seeded DB: newest-first records with full text; query filters; limit truncates", async () => {
      freshTmp();
      const dbPath = path.join(tmpDir, "transcriptions.db");
      createAppDb270(dbPath, [
        {
          text: "meeting minutes topic",
          created_at: "2026-09-12 10:00:01",
        },
        {
          text: "raw chatter",
          processed_text: "polished budget talk",
          created_at: "2026-09-12 10:00:02",
        },
        { text: "unrelated", created_at: "2026-09-12 10:00:03" },
      ]);
      const { client } = await makeSession(
        makeConnectDeps({ resolveHistoryDbPath: () => dbPath }),
      );

      // Newest first, full text (no preview cap — documented decision).
      const all = await callTool(client, MCP_TOOL_LIST_TRANSCRIPTIONS, {});
      expect(all.isError).toBeUndefined();
      expect(all.structuredContent).toEqual({
        records: [
          { id: 3, text: "unrelated", created_at: "2026-09-12 10:00:03" },
          {
            id: 2,
            text: "raw chatter",
            created_at: "2026-09-12 10:00:02",
          },
          {
            id: 1,
            text: "meeting minutes topic",
            created_at: "2026-09-12 10:00:01",
          },
        ],
      });

      // query: literal substring over text AND processed_text.
      const textHit = await callTool(client, MCP_TOOL_LIST_TRANSCRIPTIONS, {
        query: "meeting",
      });
      expect(textHit.structuredContent).toEqual({
        records: [
          {
            id: 1,
            text: "meeting minutes topic",
            created_at: "2026-09-12 10:00:01",
          },
        ],
      });
      const processedHit = await callTool(
        client,
        MCP_TOOL_LIST_TRANSCRIPTIONS,
        { query: "budget" },
      );
      expect(processedHit.structuredContent).toEqual({
        records: [
          {
            id: 2,
            text: "raw chatter",
            created_at: "2026-09-12 10:00:02",
          },
        ],
      });

      // limit truncates newest-first.
      const limited = await callTool(client, MCP_TOOL_LIST_TRANSCRIPTIONS, {
        limit: 2,
      });
      expect(
        (
          limited.structuredContent as {
            records: Array<{ id: number }>;
          }
        ).records.map((record) => record.id),
      ).toEqual([3, 2]);
    });

    it("missing DB file → successful {records: []}; the file is never created (readonly open guarantee)", async () => {
      freshTmp();
      const dbPath = path.join(tmpDir, "does-not-exist.db");
      const { client } = await makeSession(
        makeConnectDeps({ resolveHistoryDbPath: () => dbPath }),
      );
      const result = await callTool(client, MCP_TOOL_LIST_TRANSCRIPTIONS, {});
      // Never-transcribed == empty history (documented #270 decision) — a
      // normal fresh install is NOT an error.
      expect(result.isError).toBeUndefined();
      expect(result.structuredContent).toEqual({ records: [] });
      expect(fs.existsSync(dbPath)).toBe(false);
    });
  });

  // [20260912_Fix_270_Review] Non-integer ids are rejected by the zod
  // input schemas as PROTOCOL errors (SDK converts to InvalidParams —
  // client.callTool rejects rather than returning isError). Locked here so
  // the usage-error surface of both id-taking tools is explicit.
  describe("id schema protocol errors (ticket #270 review)", () => {
    // SDK 1.30 surfaces zod input-schema failures as an isError RESULT
    // carrying the -32602 InvalidParams text (NOT a callTool rejection) —
    // locked so this usage-error surface is explicit and distinct from the
    // tools' own isError convention.
    it("get_transcription rejects a fractional id as an InvalidParams error result", async () => {
      freshTmp();
      const { client } = await makeSession(
        makeConnectDeps({
          resolveHistoryDbPath: () => path.join(tmpDir, "x.db"),
        }),
      );
      const result = (await client.callTool({
        name: MCP_TOOL_GET_TRANSCRIPTION,
        arguments: { id: 1.5 },
      })) as CallToolResult;
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain("-32602");
      expect(JSON.stringify(result.content)).toContain("Invalid");
    });

    it("delete_transcription rejects a fractional id as an InvalidParams error result", async () => {
      freshTmp();
      const { client } = await makeSession(makeConnectDeps());
      const result = (await client.callTool({
        name: MCP_TOOL_DELETE_TRANSCRIPTION,
        arguments: { id: 1.5 },
      })) as CallToolResult;
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain("-32602");
    });
  });

  describe("get_transcription (ticket #270)", () => {
    it("existing id → the full row as structuredContent", async () => {
      freshTmp();
      const dbPath = path.join(tmpDir, "transcriptions.db");
      createAppDb270(dbPath, [
        {
          text: "完整记录",
          processed_text: "润色后",
          created_at: "2026-09-12 10:00:01",
        },
        { text: "second", created_at: "2026-09-12 10:00:02" },
      ]);
      const { client } = await makeSession(
        makeConnectDeps({ resolveHistoryDbPath: () => dbPath }),
      );
      const result = await callTool(client, MCP_TOOL_GET_TRANSCRIPTION, {
        id: 1,
      });
      expect(result.isError).toBeUndefined();
      expect(result.structuredContent).toEqual({
        id: 1,
        text: "完整记录",
        raw_text: null,
        processed_text: "润色后",
        confidence: null,
        language: "zh-CN",
        duration: null,
        file_size: null,
        created_at: "2026-09-12 10:00:01",
        // updated_at is the INSERT time (CURRENT_TIMESTAMP), not the seeded
        // created_at — only its shape is locked here.
        updated_at: expect.any(String),
        source_type: "recording",
        source_file_path: null,
        segments: null,
        manually_edited: 0,
      });
      expect(result.content).toEqual([{ type: "text", text: "完整记录" }]);
    });

    it("missing id → isError 转录记录不存在", async () => {
      freshTmp();
      const dbPath = path.join(tmpDir, "transcriptions.db");
      createAppDb270(dbPath, [
        { text: "only one", created_at: "2026-09-12 10:00:01" },
      ]);
      const { client } = await makeSession(
        makeConnectDeps({ resolveHistoryDbPath: () => dbPath }),
      );
      const result = await callTool(client, MCP_TOOL_GET_TRANSCRIPTION, {
        id: 999,
      });
      expect(result.isError).toBe(true);
      expect(result.content).toEqual([
        { type: "text", text: "转录记录不存在" },
      ]);
    });

    it("missing DB file → isError 转录记录不存在 (no row can exist without a DB)", async () => {
      freshTmp();
      const dbPath = path.join(tmpDir, "does-not-exist.db");
      const { client } = await makeSession(
        makeConnectDeps({ resolveHistoryDbPath: () => dbPath }),
      );
      const result = await callTool(client, MCP_TOOL_GET_TRANSCRIPTION, {
        id: 1,
      });
      expect(result.isError).toBe(true);
      expect(result.content).toEqual([
        { type: "text", text: "转录记录不存在" },
      ]);
    });

    it("not-found wording parity lock: the JS mirror in historyReader.mjs equals the historyService TS constant", () => {
      expect(TRANSCRIPTION_NOT_FOUND_MESSAGE_MIRRORED).toBe(
        TRANSCRIPTION_NOT_FOUND_MESSAGE,
      );
      expect(TRANSCRIPTION_NOT_FOUND_MESSAGE).toBe("转录记录不存在");
    });
  });

  describe("delete_transcription (ticket #270)", () => {
    it("channel-backed success → structuredContent {deleted:true, id}; the service receives the numeric id", async () => {
      freshTmp();
      const deleteTranscription = vi.fn(async (_id: number) => ({
        success: true,
        changes: 1,
      }));
      await startServer({
        transcribeFile: async () => ({ success: true }),
        checkEngineStatus: async () => ({ models_downloaded: true }),
        deleteTranscription,
      });
      publishChannelFiles(tmpDir, TOKEN);
      const { client } = await makeSession(makeConnectDeps());
      const result = await callTool(client, MCP_TOOL_DELETE_TRANSCRIPTION, {
        id: 42,
      });
      expect(result.isError).toBeUndefined();
      expect(result.structuredContent).toEqual({ deleted: true, id: 42 });
      expect(deleteTranscription).toHaveBeenCalledTimes(1);
      expect(deleteTranscription.mock.calls[0]?.[0]).toBe(42);
    });

    it("missing id → isError 转录记录不存在 (the channel service's not-found error frame)", async () => {
      freshTmp();
      const deleteTranscription = vi.fn(async (_id: number) => {
        throw new Error(TRANSCRIPTION_NOT_FOUND_MESSAGE);
      });
      await startServer({
        transcribeFile: async () => ({ success: true }),
        checkEngineStatus: async () => ({ models_downloaded: true }),
        deleteTranscription,
      });
      publishChannelFiles(tmpDir, TOKEN);
      const { client } = await makeSession(makeConnectDeps());
      const result = await callTool(client, MCP_TOOL_DELETE_TRANSCRIPTION, {
        id: 7,
      });
      expect(result.isError).toBe(true);
      expect(result.content).toEqual([
        { type: "text", text: "转录记录不存在" },
      ]);
    });

    it("app not running: isError with the actionable bridge message (writes REQUIRE the running app)", async () => {
      freshTmp();
      // No discovery files — the single-writer principle means the tool
      // cannot fulfil a delete without the app.
      const { client } = await makeSession(makeConnectDeps());
      const result = await callTool(client, MCP_TOOL_DELETE_TRANSCRIPTION, {
        id: 42,
      });
      expect(result.isError).toBe(true);
      expect(result.content).toEqual([
        { type: "text", text: expect.stringContaining("应用可能未运行") },
      ]);
    });
  });
});
