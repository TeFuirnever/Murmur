/**
 * IPC handler mocking for Electron E2E tests.
 *
 * Wraps electronApp.evaluate() to remove then re-register IPC handlers.
 * All responses must be JSON-serializable (plain objects, not functions).
 *
 * Solves the "cannot register a second handler" limitation (Electron 20+).
 */
// [20260726_Tier43_E2EHelpers] Migrated .js→.ts for TypeScript types.
// Uses CommonJS (require / module.exports) rather than ESM import/export
// because the 12 e2e suites are still .js (CJS) — see US-003. Playwright
// 1.60 + Node 24 hit "exports is not defined in ES module scope"
// (microsoft/playwright #37890) when a CJS .js suite imports an
// ESM-compiled .ts helper. Type annotations come from JSDoc; the
// ElectronApplication type name resolves via @playwright/test types.
// [20260820_E2E_EvalScopeRequireFix] The old bodies called
// require("electron") inside app.evaluate(). Playwright evaluates that
// body in the main-process global scope, where `require` is NOT defined
// (ADR-010 ships main as an esbuild CJS bundle — module-scope require
// never leaks to globals). Playwright passes the electron module itself
// as the evaluate callback's FIRST argument; destructure from there and
// never touch require() inside evaluate bodies.

/**
 * Override an IPC handler with a static mock response.
 *
 * @param {ElectronApplication} app
 * @param {string} channel - IPC channel name
 * @param {object} response - JSON-serializable response object
 *
 * @example
 * await mockIpcHandler(app, 'transcribe-audio', { success: true, text: '测试' });
 */
async function mockIpcHandler(app, channel, response) {
  return app.evaluate(
    ({ ipcMain }, { channel, response }) => {
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, () => response);
    },
    { channel, response },
  );
}

/**
 * Override multiple IPC handlers at once.
 *
 * @param {ElectronApplication} app
 * @param {Record<string, object>} mocks - Channel → response map
 */
async function mockIpcHandlers(app, mocks) {
  for (const [channel, response] of Object.entries(mocks)) {
    await mockIpcHandler(app, channel, response);
  }
}

/**
 * Remove a mocked IPC handler (channel returns "no handler" errors).
 *
 * @param {ElectronApplication} app
 * @param {string} channel
 */
async function restoreIpcHandler(app, channel) {
  return app.evaluate(
    ({ ipcMain }, { channel }) => {
      ipcMain.removeHandler(channel);
    },
    { channel },
  );
}

// [20260820_E2E_ControllableModelState] Deterministic model-state mocks.
// The renderer derives modelStatus.stage from the MODELS.CHECK +
// FUNASR.STATUS payloads (src/hooks/useModelStatus.tsx checkModelStatus),
// NOT from any stage field in the response — so the mock payloads below
// must use the real contract shapes. Whether the real machine has models
// downloaded is an environment bet these helpers remove.

/**
 * Force the "models ready" state: mic enabled, recording allowed.
 *
 * @param {ElectronApplication} app
 */
async function mockModelReady(app) {
  await mockIpcHandlers(app, {
    "check-model-files": {
      success: true,
      models_downloaded: true,
      minimum_ready: true,
      missing_models: [],
    },
    // stage "ready" additionally requires serverStatus.success &&
    // models_initialized (useModelStatus.tsx).
    "check-funasr-status": {
      success: true,
      models_initialized: true,
      server_ready: true,
    },
  });
}

/**
 * Force the "need_download" FTUE state: download prompt, onboarding
 * steps, mic disabled — regardless of what exists on this machine.
 *
 * @param {ElectronApplication} app
 */
async function mockModelNeedDownload(app) {
  await mockIpcHandler(app, "check-model-files", {
    success: true,
    models_downloaded: false,
    minimum_ready: false,
    missing_models: ["all"],
  });
}

module.exports = {
  mockIpcHandler,
  mockIpcHandlers,
  restoreIpcHandler,
  mockModelReady,
  mockModelNeedDownload,
};
// [20260726_Tier43_E2EHelpers] END
