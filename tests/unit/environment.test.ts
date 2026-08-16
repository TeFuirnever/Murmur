// [20260816_Refactor_MinimalEnvironment] Covers the retained environment
// surface: the .env loader semantics (shell-wins, quoting, export prefix)
// and the cross-platform data-directory dispatch. The config-getter /
// validate / export suites were removed with their zero-caller methods.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import EnvironmentManager from "../../src/helpers/environment";

describe("EnvironmentManager", () => {
  let env: InstanceType<typeof EnvironmentManager>;
  let tmpHome: string;
  let originalPlatform: string;
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    // Save original env values for cleanup.
    const envKeys = [
      "AUDIO_SAMPLE_RATE",
      "AUDIO_CHANNELS",
      "AUDIO_FORMAT",
      "FUNASR_MODEL_DIR",
      "FUNASR_CACHE_DIR",
      "BATCH_SIZE",
      "HOTWORDS",
      "DEBUG",
      "LOG_LEVEL",
      "LANGUAGE",
      "THEME",
      "WINDOW_ALWAYS_ON_TOP",
      "START_MINIMIZED",
      "GLOBAL_HOTKEY",
      "DATABASE_PATH",
      "BACKUP_ENABLED",
      "BACKUP_INTERVAL",
      "HTTP_PROXY",
      "HTTPS_PROXY",
      "MAX_RECORDING_DURATION",
      "MAX_TEXT_LENGTH",
      "NODE_ENV",
    ];
    originalEnv = {};
    for (const key of envKeys) {
      originalEnv[key] = process.env[key];
      delete process.env[key];
    }

    // Use a tmpdir as "home" so directory-creation tests don't pollute the
    // real home directory.
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-env-test-"));
    originalPlatform = process.platform;
    // Override os.homedir so getDataDirectory resolves under tmpHome.
    vi.spyOn(os, "homedir").mockReturnValue(tmpHome);

    env = new EnvironmentManager();
  });

  afterEach(() => {
    // Restore env.
    for (const [key, val] of Object.entries(originalEnv)) {
      if (val === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = val;
      }
    }
    // Restore platform.
    Object.defineProperty(process, "platform", {
      value: originalPlatform,
      configurable: true,
    });
    vi.restoreAllMocks();
    // Clean up tmpdir.
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  function setPlatform(p: string): void {
    Object.defineProperty(process, "platform", {
      value: p,
      configurable: true,
    });
  }

  describe("constructor / loadEnvironmentVariables", () => {
    it("constructs without error when no .env exists", () => {
      expect(env).toBeInstanceOf(EnvironmentManager);
    });

    it("loads .env if present in cwd", () => {
      // Create a tmpdir with a .env file, chdir into it, construct.
      const tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-dotenv-"));
      fs.writeFileSync(path.join(tmpCwd, ".env"), "TEST_DOTENV_VAR=hello123\n");
      const origCwd = process.cwd();
      process.chdir(tmpCwd);
      try {
        new EnvironmentManager();
        // dotenv populates process.env synchronously.
        expect(process.env.TEST_DOTENV_VAR).toBe("hello123");
      } finally {
        process.chdir(origCwd);
        delete process.env.TEST_DOTENV_VAR;
        fs.rmSync(tmpCwd, { recursive: true, force: true });
      }
    });

    // [20260815_Refactor_DotenvRemoval] dotenv's config() never overrides an
    // existing process.env entry (override: false) — the shell environment
    // must keep winning over .env files after the hand-rolled parser swap.
    it("does not override variables already present in the shell environment", () => {
      const tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-dotenv-"));
      fs.writeFileSync(
        path.join(tmpCwd, ".env"),
        "TEST_DOTENV_PRECEDENCE=from-file",
      );
      const origCwd = process.cwd();
      const original = process.env.TEST_DOTENV_PRECEDENCE;
      process.env.TEST_DOTENV_PRECEDENCE = "from-shell";
      process.chdir(tmpCwd);
      try {
        new EnvironmentManager();
        expect(process.env.TEST_DOTENV_PRECEDENCE).toBe("from-shell");
      } finally {
        process.chdir(origCwd);
        if (original === undefined) {
          delete process.env.TEST_DOTENV_PRECEDENCE;
        } else {
          process.env.TEST_DOTENV_PRECEDENCE = original;
        }
        fs.rmSync(tmpCwd, { recursive: true, force: true });
      }
    });

    // [20260815_Refactor_DotenvRemoval] dotenv (108KB) was swapped for a
    // minimal parser; these cases lock the semantics real .env files rely on
    // (comments, blank lines, optional export prefix, quoted values).
    it("parses comments, blank lines, export prefix and quoted values", () => {
      const tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-dotenv-"));
      fs.writeFileSync(
        path.join(tmpCwd, ".env"),
        [
          "# comment line",
          "",
          "export TEST_DOTENV_BARE=bare",
          'TEST_DOTENV_QUOTED="quoted value"',
          "TEST_DOTENV_SINGLE='single value'",
        ].join("\n"),
      );
      const origCwd = process.cwd();
      process.chdir(tmpCwd);
      try {
        new EnvironmentManager();
        expect(process.env.TEST_DOTENV_BARE).toBe("bare");
        expect(process.env.TEST_DOTENV_QUOTED).toBe("quoted value");
        expect(process.env.TEST_DOTENV_SINGLE).toBe("single value");
      } finally {
        process.chdir(origCwd);
        for (const key of [
          "TEST_DOTENV_BARE",
          "TEST_DOTENV_QUOTED",
          "TEST_DOTENV_SINGLE",
        ]) {
          delete process.env[key];
        }
        fs.rmSync(tmpCwd, { recursive: true, force: true });
      }
    });
  });

  // [20260816_Refactor_MinimalEnvironment] Coverage for the RETAINED surface:
  // the cross-platform data-directory dispatch and directory creation.
  describe("getDataDirectory — platform dispatch", () => {
    it("returns AppData path on win32", () => {
      setPlatform("win32");
      const dir = env.getDataDirectory();
      expect(dir).toContain("AppData");
      expect(dir).toContain("Roaming");
      expect(dir).toContain("Murmur");
    });

    it("returns Library path on darwin", () => {
      setPlatform("darwin");
      const dir = env.getDataDirectory();
      expect(dir).toContain("Library");
      expect(dir).toContain("Application Support");
      expect(dir).toContain("Murmur");
    });

    it("returns .config path on linux", () => {
      setPlatform("linux");
      const dir = env.getDataDirectory();
      expect(dir).toContain(".config");
      expect(dir).toContain("Murmur");
    });

    it("returns .murmur path on unknown platform", () => {
      setPlatform("freebsd");
      const dir = env.getDataDirectory();
      expect(dir).toContain(".murmur");
    });
  });

  describe("directory creation", () => {
    it("ensureDataDirectory creates the data dir", () => {
      const dir = env.ensureDataDirectory();
      expect(fs.existsSync(dir)).toBe(true);
    });
  });
});
