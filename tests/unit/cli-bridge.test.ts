// [20260912_Feat_267_BridgeTranscribe] CLI bridge subcommand tests (ticket
// #267): `murmur status` / `murmur transcribe` run through the REAL runCli
// against a REAL in-process channel server (createChannelServer with mocked
// services — tests may import TS; the CLI cannot, which is exactly what the
// esbuild bundle under test provides). Locked here: exit-code 4 semantics
// (app not running / handshake rejected / timeout), the --json schemas,
// progress lines on stderr, the local extension gate (usage path, before any
// connection), the --diarize honest refusal, and the --save no-op contract.
// No process spawn, no Electron. The TS client kernel itself is covered by
// tests/unit/localChannel.test.ts (ticket #265) — not duplicated here.
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { build } from "esbuild";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  runCli,
  EXIT_OK,
  EXIT_RUNTIME_ERROR,
  EXIT_USAGE_ERROR,
  EXIT_BRIDGE_UNAVAILABLE,
} from "../../cli/lib/cliRunner.mjs";
import {
  BridgeUnavailableError,
  CLI_AUDIO_EXTENSIONS,
  ENDPOINT_FILE_NAME as CLI_ENDPOINT_FILE_NAME,
  METHOD_STATUS as CLI_METHOD_STATUS,
  METHOD_TRANSCRIBE_FILE as CLI_METHOD_TRANSCRIBE_FILE,
  SOCKET_FILE_NAME as CLI_SOCKET_FILE_NAME,
  TOKEN_FILE_NAME as CLI_TOKEN_FILE_NAME,
  classifyConnectFailure,
  validateAudioExtension,
} from "../../cli/lib/channelBridge.mjs";
import {
  createChannelServer,
  SOCKET_FILE_NAME,
  TOKEN_FILE_NAME,
  type ChannelServices,
  type LocalChannelServer,
} from "../../src/helpers/localChannel";
import {
  METHOD_STATUS,
  METHOD_TRANSCRIBE_FILE,
} from "../../src/helpers/localChannel/protocol";
import {
  ENDPOINT_FILE_NAME as TS_ENDPOINT_FILE_NAME,
  writeChannelEndpointFile,
  writeChannelTokenFile,
} from "../../src/helpers/localChannel/endpoint";
import { AUDIO_EXTENSIONS } from "../../src/helpers/ipc-contracts";
import type { Logger } from "../../src/helpers/services/transcriptionService";

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

const TOKEN = "local-channel-267-test-token-0123456789abcdef";
const WRONG_TOKEN = "definitely-not-the-token-267";

/** Silent logger satisfying the channel services Logger interface. */
const silentLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
} as unknown as Logger;

function buildServices(
  overrides: Partial<ChannelServices> = {},
): ChannelServices {
  return {
    transcribeFile: vi.fn(async () => ({
      success: true,
      text: "转录结果",
    })),
    checkEngineStatus: vi.fn(async () => ({ models_downloaded: true })),
    ...overrides,
  };
}

describe("cli bridge subcommands (ticket #267)", () => {
  let tmpDir: string;
  let endpointPath: string;
  let server: LocalChannelServer | null;
  let endpointCounter = 0;

  tmpDir = "";
  endpointPath = "";
  server = null;

  // The CLI imports the bundled TS client kernel from
  // cli/dist/channelClient.mjs (gitignored build:cli output). Build it
  // in-process via esbuild's JS API — no spawn — so the suite is hermetic
  // and always exercises the current client source.
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
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-267-"));
    endpointCounter += 1;
    // Platform-aware endpoint, same construction as localChannel.test.ts:
    // Node on win32 only accepts \\.\pipe\ paths for IPC listening; pipes
    // are flat-namespaced so pid+counter keeps workers unique.
    endpointPath =
      process.platform === "win32"
        ? `\\\\.\\pipe\\murmur-test-267-${process.pid}-${endpointCounter}`
        : path.join(tmpDir, `chan-${endpointCounter}.sock`);
    return tmpDir;
  }

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
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
    server = instance;
    await instance.listen();
    return instance;
  }

  /** Publish the discovery files exactly like startLocalChannel does. */
  function publishChannelFiles(dir: string, token: string): void {
    writeChannelEndpointFile(dir, endpointPath, process.platform);
    writeChannelTokenFile(dir, token, process.platform);
  }

  /** Run the real runner with ELECTRON_USER_DATA pointed at the temp dir. */
  async function runBridgeCli(argv: string[]): Promise<CliResult> {
    return (await runCli(argv, {
      env: { ELECTRON_USER_DATA: tmpDir },
    })) as CliResult;
  }

  describe("mirror parity (JS CLI side ↔ TS source)", () => {
    it("file names, method names and audio extensions match the TS constants", () => {
      expect(CLI_ENDPOINT_FILE_NAME).toBe(TS_ENDPOINT_FILE_NAME);
      expect(CLI_TOKEN_FILE_NAME).toBe(TOKEN_FILE_NAME);
      expect(CLI_SOCKET_FILE_NAME).toBe(SOCKET_FILE_NAME);
      expect(CLI_METHOD_STATUS).toBe(METHOD_STATUS);
      expect(CLI_METHOD_TRANSCRIBE_FILE).toBe(METHOD_TRANSCRIBE_FILE);
      expect(CLI_AUDIO_EXTENSIONS).toEqual([...AUDIO_EXTENSIONS]);
    });
  });

  describe("murmur status", () => {
    it("renders text output for a reachable app with downloaded models", async () => {
      freshTmp();
      await startServer(buildServices());
      publishChannelFiles(tmpDir, TOKEN);
      const result = await runBridgeCli(["status"]);
      expect(result.code).toBe(EXIT_OK);
      expect(result.stdout).toBe("Murmur 应用可达\n模型: 已下载\n");
      expect(result.stderr).toBe("");
    });

    it("renders 未下载 when the engine reports models missing", async () => {
      freshTmp();
      await startServer(
        buildServices({
          checkEngineStatus: async () => ({ models_downloaded: false }),
        }),
      );
      publishChannelFiles(tmpDir, TOKEN);
      const result = await runBridgeCli(["status"]);
      expect(result.code).toBe(EXIT_OK);
      expect(result.stdout).toBe("Murmur 应用可达\n模型: 未下载\n");
    });

    it("--json locks the exact schema { reachable, ...channelStatus }", async () => {
      freshTmp();
      await startServer(buildServices());
      publishChannelFiles(tmpDir, TOKEN);
      const result = await runBridgeCli(["status", "--json"]);
      expect(result.code).toBe(EXIT_OK);
      expect(JSON.parse(result.stdout)).toEqual({
        reachable: true,
        models_downloaded: true,
      });
    });

    it("unknown status flags are usage errors (exit 2)", async () => {
      freshTmp();
      const result = await runBridgeCli(["status", "--frobnicate"]);
      expect(result.code).toBe(EXIT_USAGE_ERROR);
      expect(result.stderr).toContain("--frobnicate");
    });
  });

  describe("murmur transcribe", () => {
    it("happy path: progress lines on stderr, transcript text on stdout", async () => {
      freshTmp();
      const transcribeFile = vi.fn(
        async (
          _audioPath: string,
          _options: Record<string, unknown>,
          onProgress?: (progress: unknown) => void,
        ) => {
          onProgress?.({
            type: "progress",
            phase: "asr",
            message: "语音识别中...",
            progress_pct: 40,
          });
          onProgress?.({
            type: "progress",
            phase: "asr",
            message: "语音识别中...",
            progress_pct: 90,
          });
          return { success: true, text: "你好世界" };
        },
      );
      await startServer(buildServices({ transcribeFile }));
      publishChannelFiles(tmpDir, TOKEN);
      const audioPath = path.join(os.tmpdir(), "murmur-267-sample.wav");
      const result = await runBridgeCli(["transcribe", audioPath]);
      expect(result.code).toBe(EXIT_OK);
      expect(result.stdout).toBe("你好世界\n");
      expect(result.stderr).toContain("转写中: 40%\n");
      expect(result.stderr).toContain("转写中: 90%\n");
      expect(transcribeFile).toHaveBeenCalledTimes(1);
      expect(transcribeFile.mock.calls[0]?.[0]).toBe(audioPath);
    });

    it("--json locks the exact channel result schema", async () => {
      freshTmp();
      const channelResult = { success: true, text: "通道结果", segments: [] };
      await startServer(
        buildServices({ transcribeFile: vi.fn(async () => channelResult) }),
      );
      publishChannelFiles(tmpDir, TOKEN);
      const result = await runBridgeCli([
        "transcribe",
        path.join(os.tmpdir(), "murmur-267-sample.wav"),
        "--json",
      ]);
      expect(result.code).toBe(EXIT_OK);
      expect(JSON.parse(result.stdout)).toEqual(channelResult);
    });

    it("rejects an unsupported extension locally as a usage error before any connection", async () => {
      freshTmp();
      // No server, no discovery files: reaching the network would produce
      // exit 4, so exit 2 proves the local gate fired first.
      const result = await runBridgeCli([
        "transcribe",
        path.join(os.tmpdir(), "notes.txt"),
      ]);
      expect(result.code).toBe(EXIT_USAGE_ERROR);
      expect(result.stderr).toContain("不支持的音频格式");
    });

    it("--diarize is honestly unsupported: exit 1, no faked output", async () => {
      freshTmp();
      await startServer(buildServices());
      publishChannelFiles(tmpDir, TOKEN);
      const result = await runBridgeCli([
        "transcribe",
        path.join(os.tmpdir(), "murmur-267-sample.wav"),
        "--diarize",
      ]);
      expect(result.code).toBe(EXIT_RUNTIME_ERROR);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("尚未支持");
    });

    it("--save is accepted as the documented default (no behaviour change)", async () => {
      freshTmp();
      await startServer(buildServices());
      publishChannelFiles(tmpDir, TOKEN);
      const withFlag = await runBridgeCli([
        "transcribe",
        path.join(os.tmpdir(), "murmur-267-sample.wav"),
        "--save",
      ]);
      expect(withFlag.code).toBe(EXIT_OK);
      expect(withFlag.stdout).toBe("转录结果\n");
      // The flag never reaches the channel params (it is a CLI-side no-op;
      // persistence is unconditional in the service, matching the GUI).
      expect(withFlag.stderr).not.toContain("--save");
    });

    it("missing <file> positional is a usage error (exit 2)", async () => {
      freshTmp();
      const result = await runBridgeCli(["transcribe"]);
      expect(result.code).toBe(EXIT_USAGE_ERROR);
      expect(result.stderr).toContain("missing <file>");
    });

    it("surfaces a service-side failure envelope as a runtime error (exit 1)", async () => {
      freshTmp();
      await startServer(
        buildServices({
          transcribeFile: vi.fn(async () => ({
            success: false,
            error: "引擎未就绪",
          })),
        }),
      );
      publishChannelFiles(tmpDir, TOKEN);
      const result = await runBridgeCli([
        "transcribe",
        path.join(os.tmpdir(), "murmur-267-sample.wav"),
      ]);
      expect(result.code).toBe(EXIT_RUNTIME_ERROR);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("引擎未就绪");
    });
  });

  describe("exit code 4: app-side unavailability", () => {
    it("app not running (no discovery files at all) exits 4 with an actionable message", async () => {
      freshTmp();
      const result = await runBridgeCli(["status"]);
      expect(result.code).toBe(EXIT_BRIDGE_UNAVAILABLE);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("应用可能未运行");
    });

    it("a stale endpoint file (published path is dead) exits 4 via connect failure", async () => {
      freshTmp();
      // Discovery files present, but nothing is listening behind them —
      // a crashed previous instance. connect() must fail (ENOENT on unix,
      // ENOENT on a missing win32 pipe) and classify as unreachable.
      const deadEndpoint =
        process.platform === "win32"
          ? `\\\\.\\pipe\\murmur-test-267-dead-${process.pid}`
          : path.join(tmpDir, "dead.sock");
      writeChannelEndpointFile(tmpDir, deadEndpoint, process.platform);
      writeChannelTokenFile(tmpDir, TOKEN, process.platform);
      const result = await runBridgeCli(["status"]);
      expect(result.code).toBe(EXIT_BRIDGE_UNAVAILABLE);
      expect(result.stderr).toContain("应用可能未运行");
    });

    it("wrong token in the discovery file: handshake rejection exits 4 without echoing the token", async () => {
      freshTmp();
      await startServer(buildServices());
      publishChannelFiles(tmpDir, WRONG_TOKEN);
      const result = await runBridgeCli(["status"]);
      expect(result.code).toBe(EXIT_BRIDGE_UNAVAILABLE);
      expect(result.stderr).toContain("握手被拒绝");
      expect(result.stderr).not.toContain(WRONG_TOKEN);
    });
  });

  describe("failure classification (pure unit)", () => {
    it("distinguishes timeout, handshake rejection and unreachable connect failures", () => {
      const timeout = classifyConnectFailure(
        new Error("local-channel-connect-timeout"),
      );
      expect(timeout?.kind).toBe("timeout");

      const handshake = classifyConnectFailure(new Error("token-rejected"));
      expect(handshake?.kind).toBe("handshake");

      const limit = classifyConnectFailure(
        new Error("connection-limit-rejected"),
      );
      expect(limit?.kind).toBe("handshake");

      const enoent = classifyConnectFailure(
        Object.assign(new Error("connect ENOENT /tmp/x.sock"), {
          code: "ENOENT",
        }),
      );
      expect(enoent?.kind).toBe("unreachable");
      expect(enoent?.message).toContain("应用可能未运行");

      // Anything unrecognised stays unclassified → ordinary runtime error.
      expect(
        classifyConnectFailure(new Error("local-channel-malformed")),
      ).toBeNull();
    });

    it("BridgeUnavailableError carries its exit-4 kind", () => {
      const error = new BridgeUnavailableError(
        "unreachable",
        "无法连接 Murmur 应用",
      );
      expect(error.kind).toBe("unreachable");
      expect(error.message).toContain("无法连接");
    });
  });

  describe("local extension gate (audioPathValidator mirror)", () => {
    it("accepts every whitelisted extension and rejects others with the app's message", () => {
      for (const ext of CLI_AUDIO_EXTENSIONS) {
        expect(validateAudioExtension(`/some/dir/audio${ext}`).valid).toBe(
          true,
        );
      }
      const rejected = validateAudioExtension("/some/dir/notes.txt");
      expect(rejected.valid).toBe(false);
      if (!rejected.valid) {
        expect(rejected.error).toBe("不支持的音频格式: .txt");
      }
    });

    // [20260912_Fix_267_ReviewProgressDup] The real entry streams progress
    // live via ctx.stderrWrite; the returned result.stderr must then stay
    // EMPTY of progress — buffering too would double-emit every line when
    // the entry flushes result.stderr.
    it("streams progress via stderrWrite without buffering it into result.stderr", async () => {
      freshTmp();
      const streamed: string[] = [];
      await startServer(
        buildServices({
          transcribeFile: vi.fn(
            (
              _audioPath: string,
              _options: Record<string, unknown>,
              onProgress?: (progress: unknown) => void,
            ) => {
              onProgress?.({
                phase: "asr",
                message: "语音识别中...",
                progress_pct: 50,
              });
              return Promise.resolve({ success: true, text: "流式结果" });
            },
          ),
        }),
      );
      publishChannelFiles(tmpDir, TOKEN);
      const result = (await runCli(
        ["transcribe", path.join(os.tmpdir(), "murmur-267-sample.wav")],
        {
          env: { ELECTRON_USER_DATA: tmpDir },
          stderrWrite: (line: string) => {
            streamed.push(line);
          },
        },
      )) as CliResult;
      expect(result.code).toBe(EXIT_OK);
      expect(streamed.join("")).toContain("转写中");
      expect(result.stderr).not.toContain("转写中");
    });
  });
});
