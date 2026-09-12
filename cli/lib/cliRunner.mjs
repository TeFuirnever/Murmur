// [20260912_Feat_CliSkeleton] Core argv->result runner for the murmur CLI
// (ticket #264, spec #258). Pure-ish function level: runCli(argv, options)
// returns { code, stdout, stderr } — the entry point (cli/murmur.mjs) only
// wires process streams and process.exit onto that result. This shape keeps
// the locked CLI conventions structural and unit-testable without spawning a
// process:
//   - `--json` switches stdout to a stable JSON schema (per subcommand)
//   - exit codes: 0 success / 1 runtime error / 2 usage error (4 reserved)
//   - logs, progress and error text go to stderr only; stdout carries results
//   - no prompts, no spinners: every code path either prints and exits
// Local subcommands only (the app does NOT need to be running):
//   murmur config get <key> | config set <key> <value> | history list
import { resolveConfigPath, resolveDatabasePath } from "./paths.mjs";
import { isConfigKey } from "./configKeys.mjs";
import { readConfig, writeConfig } from "./configStore.mjs";
import { DEFAULT_HISTORY_LIMIT, listTranscriptions } from "./historyReader.mjs";
import os from "node:os";

export const EXIT_OK = 0;
export const EXIT_RUNTIME_ERROR = 1;
export const EXIT_USAGE_ERROR = 2; // 4 is reserved for future use, unused here.

/** Long preview cap for text-mode history lines (not applied to --json). */
const TEXT_PREVIEW_MAX_CHARS = 120;
const TEXT_PREVIEW_ELLIPSIS = "…";

const USAGE = `murmur — Murmur command line interface

Usage:
  murmur config get <key>              Read a whitelisted setting from murmur.json
  murmur config set <key> <value>      Write a whitelisted setting to murmur.json
  murmur history list [--query <text>] [--limit N] [--json]
                                       List transcriptions directly from SQLite (read-only)

Global options:
  --json                               Structured JSON output on stdout
  --version                            Print the CLI version
  --help                               Show this help

Notes:
  - Whitelisted keys are the same list the app enforces for settings.
  - exit codes: 0 success, 1 runtime error, 2 usage error.
  - Logs and errors go to stderr; results go to stdout.`;

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
 */
function parseArgs(argv, knownFlags) {
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

    const takesValue = name !== "--json";
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

/**
 * Run one CLI invocation. argv excludes the node/electron and script paths.
 *
 * @param {string[]} argv
 * @param {object} [options]
 * @param {Record<string, string | undefined>} [options.env] Environment (defaults to process.env).
 * @param {string} [options.platform] Platform (defaults to process.platform).
 * @param {() => string} [options.homedir] Home dir resolver (defaults to os.homedir).
 * @param {string} [options.configPath] Explicit murmur.json path (skips env derivation).
 * @param {string} [options.dbPath] Explicit SQLite path (skips env derivation).
 * @param {string} [options.version] Version string for --version.
 * @returns {{ code: number, stdout: string, stderr: string }}
 */
export function runCli(argv, options = {}) {
  // `--json` is a global flag honoured at any position (locked convention:
  // "--json structured output on stdout"), so strip it before command
  // dispatch — subcommand parsers never see it.
  const json = argv.includes("--json");
  const dispatch = argv.filter((token) => token !== "--json");
  const ctx = {
    configPath:
      options.configPath ??
      resolveConfigPath({
        env: options.env ?? process.env,
        platform: options.platform ?? process.platform,
        homedir: options.homedir ?? os.homedir,
      }),
    dbPath:
      options.dbPath ??
      resolveDatabasePath({
        env: options.env ?? process.env,
        platform: options.platform ?? process.platform,
        homedir: options.homedir ?? os.homedir,
      }),
    json,
    version: options.version ?? "",
  };

  if (dispatch.includes("--version")) {
    return ok(`${ctx.version || "unknown"}\n`);
  }
  if (dispatch.includes("--help")) {
    return ok(`${USAGE}\n`);
  }

  const [command, subcommand, ...rest] = dispatch;
  if (command === undefined) return usageError("missing command");
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
