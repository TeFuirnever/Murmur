const environmentHandlers = require("./environmentHandlers");
const modelHandlers = require("./modelHandlers");
const transcriptionHandlers = require("./transcriptionHandlers");
const aiHandlers = require("./aiHandlers");
const settingsHandlers = require("./settingsHandlers");
const windowHandlers = require("./windowHandlers");
const hotkeyHandlers = require("./hotkeyHandlers");
const clipboardHandlers = require("./clipboardHandlers");
const systemHandlers = require("./systemHandlers");

function registerAll(ipcMain, managers) {
  environmentHandlers.register(ipcMain, managers);
  modelHandlers.register(ipcMain, managers);
  transcriptionHandlers.register(ipcMain, managers);
  aiHandlers.register(ipcMain, managers);
  settingsHandlers.register(ipcMain, managers);
  windowHandlers.register(ipcMain, managers);
  hotkeyHandlers.register(ipcMain, managers);
  clipboardHandlers.register(ipcMain, managers);
  systemHandlers.register(ipcMain, managers);
}

module.exports = { registerAll };
