// [20260725_E2E_BootHealthGate] New boot-health smoke suite. Spec:
// docs/research/e2e-functional-verification-strategy.md §4.1 Gate 3.
//
// Why a distinct gate (cited):
//   - Without Gate 3, a boot regression masquerades as 20+ journey failures
//     scattered across 01-lifecycle / 00-ftue / 02-model-download etc.
//   - Running these assertions first, in a serial suite, isolates
//     Phase A-E regressions so they fail fast and stop the file.
//
// This suite intentionally mirrors Phase A-E of the boot sequence
// (e2e-functional-verification-strategy.md §2). Each test maps to one
// boot phase so a failure pinpoints the regression site:
//   0.1 DB initialized            → Phase A4
//   0.2 IPC handlers registered   → Phase A5
//   0.3 preload bridge loaded     → Phase C6
//   0.4 renderer mounted          → Phase C4
//   0.5 no uncaught console errors→ Phase C4 + R1-R3
//   0.6 CSP installed             → Phase C4
//   0.7 graceful shutdown         → Phase E3
//
// Design rules followed (§4.1, §6):
//   R1: web-first assertions (toBeAttached, expect.poll)
//   R2: fresh app via launchElectronApp + :memory: DB
//   R3: locate by [data-testid], not CSS/XPath
//   R8: workers:1 (already set in playwright.config.js)
//   R9: fail-fast on boot, fail-soft on journey
//
// What NOT to do (§8):
//   - Do NOT use waitForTimeout (use web-first assertions)
//   - Do NOT parallelise Electron (shared userData dir)
//   - Do NOT treat all console.error as fatal (use allowlist for known noise)
// [20260725_E2E_BootHealthGate] END

import { test, expect } from "@playwright/test";
import {
  launchElectronApp,
  closeElectronApp,
} from "../helpers/electron-launch";

// [20260725_E2E_BootHealthGate] Known-noisy renderer messages that must not
// fail test 0.5. Adding to this list requires a citation — the goal is to
// detect NET-NEW uncaught errors, not pin historical noise. See §4.1 R9.
const KNOWN_RENDERER_NOISE = [
  /Failed to load resource/i, // file:// resource misses in test env
];
// [20260725_E2E_BootHealthGate] END

// [20260725_E2E_BootHealthGate] Probes the 10 IPC handler domains that
// every downstream suite depends on. If any of these reject with
// "No handler registered", the entire Gate 4 journey tier is suspect.
// Channels chosen because they are side-effect-free reads (safe to call
// at boot). Source: e2e-functional-verification-strategy.md §2 Phase A5.
// [20260815_Refactor_DeadIpc] read-clipboard probe removed with the dead
// CLIPBOARD.READ channel; 9 side-effect-free probes remain.
// [20260816_Refactor_DeadChannels] get-current-model probe removed with the
// placeholder MODELS.CURRENT channel; 8 side-effect-free probes remain.
// [20260816_Fix_BootProbeContext] Values are electronAPI method names; the
// test evaluates them by name inside the browser (the old call(window) form
// ran on the Node side, where the Playwright Page has no electronAPI — the
// test could only ever fail).
const BOOT_PROBES = {
  "check-funasr-status": "checkFunASRStatus",
  "check-model-files": "checkModelFiles",
  "get-ai-modes": "getAIModes",
  "get-all-settings": "getAllSettings",
  "get-system-info": "getSystemInfo",
  "get-app-version": "getAppVersion",
  "is-window-maximized": "isWindowMaximized",
  "get-current-hotkey": "getCurrentHotkey",
};
// [20260725_E2E_BootHealthGate] END

test.describe.serial("Suite 0: Boot Health (Phase A-E)", () => {
  let electronApp;
  let window;
  // [20260725_E2E_BootHealthGate_CodeReviewS2] Renderer console listener
  // is attached in beforeAll IMMEDIATELY after firstWindow() resolves so
  // it catches initial-mount errors, not just post-reload ones. Previously
  // the listener was attached inside test 0.5 — but launchElectronApp's
  // waitForLoadState("domcontentloaded") had already completed, so first-
  // render CSP/preload errors fired before any listener existed.
  // See code-review S2 (architect + code-reviewer converged on this).
  const consoleErrors = [];

  test.beforeAll(async () => {
    ({ app: electronApp, window } = await launchElectronApp());
    window.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
  });

  test.afterAll(async () => {
    // [20260725_E2E_BootHealthGate] test 0.7 may have already closed the app;
    // closeElectronApp tolerates double-close (try/catch inside helper).
    await closeElectronApp(electronApp);
  });

  // 0.1 — Phase A4: DB schema initialized. If this fails, every persistence
  // test downstream is meaningless. getSetting round-trips a value through
  // better-sqlite3 — this catches "db is undefined" as well as schema errors.
  test("0.1 DB is initialized (getSetting round-trips)", async () => {
    const result = await window.evaluate(() =>
      window.electronAPI.getSetting("__boot_probe__", "ok"),
    );
    expect(result).toBe("ok");
  });

  // 0.2 — Phase A5: all 10 IPC handler modules registered. If any reject,
  // registerIPCHandlers (main.ts:147) is broken or a handler module threw
  // at import time. See §2 Phase A5 for the per-module breakdown.
  //
  // [20260816_Refactor_DeadChannels] get-current-model probe removed with the
  // placeholder MODELS.CURRENT channel; 8 side-effect-free probes remain.
  // [20260816_Fix_BootProbeContext] The probes used to run as call(window) on
  // the Node side, where the Playwright Page object has no electronAPI — the
  // test could only ever fail. Evaluate each probe inside the browser so the
  // IPC rejections surface as real failures rather than being swallowed.
  test("0.2 all IPC handler domains respond", async () => {
    for (const [channel, method] of Object.entries(BOOT_PROBES)) {
      await expect(
        window.evaluate(
          // [20260816_Refactor_DeadChannels] get-current-model probe removed with the
          // placeholder MODELS.CURRENT channel; 8 side-effect-free probes remain.
          // [20260816_Fix_BootProbeContext] Runs in the browser: look the
          // method up on the real preload bridge by name so a rejection
          // ("No handler registered") surfaces as a test failure.
          (m) => {
            const api = (
              globalThis as {
                electronAPI: Record<string, () => Promise<unknown>>;
              }
            ).electronAPI;
            return api[m]();
          },
          method,
        ),
        `IPC channel "${channel}" did not resolve`,
      ).resolves.toBeDefined();
    }
  });

  // 0.3 — Phase C6: preload bridge exposes the contract. The threshold of
  // 50 methods catches accidental tree-shaking of preload.ts. Four
  // load-bearing methods are required explicitly — they back every Tier-1
  // journey in §5.1.
  test("0.3 preload exposes electronAPI with 50+ methods", async () => {
    const keys = await window.evaluate(() => Object.keys(window.electronAPI));
    expect(keys.length).toBeGreaterThanOrEqual(50);
    for (const required of [
      "getSetting",
      "setSetting",
      "transcribeAudio",
      "pasteText",
    ]) {
      expect(keys).toContain(required);
    }
  });

  // 0.4 — Phase C4: React mounted. R1 (web-first): toBeAttached retries
  // automatically — no manual waitForTimeout. 10s ceiling matches
  // electron-launch's firstWindow() budget.
  test("0.4 main window renders mic button (React mounted)", async () => {
    await expect(window.locator('[data-testid="mic-button"]')).toBeAttached({
      timeout: 10_000,
    });
  });

  // 0.5 — Phase C4 + R1-R3: catch CSP violations, preload-load failures,
  // and unhandled promise rejections that don't crash the window. The
  // listener is attached in beforeAll (after firstWindow) so it captures
  // errors from BOTH the initial mount and the reload below. The allowlist
  // (KNOWN_RENDERER_NOISE) prevents noise-pinning from masking real bugs.
  test("0.5 no uncaught errors in renderer console", async () => {
    // Reload re-triggers mount; combined with the beforeAll listener,
    // this catches both first-mount and reload-mount errors.
    await window.reload();
    await window.waitForLoadState("domcontentloaded");
    const novel = consoleErrors.filter(
      (e) => !KNOWN_RENDERER_NOISE.some((k) => k.test(e)),
    );
    expect(novel).toEqual([]);
  });

  // 0.6 — Phase C4: CSP wiring precondition. In test mode we load via
  // file:// so we cannot read response headers; instead verify the session
  // exists (CSP is wired through session.defaultSession.webRequest
  // .onHeadersReceived at windowManager.ts:74-107). This is a smoke check
  // for session presence, NOT a CSP-filter assertion — see comment block
  // in spec §4.1 for the rationale ("session-presence is sufficient smoke").
  test("0.6 defaultSession is available (CSP wiring precondition)", async () => {
    const installed = await electronApp.evaluate(({ session }) => {
      return !!session.defaultSession;
    });
    expect(installed).toBe(true);
  });

  // 0.7a — [20260905_Feat_BloubMascotWiring] the title-bar bot mascot
  // (spec #224) must mount AND paint in the real app: the shell sets
  // data-bot-state imperatively from its rAF loop, so a non-empty value
  // proves renderer wiring + engine + paint loop all survived boot.
  test("0.7a title-bar mascot is mounted and painted", async () => {
    const mascot = window.locator("svg[data-bot-state]");
    await expect(mascot).toBeAttached();
    await expect
      .poll(async () => await mascot.getAttribute("data-bot-state"), {
        timeout: 5_000,
      })
      .toMatch(
        /^(idle|wide|thinking|orbit|sleep|alert|exclaim|comet|burst|wink)$/,
      );
  });

  // 0.7 — Phase E3: graceful shutdown. will-quit race timeout is 5s
  // (main.ts will-quit handler); 6s gives 1s of slack. If this fails, a
  // manager's before-quit hook is hanging — typically FunASR Python spawn
  // teardown or sqlite open handle. Nulls electronApp so afterAll skips.
  test("0.7 app quits within 6s (will-quit race timeout is 5s)", async () => {
    const start = Date.now();
    await closeElectronApp(electronApp);
    expect(Date.now() - start).toBeLessThan(6_000);
    electronApp = null; // prevent double-close in afterAll
  });
});
