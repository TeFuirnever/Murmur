// [20260725_Tier3_WindowsCompatMigrate] Migrated from .js to .ts as part
// of Tier 3 batch 1. Pattern: type untyped function params (TS7008).
// Template reference: phase4-i18n.test.ts (commit d52f2e0).
/**
 * Windows compatibility regression tests.
 *
 * These tests verify fixes for Windows-specific bugs found during the
 * Windows compat audit (2026-06-07). Each test section maps to a numbered
 * finding from the diagnostic report.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const srcRoot = path.join(__dirname, "../../src/helpers");

// [20260724_TS_BigBang_TestFix] Read .ts if it exists (post-migration),
// otherwise fall back to .js (pre-migration). This keeps static-analysis
// tests working across the migration boundary.
// [20260725_Tier3_WindowsCompatMigrate] Param typing: string → string.
function readHelperSource(name: string): string {
  const tsPath = path.join(srcRoot, `${name}.ts`);
  if (fs.existsSync(tsPath)) return fs.readFileSync(tsPath, "utf-8");
  return fs.readFileSync(path.join(srcRoot, `${name}.js`), "utf-8");
}
function readEntrySource(name: string): string {
  const root = path.join(__dirname, "../..");
  const tsPath = path.join(root, `${name}.ts`);
  if (fs.existsSync(tsPath)) return fs.readFileSync(tsPath, "utf-8");
  return fs.readFileSync(path.join(root, `${name}.js`), "utf-8");
}
// [20260724_TS_BigBang_TestFix] END

// ─── Finding #3: pasteWindows must have timeout + windowsHide ───────
describe("clipboard.js — pasteWindows Windows compat", () => {
  it("pasteWindows spawn includes windowsHide:true", () => {
    const source = readHelperSource("clipboard");
    // Extract the pasteWindows method body
    const pasteSection = source.substring(
      source.indexOf("async pasteWindows("),
      source.indexOf("async pasteLinux("),
    );
    expect(pasteSection).toContain("windowsHide");
  });

  it("pasteWindows has a timeout guard (3s)", () => {
    const source = readHelperSource("clipboard");
    const pasteSection = source.substring(
      source.indexOf("async pasteWindows("),
      source.indexOf("async pasteLinux("),
    );
    // Should have a timeout mechanism with 3-second value
    expect(pasteSection).toContain("setTimeout");
    expect(pasteSection).toContain("3000");
    // Should have hasTimedOut guard to prevent double resolve/reject
    expect(pasteSection).toContain("hasTimedOut");
  });
});

// ─── Finding #5: funasrServer gracefulShutdown on Windows ───────────
// [20260817_T2_KillTree] Contract updated for the shared killProcessTree
// helper (ticket #179): the taskkill logic moved out of gracefulShutdown
// into killProcessTree, and ALL kill paths must delegate to it.
describe("funasrServer.js — process tree kill Windows compat", () => {
  it("killProcessTree uses taskkill /T /F /PID on Windows via spawnSync", () => {
    const source = readHelperSource("funasrServer");
    const helperSection = source.substring(
      source.indexOf("export function killProcessTree"),
      source.indexOf("/** Logger interface"),
    );
    expect(helperSection).toContain("taskkill");
    expect(helperSection).toContain("/T");
    expect(helperSection).toContain("/F");
    expect(helperSection).toContain("/PID");
    expect(helperSection).toContain("win32");
    expect(helperSection).toContain("spawnSync");
    expect(helperSection).toContain("windowsHide");
  });

  it("gracefulShutdown delegates the timeout kill to killProcessTree", () => {
    const source = readHelperSource("funasrServer");
    const shutdownSection = source.substring(
      source.indexOf("async gracefulShutdown()"),
      source.indexOf("resetState()"),
    );
    expect(shutdownSection).toContain("killProcessTree");
    expect(shutdownSection).not.toContain("taskkill");
  });

  it("crash-restart, stop fallback, and startup timeout all use killProcessTree", () => {
    const source = readHelperSource("funasrServer");
    const crashSection = source.substring(
      source.indexOf("async _handleServerCrash()"),
      source.indexOf("async _sendServerCommand"),
    );
    expect(crashSection).toContain("killProcessTree");

    const stopSection = source.substring(
      source.indexOf("async _stopFunASRServer()"),
      source.indexOf("async gracefulShutdown()"),
    );
    expect(stopSection).toContain("killProcessTree");

    const timeoutSection = source.substring(
      source.indexOf("FunASR服务器启动超时"),
      source.indexOf("}, 120000);"),
    );
    expect(timeoutSection).toContain("killProcessTree");
    expect(timeoutSection).not.toContain(".kill()");
  });

  it("spawnSync remains imported at module level", () => {
    const source = readHelperSource("funasrServer");
    const importLine = source
      .split("\n")
      .find(
        (l) =>
          l.includes('require("child_process")') ||
          l.includes('from "child_process"'),
      );
    expect(importLine).toContain("spawnSync");
  });
});

// ─── Finding #6: modelManager download spawn missing windowsHide ────
describe("modelManager.js — download spawn windowsHide", () => {
  it("download spawn includes windowsHide:true", () => {
    const source = readHelperSource("modelManager");

    // Find the spawn call in the download function context
    const downloadSection = source.substring(
      source.indexOf("async downloadModels"),
      source.indexOf("clearCache"),
    );

    expect(downloadSection).toContain("windowsHide");
  });
});

// ─── Finding #7: main.js setupProductionPath uses LOCALAPPDATA ──────
describe("main.js — setupProductionPath uses LOCALAPPDATA on Windows", () => {
  it("does not hardcode username in Windows Python paths", () => {
    const source = readEntrySource("main");

    const setupSection = source.substring(
      source.indexOf("function setupProductionPath"),
      source.indexOf("// 在初始化管理器之前"),
    );

    // Should use process.env.LOCALAPPDATA instead of hardcoded paths
    expect(setupSection).toContain("LOCALAPPDATA");
    // Should NOT use os.userInfo().username for path construction
    expect(setupSection).not.toContain("userInfo().username");
  });
});

// ─── Finding #9: useHotkey.ts should not use deprecated navigator.platform ──
describe("useHotkey.ts — platform detection", () => {
  it("does not use deprecated navigator.platform", () => {
    const source = fs.readFileSync(
      path.join(__dirname, "../../src/hooks/useHotkey.ts"),
      "utf-8",
    );

    // Should not use navigator.platform (deprecated)
    expect(source).not.toContain("navigator.platform");
  });

  // Risk: navigator.userAgent may be frozen/reduced in future Chromium.
  // Must have userAgentData fallback for future-proofing.
  it("has userAgentData fallback for future Chromium compatibility", () => {
    const source = fs.readFileSync(
      path.join(__dirname, "../../src/hooks/useHotkey.ts"),
      "utf-8",
    );

    const formatSection = source.substring(
      source.indexOf("formatHotkey"),
      source.lastIndexOf("}"),
    );
    // Should check userAgentData?.platform as fallback
    expect(formatSection).toMatch(/userAgentData/);
  });
});
