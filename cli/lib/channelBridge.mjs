// [20260912_Feat_267_BridgeTranscribe] Bridge client kernel for the murmur
// CLI (ticket #267). Connects the CLI to the running app's local channel
// (ticket #265): endpoint + token discovery from userData, the bundled TS
// client kernel (cli/dist/channelClient.mjs, built from
// src/helpers/localChannel/client.ts by `pnpm run build:cli` — a single
// source, so CLI/server protocol parity is zero-risk by construction), and
// the exit-code-4 failure classification:
//   - app not running  (endpoint/token file missing, connect ENOENT/ECONNREFUSED)
//   - handshake failure (token-rejected / connection-limit-rejected)
//   - timeout          (local-channel-connect-timeout)
// All three surface as BridgeUnavailableError (exit 4); everything else is a
// plain runtime failure (exit 1). SECURITY: the token never appears in any
// message, result, or stdout payload produced here.
import fs from "node:fs";
import path from "node:path";
import { resolveDataDirectory } from "./paths.mjs";

// [20260912_Feat_267_BridgeTranscribe] File names mirrored from
// src/helpers/localChannel (protocol.ts + endpoint.ts). Parity with the TS
// constants is locked by tests/unit/cli-bridge.test.ts — keep in sync.
export const ENDPOINT_FILE_NAME = "murmur-channel-endpoint";
export const TOKEN_FILE_NAME = "murmur-channel-token";
export const SOCKET_FILE_NAME = "murmur-channel.sock";

// Channel method names mirrored from protocol.ts (METHOD_STATUS /
// METHOD_TRANSCRIBE_FILE); parity locked by the same test.
export const METHOD_STATUS = "status";
export const METHOD_TRANSCRIBE_FILE = "transcribe_file";

// esbuild bundle of src/helpers/localChannel/client.ts (see build:cli).
const CHANNEL_CLIENT_BUNDLE_URL = new URL(
  "../dist/channelClient.mjs",
  import.meta.url,
);

// [20260912_Feat_267_BridgeTranscribe] Extension whitelist mirrored from
// src/helpers/ipc-contracts.ts AUDIO_EXTENSIONS (via audioPathValidator).
// The CLI checks the extension LOCALLY before any connection so a typo'd
// path fails fast as a usage error (exit 2); the app re-validates the full
// path authoritatively (allowed dirs, realpath, UNC) server-side.
export const CLI_AUDIO_EXTENSIONS = [
  ".wav",
  ".mp3",
  ".m4a",
  ".flac",
  ".ogg",
  ".wma",
  ".aac",
];

// errno values treated as "the endpoint is not being served" during
// connect (app not running / stale socket). ENOENT is the common unix case;
// ECONNREFUSED/EACCES/EPERM cover socket and permission variants.
const CONNECT_FAILURE_ERRNOS = new Set([
  "ENOENT",
  "ECONNREFUSED",
  "EACCES",
  "EPERM",
  "ENOTDIR",
  "ELOOP",
]);

// Handshake-level rejection frame payloads (id-less error frames) that the
// client turns into connect() rejections with these exact messages.
const HANDSHAKE_REJECTION_MESSAGES = new Set([
  "token-rejected",
  "connection-limit-rejected",
]);

const CONNECT_TIMEOUT_MESSAGE = "local-channel-connect-timeout";

const APP_NOT_RUNNING_MESSAGE =
  "无法连接 Murmur 应用：应用可能未运行，请先启动 Murmur 桌面应用后重试";
const HANDSHAKE_REJECTED_MESSAGE =
  "本地通道握手被拒绝（令牌校验失败）。Murmur 每次启动都会更新令牌，" +
  "若应用刚重启请稍后重试";
const CONNECTION_LIMIT_MESSAGE =
  "本地通道连接数已达上限，请关闭其他 murmur 命令行会话后重试";
const CONNECT_TIMEOUT_STDERR_MESSAGE =
  "连接 Murmur 应用超时，请确认应用正在运行且未挂起后重试";

/**
 * A bridge failure that maps to exit code 4 (app side unreachable, in the
 * broad sense: not running, handshake rejected, or connect timed out).
 * `kind` distinguishes the three classes for tests and diagnostics.
 */
export class BridgeUnavailableError extends Error {
  constructor(kind, message) {
    super(message);
    this.name = "BridgeUnavailableError";
    this.kind = kind; // "unreachable" | "handshake" | "timeout"
  }
}

/** Narrow an unknown parsed value to a plain object record. */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Classify a client-side connect/request failure. Pure function over the
 * error shape — the bundled client rejects with the raw net error for
 * socket-level connect failures, the rejection-frame string for handshake
 * failures, and a tagged message for timeouts.
 */
export function classifyConnectFailure(error) {
  const message = error instanceof Error ? error.message : String(error);
  const errno =
    isRecord(error) && typeof error.code === "string" ? error.code : null;
  if (message === CONNECT_TIMEOUT_MESSAGE) {
    return { kind: "timeout", message: CONNECT_TIMEOUT_STDERR_MESSAGE };
  }
  if (HANDSHAKE_REJECTION_MESSAGES.has(message)) {
    return {
      kind: "handshake",
      message:
        message === "connection-limit-rejected"
          ? CONNECTION_LIMIT_MESSAGE
          : HANDSHAKE_REJECTED_MESSAGE,
    };
  }
  if (
    (errno && CONNECT_FAILURE_ERRNOS.has(errno)) ||
    message.startsWith("connect ")
  ) {
    const detail = errno ?? message;
    return {
      kind: "unreachable",
      message: `${APP_NOT_RUNNING_MESSAGE}（原因: ${detail}）`,
    };
  }
  return null;
}

/** Read a small text file, returning null when absent/unreadable. */
function readTrimmedFile(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8").trim();
  } catch {
    return null;
  }
}

/**
 * Resolve the channel endpoint the running app published.
 * Order (ticket #267): the endpoint discovery file first (the Windows
 * contract — pipe names are per-launch random and cannot be guessed), then
 * the deterministic unix socket path as fallback (a stale socket from a
 * crashed app simply fails the connect probe below, same as app-not-running).
 */
export function resolveBridgeEndpoint(userDataPath, platform) {
  const fromFile = readTrimmedFile(path.join(userDataPath, ENDPOINT_FILE_NAME));
  if (fromFile) return fromFile;
  if (platform !== "win32") {
    return path.join(userDataPath, SOCKET_FILE_NAME);
  }
  // Windows without a discovery file: the random pipe name is unknowable.
  throw new BridgeUnavailableError("unreachable", APP_NOT_RUNNING_MESSAGE);
}

/** Load the bundled TS client kernel. A missing bundle is a CLI
 * installation/build problem (exit 1, not exit 4): the fix is rebuilding.
 */
async function loadChannelClientModule() {
  try {
    // .href is already a valid file:// URL (built from import.meta.url).
    return await import(CHANNEL_CLIENT_BUNDLE_URL.href);
  } catch {
    throw new Error(
      "CLI 桥接客户端内核缺失：未找到 cli/dist/channelClient.mjs，" +
        "请运行 pnpm run build:cli 重新构建后再试",
    );
  }
}

/**
 * Connect to the running app's local channel.
 *
 * @param {object} [options]
 * @param {Record<string, string | undefined>} [options.env] Environment
 *   (defaults to process.env) — ELECTRON_USER_DATA selects the userData dir
 *   (same derivation as cli/lib/paths.mjs).
 * @param {string} [options.platform] Platform (defaults to process.platform).
 * @param {() => string} [options.homedir] Home dir resolver.
 * @param {number} [options.connectTimeoutMs] Connect+handshake timeout.
 * @returns {Promise<{endpointPath: string, requestStatus: () => Promise<unknown>,
 *   requestTranscribe: (audioPath: string, options?: Record<string, unknown>,
 *   onProgress?: (progress: unknown) => void) => Promise<unknown>, close: () => void}>}
 */
export async function connectChannelBridge(options = {}) {
  const platform = options.platform ?? process.platform;
  const userDataPath = resolveDataDirectory({
    env: options.env ?? process.env,
    platform,
    homedir: options.homedir,
  });

  // Token first (missing token file == app never launched: it is published
  // on every startup right after the channel binds, fail-closed).
  const token = readTrimmedFile(path.join(userDataPath, TOKEN_FILE_NAME));
  if (token === null) {
    throw new BridgeUnavailableError(
      "unreachable",
      `${APP_NOT_RUNNING_MESSAGE}（未找到本地通道令牌文件）`,
    );
  }
  const endpointPath = resolveBridgeEndpoint(userDataPath, platform);

  const { createChannelClient } = await loadChannelClientModule();
  const client = createChannelClient({
    endpointPath,
    token,
    ...(options.connectTimeoutMs !== undefined
      ? { connectTimeoutMs: options.connectTimeoutMs }
      : {}),
  });
  try {
    await client.connect();
  } catch (error) {
    client.close();
    const classified = classifyConnectFailure(error);
    if (classified) {
      throw new BridgeUnavailableError(classified.kind, classified.message);
    }
    throw error;
  }

  return {
    endpointPath,
    requestStatus() {
      return client.request(METHOD_STATUS, {});
    },
    requestTranscribe(audioPath, params = {}, onProgress) {
      return client.request(
        METHOD_TRANSCRIBE_FILE,
        { audioPath, options: params },
        onProgress,
      );
    },
    close() {
      client.close();
    },
  };
}

/**
 * Local (pre-connection) audio extension check mirroring audioPathValidator's
 * whitelist gate. Message mirrors the validator's 「不支持的音频格式: <ext>」
 * so CLI and app diagnostics read identically.
 */
export function validateAudioExtension(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (!CLI_AUDIO_EXTENSIONS.includes(ext)) {
    return { valid: false, error: `不支持的音频格式: ${ext || ""}` };
  }
  return { valid: true };
}
