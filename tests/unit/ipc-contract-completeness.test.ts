// [IPC_Contract_Completeness_Test] Verifies that every two-way IPC channel
// value declared in src/helpers/ipc-contracts.ts is registered by registerAll
// in src/helpers/ipc/index.ts, and that no channel is registered twice.
//
// EVENTS are one-way (main -> renderer via webContents.send), so they are
// intentionally excluded from this two-way `ipcMain.handle` coverage check.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock electron — every handler module imports named members from it.
// `app`, `shell`, `dialog`, `net`, `BrowserWindow`, `Notification` are all
// referenced at registration time (not just at handler-call time) in at
// least one handler, so they must exist on the mock before index.ts loads.
vi.mock("electron", () => {
  const _noop = vi.fn();
  const webContents = {
    id: 1,
    send: vi.fn(),
    on: vi.fn(),
    openDevTools: vi.fn(),
    reload: vi.fn(),
  };
  const window = {
    webContents,
    hide: vi.fn(),
    show: vi.fn(),
    minimize: vi.fn(),
    maximize: vi.fn(),
    close: vi.fn(),
    setBounds: vi.fn(),
    getBounds: vi.fn(() => ({ x: 0, y: 0, width: 800, height: 600 })),
    isMaximized: vi.fn(() => false),
    isDestroyed: vi.fn(() => false),
    setAlwaysOnTop: vi.fn(),
    reload: vi.fn(),
    openDevTools: vi.fn(),
  };
  return {
    app: {
      getPath: vi.fn(() => "/tmp/murmur-test"),
      getVersion: vi.fn(() => "0.0.0-test"),
      quit: vi.fn(),
    },
    shell: { openExternal: vi.fn(), openPath: vi.fn() },
    dialog: {
      showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })),
      showSaveDialog: vi.fn(async () => ({ canceled: true, filePath: "" })),
      showMessageBox: vi.fn(async () => ({ response: 0 })),
    },
    net: {
      fetch: vi.fn(async () => ({
        ok: false,
        json: async () => ({}),
        text: async () => "",
      })),
    },
    BrowserWindow: Object.assign(
      vi.fn(() => window),
      {
        fromWebContents: vi.fn(() => window),
        getAllWindows: vi.fn(() => [window]),
        isSupported: vi.fn(() => false),
      },
    ),
    Notification: Object.assign(
      vi.fn(() => ({ on: vi.fn(), show: vi.fn() })),
      {
        isSupported: vi.fn(() => false),
      },
    ),
  };
});

// Mock the heavy/impure helper modules that handler modules import at top
// level. These must be mocked so importing index.ts does not pull in docx,
// real AI prompts, file-system validators, etc.
vi.mock("../../src/helpers/exportFormatters", () => ({
  getFormatInfo: vi.fn(() => ({
    ext: ".txt",
    label: "Text",
    formatter: vi.fn(async () => "formatted"),
  })),
  formatTXT: vi.fn(() => "txt"),
  formatSRT: vi.fn(() => "srt"),
  formatVTT: vi.fn(() => "vtt"),
  formatMD: vi.fn(() => "md"),
  formatDOCX: vi.fn(async () => Buffer.from("docx")),
}));

vi.mock("../../src/helpers/aiPrompts", () => ({
  buildPrompt: vi.fn(() => ({ system: "sys", user: "user" })),
  loadCustomTemplates: vi.fn(() => []),
  DEFAULT_PIPELINE: ["optimize"],
}));

vi.mock("../../src/helpers/providerPresets", () => ({
  getProviderPresets: vi.fn(() => []),
}));

vi.mock("../../src/helpers/detectLocalModels", () => ({
  detectLocalModels: vi.fn(async () => ({ models: [] })),
}));

vi.mock("../../src/helpers/audioPathValidator", () => ({
  validateAudioPath: vi.fn(() => ({
    valid: true,
    ext: ".wav",
    resolved: "/x.wav",
  })),
}));

// Build a managers bag that satisfies every handler's destructure list:
//   environment: funasrManager, logger
//   model:        funasrManager
//   ai:           databaseManager, logger, templatesDir
//   transcription:funasrManager, databaseManager, logger (+ processTextWithAI injected by index)
//   settings:     databaseManager, logger, windowManager
//   window:       windowManager
//   hotkey:       hotkeyManager, windowManager, logger
//   clipboard:    clipboardManager, logger
//   system:       logger, funasrManager, clipboardManager
//   update:       logger
function createMockManagers() {
  const mockWebContents = { send: vi.fn(), id: 1 };
  const mockWindow = {
    webContents: mockWebContents,
    isDestroyed: vi.fn(() => false),
    hide: vi.fn(),
    show: vi.fn(),
    minimize: vi.fn(),
    maximize: vi.fn(),
    close: vi.fn(),
    setBounds: vi.fn(),
    getBounds: vi.fn(() => ({ x: 0, y: 0, width: 800, height: 600 })),
    isMaximized: vi.fn(() => false),
    setAlwaysOnTop: vi.fn(),
    reload: vi.fn(),
    openDevTools: vi.fn(),
  };

  return {
    funasrManager: {
      // environment + model
      checkStatus: vi.fn(async () => ({
        success: true,
        models_downloaded: true,
        python_installed: true,
        funasr_installed: true,
      })),
      installFunASR: vi.fn(async () => ({ success: true })),
      restartServer: vi.fn(async () => ({ success: true })),
      checkModelFiles: vi.fn(async () => ({ models_downloaded: true })),
      getDownloadProgress: vi.fn(async () => ({ progress: 0 })),
      downloadModels: vi.fn(async () => ({ success: true })),
      // transcription
      transcribeAudio: vi.fn(async () => ({ success: true, text: "" })),
      transcribeFile: vi.fn(async () => ({ success: true, text: "" })),
      cancelTranscription: vi.fn(async () => ({ success: true })),
      diarizeAudio: vi.fn(async () => ({ success: true })),
      // system (fields read directly)
      isInitialized: true,
      modelsInitialized: true,
      serverReady: true,
      pythonCmd: "python3",
      initializationPromise: null,
    },
    databaseManager: {
      getSetting: vi.fn(async () => null),
      setSetting: vi.fn(() => true),
      getAllSettings: vi.fn(() => ({})),
      resetSettings: vi.fn(() => true),
      saveTranscription: vi.fn(() => ({ lastInsertRowid: 1, changes: 1 })),
      getTranscriptionById: vi.fn(() => null),
      getTranscriptions: vi.fn(() => []),
      deleteTranscription: vi.fn(() => ({ changes: 1 })),
      searchTranscriptions: vi.fn(() => []),
      getTranscriptionStats: vi.fn(() => ({ total: 0 })),
      clearAllTranscriptions: vi.fn(() => true),
      syncToFileConfig: vi.fn(),
    },
    windowManager: {
      mainWindow: mockWindow,
      historyWindow: null,
      settingsWindow: null,
      _preMaximizeBounds: null,
      setDefaultAlwaysOnTop: vi.fn(),
      showHistoryWindow: vi.fn(),
      closeHistoryWindow: vi.fn(),
      hideHistoryWindow: vi.fn(),
      showSettingsWindow: vi.fn(),
      closeSettingsWindow: vi.fn(),
      hideSettingsWindow: vi.fn(),
    },
    hotkeyManager: {
      registerHotkey: vi.fn(() => true),
      unregisterHotkey: vi.fn(() => true),
      getRegisteredHotkeys: vi.fn(() => []),
      registerF2DoubleClick: vi.fn(() => true),
      setRecordingState: vi.fn(),
      getRecordingState: vi.fn(() => false),
    },
    clipboardManager: {
      copyText: vi.fn(async () => ({ success: true })),
      pasteText: vi.fn(async () => ({ success: true })),
      readClipboard: vi.fn(async () => ""),
      writeClipboard: vi.fn(async () => ({ success: true })),
      checkAccessibilityPermissions: vi.fn(async () => true),
      openSystemSettings: vi.fn(),
    },
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      getSystemInfo: vi.fn(() => ({})),
    },
    // aiHandlers falls back to lazy require("electron") when templatesDir is
    // absent; provide it so registration never touches electron.
    templatesDir: "/tmp/murmur-test-templates",
  };
}

describe("IPC contract completeness", () => {
  let originalNodeEnv: string | undefined;
  let registrations: Array<{ channel: string; handler: unknown }>;

  beforeEach(() => {
    // WINDOW.OPEN_DEV_TOOLS and WINDOW.RELOAD are only registered when
    // NODE_ENV === "development" (see systemHandlers.ts). Force dev so the
    // completeness check covers the full contract surface.
    originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";

    registrations = [];
  });

  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    vi.resetModules();
  });

  function createMockIpcMain() {
    // registerAll's wrapWithRateLimits reassigns `handle` on the object it
    // receives, so `handle` must be a writable own property that records
    // every registration. The wrapper still delegates to the original.
    const ipcMain = {
      handle: vi.fn((channel: string, handler: unknown) => {
        registrations.push({ channel, handler });
      }),
    };
    return ipcMain;
  }

  it("registers a handler for every two-way channel value in ipc-contracts", async () => {
    const C = await import("../../src/helpers/ipc-contracts");
    const { registerAll } = await import("../../src/helpers/ipc/index");

    const ipcMain = createMockIpcMain();
    registerAll(ipcMain as never, createMockManagers() as never);

    // Collect every channel value from the two-way contract groups.
    // EVENTS is excluded — those are one-way main->renderer sends.
    const contractGroups = [
      C.FUNASR,
      C.MODELS,
      C.TRANSCRIPTION,
      C.AI,
      C.SETTINGS,
      C.WINDOW,
      C.HOTKEY,
      C.CLIPBOARD,
      C.UPDATE,
      C.SYSTEM,
    ];
    const expectedChannels = contractGroups.flatMap((group) =>
      Object.values(group),
    );

    const registeredChannels = registrations.map((r) => r.channel);
    const missing = expectedChannels.filter(
      (ch) => !registeredChannels.includes(ch),
    );
    const extra = registeredChannels.filter(
      (ch) => !expectedChannels.includes(ch),
    );

    expect(
      missing,
      `Channels declared in ipc-contracts but NOT registered:\n${missing.join("\n")}`,
    ).toEqual([]);
    expect(
      extra,
      `Channels registered but NOT declared in ipc-contracts:\n${extra.join("\n")}`,
    ).toEqual([]);
  });

  it("does not register any channel more than once", async () => {
    await import("../../src/helpers/ipc-contracts");
    const { registerAll } = await import("../../src/helpers/ipc/index");

    registerAll(createMockIpcMain() as never, createMockManagers() as never);

    const channels = registrations.map((r) => r.channel);
    const counts = new Map<string, number>();
    for (const ch of channels) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    const duplicates = [...counts.entries()]
      .filter(([, n]) => n > 1)
      .map(([ch, n]) => `${ch} (x${n})`);

    expect(
      duplicates,
      `Duplicate channel registrations:\n${duplicates.join("\n")}`,
    ).toEqual([]);
  });
});
