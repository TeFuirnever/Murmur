import { describe, it, expect, vi } from "vitest";
import { validateSetting } from "../../src/helpers/ipc/settingsHandlers";
import LogManager from "../../src/helpers/logManager";

// ---------------------------------------------------------------------------
// Phase 0: Security Hardening — TDD Tests
// ---------------------------------------------------------------------------

describe("Phase 0: Settings import whitelist", () => {
  it("should reject unknown setting keys", () => {
    expect(validateSetting("evil_injected_key", "value")).toBe(false);
    expect(validateSetting("__proto__", "value")).toBe(false);
    expect(validateSetting("constructor", "value")).toBe(false);
  });

  it("should accept known setting keys", () => {
    expect(validateSetting("ai_api_key", "sk-123")).toBe(true);
    expect(validateSetting("ai_base_url", "https://api.openai.com/v1")).toBe(
      true,
    );
    expect(validateSetting("ai_model", "gpt-4")).toBe(true);
    expect(validateSetting("theme", "dark")).toBe(true);
    expect(validateSetting("auto_paste", "paste")).toBe(true);
    expect(validateSetting("close_behavior", "hide")).toBe(true);
    expect(validateSetting("window_always_on_top", true)).toBe(true);
    expect(validateSetting("enable_ai_optimization", true)).toBe(true);
  });

  it("should reject keys that are too long", () => {
    expect(validateSetting("a".repeat(101), "value")).toBe(false);
  });

  it("should reject non-string keys", () => {
    expect(validateSetting(123, "value")).toBe(false);
    expect(validateSetting(null, "value")).toBe(false);
    expect(validateSetting(undefined, "value")).toBe(false);
  });

  it("should reject string values exceeding MAX_VALUE_LENGTH", () => {
    expect(validateSetting("ai_api_key", "x".repeat(10001))).toBe(false);
  });

  it("should accept string values within MAX_VALUE_LENGTH", () => {
    expect(validateSetting("ai_api_key", "x".repeat(10000))).toBe(true);
  });

  it("should accept non-string values (booleans, numbers)", () => {
    expect(validateSetting("window_always_on_top", true)).toBe(true);
    expect(validateSetting("window_always_on_top", false)).toBe(true);
  });
});

describe("Phase 0: SQL LIKE wildcard escaping logic", () => {
  // Test the escaping logic directly without a real database
  function escapeLike(query) {
    return query
      .replace(/\\/g, "\\\\")
      .replace(/%/g, "\\%")
      .replace(/_/g, "\\_");
  }

  it("should escape % wildcard", () => {
    expect(escapeLike("100%")).toBe("100\\%");
  });

  it("should escape _ wildcard", () => {
    expect(escapeLike("test_one")).toBe("test\\_one");
  });

  it("should escape backslash", () => {
    expect(escapeLike("path\\to\\file")).toBe("path\\\\to\\\\file");
  });

  it("should handle combined wildcards", () => {
    expect(escapeLike("100%_test")).toBe("100\\%\\_test");
  });

  it("should leave normal text unchanged", () => {
    expect(escapeLike("hello world")).toBe("hello world");
  });
});

describe("Phase 0: LogManager uses async I/O", () => {
  it("should use fs.appendFile (async) not fs.appendFileSync", () => {
    const fs = require("fs");
    const logManager = new LogManager();

    const appendFileSpy = vi
      .spyOn(fs, "appendFile")
      .mockImplementation(() => {});
    const appendFileSyncSpy = vi.spyOn(fs, "appendFileSync");

    logManager.info("test message");

    expect(appendFileSpy).toHaveBeenCalled();
    expect(appendFileSyncSpy).not.toHaveBeenCalled();

    appendFileSpy.mockRestore();
    appendFileSyncSpy.mockRestore();
  });

  it("should use fs.appendFile for FunASR logs", () => {
    const fs = require("fs");
    const logManager = new LogManager();

    const appendFileSpy = vi
      .spyOn(fs, "appendFile")
      .mockImplementation(() => {});
    const appendFileSyncSpy = vi.spyOn(fs, "appendFileSync");

    logManager.logFunASR("info", "FunASR test message");

    expect(appendFileSpy).toHaveBeenCalled();
    expect(appendFileSyncSpy).not.toHaveBeenCalled();

    appendFileSpy.mockRestore();
    appendFileSyncSpy.mockRestore();
  });
});

describe("Phase 0: Ghost dependencies removed from package.json", () => {
  const ghostDeps = [
    "asynckit",
    "bindings",
    "combined-stream",
    "delayed-stream",
    "es-errors",
    "es-object-atoms",
    "es-set-tostringtag",
    "file-uri-to-path",
    "get-intrinsic",
    "math-intrinsics",
    "mime-db",
  ];

  it.each(ghostDeps)("should not have '%s' as direct dependency", (dep) => {
    const pkg = require("../../package.json");
    expect(pkg.dependencies).not.toHaveProperty(dep);
  });
});
