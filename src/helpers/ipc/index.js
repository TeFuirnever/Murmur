const environmentHandlers = require("./environmentHandlers");
const modelHandlers = require("./modelHandlers");
const aiHandlers = require("./aiHandlers");
const transcriptionHandlers = require("./transcriptionHandlers");
const settingsHandlers = require("./settingsHandlers");
const windowHandlers = require("./windowHandlers");
const hotkeyHandlers = require("./hotkeyHandlers");
const clipboardHandlers = require("./clipboardHandlers");
const systemHandlers = require("./systemHandlers");
const updateHandlers = require("../updateManager");
const createRateLimitedHandler = require("../ipcRateLimiter");

function wrapWithRateLimits(ipcMain) {
  const originalHandle = ipcMain.handle.bind(ipcMain);
  const RATE_LIMITS = {
    "process-text": { maxCalls: 20, windowMs: 60_000 },
    "check-ai-status": { maxCalls: 30, windowMs: 60_000 },
    "save-transcription": { maxCalls: 30, windowMs: 60_000 },
    "download-models": { maxCalls: 3, windowMs: 300_000 },
    "install-funasr": { maxCalls: 3, windowMs: 300_000 },
  };

  ipcMain.handle = function (channel, handler) {
    const limits = RATE_LIMITS[channel];
    if (limits) {
      return originalHandle(
        channel,
        createRateLimitedHandler(handler, limits),
      );
    }
    return originalHandle(channel, handler);
  };

  return ipcMain;
}

function registerAll(ipcMain, managers) {
  const wrappedIpc = wrapWithRateLimits(ipcMain);
  environmentHandlers.register(wrappedIpc, managers);
  modelHandlers.register(wrappedIpc, managers);
  aiHandlers.register(wrappedIpc, managers);
  transcriptionHandlers.register(wrappedIpc, {
    ...managers,
    processTextWithAI: aiHandlers.processTextWithAI,
  });
  settingsHandlers.register(wrappedIpc, managers);
  windowHandlers.register(wrappedIpc, managers);
  hotkeyHandlers.register(wrappedIpc, managers);
  clipboardHandlers.register(wrappedIpc, managers);
  systemHandlers.register(wrappedIpc, managers);
  updateHandlers.register(wrappedIpc, managers);
}

module.exports = { registerAll };
