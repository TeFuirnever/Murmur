/**
 * Shared Electron app lifecycle helpers for E2E tests.
 *
 * Launches the Electron app in test mode with:
 * - In-memory SQLite database (MURMUR_DB_PATH=:memory:)
 * - MediaRecorder mock (navigator.mediaDevices.getUserMedia)
 * - Clean state per suite
 */
const { _electron: electron } = require("@playwright/test");
const path = require("path");

// [20260724_TS_BigBang_TestFix] Fix PROJECT_ROOT: tests/e2e/helpers is 3
// levels below project root (helpers → e2e → tests → Murmur). The original
// "../../../.." (4 levels) resolved to the parent of Murmur, which was
// masked because e2e never actually ran (playwright-core CLI was broken).
const PROJECT_ROOT = path.resolve(__dirname, "../../..");
// [20260724_TS_BigBang_TestFix] END

/**
 * Launch the Murmur Electron app for testing.
 * @param {object} [options] - Launch options
 * @param {Record<string, string>} [options.env] - Additional env vars
 * @returns {Promise<{app: import('@playwright/test').ElectronApplication, window: import('@playwright/test').Page}>}
 */
async function launchElectronApp({ env = {} } = {}) {
  // [20260724_TS_BigBang_TestFix] Launch via project root so Electron reads
  // package.json "main" field (dist-main/main.js). Passing the bundle path
  // directly as args[] causes app.getAppPath() to return dist-main/ instead
  // of the project root, breaking renderer/preload path resolution.
  // Launching with "." makes getAppPath() return the package.json directory.
  const appRoot = PROJECT_ROOT;
  // [20260724_TS_BigBang_TestFix] END

  const app = await electron.launch({
    args: [appRoot],
    env: {
      ...process.env,
      NODE_ENV: "test",
      MURMUR_DB_PATH: ":memory:",
      ...env,
    },
  });

  const window = await app.firstWindow();

  // Inject MediaRecorder mock — getUserMedia returns an empty audio stream.
  // This prevents "NotAllowedError: Permission denied" in test environment.
  await window.addInitScript(() => {
    if (!navigator.mediaDevices) {
      navigator.mediaDevices = {};
    }
    if (!navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices.getUserMedia = async () => {
        // Create a silent audio context to produce a real MediaStream
        const ctx = new AudioContext();
        const oscillator = ctx.createOscillator();
        const dest = ctx.createMediaStreamDestination();
        oscillator.connect(dest);
        oscillator.start();
        return dest.stream;
      };
    }
  });

  // Wait for the app to be ready
  await window.waitForLoadState("domcontentloaded");

  return { app, window };
}

/**
 * Gracefully close the Electron app.
 * @param {import('@playwright/test').ElectronApplication} app
 */
async function closeElectronApp(app) {
  if (app) {
    try {
      await app.close();
    } catch {
      // App may have already exited (e.g. close_behavior=quit test)
    }
  }
}

module.exports = { launchElectronApp, closeElectronApp };
