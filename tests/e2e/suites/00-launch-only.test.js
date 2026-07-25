// [20260725_E2E_LaunchDiagnosis] Minimal launch-only smoke test.
//
// Purpose: isolate the Electron launch failure on CI macOS. Every other
// e2e suite (00-boot-health, 00-ftue, 01-lifecycle, etc.) fails at
// `app.firstWindow()` 30s timeout with zero captured stderr. This suite
// exists ONLY to:
//   1. Call launchElectronApp() (which is now instrumented to capture
//      env, bundle existence, process stdout/stderr/exit, console events)
//   2. Assert the window exists
//   3. Close the app
//
// If THIS test fails, the problem is in the launch path itself (Electron
// binary, GPU init, code-signing, appPath resolution). If this test
// passes but others fail, the problem is in the boot sequence or probes.
//
// The instrumentation in electron-launch.js will print diagnostic output
// to CI logs. Grep for "[e2e-launch]" to find the relevant lines.
//
// This suite is a diagnostic tool, not a permanent test. Once the launch
// failure is fixed, this can be deleted (or merged into 00-boot-health).
// [20260725_E2E_LaunchDiagnosis] END

import { test, expect } from "@playwright/test";
import {
  launchElectronApp,
  closeElectronApp,
} from "../helpers/electron-launch.js";

test.describe.serial("Suite 0-Diag: Launch Only (no probes)", () => {
  let electronApp;
  let window;

  test.beforeAll(async () => {
    ({ app: electronApp, window } = await launchElectronApp());
  });

  test.afterAll(async () => {
    await closeElectronApp(electronApp);
  });

  test("D.1 — Electron app launches and opens a window", async () => {
    // [20260725_E2E_LaunchDiagnosis] If we got here, firstWindow()
    // resolved — the launch succeeded. The diagnostic listeners in
    // electron-launch.js already logged env + process output + window
    // url. Just assert the window is real.
    expect(window).toBeDefined();
    const url = window.url();
    console.log(`[e2e-launch] D.1 window url=${url}`);
    // Empty url means renderer never loaded — different failure mode
    // than firstWindow timeout.
    expect(url.length).toBeGreaterThan(0);
  });
});
