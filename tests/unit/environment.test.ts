// [20260729_Test_EnvironmentManager] Unit tests for EnvironmentManager.
// Covers all public methods: config getters, platform dispatch, directory
// creation, validation, export. Reuses the tmpdir pattern from
// database-error-paths.test.ts and introduces vi.stubEnv for env-var testing.
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

  describe("getAIConfig", () => {
    it("returns default AI config", () => {
      const cfg = env.getAIConfig();
      expect(cfg.baseURL).toBe("https://api.openai.com/v1");
      expect(cfg.model).toBe("gpt-3.5-turbo");
      expect(cfg.apiKey).toBe("");
    });
  });

  describe("getAudioConfig", () => {
    it("returns defaults", () => {
      const cfg = env.getAudioConfig();
      expect(cfg.sampleRate).toBe(16000);
      expect(cfg.channels).toBe(1);
      expect(cfg.format).toBe("wav");
    });

    it("respects env overrides", () => {
      process.env.AUDIO_SAMPLE_RATE = "44100";
      process.env.AUDIO_CHANNELS = "2";
      process.env.AUDIO_FORMAT = "mp3";
      const cfg = env.getAudioConfig();
      expect(cfg.sampleRate).toBe(44100);
      expect(cfg.channels).toBe(2);
      expect(cfg.format).toBe("mp3");
    });
  });

  describe("getFunASRConfig", () => {
    it("returns defaults", () => {
      const cfg = env.getFunASRConfig();
      expect(cfg.modelDir).toBe("./models");
      expect(cfg.cacheDir).toBe("./cache");
      expect(cfg.batchSize).toBe(300);
      expect(cfg.hotwords).toEqual([]);
    });

    it("parses hotwords from comma-separated string", () => {
      process.env.HOTWORDS = "你好,世界,测试";
      const cfg = env.getFunASRConfig();
      expect(cfg.hotwords).toEqual(["你好", "世界", "测试"]);
    });
  });

  describe("getAppConfig", () => {
    it("returns defaults", () => {
      const cfg = env.getAppConfig();
      expect(cfg.debug).toBe(false);
      expect(cfg.logLevel).toBe("info");
      expect(cfg.language).toBe("zh-CN");
      expect(cfg.theme).toBe("auto");
      expect(cfg.windowAlwaysOnTop).toBe(false);
      expect(cfg.startMinimized).toBe(false);
      expect(cfg.globalHotkey).toBe("CommandOrControl+Shift+Space");
    });

    it("respects env overrides", () => {
      process.env.DEBUG = "true";
      process.env.LOG_LEVEL = "debug";
      process.env.LANGUAGE = "en";
      process.env.THEME = "dark";
      process.env.WINDOW_ALWAYS_ON_TOP = "true";
      process.env.START_MINIMIZED = "true";
      process.env.GLOBAL_HOTKEY = "Ctrl+Alt+V";
      const cfg = env.getAppConfig();
      expect(cfg.debug).toBe(true);
      expect(cfg.logLevel).toBe("debug");
      expect(cfg.language).toBe("en");
      expect(cfg.theme).toBe("dark");
      expect(cfg.windowAlwaysOnTop).toBe(true);
      expect(cfg.startMinimized).toBe(true);
      expect(cfg.globalHotkey).toBe("Ctrl+Alt+V");
    });
  });

  describe("getDatabaseConfig", () => {
    it("returns defaults with backupEnabled true", () => {
      const cfg = env.getDatabaseConfig();
      expect(cfg.path).toBe("./data/transcriptions.db");
      expect(cfg.backupEnabled).toBe(true);
      expect(cfg.backupInterval).toBe(24);
    });

    it("disables backup when BACKUP_ENABLED=false", () => {
      process.env.BACKUP_ENABLED = "false";
      expect(env.getDatabaseConfig().backupEnabled).toBe(false);
    });
  });

  describe("getProxyConfig", () => {
    it("returns empty defaults", () => {
      const cfg = env.getProxyConfig();
      expect(cfg.http).toBe("");
      expect(cfg.https).toBe("");
    });

    it("respects env overrides", () => {
      process.env.HTTP_PROXY = "http://proxy:8080";
      process.env.HTTPS_PROXY = "https://proxy:8443";
      const cfg = env.getProxyConfig();
      expect(cfg.http).toBe("http://proxy:8080");
      expect(cfg.https).toBe("https://proxy:8443");
    });
  });

  describe("getPerformanceConfig", () => {
    it("returns defaults", () => {
      const cfg = env.getPerformanceConfig();
      expect(cfg.maxRecordingDuration).toBe(300);
      expect(cfg.maxTextLength).toBe(10000);
    });

    it("respects env overrides", () => {
      process.env.MAX_RECORDING_DURATION = "600";
      process.env.MAX_TEXT_LENGTH = "5000";
      const cfg = env.getPerformanceConfig();
      expect(cfg.maxRecordingDuration).toBe(600);
      expect(cfg.maxTextLength).toBe(5000);
    });
  });

  describe("getSystemInfo", () => {
    it("returns system snapshot with expected fields", () => {
      const info = env.getSystemInfo();
      expect(info.platform).toBeDefined();
      expect(info.arch).toBeDefined();
      expect(info.nodeVersion).toMatch(/^v\d/);
      expect(info.osType).toBeDefined();
      expect(info.osRelease).toBeDefined();
      expect(typeof info.totalMemory).toBe("number");
      expect(typeof info.freeMemory).toBe("number");
      expect(typeof info.cpus).toBe("number");
      expect(info.cpus).toBeGreaterThan(0);
      expect(info.homeDir).toBe(tmpHome);
      expect(info.tmpDir).toBeDefined();
    });
  });

  describe("isDevelopment / isProduction", () => {
    it("returns true when NODE_ENV=development", () => {
      process.env.NODE_ENV = "development";
      expect(env.isDevelopment()).toBe(true);
      expect(env.isProduction()).toBe(false);
    });

    it("returns true when NODE_ENV=production", () => {
      process.env.NODE_ENV = "production";
      expect(env.isDevelopment()).toBe(false);
      expect(env.isProduction()).toBe(true);
    });

    it("returns false for both when NODE_ENV is unset", () => {
      expect(env.isDevelopment()).toBe(false);
      expect(env.isProduction()).toBe(false);
    });
  });

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

    it("ensureDataDirectory returns existing dir without error", () => {
      const dir1 = env.ensureDataDirectory();
      const dir2 = env.ensureDataDirectory();
      expect(dir1).toBe(dir2);
    });

    it("getLogDirectory creates logs subdir", () => {
      const dir = env.getLogDirectory();
      expect(dir).toContain("logs");
      expect(fs.existsSync(dir)).toBe(true);
    });

    it("getCacheDirectory creates cache subdir", () => {
      const dir = env.getCacheDirectory();
      expect(dir).toContain("cache");
      expect(fs.existsSync(dir)).toBe(true);
    });

    it("getModelsDirectory creates models subdir", () => {
      const dir = env.getModelsDirectory();
      expect(dir).toContain("models");
      expect(fs.existsSync(dir)).toBe(true);
    });
  });

  describe("validateEnvironment", () => {
    it("returns valid=true with no issues on a writable tmpdir", () => {
      const result = env.validateEnvironment();
      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
      expect(result.systemInfo).toBeDefined();
    });

    it("reports an issue if ensureDataDirectory throws", () => {
      vi.spyOn(fs, "mkdirSync").mockImplementation(() => {
        throw new Error("EACCES");
      });
      const result = env.validateEnvironment();
      expect(result.valid).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.issues[0]).toContain("无法创建数据目录");
    });
  });

  describe("exportConfig", () => {
    it("returns a complete config object with all sections", () => {
      const cfg = env.exportConfig();
      expect(cfg).toHaveProperty("ai");
      expect(cfg).toHaveProperty("audio");
      expect(cfg).toHaveProperty("funasr");
      expect(cfg).toHaveProperty("app");
      expect(cfg).toHaveProperty("database");
      expect(cfg).toHaveProperty("proxy");
      expect(cfg).toHaveProperty("performance");
      expect(cfg).toHaveProperty("system");
      expect(cfg).toHaveProperty("directories");
      expect(cfg.directories).toHaveProperty("data");
      expect(cfg.directories).toHaveProperty("logs");
      expect(cfg.directories).toHaveProperty("cache");
      expect(cfg.directories).toHaveProperty("models");
      // Directories should exist (exportConfig calls the creators).
      expect(fs.existsSync(cfg.directories.data)).toBe(true);
      expect(fs.existsSync(cfg.directories.logs)).toBe(true);
    });
  });
});
