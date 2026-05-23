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

describe("LogManager", () => {
  let LogManager;
  let tmpDir;

  beforeEach(() => {
    vi.resetModules();
    LogManager = require("../../src/helpers/logManager");
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-log-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function createManager() {
    const mgr = new LogManager();
    mgr.logDir = tmpDir;
    mgr.logFile = path.join(tmpDir, "app.log");
    mgr.funasrLogFile = path.join(tmpDir, "funasr.log");
    mgr._initialized = true;
    return mgr;
  }

  it("writes info log to file", () => {
    const mgr = createManager();
    mgr.info("test message", { key: "value" });

    const content = fs.readFileSync(mgr.logFile, "utf8");
    const entry = JSON.parse(content.trim());
    expect(entry.level).toBe("info");
    expect(entry.message).toBe("test message");
    expect(entry.data).toEqual({ key: "value" });
  });

  it("writes error log to file", () => {
    const mgr = createManager();
    mgr.error("something broke");

    const content = fs.readFileSync(mgr.logFile, "utf8");
    const entry = JSON.parse(content.trim());
    expect(entry.level).toBe("error");
  });

  it("writes FunASR logs to separate file", () => {
    const mgr = createManager();
    mgr.logFunASR("info", "model loaded");

    const content = fs.readFileSync(mgr.funasrLogFile, "utf8");
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
      fs.appendFileSync(mgr.logFile, JSON.stringify(e) + "\n");
    }

    const logs = mgr.getRecentLogs(2);
    expect(logs).toHaveLength(2);
    expect(logs[0].message).toBe("second");
    expect(logs[1].message).toBe("third");
  });

  it("getRecentLogs returns empty array for missing file", () => {
    const mgr = createManager();
    expect(mgr.getRecentLogs()).toEqual([]);
  });

  it("getRecentLogs handles malformed JSON lines", () => {
    const mgr = createManager();
    fs.appendFileSync(mgr.logFile, "not json\n");
    fs.appendFileSync(
      mgr.logFile,
      JSON.stringify({ message: "valid", timestamp: "2026-01-01" }) + "\n",
    );

    const logs = mgr.getRecentLogs();
    expect(logs).toHaveLength(2);
    expect(logs[0].message).toBe("not json");
    expect(logs[1].message).toBe("valid");
  });

  it("cleanOldLogs removes files older than retention period", () => {
    const mgr = createManager();
    fs.appendFileSync(mgr.logFile, "old log\n");

    const oldTime = Date.now() - 10 * 24 * 60 * 60 * 1000;
    fs.utimesSync(mgr.logFile, new Date(oldTime), new Date(oldTime));

    mgr.cleanOldLogs(7);
    expect(fs.existsSync(mgr.logFile)).toBe(false);
  });

  it("cleanOldLogs keeps recent files", () => {
    const mgr = createManager();
    fs.appendFileSync(mgr.logFile, "recent log\n");

    mgr.cleanOldLogs(7);
    expect(fs.existsSync(mgr.logFile)).toBe(true);
  });

  it("getLogFilePath returns configured path", () => {
    const mgr = createManager();
    expect(mgr.getLogFilePath()).toBe(path.join(tmpDir, "app.log"));
  });
});
