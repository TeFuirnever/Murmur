// [20260726_Tier3_LogManagerMigrate] Migrated from .js to .ts as part of
// Tier 3 batch 5 (final electron-mock batch). Pattern: typed `LogManager`
// const via `typeof import("...").default` (TS7005) and explicit `let tmpDir:
// string` (TS7034). The suite's createManager() helper reassigns the private
// logDir/logFile/funasrLogFile/_initialized fields to point at a temp dir, so
// a LogManagerSurface structural type + cast helper exposes them without `any`.
// Template reference: phase4-i18n.test.ts (commit d52f2e0).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => "/tmp/test-user-data"),
    getVersion: vi.fn(() => "1.0.0"),
  },
}));

// [20260726_Tier3_LogManagerMigrate] Default-exported class; the require
// returns the constructor under CJS interop (setupFile unwraps the ESM
// default namespace to the class itself).
type LogManagerCtor = typeof import("../../src/helpers/logManager").default;

// [20260726_Tier32_LogManager] Convert require() + vi.resetModules() to a
// top-level ESM default import. vi.mock is hoisted and applies to every
// import of the module. logManager.ts uses `export default LogManager`.
import LogManager from "../../src/helpers/logManager";

// [20260726_Tier3_LogManagerMigrate] The LogManager class declares
// logDir/logFile/funasrLogFile/_initialized private. createManager() reassigns
// them to redirect output into the per-test temp dir, so this surface exposes
// those four fields as public writable strings/boolean.
interface LogManagerSurface {
  logDir: string;
  logFile: string;
  funasrLogFile: string;
  _initialized: boolean;
}

// [20260726_Tier3_LogManagerMigrate] Local cast helper keeps the private-field
// reassignment sites short. Returning the structural surface avoids repeating
// `as unknown as LogManagerSurface` in createManager().
function surface(mgr: InstanceType<LogManagerCtor>): LogManagerSurface {
  return mgr as unknown as LogManagerSurface;
}

describe("LogManager", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-log-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function createManager(): InstanceType<LogManagerCtor> {
    const mgr = new LogManager();
    // [20260726_Tier3_LogManagerMigrate] Redirect the private log paths into
    // the per-test temp dir so tests can read/assert against real files. The
    // _initialized flag short-circuits the lazy electron-dependent init.
    const s = surface(mgr);
    s.logDir = tmpDir;
    s.logFile = path.join(tmpDir, "app.log");
    s.funasrLogFile = path.join(tmpDir, "funasr.log");
    s._initialized = true;
    return mgr;
  }

  it("writes info log to file", () => {
    const mgr = createManager();
    mgr.info("test message", { key: "value" });

    const content = fs.readFileSync(surface(mgr).logFile, "utf8");
    const entry = JSON.parse(content.trim());
    expect(entry.level).toBe("info");
    expect(entry.message).toBe("test message");
    expect(entry.data).toEqual({ key: "value" });
  });

  it("writes error log to file", () => {
    const mgr = createManager();
    mgr.error("something broke");

    const content = fs.readFileSync(surface(mgr).logFile, "utf8");
    const entry = JSON.parse(content.trim());
    expect(entry.level).toBe("error");
  });

  it("writes FunASR logs to separate file", () => {
    const mgr = createManager();
    mgr.logFunASR("info", "model loaded");

    const content = fs.readFileSync(surface(mgr).funasrLogFile, "utf8");
    const entry = JSON.parse(content.trim());
    expect(entry.source).toBe("FunASR");
    expect(entry.message).toBe("model loaded");
  });

  it("getRecentLogs returns parsed log entries", () => {
    const mgr = createManager();
    const entries = [
      { message: "first", level: "info", timestamp: "2026-01-01T00:00:00Z" },
      { message: "second", level: "info", timestamp: "2026-01-01T00:00:01Z" },
      { message: "third", level: "info", timestamp: "2026-01-01T00:00:02Z" },
    ];
    for (const e of entries) {
      fs.appendFileSync(surface(mgr).logFile, JSON.stringify(e) + "\n");
    }

    const logs = mgr.getRecentLogs(2);
    expect(logs).toHaveLength(2);
    expect(logs[0]!.message).toBe("second");
    expect(logs[1]!.message).toBe("third");
  });

  it("getRecentLogs returns empty array for missing file", () => {
    const mgr = createManager();
    expect(mgr.getRecentLogs()).toEqual([]);
  });

  it("getRecentLogs handles malformed JSON lines", () => {
    const mgr = createManager();
    fs.appendFileSync(surface(mgr).logFile, "not json\n");
    fs.appendFileSync(
      surface(mgr).logFile,
      JSON.stringify({ message: "valid", timestamp: "2026-01-01" }) + "\n",
    );

    const logs = mgr.getRecentLogs();
    expect(logs).toHaveLength(2);
    expect(logs[0]!.message).toBe("not json");
    expect(logs[1]!.message).toBe("valid");
  });

  it("cleanOldLogs removes files older than retention period", () => {
    const mgr = createManager();
    fs.appendFileSync(surface(mgr).logFile, "old log\n");

    const oldTime = Date.now() - 10 * 24 * 60 * 60 * 1000;
    fs.utimesSync(surface(mgr).logFile, new Date(oldTime), new Date(oldTime));

    mgr.cleanOldLogs(7);
    expect(fs.existsSync(surface(mgr).logFile)).toBe(false);
  });

  it("cleanOldLogs keeps recent files", () => {
    const mgr = createManager();
    fs.appendFileSync(surface(mgr).logFile, "recent log\n");

    mgr.cleanOldLogs(7);
    expect(fs.existsSync(surface(mgr).logFile)).toBe(true);
  });

  it("getLogFilePath returns configured path", () => {
    const mgr = createManager();
    expect(mgr.getLogFilePath()).toBe(path.join(tmpDir, "app.log"));
  });
});
