import { describe, it, expect, vi } from "vitest";
const C = require("../../src/helpers/ipc-contracts");
const envHandlers = require("../../src/helpers/ipc/environmentHandlers");

function createIpcMain() {
  const handlers = {};
  return {
    handle: vi.fn((channel, fn) => {
      handlers[channel] = fn;
    }),
    _handlers: handlers,
  };
}

describe("environmentHandlers funasr-install-progress event", () => {
  it("forwards progress through C.EVENTS.FUNASR_INSTALL_PROGRESS constant", async () => {
    const ipcMain = createIpcMain();
    const sendSpy = vi.fn();
    const event = { sender: { send: sendSpy } };

    const managers = {
      environmentManager: {
        exportConfig: vi.fn(),
        validateEnvironment: vi.fn(),
      },
      funasrManager: {
        checkPythonInstallation: vi.fn(),
        installPython: vi.fn(),
        checkFunASRInstallation: vi.fn(),
        checkStatus: vi.fn(() => Promise.resolve({})),
        modelsInitialized: false,
        serverReady: false,
        initializationPromise: null,
        installFunASR: vi.fn(async (cb) => {
          cb({ stage: "downloading", percentage: 42 });
          return { success: true };
        }),
        restartServer: vi.fn(),
        findPythonExecutable: vi.fn(),
      },
      logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
    };

    envHandlers.register(ipcMain, managers);
    await ipcMain._handlers[C.FUNASR.INSTALL](event);

    expect(sendSpy).toHaveBeenCalledWith(
      C.EVENTS.FUNASR_INSTALL_PROGRESS,
      expect.objectContaining({ stage: "downloading", percentage: 42 }),
    );
  });

  it("source uses constant, not string literal", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      new URL(
        "../../src/helpers/ipc/environmentHandlers.js",
        import.meta.url,
      ),
      "utf8",
    );
    expect(source).toContain("C.EVENTS.FUNASR_INSTALL_PROGRESS");
    const sendLines = source
      .split("\n")
      .filter((l) => l.includes("event.sender.send"));
    for (const line of sendLines) {
      expect(line).not.toContain('"funasr-install-progress"');
    }
  });
});
