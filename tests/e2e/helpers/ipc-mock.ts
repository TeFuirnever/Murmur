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
// IMPORTANT: the require("electron") calls inside app.evaluate() run in
// the Electron MAIN process where ESM `import` is unavailable — they
// must stay as require() regardless of the module system choice above.

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
    ({ channel, response }) => {
      const { ipcMain } = require("electron");
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
    ({ channel }) => {
      const { ipcMain } = require("electron");
      ipcMain.removeHandler(channel);
    },
    { channel },
  );
}

module.exports = { mockIpcHandler, mockIpcHandlers, restoreIpcHandler };
// [20260726_Tier43_E2EHelpers] END
