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

// ─── Finding #3: pasteWindows must have timeout + windowsHide ───────
describe("clipboard.js — pasteWindows Windows compat", () => {
  it("pasteWindows spawn includes windowsHide:true", () => {
    const source = fs.readFileSync(path.join(srcRoot, "clipboard.js"), "utf-8");
    // Extract the pasteWindows method body
    const pasteSection = source.substring(
      source.indexOf("async pasteWindows("),
      source.indexOf("async pasteLinux("),
    );
    expect(pasteSection).toContain("windowsHide");
  });

  it("pasteWindows has a timeout guard (3s)", () => {
    const source = fs.readFileSync(path.join(srcRoot, "clipboard.js"), "utf-8");
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
describe("funasrServer.js — gracefulShutdown Windows compat", () => {
  it("gracefulShutdown uses taskkill on Windows for process tree kill", () => {
    const source = fs.readFileSync(
      path.join(srcRoot, "funasrServer.js"),
      "utf-8",
    );
    // Extract gracefulShutdown method
    const shutdownSection = source.substring(
      source.indexOf("async gracefulShutdown()"),
      source.indexOf("resetState()"),
    );
    // On Windows, should use taskkill /T /F /PID for process tree kill
    // instead of proc.kill("SIGKILL") which only kills the direct child
    expect(shutdownSection).toContain("taskkill");
    expect(shutdownSection).toContain("/T");
    expect(shutdownSection).toContain("/F");
    expect(shutdownSection).toContain("/PID");
    // Should be guarded by platform check
    expect(shutdownSection).toContain("win32");
  });

  // Risk: spawn is async, resolve() fires before taskkill completes.
  // Must use spawnSync (blocking) to ensure process tree is fully killed.
  it("gracefulShutdown uses spawnSync (blocking) for taskkill, not async spawn", () => {
    const source = fs.readFileSync(
      path.join(srcRoot, "funasrServer.js"),
      "utf-8",
    );
    const shutdownSection = source.substring(
      source.indexOf("async gracefulShutdown()"),
      source.indexOf("resetState()"),
    );
    // Should use spawnSync, not spawn, for the kill command
    expect(shutdownSection).toContain("spawnSync");
    // Import at module level should include spawnSync
    const importLine = source
      .split("\n")
      .find((l) => l.includes('require("child_process")'));
    expect(importLine).toContain("spawnSync");
  });
});

// ─── Finding #6: modelManager download spawn missing windowsHide ────
describe("modelManager.js — download spawn windowsHide", () => {
  it("download spawn includes windowsHide:true", () => {
    const source = fs.readFileSync(
      path.join(srcRoot, "modelManager.js"),
      "utf-8",
    );

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
    const source = fs.readFileSync(
      path.join(__dirname, "../../main.js"),
      "utf-8",
    );

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
