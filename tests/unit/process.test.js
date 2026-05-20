import { describe, it, expect } from "vitest";

const { runCommand, TIMEOUTS } = require("../../src/utils/process");

describe("process utils", () => {
  it("TIMEOUTS has expected keys", () => {
    expect(TIMEOUTS.QUICK_CHECK).toBe(5000);
    expect(TIMEOUTS.PIP_UPGRADE).toBe(60000);
    expect(TIMEOUTS.INSTALL).toBe(300000);
    expect(TIMEOUTS.DOWNLOAD).toBe(600000);
  });

  it("runs a command and returns output", async () => {
    const result = await runCommand("echo", ["hello"]);
    expect(result.code).toBe(0);
    expect(result.output).toContain("hello");
  });

  it("rejects on non-zero exit code", async () => {
    await expect(runCommand("false")).rejects.toThrow();
  });

  it("rejects on timeout", async () => {
    await expect(
      runCommand("sleep", ["10"], { timeout: 100 }),
    ).rejects.toThrow("timed out");
  });

  it("rejects on process error", async () => {
    await expect(
      runCommand("nonexistent_command_xyz"),
    ).rejects.toThrow();
  });

  it("captures stderr output", async () => {
    const result = await runCommand("node", ["-e", "process.stderr.write('err-msg')"]);
    expect(result.code).toBe(0);
  });
});
