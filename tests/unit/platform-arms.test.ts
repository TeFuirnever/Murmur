// [20260906_Test_PlatformArms] Spec #266 T04 (#280): cross-platform branch
// arms exercised on ONE machine via process.platform stubbing. Companion
// audit of the arm inventory (research doc G3: the win CI leg measured
// branch 91.53% vs mac 92.19% because each leg executes only its own arms):
//
//   branch point                          covering tests
//   ------------------------------------  -------------------------------
//   audioPathValidator UNC early-reject   audioPathValidator-branches + HERE
//   audioPathValidator 8.3/trailing-dot   audioPathValidator-branches (win32 stub)
//   audioPathValidator /Volumes roots     audioPathValidator-branches + symlink
//   funasrServer taskkill/SIGKILL arms    funasrServer-killtree (both stubbed)
//   pythonEnvironment layout win/darwin   pythonEnvironment-embedded-layout
//   pythonInstaller mac dispatch          pythonInstaller (setPlatform)
//   updateManager dmg/exe asset arms      updateManager-behavioral + HERE
//   audioFileHelpers which/where ffmpeg   HERE (previously uncovered)
//   systemHandlers darwin-gated perms     HERE (previously uncovered)
//
// process.platform BRANCHES are dual-asserted here; the fs/path MODULES
// stay host-bound (a win CI leg resolves paths with win32 semantics), so
// the two assertions that depend on posix filename semantics are gated
// with it.skipIf(process.platform === "win32") — they run on the mac leg
// and skip on the win leg, mirroring audioPathValidator-branches.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

vi.mock("child_process", () => ({
  execSync: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => "/tmp/test-user-data"),
    getAppPath: vi.fn(() => "/test-app"),
  },
  shell: { openExternal: vi.fn(), openPath: vi.fn() },
  BrowserWindow: vi.fn(),
  dialog: { showMessageBox: vi.fn() },
}));

import { execSync } from "child_process";
import * as audioFileHelpers from "../../src/helpers/audioFileHelpers";
import * as sysHandlers from "../../src/helpers/ipc/systemHandlers";
import * as C from "../../src/helpers/ipc-contracts";
import { getPlatformAsset } from "../../src/helpers/updateManager";
import { validateAudioPath } from "../../src/helpers/audioPathValidator";

const ORIG_PLATFORM = process.platform;

function setPlatform(platform: string): void {
  Object.defineProperty(process, "platform", {
    value: platform,
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  setPlatform(ORIG_PLATFORM);
  vi.restoreAllMocks();
  vi.mocked(execSync).mockReset();
});

describe("[20260906_Test_PlatformArms] audioFileHelpers ffmpeg detection", () => {
  beforeEach(() => {
    audioFileHelpers._resetFFmpegCache();
  });

  it("win32 arm probes with `where ffmpeg` and takes the first hit", () => {
    setPlatform("win32");
    vi.mocked(execSync).mockImplementation(
      () => "C:\\tools\\ffmpeg.exe\nC:\\other\\ffmpeg.exe\n",
    );
    expect(audioFileHelpers.getFFmpegPath()).toBe("C:\\tools\\ffmpeg.exe");
    expect(execSync).toHaveBeenCalledWith("where ffmpeg", expect.any(Object));
  });

  it("posix arm probes with `which ffmpeg` and takes the first hit", () => {
    setPlatform("darwin");
    vi.mocked(execSync).mockImplementation(() => "/opt/homebrew/bin/ffmpeg\n");
    expect(audioFileHelpers.getFFmpegPath()).toBe("/opt/homebrew/bin/ffmpeg");
    expect(execSync).toHaveBeenCalledWith("which ffmpeg", expect.any(Object));
  });
});

describe("[20260906_Test_PlatformArms] systemHandlers darwin-gated permission handlers", () => {
  function makeHarness() {
    const handlers: Record<string, (...args: unknown[]) => unknown> = {};
    const ipcMain = {
      handle: vi.fn((channel: string, fn: (...args: unknown[]) => unknown) => {
        handlers[channel] = fn;
      }),
    };
    const clipboardManager = {
      checkAccessibilityPermissions: vi.fn(async () => true),
      openSystemSettings: vi.fn(),
      pasteText: vi.fn(async () => undefined),
    };
    const managers = {
      logger: {},
      funasrManager: {
        isInitialized: true,
        modelsInitialized: true,
        serverReady: true,
        pythonCmd: "python",
      },
      clipboardManager,
    };
    sysHandlers.register(
      ipcMain as never,
      managers as unknown as Parameters<typeof sysHandlers.register>[1],
    );
    return { handlers, clipboardManager };
  }

  it("REQUEST_PERMS opens system settings on darwin only", async () => {
    setPlatform("darwin");
    const darwin = makeHarness();
    await expect(darwin.handlers[C.SYSTEM.REQUEST_PERMS]!()).resolves.toEqual({
      success: true,
    });
    expect(darwin.clipboardManager.openSystemSettings).toHaveBeenCalledTimes(1);

    setPlatform("win32");
    const win = makeHarness();
    await expect(win.handlers[C.SYSTEM.REQUEST_PERMS]!()).resolves.toEqual({
      success: true,
    });
    expect(win.clipboardManager.openSystemSettings).not.toHaveBeenCalled();
  });

  it("OPEN_PERMS succeeds on darwin and degrades with a clear error on win32", async () => {
    setPlatform("darwin");
    const darwin = makeHarness();
    expect(darwin.handlers[C.SYSTEM.OPEN_PERMS]!()).toEqual({ success: true });
    expect(darwin.clipboardManager.openSystemSettings).toHaveBeenCalledTimes(1);

    setPlatform("win32");
    const win = makeHarness();
    expect(win.handlers[C.SYSTEM.OPEN_PERMS]!()).toEqual({
      success: false,
      error: "当前平台不支持自动打开权限设置",
    });
    expect(win.clipboardManager.openSystemSettings).not.toHaveBeenCalled();
  });
});

describe("[20260906_Test_PlatformArms] updateManager asset arms", () => {
  const release = {
    tag_name: "v1.0.0",
    html_url: "https://github.com/TeFuirnever/Murmur/releases/v1.0.0",
    assets: [
      {
        name: "Murmur-1.0.0.exe",
        browser_download_url: "https://example.com/murmur.exe",
        size: 1000,
      },
      {
        name: "Murmur-1.0.0.dmg",
        browser_download_url: "https://example.com/murmur.dmg",
        size: 2000,
      },
    ],
  };

  it("win32 arm selects the .exe asset", () => {
    expect(getPlatformAsset(release, "win32")?.name).toBe("Murmur-1.0.0.exe");
  });

  it("darwin arm selects the .dmg asset", () => {
    expect(getPlatformAsset(release, "darwin")?.name).toBe("Murmur-1.0.0.dmg");
  });
});

describe("[20260906_Test_PlatformArms] audioPathValidator UNC pairing", () => {
  it("UNC input is rejected under win32 (early-reject arm)", () => {
    setPlatform("win32");
    expect(validateAudioPath("\\\\server\\share\\audio.wav")).toEqual({
      valid: false,
      error: "路径不在允许范围内",
    });
  });

  // Host-bound fs semantics: on a posix host backslashes are ordinary
  // filename characters, so this exercises the allowed-roots path for a
  // UNC-looking literal. Skipped on win hosts where path.join collapses
  // the backslashes into subdirectories and the premise disappears.
  it.skipIf(process.platform === "win32")(
    "posix identity has no UNC concept: the same string is a plain filename ruled by allowed roots",
    () => {
      setPlatform("darwin");
      const target = path.join(os.tmpdir(), "\\\\server\\share\\audio.wav");
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, "x");
      try {
        expect(validateAudioPath(target).valid).toBe(true);
      } finally {
        fs.rmSync(target, { force: true });
      }
    },
  );

  it("a legitimate tmpdir audio file is accepted under BOTH identities", () => {
    const target = path.join(os.tmpdir(), `murmur-arms-${Date.now()}.wav`);
    fs.writeFileSync(target, "x");
    try {
      setPlatform("win32");
      expect(validateAudioPath(target).valid).toBe(true);
      setPlatform("darwin");
      expect(validateAudioPath(target).valid).toBe(true);
    } finally {
      fs.rmSync(target, { force: true });
    }
  });

  it("windows system-tree blacklist is win32-semantic: rejects on win32", () => {
    // A posix host's path.resolve never yields a drive-letter path, so the
    // win32 arm is reached the same way audioPathValidator-branches reaches
    // it: stub realpathSync to return the canonicalized Windows path. The
    // stub keeps this assertion host-independent.
    const spy = vi
      .spyOn(fs, "realpathSync")
      .mockReturnValue("C:\\Windows\\Media\\alarm.wav");
    setPlatform("win32");
    const target = path.join(os.tmpdir(), `murmur-arms-sys-${Date.now()}.wav`);
    fs.writeFileSync(target, "x");
    try {
      expect(validateAudioPath(target).valid).toBe(false);
      expect(spy).toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
      fs.rmSync(target, { force: true });
    }
  });

  // [20260906_Test_PlatformArms_ReviewFix] Host-bound path semantics: what
  // "C:\Windows\..." resolves to depends on the HOST's path module, not the
  // process.platform stub — on a posix host it is a relative filename under
  // the cwd (inside homedir → allowed), while a win host resolves a real
  // drive-letter path (system tree → rejected). Run only where the posix
  // premise holds; same pattern as the skipIf cases in
  // audioPathValidator-branches.test.ts.
  it.skipIf(process.platform === "win32")(
    "posix host treats the system-tree string as a plain relative filename",
    () => {
      setPlatform("darwin");
      expect(validateAudioPath("C:\\Windows\\Media\\alarm.wav").valid).toBe(
        true,
      );
    },
  );
});
