// [20260912_Feat_CliSkeleton] `murmur config get/set` tests (ticket #264).
// Covers: whitelist enforcement (out-of-whitelist key -> usage error, exit 2,
// whitelist parity against fileConfig's FILE_CONFIGURABLE_KEYS),
// murmur.json read/write semantics mirrored from src/helpers/fileConfig.ts,
// typed value round-trips, and the TS<->mjs whitelist parity lock. All
// function-level via runCli; no process spawn.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runCli } from "../../cli/lib/cliRunner.mjs";
import { CONFIG_KEYS, isConfigKey } from "../../cli/lib/configKeys.mjs";
import { readConfig } from "../../cli/lib/configStore.mjs";
// [20260912_Fix_264_ConfigWhitelistScope] Parity target is fileConfig's
// FILE_CONFIGURABLE_KEYS (what murmur.json actually honors), not the IPC
// settings allowlist — see cli/lib/configKeys.mjs for the rationale.
import { validateSetting } from "../../src/helpers/ipc/settingsHandlers";
import { FILE_CONFIGURABLE_KEYS } from "../../src/helpers/fileConfig";

describe("cli config whitelist parity", () => {
  // [20260912_Fix_264_ConfigWhitelistScope] The CLI list must equal the
  // file-config whitelist in BOTH directions: writing a key outside it
  // would be silently ignored by the app, and missing a key inside it
  // would strand a configurable in GUI-only land.
  it("CONFIG_KEYS mirrors FILE_CONFIGURABLE_KEYS exactly (both directions)", () => {
    expect(new Set(CONFIG_KEYS)).toEqual(new Set(FILE_CONFIGURABLE_KEYS));
    // Duplicate-free mirror: same cardinality as the set.
    expect(CONFIG_KEYS.length).toBe(FILE_CONFIGURABLE_KEYS.length);
  });

  // [20260912_Fix_264_ConfigWhitelistScope] Secret hygiene lock: the
  // decrypted AI key must NEVER be CLI-configurable into the plaintext
  // murmur.json (fileConfig excludes it by design).
  it("never exposes the ai_api_key secret through the config subcommand", () => {
    expect(isConfigKey("ai_api_key")).toBe(false);
  });

  it("isConfigKey agrees with validateSetting's key check for every CLI key", () => {
    for (const key of CONFIG_KEYS) {
      expect(isConfigKey(key)).toBe(true);
      // Every file-configurable key is also legal at the IPC settings
      // boundary (superset property; any string value passes its length
      // check).
      expect(validateSetting(key, "x")).toBe(true);
    }
  });
});

describe("cli config get", () => {
  let dir: string;
  let configPath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-cli-config-"));
    configPath = path.join(dir, "murmur.json");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("reads an existing string key in text mode (bare value on stdout)", () => {
    fs.writeFileSync(
      configPath,
      JSON.stringify({ ai_model: "qwen2.5", theme: "dark" }),
    );
    const result = runCli(["config", "get", "ai_model"], { configPath });
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("qwen2.5\n");
    expect(result.stderr).toBe("");
  });

  it("formats non-string values as JSON in text mode", () => {
    fs.writeFileSync(
      configPath,
      JSON.stringify({ ai_temperature: 0.7, auto_paste: true }),
    );
    expect(
      runCli(["config", "get", "ai_temperature"], { configPath }).stdout,
    ).toBe("0.7\n");
    expect(runCli(["config", "get", "auto_paste"], { configPath }).stdout).toBe(
      "true\n",
    );
  });

  it("returns null for a whitelisted key that is not set (exit 0)", () => {
    const result = runCli(["config", "get", "theme"], { configPath });
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("null\n");
  });

  it("--json emits the stable { key, value } schema", () => {
    fs.writeFileSync(configPath, JSON.stringify({ ai_model: "qwen2.5" }));
    const result = runCli(["config", "get", "ai_model", "--json"], {
      configPath,
    });
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      key: "ai_model",
      value: "qwen2.5",
    });
  });

  it("rejects an out-of-whitelist key with a usage error (exit 2)", () => {
    const result = runCli(["config", "get", "not_a_real_key"], { configPath });
    expect(result.code).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("not_a_real_key");
  });

  it("rejects a missing key argument (exit 2)", () => {
    const result = runCli(["config", "get"], { configPath });
    expect(result.code).toBe(2);
  });

  it("treats a corrupted murmur.json as empty (app parity: reads degrade to {})", () => {
    fs.writeFileSync(configPath, "{ not valid json");
    const result = runCli(["config", "get", "theme"], { configPath });
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("null\n");
  });
});

describe("cli config set", () => {
  let dir: string;
  let configPath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-cli-config-"));
    configPath = path.join(dir, "murmur.json");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("writes a string value silently in text mode (exit 0, empty stdout)", () => {
    const result = runCli(["config", "set", "theme", "dark"], { configPath });
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("");
    expect(readConfig(configPath)).toEqual({ theme: "dark" });
  });

  it("parses JSON-looking values into typed settings (number, boolean)", () => {
    runCli(["config", "set", "ai_temperature", "0.7"], { configPath });
    runCli(["config", "set", "auto_paste", "true"], { configPath });
    const written = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    expect(written).toEqual({ ai_temperature: 0.7, auto_paste: true });
  });

  it("keeps a non-JSON value as a literal string", () => {
    runCli(["config", "set", "theme", "not-json {"], { configPath });
    expect(readConfig(configPath)).toEqual({ theme: "not-json {" });
  });

  it("preserves other whitelisted keys (read-modify-write)", () => {
    fs.writeFileSync(
      configPath,
      JSON.stringify({ ai_model: "qwen2.5", language: "zh-CN" }),
    );
    runCli(["config", "set", "theme", "light"], { configPath });
    expect(readConfig(configPath)).toEqual({
      ai_model: "qwen2.5",
      language: "zh-CN",
      theme: "light",
    });
  });

  it("drops non-whitelisted junk already present in the file (app save parity)", () => {
    fs.writeFileSync(
      configPath,
      JSON.stringify({ ai_model: "qwen2.5", rogue_key: "junk" }),
    );
    runCli(["config", "set", "theme", "dark"], { configPath });
    const written = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    expect(written).toEqual({ ai_model: "qwen2.5", theme: "dark" });
  });

  it("--json emits the stable { success, key, value } schema", () => {
    const result = runCli(["config", "set", "ai_model", "qwen2.5", "--json"], {
      configPath,
    });
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      success: true,
      key: "ai_model",
      value: "qwen2.5",
    });
  });

  it("rejects an out-of-whitelist key without touching the file (exit 2)", () => {
    fs.writeFileSync(configPath, JSON.stringify({ theme: "dark" }));
    const result = runCli(["config", "set", "custom_rogue_key", "x"], {
      configPath,
    });
    expect(result.code).toBe(2);
    expect(JSON.parse(fs.readFileSync(configPath, "utf-8"))).toEqual({
      theme: "dark",
    });
  });

  it("rejects missing key/value arguments (exit 2)", () => {
    expect(runCli(["config", "set"], { configPath }).code).toBe(2);
    expect(runCli(["config", "set", "theme"], { configPath }).code).toBe(2);
    expect(fs.existsSync(configPath)).toBe(false);
  });

  it("maps filesystem write failures to a runtime error (exit 1, stderr only)", () => {
    // Parent chain contains a regular FILE, so mkdirSync must fail -> the
    // runner surfaces a runtime error, not a crash.
    const blockingFile = path.join(dir, "blocker");
    fs.writeFileSync(blockingFile, "x");
    const result = runCli(["config", "set", "theme", "dark"], {
      configPath: path.join(blockingFile, "murmur.json"),
    });
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("config set theme");
  });
});

// [20260912_Fix_264_ReviewFollowups] Boundary parity with the IPC settings
// path: the CLI must reject what the app's own write boundary rejects.
describe("cli config set value-length cap (IPC boundary parity)", () => {
  it("rejects string values over the 10000-char cap as a usage error (exit 2)", () => {
    const result = runCli(["config", "set", "theme", "x".repeat(10001)], {
      configPath: "/tmp/unused-murmur.json",
    });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("10000");
  });

  it("accepts a value at the cap boundary", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-cli-cap-"));
    const configPath = path.join(dir, "murmur.json");
    const result = runCli(["config", "set", "theme", "x".repeat(10000)], {
      configPath,
    });
    expect(result.code).toBe(0);
    expect(readConfig(configPath)).toEqual({ theme: "x".repeat(10000) });
  });
});
