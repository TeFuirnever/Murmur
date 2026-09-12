// [20260912_Feat_CliSkeleton] Core argv->result runner for the murmur CLI
// (ticket #264, spec #258). Pure-ish function level: runCli(argv, options)
// returns { code, stdout, stderr } — the entry point (cli/murmur.mjs) only
// wires process streams and process.exit onto that result. This shape keeps
// the locked CLI conventions structural and unit-testable without spawning a
// process:
//   - `--json` switches stdout to a stable JSON schema (per subcommand)
//   - exit codes: 0 success / 1 runtime error / 2 usage error / 4 app
//     unreachable (bridge subcommands only, ticket #267)
//   - logs, progress and error text go to stderr only; stdout carries results
//   - no prompts, no spinners: every code path either prints and exits
// Local subcommands (the app does NOT need to be running):
//   murmur config get <key> | config set <key> <value> | history list
// Bridge subcommands (ticket #267 — require the running app's local channel;
// these return a PROMISE of the result, see the runCli JSDoc):
//   murmur status | transcribe <file> [--diarize] [--save]
import {
  resolveConfigPath,
  resolveDatabasePath,
  resolveDataDirectory,
} from "./paths.mjs";
import { isConfigKey } from "./configKeys.mjs";
import { readConfig, writeConfig } from "./configStore.mjs";
import { DEFAULT_HISTORY_LIMIT, listTranscriptions } from "./historyReader.mjs";
import {
  BridgeUnavailableError,
  connectChannelBridge,
  validateAudioExtension,
} from "./channelBridge.mjs";
import os from "node:os";

// [20260912_Fix_264_ReviewFollowups] Mirrors validateSetting's
// MAX_VALUE_LENGTH in src/helpers/ipc/settingsHandlers.ts (boundary parity).
const MAX_VALUE_LENGTH = 10000;

export const EXIT_OK = 0;
export const EXIT_RUNTIME_ERROR = 1;
export const EXIT_USAGE_ERROR = 2;
// [20260912_Feat_267_BridgeTranscribe] Exit code 4 (reserved since #264) is
// now used by the bridge subcommands (status/transcribe): the running app is
// unreachable in the broad sense — not running (ENOENT/discovery file
// missing), handshake rejected (token mismatch), or connect timed out.
export const EXIT_BRIDGE_UNAVAILABLE = 4;

/** Long preview cap for text-mode history lines (not applied to --json). */
const TEXT_PREVIEW_MAX_CHARS = 120;
const TEXT_PREVIEW_ELLIPSIS = "…";

const USAGE = `murmur — Murmur command line interface

Usage:
  murmur config get <key>              Read a whitelisted setting from murmur.json
  murmur config set <key> <value>      Write a whitelisted setting to murmur.json
  murmur history list [--query <text>] [--limit N] [--json]
                                       List transcriptions directly from SQLite (read-only)
  murmur status [--json]               Show the running app's engine status (app must be running)
  murmur transcribe <file> [--json]    Transcribe an audio file via the running app
                                       --save  accepted for compatibility; file
                                       transcriptions are ALWAYS saved to history
                                       (same as the GUI), so this is the default
                                       --diarize  not supported yet on the channel

Global options:
  --json                               Structured JSON output on stdout
  --version                            Print the CLI version
  --help                               Show this help

Notes:
  - Whitelisted keys are the same list the app enforces for settings.
  - status/transcribe talk to the running Murmur app over its local channel;
    when the app is unreachable they exit with code 4.
  - exit codes: 0 success, 1 runtime error, 2 usage error, 4 app unreachable.
  - Logs, progress and errors go to stderr; results go to stdout.`;

function ok(stdout = "", stderr = "") {
  return { code: EXIT_OK, stdout, stderr };
}

function usageError(message) {
  return {
    code: EXIT_USAGE_ERROR,
    stdout: "",
    stderr: `${message}\n\n${USAGE}\n`,
  };
}

function runtimeError(context, message) {
  return {
    code: EXIT_RUNTIME_ERROR,
    stdout: "",
    stderr: `murmur ${context}: ${message}\n`,
  };
}

// [20260912_Feat_267_BridgeTranscribe] Map a bridge failure to a result:
// BridgeUnavailableError (app not running / handshake rejected / timeout)
// exits 4; anything else is an ordinary runtime error (exit 1).
function bridgeError(context, error) {
  if (error instanceof BridgeUnavailableError) {
    return {
      code: EXIT_BRIDGE_UNAVAILABLE,
      stdout: "",
      stderr: `murmur ${context}: ${error.message}\n`,
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return runtimeError(context, message);
}

// Progress frames from the channel carry the FunASR worker's message shape
// ({ type: "progress", phase, message, progress_pct, ... }). Only the numeric
// percentage is rendered; every real progress frame carries progress_pct.
const PROGRESS_LINE_PREFIX = "转写中";

function formatProgressLine(progress) {
  const record =
    typeof progress === "object" && progress !== null ? progress : {};
  const percent = record.progress_pct;
  if (typeof percent === "number" && Number.isFinite(percent)) {
    return `${PROGRESS_LINE_PREFIX}: ${Math.round(percent)}%\n`;
  }
  return null;
}

/** Parse a CLI value the same way the app's JSON settings store would round-trip it. */
function parseSettingValue(rawValue) {
  try {
    return JSON.parse(rawValue);
  } catch {
    // Not valid JSON — store the literal string (e.g. `config set theme dark`).
    return rawValue;
  }
}

/** Format a setting value for text-mode stdout: strings bare, rest as JSON. */
function formatSettingValue(value) {
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** Single-line preview for text-mode history output (never applied to --json). */
function previewText(text) {
  const flat = String(text).replace(/\s+/g, " ").trim();
  if (flat.length <= TEXT_PREVIEW_MAX_CHARS) return flat;
  return flat.slice(0, TEXT_PREVIEW_MAX_CHARS) + TEXT_PREVIEW_ELLIPSIS;
}

/**
 * Split argv into a global-flag map and the positional tokens.
 * Accepts both `--flag value` and `--flag=value`. Unknown flags surface as
 * { unknown: true } so subcommand parsers can reject them as usage errors.
 * [20260912_Feat_267_BridgeTranscribe] `booleanFlags` lists valueless flags
 * (e.g. --diarize/--save); previously only --json was valueless (it is
 * stripped before dispatch, so the default empty set keeps every existing
 * caller's behaviour byte-identical).
 */
function parseArgs(argv, knownFlags, booleanFlags = new Set()) {
  const flags = {};
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const eqIndex = token.indexOf("=");
    const name = eqIndex === -1 ? token : token.slice(0, eqIndex);
    if (!knownFlags.has(name)) return { unknown: name };

    const takesValue = !booleanFlags.has(name);
    if (!takesValue) {
      flags[name] = true;
      continue;
    }
    if (eqIndex !== -1) {
      flags[name] = token.slice(eqIndex + 1);
      continue;
    }
    i += 1;
    // A following token that looks like another flag is never a value —
    // e.g. `--query --limit 5` must not search for the text "--limit".
    if (i >= argv.length || argv[i].startsWith("--")) return { missing: name };
    flags[name] = argv[i];
  }
  return { flags, positionals };
}

function runConfigGet(argv, ctx) {
  const parsed = parseArgs(argv, new Set());
  if (parsed.unknown)
    return usageError(`config get: unknown flag ${parsed.unknown}`);
  if (parsed.missing)
    return usageError(`config get: ${parsed.missing} requires a value`);
  if (parsed.positionals.length === 0)
    return usageError("config get: missing <key>");
  if (parsed.positionals.length > 1)
    return usageError("config get: unexpected extra arguments");

  const key = parsed.positionals[0];
  if (!isConfigKey(key)) return usageError(`config: key not allowed: ${key}`);

  const config = readConfig(ctx.configPath);
  const value = key in config ? config[key] : null;

  if (ctx.json) {
    return ok(`${JSON.stringify({ key, value })}\n`);
  }
  return ok(`${formatSettingValue(value)}\n`);
}

function runConfigSet(argv, ctx) {
  const parsed = parseArgs(argv, new Set());
  if (parsed.unknown)
    return usageError(`config set: unknown flag ${parsed.unknown}`);
  if (parsed.missing)
    return usageError(`config set: ${parsed.missing} requires a value`);
  if (parsed.positionals.length < 2)
    return usageError("config set: missing <key> and/or <value>");
  if (parsed.positionals.length > 2)
    return usageError("config set: unexpected extra arguments");

  const [key, rawValue] = parsed.positionals;
  if (!isConfigKey(key)) return usageError(`config: key not allowed: ${key}`);
  // [20260912_Fix_264_ReviewFollowups] Boundary parity with the IPC
  // settings path: values longer than MAX_VALUE_LENGTH are rejected there
  // (settingsHandlers validateSetting); the CLI must not accept what the
  // app's own write boundary would refuse.
  if (typeof rawValue === "string" && rawValue.length > MAX_VALUE_LENGTH) {
    return usageError(
      `config set: value exceeds ${MAX_VALUE_LENGTH} characters`,
    );
  }
  const value = parseSettingValue(rawValue);

  try {
    // Read-modify-write keeps every other whitelisted key in the file
    // (mirrors the app's syncToFileConfig behaviour).
    const config = readConfig(ctx.configPath);
    config[key] = value;
    writeConfig(ctx.configPath, config);
  } catch (error) {
    return runtimeError(
      `config set ${key}`,
      `cannot write ${ctx.configPath}: ${error.message}`,
    );
  }

  if (ctx.json) {
    return ok(`${JSON.stringify({ success: true, key, value })}\n`);
  }
  return ok();
}

function runHistoryList(argv, ctx) {
  const parsed = parseArgs(argv, new Set(["--query", "--limit"]));
  if (parsed.unknown)
    return usageError(`history list: unknown flag ${parsed.unknown}`);
  if (parsed.missing)
    return usageError(`history list: ${parsed.missing} requires a value`);
  if (parsed.positionals.length > 0)
    return usageError("history list: unexpected extra arguments");

  let limit = DEFAULT_HISTORY_LIMIT;
  if (parsed.flags["--limit"] !== undefined) {
    const rawLimit = parsed.flags["--limit"];
    if (!/^\d+$/.test(String(rawLimit)) || Number(rawLimit) < 1) {
      return usageError(
        `history list: --limit must be a positive integer, got ${rawLimit}`,
      );
    }
    limit = Number(rawLimit);
  }

  let records;
  try {
    records = listTranscriptions(ctx.dbPath, {
      query: parsed.flags["--query"] ?? null,
      limit,
    });
  } catch (error) {
    return runtimeError(
      "history list",
      `cannot read database at ${ctx.dbPath}: ${error.message}`,
    );
  }

  if (ctx.json) {
    return ok(`${JSON.stringify({ records })}\n`);
  }

  const lines = records.map(
    (record) =>
      `#${record.id}\t${record.created_at ?? ""}\t${previewText(record.text)}`,
  );
  return ok(lines.length > 0 ? `${lines.join("\n")}\n` : "");
}

// [20260912_Feat_267_BridgeTranscribe] --- bridge subcommands (ticket #267) ---
// Both talk to the running app's local channel; connection setup, endpoint/
// token discovery and the exit-4 classification live in channelBridge.mjs.

async function runStatus(argv, ctx) {
  const parsed = parseArgs(argv, new Set());
  if (parsed.unknown)
    return usageError(`status: unknown flag ${parsed.unknown}`);
  if (parsed.missing)
    return usageError(`status: ${parsed.missing} requires a value`);
  if (parsed.positionals.length > 0)
    return usageError("status: unexpected extra arguments");

  let bridge;
  try {
    bridge = await connectChannelBridge({
      env: ctx.env,
      platform: ctx.platform,
      homedir: ctx.homedir,
    });
  } catch (error) {
    return bridgeError("status", error);
  }

  let status;
  try {
    status = await bridge.requestStatus();
  } catch (error) {
    bridge.close();
    return bridgeError("status", error);
  }
  bridge.close();

  const record = typeof status === "object" && status !== null ? status : {};
  if (ctx.json) {
    // Locked schema: { reachable: true, ...channelStatusFields }.
    // [20260912_Fix_267_ReviewReachable] reachable is CLI-authoritative —
    // spread the channel payload FIRST so it can never override it.
    return ok(`${JSON.stringify({ ...record, reachable: true })}\n`);
  }
  const modelLine =
    record.models_downloaded === true ? "模型: 已下载" : "模型: 未下载";
  return ok(`Murmur 应用可达\n${modelLine}\n`);
}

async function runTranscribe(argv, ctx) {
  const parsed = parseArgs(
    argv,
    new Set(["--diarize", "--save"]),
    new Set(["--diarize", "--save"]),
  );
  if (parsed.unknown)
    return usageError(`transcribe: unknown flag ${parsed.unknown}`);
  if (parsed.missing)
    return usageError(`transcribe: ${parsed.missing} requires a value`);
  if (parsed.positionals.length === 0)
    return usageError("transcribe: missing <file>");
  if (parsed.positionals.length > 1)
    return usageError("transcribe: unexpected extra arguments");
  const audioPath = parsed.positionals[0];

  // --diarize is not exposed on the local channel yet (the underlying IPC
  // diarize entry is out of #267's scope). Fail honestly — never fake it.
  if (parsed.flags["--diarize"]) {
    return runtimeError(
      "transcribe",
      "--diarize 尚未支持：说话人分离尚未通过本地通道开放（计划在后续 ticket 中暴露）",
    );
  }

  // [20260912_Feat_267_BridgeTranscribe] Local extension gate (mirror of
  // audioPathValidator's whitelist) BEFORE any connection: a typo'd path is
  // a fast usage error, while the app re-validates the full path
  // authoritatively once the request arrives.
  const extensionCheck = validateAudioExtension(audioPath);
  if (!extensionCheck.valid) {
    return usageError(`transcribe: ${extensionCheck.error}`);
  }

  // --save is accepted-and-default (documented no-op): the channel service
  // (transcribeFileService) persists every successful file transcription
  // server-side, matching GUI behaviour, and the ticket forbids changing
  // that service behaviour. If a persistence switch is ever added to the
  // service options, wire it through requestTranscribe's params here.

  let bridge;
  try {
    bridge = await connectChannelBridge({
      env: ctx.env,
      platform: ctx.platform,
      homedir: ctx.homedir,
    });
  } catch (error) {
    return bridgeError("transcribe", error);
  }

  let result;
  try {
    result = await bridge.requestTranscribe(audioPath, {}, (progress) => {
      // [20260912_Fix_267_ReviewProgressDup] Stream-or-buffer EXCLUSIVELY:
      // the real entry streams live (ctx.stderrWrite wired) — buffering too
      // would re-emit every line when the entry flushes result.stderr.
      // Function-level callers (no stderrWrite) keep the buffered contract.
      const line = formatProgressLine(progress);
      if (line === null) return;
      if (ctx.stderrWrite) {
        ctx.stderrWrite(line);
      } else {
        ctx.stderrChunks.push(line);
      }
    });
  } catch (error) {
    bridge.close();
    return bridgeError("transcribe", error);
  }
  bridge.close();

  const record = typeof result === "object" && result !== null ? result : {};
  if (record.success === false) {
    const message =
      typeof record.error === "string" ? record.error : "未知错误";
    // [20260912_Fix_267_ReviewProgressDup] Function-level callers keep the
    // partial progress accumulated before the failure (the real entry
    // already streamed it live).
    const partial = ctx.stderrChunks.join("");
    const failure = runtimeError("transcribe", `转写失败: ${message}`);
    return { ...failure, stderr: partial + failure.stderr };
  }

  const progressText = ctx.stderrChunks.join("");
  if (ctx.json) {
    // Locked schema: the channel result verbatim (success/text/segments/id…).
    return ok(`${JSON.stringify(result)}\n`, progressText);
  }
  const text = typeof record.text === "string" ? record.text : "";
  return ok(`${text}\n`, progressText);
}

/**
 * Run one CLI invocation. argv excludes the node/electron and script paths.
 *
 * [20260912_Feat_267_BridgeTranscribe] The bridge subcommands (status,
 * transcribe) are inherently async — they connect to the running app — so
 * for those two commands runCli returns a PROMISE of the result shape below;
 * the local subcommands still resolve synchronously (locked #264 contract).
 * Callers MUST `await` the result (awaiting a plain result is a no-op).
 * The @returns type documents the sync shape so existing sync callers keep
 * typechecking unchanged; bridge results carry the identical shape.
 *
 * @param {string[]} argv
 * @param {object} [options]
 * @param {Record<string, string | undefined>} [options.env] Environment (defaults to process.env).
 * @param {string} [options.platform] Platform (defaults to process.platform).
 * @param {() => string} [options.homedir] Home dir resolver (defaults to os.homedir).
 * @param {string} [options.configPath] Explicit murmur.json path (skips env derivation).
 * @param {string} [options.dbPath] Explicit SQLite path (skips env derivation).
 * @param {(chunk: string) => void} [options.stderrWrite] Streaming sink for
 *   progress lines (wired to process.stderr by the entry point; tests omit it
 *   and read the accumulated stderr instead).
 * @param {string} [options.version] Version string for --version.
 * @returns {{ code: number, stdout: string, stderr: string }}
 */
export function runCli(argv, options = {}) {
  // `--json` is a global flag honoured at any position (locked convention:
  // "--json structured output on stdout"), so strip it before command
  // dispatch — subcommand parsers never see it.
  const json = argv.includes("--json");
  const dispatch = argv.filter((token) => token !== "--json");
  const pathContext = {
    env: options.env ?? process.env,
    platform: options.platform ?? process.platform,
    homedir: options.homedir ?? os.homedir,
  };
  const ctx = {
    configPath: options.configPath ?? resolveConfigPath(pathContext),
    dbPath: options.dbPath ?? resolveDatabasePath(pathContext),
    // [20260912_Feat_267_BridgeTranscribe] Bridge subcommands resolve the
    // channel endpoint/token from the same userData derivation.
    userDataPath: resolveDataDirectory(pathContext),
    env: pathContext.env,
    platform: pathContext.platform,
    homedir: pathContext.homedir,
    json,
    version: options.version ?? "",
    stderrWrite: options.stderrWrite ?? null,
    stderrChunks: [],
  };

  if (dispatch.includes("--version")) {
    return ok(`${ctx.version || "unknown"}\n`);
  }
  if (dispatch.includes("--help")) {
    return ok(`${USAGE}\n`);
  }

  const [command, subcommand, ...rest] = dispatch;
  if (command === undefined) return usageError("missing command");
  // [20260912_Feat_267_BridgeTranscribe] Bridge subcommand registration:
  // these return Promises (see JSDoc above); every other command stays sync.
  // status/transcribe are single-word commands — dispatch.slice(1) is their
  // FULL argument tail (the destructure above would park the first
  // positional in `subcommand`). The JSDoc casts pin runCli's documented
  // result type for TS consumers (boundary cast, established TypeRelax
  // pattern): bridge results carry the same { code, stdout, stderr } shape.
  if (command === "status") {
    return /** @type {{ code: number, stdout: string, stderr: string }} */ (
      runStatus(dispatch.slice(1), ctx)
    );
  }
  if (command === "transcribe") {
    return /** @type {{ code: number, stdout: string, stderr: string }} */ (
      runTranscribe(dispatch.slice(1), ctx)
    );
  }
  if (command !== "config" && command !== "history") {
    return usageError(`unknown command: ${command}`);
  }

  if (command === "config") {
    if (subcommand === "get") return runConfigGet(rest, ctx);
    if (subcommand === "set") return runConfigSet(rest, ctx);
    return usageError(`unknown config subcommand: ${String(subcommand)}`);
  }

  // command === "history": the only subcommand in this batch is `list`.
  if (subcommand === "list") return runHistoryList(rest, ctx);
  return usageError(`unknown history subcommand: ${String(subcommand)}`);
}
