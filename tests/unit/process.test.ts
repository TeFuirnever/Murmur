// [20260726_Tier3_ProcessTestMigrate] Migrated from .js to .ts as part of
// Tier 3 batch 2. Pattern: type the destructured require() bindings via
// `typeof import("<module>").<export>` so each name reuses the source's own
// type without introducing `any`. require() under esbuild CJS interop returns
// the namespace object, so named destructuring aligns 1:1 with `export const`
// / `export function` members of src/utils/process.ts. No `let`-bare or
// untyped function params in this file. Template reference: phase4-i18n.test.ts
// (commit d52f2e0).
import { describe, it, expect } from "vitest";

const {
  runCommand,
  TIMEOUTS,
}: typeof import("../../src/utils/process") = require("../../src/utils/process");

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
    await expect(runCommand("sleep", ["10"], { timeout: 100 })).rejects.toThrow(
      "timed out",
    );
  });

  it("rejects on process error", async () => {
    await expect(runCommand("nonexistent_command_xyz")).rejects.toThrow();
  });

  it("captures stderr output", async () => {
    const result = await runCommand("node", [
      "-e",
      "process.stderr.write('err-msg')",
    ]);
    expect(result.code).toBe(0);
  });
});
