/**
 * Shared Electron app lifecycle helpers for E2E tests.
 *
 * Launches the Electron app in test mode with:
 * - In-memory SQLite database (MURMUR_DB_PATH=:memory:)
 * - MediaRecorder mock (navigator.mediaDevices.getUserMedia)
 * - Clean state per suite
 */
const { _electron: electron } = require("playwright-core");
const path = require("path");

/**
 * Launch the Murmur Electron app for testing.
 * @param {object} [options] - Launch options
 * @param {string} [options.page] - URL page param (?page=settings, ?page=history)
 * @param {Record<string, string>} [options.env] - Additional env vars
 * @returns {Promise<{app: import('playwright-core').ElectronApplication, window: import('playwright-core').Page}>}
 */
async function launchElectronApp({ page: _page, env = {} } = {}) {
  const mainJs = path.resolve(__dirname, "../../../../main.js");

  const app = await electron.launch({
    args: [mainJs],
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
 * @param {import('playwright-core').ElectronApplication} app
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
