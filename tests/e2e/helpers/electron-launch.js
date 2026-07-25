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

// [20260725_E2E_LaunchDiagnosis] Verbose diagnostic prefix used in all
// instrumentation logs. Grep-friendly so we can extract them from CI
// output: `grep "\[e2e-launch\]" <ci-log>`.
const DIAG_PREFIX = "[e2e-launch]";
// [20260725_E2E_LaunchDiagnosis] END

// [20260725_E2E_LaunchDiagnosis] Newer Electron on macOS Sequoia (15.x)
// can silently block window creation when the binary lacks a valid code
// signature or has quarantine attributes carried in from extraction.
// Log the relevant env so CI output shows whether the gate fired.
function logDiagnosticEnvironment() {
  const interesting = [
    "NODE_ENV",
    "MURMUR_DB_PATH",
    "CI",
    "RUNNER_OS",
    "MACOSX_DEPLOYMENT_TARGET",
    "CSC_IDENTITY_AUTO_DISCOVERY",
    "APPLE_ID",
    "APP_PATH",
    "ELECTRON_ENABLE_LOGGING",
  ];
  console.log(`${DIAG_PREFIX} env snapshot:`);
  for (const k of interesting) {
    if (process.env[k] !== undefined) {
      console.log(`${DIAG_PREFIX}   ${k}=${process.env[k]}`);
    }
  }
  console.log(`${DIAG_PREFIX} PROJECT_ROOT=${PROJECT_ROOT}`);
  console.log(
    `${DIAG_PREFIX} platform=${process.platform} arch=${process.arch} node=${process.version}`,
  );
}
// [20260725_E2E_LaunchDiagnosis] END

// [20260725_E2E_LaunchDiagnosis] Attach every stream Playwright exposes
// to console so the CI log surfaces WHY firstWindow() never resolves.
// Without this we only see "Timeout 30000ms exceeded" and no signal.
// Sources: https://playwright.dev/docs/api/class-electronapplication
function attachDiagnosticListeners(app, label) {
  // Main-process console.log / console.error calls. Per Playwright docs
  // the 'console' event fires when JS in the main process uses the
  // console API. Main-process logs from Electron itself (e.g. GPU init
  // errors, code-signing warnings) often go to stderr instead — see
  // the process() listener below for those.
  app.on("console", (msg) => {
    console.log(
      `${DIAG_PREFIX} [main:${label}] console.${msg.type()}: ${msg.text()}`,
    );
  });

  // ChildProcess events — raw stdout/stderr from the Electron binary.
  // This is where code-signing rejections, GPU errors, and missing-file
  // crashes surface. Without ELECTRON_ENABLE_LOGGING=1 Electron suppress
  // most output; we set that env in launchElectronApp below.
  const proc = app.process();
  if (proc) {
    proc.stdout?.on("data", (chunk) => {
      const text = chunk.toString().trim();
      if (text) console.log(`${DIAG_PREFIX} [main:${label}] stdout: ${text}`);
    });
    proc.stderr?.on("data", (chunk) => {
      const text = chunk.toString().trim();
      if (text) console.log(`${DIAG_PREFIX} [main:${label}] stderr: ${text}`);
    });
    proc.on("exit", (code, signal) => {
      console.log(
        `${DIAG_PREFIX} [main:${label}] exit code=${code} signal=${signal}`,
      );
    });
    proc.on("error", (err) => {
      console.log(
        `${DIAG_PREFIX} [main:${label}] process error: ${err.message}`,
      );
    });
  }

  // Window lifecycle — fires when any BrowserWindow is created/loaded.
  // If we NEVER see this event, the main process failed to open a window.
  app.on("window", (page) => {
    console.log(
      `${DIAG_PREFIX} [main:${label}] window event: url=${page.url()}`,
    );
  });

  // Application terminated — fires before 'exit' when the process is
  // killed. Differentiates "playwright closed it" vs "it crashed".
  app.on("close", () => {
    console.log(`${DIAG_PREFIX} [main:${label}] close event (app terminated)`);
  });
}
// [20260725_E2E_LaunchDiagnosis] END

/**
 * Launch the Murmur Electron app for testing.
 * @param {object} [options] - Launch options
 * @param {Record<string, string>} [options.env] - Additional env vars
 * @returns {Promise<{app: import('@playwright/test').ElectronApplication, window: import('@playwright/test').Page}>}
 */
async function launchElectronApp({ env = {} } = {}) {
  // [20260725_E2E_LaunchDiagnosis] Dump env + paths BEFORE launch so
  // even an immediate crash leaves a breadcrumb.
  logDiagnosticEnvironment();
  // [20260725_E2E_LaunchDiagnosis] END

  // [20260724_TS_BigBang_TestFix] Launch via project root so Electron reads
  // package.json "main" field (dist-main/main.js). Passing the bundle path
  // directly as args[] causes app.getAppPath() to return dist-main/ instead
  // of the project root, breaking renderer/preload path resolution.
  // Launching with "." makes getAppPath() return the package.json directory.
  const appRoot = PROJECT_ROOT;
  // [20260724_TS_BigBang_TestFix] END

  // [20260725_E2E_LaunchDiagnosis] Verify the bundle exists BEFORE launch
  // — if global-setup didn't run (or the build silently failed) the
  // launch would hang for 30s with no clear cause.
  const fs = require("fs");
  const mainBundle = path.join(appRoot, "dist-main/main.js");
  const preloadBundle = path.join(appRoot, "dist-preload/preload.js");
  // [20260725_E2E_CiStartupProbe] Correct path: build:renderer script is
  // `cd src && vite build`, and vite.config.js sets outDir: "dist", so
  // the renderer HTML ends up at src/dist/, not <root>/dist/. Previous
  // diagnostic reported false negative (existed=false when file was fine).
  const rendererHtml = path.join(appRoot, "src/dist/index.html");
  console.log(`${DIAG_PREFIX} bundle check:`);
  console.log(
    `${DIAG_PREFIX}   dist-main/main.js exists=${fs.existsSync(mainBundle)}`,
  );
  console.log(
    `${DIAG_PREFIX}   dist-preload/preload.js exists=${fs.existsSync(preloadBundle)}`,
  );
  console.log(
    `${DIAG_PREFIX}   src/dist/index.html exists=${fs.existsSync(rendererHtml)}`,
  );
  // [20260725_E2E_CiStartupProbe] END

  console.log(
    `${DIAG_PREFIX} calling electron.launch() at ${new Date().toISOString()}`,
  );
  const launchStart = Date.now();

  const app = await electron.launch({
    // [20260725_E2E_CiStartupProbe] Pass --require ci-probe.js as the
    // FIRST arg so it executes before dist-main/main.js. If [probe]
    // lines appear in CI logs but [main:canary] don't, the problem
    // is in main.ts module-load (e.g. an import side-effect that
    // hangs on CI macOS).
    args: [
      "--require",
      path.join(PROJECT_ROOT, "tests/e2e/helpers/ci-probe.js"),
      appRoot,
    ],
    // [20260725_E2E_CiStartupProbe] END
    env: {
      ...process.env,
      NODE_ENV: "test",
      MURMUR_DB_PATH: ":memory:",
      // [20260725_E2E_LaunchDiagnosis] Force Electron to emit verbose
      // logs to stderr. Without this the main process stays silent and
      // the 'console' event listener only catches explicit console.log
      // calls, not GPU/code-signing/init errors.
      ELECTRON_ENABLE_LOGGING: "1",
      // [20260725_E2E_LaunchDiagnosis] END
      ...env,
    },
    // [20260725_E2E_LaunchDiagnosis] Default Playwright launch timeout
    // is 30s; CI macOS firstWindow flakiness is documented in spec
    // §7 Stage 0. Bump to 60s for the diagnostic run so we get more
    // process output before the timeout fires.
    timeout: 60_000,
    // [20260725_E2E_LaunchDiagnosis] END
  });

  console.log(
    `${DIAG_PREFIX} electron.launch() returned after ${Date.now() - launchStart}ms (pid=${app.process()?.pid})`,
  );

  // [20260725_E2E_LaunchDiagnosis] Attach diagnostic listeners BEFORE
  // awaiting firstWindow — the window event may fire during this wait,
  // and stderr/stdout during launch is the most valuable signal.
  attachDiagnosticListeners(app, "launch");
  // [20260725_E2E_LaunchDiagnosis] END

  console.log(
    `${DIAG_PREFIX} awaiting firstWindow() at ${new Date().toISOString()}`,
  );
  const window = await app.firstWindow();
  console.log(
    `${DIAG_PREFIX} firstWindow() resolved: url=${window.url()} after ${Date.now() - launchStart}ms total`,
  );

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
  console.log(`${DIAG_PREFIX} domcontentloaded fired`);

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
