// [20260912_Feat_269_McpServer] MCP server tests (ticket #269). REAL
// tool-call level coverage: the SDK's in-process client (Client +
// InMemoryTransport.createLinkedPair) is connected to the server instance
// built by createMurmurMcpServer, and the `connect` dependency is the
// PRODUCTION bridge connector (cli/lib/channelBridge.mjs over the bundled
// cli/dist/channelClient.mjs — built in-process via esbuild, same pattern
// as cli-bridge.test.ts) against a REAL in-process channel server. Locked
// here: the exact two-tool surface with honest annotations (transcribe_file
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
    it("enumerates exactly the two tools with honest annotations", async () => {
      freshTmp();
      const { client } = await makeSession(makeConnectDeps());
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(2);
      const names = tools.map((tool) => tool.name).sort();
      expect(names).toEqual([MCP_TOOL_GET_STATUS, MCP_TOOL_TRANSCRIBE_FILE]);

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
});
