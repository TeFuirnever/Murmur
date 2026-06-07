/**
 * IPC handler mocking for Electron E2E tests.
 *
 * Uses ipcMain.removeHandler() to unregister existing handlers,
 * then re-registers with mock responses. This solves the
 * "cannot register a second handler" limitation (C-3 fix).
 */
const { ipcMain } = require("electron");

/**
 * Override an IPC handler with a mock response.
 * Must be called inside electronApp.evaluate().
 *
 * @param {string} channel - IPC channel name
 * @param {Function|any} handlerOrValue - Handler function or static value to return
 *
 * @example
 * // In electronApp.evaluate():
 * await app.evaluate(async () => {
 *   const { mockIpcHandler } = require('./helpers/ipc-mock');
 *   mockIpcHandler('transcribe-audio', () => ({ success: true, text: '测试文本' }));
 * });
 */
function mockIpcHandler(channel, handlerOrValue) {
  // Remove existing handler first (Electron 20+)
  ipcMain.removeHandler(channel);

  const handler =
    typeof handlerOrValue === "function"
      ? handlerOrValue
      : () => handlerOrValue;

  ipcMain.handle(channel, handler);
}

/**
 * Override multiple IPC handlers at once.
 * @param {Record<string, Function|any>} mocks - Channel → handler/value map
 */
function mockIpcHandlers(mocks) {
  for (const [channel, handlerOrValue] of Object.entries(mocks)) {
    mockIpcHandler(channel, handlerOrValue);
  }
}

/**
 * Restore an IPC handler to its original implementation.
 * Removes the mock, so the channel returns "no handler" errors.
 * @param {string} channel
 */
function restoreIpcHandler(channel) {
  ipcMain.removeHandler(channel);
}

module.exports = { mockIpcHandler, mockIpcHandlers, restoreIpcHandler };
