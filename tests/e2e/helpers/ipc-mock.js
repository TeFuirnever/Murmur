/**
 * IPC handler mocking for Electron E2E tests.
 *
 * Wraps electronApp.evaluate() to remove then re-register IPC handlers.
 * All responses must be JSON-serializable (plain objects, not functions).
 *
 * Solves the "cannot register a second handler" limitation (Electron 20+).
 */

/**
 * Override an IPC handler with a static mock response.
 *
 * @param {import('playwright-core').ElectronApplication} app
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
 * @param {import('playwright-core').ElectronApplication} app
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
 * @param {import('playwright-core').ElectronApplication} app
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
