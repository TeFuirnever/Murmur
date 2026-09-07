// [20260725_TDD_UpdateManager_Behavioral] Behavioral TDD tests for the pure
// helper functions exported from updateManager.ts: semverGt, parseChecksums,
// getPlatformAsset. These helpers are platform/version logic with no Electron
// runtime dependency at call time; only module load pulls in `electron`, so
// we mock it out at the top.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import * as C from "../../src/helpers/ipc-contracts";

// Mock electron — updateManager imports `electron` at the top level even
// though the pure helpers never touch it at call time; register() does.
// [20260906_Spec259_T2] The holder is mutable so the register() suites can
// re-script app/net/BrowserWindow/Notification per test. IMPORTANT: only the
// INNER mock functions are re-configured (mockReset/mockImplementation...);
// the nested objects are never replaced, because the module under test
// destructures its electron imports once at import time.
type ViFn = ReturnType<typeof vi.fn>;

const electronMock = vi.hoisted(() => {
  const notificationInstances: Array<{
    opts: Record<string, unknown>;
    on: ReturnType<typeof vi.fn>;
    show: ReturnType<typeof vi.fn>;
  }> = [];
  class FakeNotification {
    static isSupported: ReturnType<typeof vi.fn> = vi.fn(() => false);
    opts: Record<string, unknown>;
    on: ReturnType<typeof vi.fn>;
    show: ReturnType<typeof vi.fn>;
    constructor(opts: Record<string, unknown>) {
      this.opts = opts;
      this.on = vi.fn();
      this.show = vi.fn();
      notificationInstances.push(this);
    }
  }
  return {
    notificationInstances,
    Notification: FakeNotification,
    app: {
      getVersion: vi.fn(() => "1.2.3"),
      getPath: vi.fn(() => "/tmp"),
      quit: vi.fn(),
    },
    shell: { openPath: vi.fn() },
    net: { fetch: vi.fn() },
    BrowserWindow: Object.assign(vi.fn(), {
      // `: unknown` return keeps mockReturnValue usable with fake windows.
      fromWebContents: vi.fn((): unknown => null),
    }),
  };
});

vi.mock("electron", () => electronMock);

import {
  semverGt,
  parseChecksums,
  getPlatformAsset,
  getChecksumsAsset,
  register,
} from "../../src/helpers/updateManager";

// GitHub API URL from the module under test (used to script fetch replies).
const GITHUB_API =
  "https://api.github.com/repos/TeFuirnever/Murmur/releases/latest";

describe("updateManager — pure helper behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("semverGt", () => {
    it("returns true when a > b by patch (1.2.3 > 1.2.2)", () => {
      expect(semverGt("1.2.3", "1.2.2")).toBe(true);
    });

    it("returns false when a < b by patch (1.2.2 vs 1.2.3)", () => {
      expect(semverGt("1.2.2", "1.2.3")).toBe(false);
    });

    it("returns false when versions are equal (1.2.3 vs 1.2.3)", () => {
      expect(semverGt("1.2.3", "1.2.3")).toBe(false);
    });

    it("returns true when crossing a major boundary (2.0.0 > 1.9.9)", () => {
      expect(semverGt("2.0.0", "1.9.9")).toBe(true);
    });
  });

  describe("parseChecksums", () => {
    it("extracts SHA256 + filename pairs from valid checksum text", () => {
      // Format observed in updateManager.ts: "<hash>  <filename>" where the
      // separator is 2+ whitespace characters. Two entries on separate lines.
      const sha1 = "a".repeat(64);
      const sha2 = "b".repeat(64);
      const content = `${sha1}  Murmur-1.0.0.dmg\n${sha2}  Murmur-1.0.0.exe`;

      const entries = parseChecksums(content);

      expect(entries).toHaveLength(2);
      expect(entries[0]).toEqual({
        hash: sha1,
        filename: "Murmur-1.0.0.dmg",
      });
      expect(entries[1]).toEqual({
        hash: sha2,
        filename: "Murmur-1.0.0.exe",
      });
    });

    it("returns empty array for invalid/blank input", () => {
      // parseChecksums splits on newlines and filters blank lines; an empty
      // or whitespace-only string yields no entries (never null).
      expect(parseChecksums("")).toEqual([]);
      expect(parseChecksums("   \n\n\t\n")).toEqual([]);
    });
  });

  describe("getPlatformAsset", () => {
    it("returns the .dmg asset for darwin from a releases array", () => {
      // getPlatformAsset keys off platform === "darwin" → looks for a .dmg.
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
          {
            name: "checksums-sha256.txt",
            browser_download_url: "https://example.com/checksums.txt",
            size: 100,
          },
        ],
      };

      const asset = getPlatformAsset(release, "darwin");

      expect(asset).toBeDefined();
      expect(asset?.name).toBe("Murmur-1.0.0.dmg");
      expect(asset?.browser_download_url).toBe(
        "https://example.com/murmur.dmg",
      );
      expect(asset?.size).toBe(2000);
    });

    it("returns undefined for an unsupported platform (no matching asset)", () => {
      // The function only knows darwin (.dmg) vs everything-else (.exe).
      // A platform like "freebsd" matches the non-darwin branch and looks
      // for a .exe; with none present, it returns undefined (not null).
      const release = {
        tag_name: "v1.0.0",
        html_url: "https://github.com/TeFuirnever/Murmur/releases/v1.0.0",
        assets: [
          {
            name: "Murmur-1.0.0.dmg",
            browser_download_url: "https://example.com/murmur.dmg",
            size: 2000,
          },
          {
            name: "checksums-sha256.txt",
            browser_download_url: "https://example.com/checksums.txt",
            size: 100,
          },
        ],
      };

      const asset = getPlatformAsset(release, "freebsd");
      // freebsd → non-darwin → seeks .exe → none present → undefined.
      expect(asset).toBeUndefined();
    });
  });
});

// [20260906_Spec259_T2] Pure-helper arm close-out: the `|| []` / `|| ""`
// fallback arms and the checksums-asset lookup that the original suite never
// exercised.
describe("[20260906_Spec259_T2] updateManager pure-helper arms", () => {
  it("semverGt treats missing version components as zero", () => {
    // "1.2" vs "1.2" hits the `pa[i] || 0` / `pb[i] || 0` fallbacks in the
    // final loop iteration without deciding the comparison.
    expect(semverGt("1.2", "1.2")).toBe(false);
    expect(semverGt("1.2", "1.2.1")).toBe(false);
    expect(semverGt("1.2.1", "1.2")).toBe(true);
    // Non-numeric components parse to NaN, which the same fallback zeroes.
    expect(semverGt("a.b.c", "1.2.3")).toBe(false);
  });

  it("getPlatformAsset tolerates a release without an assets array", () => {
    const release = {
      tag_name: "v1.0.0",
      html_url: "https://example.com/rel",
    };
    expect(getPlatformAsset(release, "darwin")).toBeUndefined();
  });

  it("getChecksumsAsset finds the checksums file or returns undefined", () => {
    const checksumsAsset = {
      name: "checksums-sha256.txt",
      browser_download_url: "https://example.com/checksums.txt",
    };
    const withAsset = {
      tag_name: "v1.0.0",
      html_url: "https://example.com/rel",
      assets: [checksumsAsset],
    };
    expect(getChecksumsAsset(withAsset)).toEqual(checksumsAsset);

    const withoutAssets = {
      tag_name: "v1.0.0",
      html_url: "https://example.com/rel",
    };
    expect(getChecksumsAsset(withoutAssets)).toBeUndefined();
  });

  it("parseChecksums maps a separator-less line to an empty filename", () => {
    // A line without the 2+-space separator yields the hash-or-empty and
    // filename-or-empty fallbacks.
    const entries = parseChecksums("justonecolumn");
    expect(entries).toEqual([{ hash: "justonecolumn", filename: "" }]);
  });
});

// [20260906_Spec259_T2] register() IPC behavior: drive all four handlers
// (CHECK / DOWNLOAD / CANCEL / INSTALL) through a captured ipcMain with the
// electron surface scripted per test. File-system effects land in a per-test
// temp dir via app.getPath("temp"); the SHA256 verification runs against the
// real downloaded bytes.
describe("[20260906_Spec259_T2] updateManager register() IPC behavior", () => {
  let tmpDir: string;
  let handlers: Record<string, (...args: unknown[]) => unknown>;
  let logger: {
    info: (message: string, ...args: unknown[]) => void;
    warn: (message: string, ...args: unknown[]) => void;
    error: (message: string, ...args: unknown[]) => void;
  };

  const LATEST_VERSION = "9.9.9";
  const DOWNLOAD_URL = "https://example.com/murmur.dmg";
  const CHECKSUMS_URL = "https://example.com/checksums.txt";

  const EXT = process.platform === "darwin" ? ".dmg" : ".exe";
  const FILE_NAME = `Murmur-${LATEST_VERSION}${EXT}`;

  function makeRelease(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      tag_name: `v${LATEST_VERSION}`,
      html_url: "https://example.com/rel",
      ...overrides,
    };
  }

  function installerBytes(): Buffer {
    return Buffer.from("fake installer payload bytes", "utf8");
  }

  function checksumsContentFor(bytes: Buffer, fileName: string): string {
    const hash = crypto.createHash("sha256").update(bytes).digest("hex");
    return `${hash}  ${fileName}\n`;
  }

  interface ReaderHandle {
    read: () => Promise<IteratorResult<Uint8Array>>;
    push: (chunk: Buffer) => void;
    finish: () => void;
  }

  function makeReader(): ReaderHandle {
    const queue: Uint8Array[] = [];
    const resolvers: Array<(r: IteratorResult<Uint8Array>) => void> = [];
    let ended = false;
    return {
      read(): Promise<IteratorResult<Uint8Array>> {
        if (queue.length > 0) {
          return Promise.resolve({ done: false, value: queue.shift()! });
        }
        if (ended) {
          return Promise.resolve({ done: true, value: undefined });
        }
        return new Promise((resolve) => resolvers.push(resolve));
      },
      push(chunk: Buffer): void {
        const resolve = resolvers.shift();
        if (resolve) resolve({ done: false, value: new Uint8Array(chunk) });
        else queue.push(new Uint8Array(chunk));
      },
      finish(): void {
        ended = true;
        while (resolvers.length > 0) {
          resolvers.shift()!({ done: true, value: undefined });
        }
      },
    };
  }

  function scriptFetch(map: Record<string, unknown>): void {
    electronMock.net.fetch = vi.fn(async (url: string | URL | Request) => {
      const target = map[String(url)];
      if (target === undefined) {
        throw new Error(`unexpected fetch ${String(url)}`);
      }
      if (target instanceof Error) throw target;
      return target;
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "um-register-"));
    electronMock.app.getVersion.mockReturnValue("1.2.3");
    electronMock.app.getPath.mockReturnValue(tmpDir);
    electronMock.BrowserWindow.fromWebContents.mockReturnValue(null);
    electronMock.Notification.isSupported.mockReturnValue(false);
    electronMock.notificationInstances.length = 0;
    handlers = {};
    const ipcMain = {
      handle: vi.fn((channel: string, fn: (...args: unknown[]) => unknown) => {
        handlers[channel] = fn;
      }),
    };
    logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    // register() is called once per test via the shared harness below.
    register(ipcMain as unknown as Electron.IpcMain, { logger });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // The DOWNLOAD handler reads event.sender — always pass a fake event.
  function fakeEvent(): { sender: Record<string, unknown> } {
    return { sender: {} };
  }

  function fakeWin(destroyed = false): {
    webContents: { send: ViFn };
    isDestroyed: ViFn;
    show: ViFn;
    focus: ViFn;
  } {
    return {
      webContents: { send: vi.fn() },
      isDestroyed: vi.fn(() => destroyed),
      show: vi.fn(),
      focus: vi.fn(),
    };
  }

  describe("UPDATE.CHECK", () => {
    it("reports a network failure through the logger and the error shape", async () => {
      electronMock.net.fetch.mockRejectedValue(new Error("offline"));

      const result = (await handlers[C.UPDATE.CHECK]!()) as Record<
        string,
        unknown
      >;

      expect(result).toEqual({
        hasUpdate: false,
        currentVersion: "1.2.3",
        error: "检查更新失败",
      });
      expect(logger.warn).toHaveBeenCalled();
    });

    it("reports a non-ok release response", async () => {
      scriptFetch({ [GITHUB_API]: { ok: false, status: 503 } });

      const result = (await handlers[C.UPDATE.CHECK]!()) as Record<
        string,
        unknown
      >;
      expect(result.error).toBe("无法检查更新");
      expect(result.hasUpdate).toBe(false);
    });

    it("reports a malformed release payload (null json)", async () => {
      scriptFetch({
        [GITHUB_API]: { ok: true, json: async () => null },
      });

      const result = (await handlers[C.UPDATE.CHECK]!()) as Record<
        string,
        unknown
      >;
      expect(result.error).toBe("更新信息格式异常");
    });

    it("reports a malformed release payload (non-string tag_name)", async () => {
      scriptFetch({
        [GITHUB_API]: { ok: true, json: async () => ({ tag_name: 42 }) },
      });

      const result = (await handlers[C.UPDATE.CHECK]!()) as Record<
        string,
        unknown
      >;
      expect(result.error).toBe("更新信息格式异常");
    });

    it("returns full update info when a newer version with assets exists", async () => {
      const release = makeRelease({
        body: "release notes",
        assets: [
          {
            // [20260906_Spec259_T2_WinFix] The distractor must carry the
            // opposite platform's extension: with a hardcoded ".exe" it
            // collided with the host asset on win32, and getPlatformAsset
            // (scanning assets in order) returned the distractor's URL.
            name: `Murmur-9.9.9${EXT === ".dmg" ? ".exe" : ".dmg"}`,
            browser_download_url: "https://example.com/other-platform",
            size: 111,
          },
          {
            name: `Murmur-9.9.9${EXT}`,
            browser_download_url: DOWNLOAD_URL,
            size: 222,
          },
          {
            name: "checksums-sha256.txt",
            browser_download_url: CHECKSUMS_URL,
          },
        ],
      });
      scriptFetch({ [GITHUB_API]: { ok: true, json: async () => release } });

      const result = (await handlers[C.UPDATE.CHECK]!()) as Record<
        string,
        unknown
      >;

      expect(result.hasUpdate).toBe(true);
      expect(result.latestVersion).toBe(LATEST_VERSION);
      expect(result.message).toBe(`发现新版本 v${LATEST_VERSION}`);
      expect(result.downloadUrl).toBe(DOWNLOAD_URL);
      expect(result.downloadSize).toBe(222);
      expect(result.checksumsUrl).toBe(CHECKSUMS_URL);
      expect(result.releaseNotes).toBe("release notes");
    });

    it("returns up-to-date info with null download fields for a bare release", async () => {
      electronMock.app.getVersion.mockReturnValue(LATEST_VERSION);
      scriptFetch({
        [GITHUB_API]: { ok: true, json: async () => makeRelease() },
      });

      const result = (await handlers[C.UPDATE.CHECK]!()) as Record<
        string,
        unknown
      >;

      expect(result.hasUpdate).toBe(false);
      expect(result.message).toBe("当前已是最新版本");
      expect(result.downloadUrl).toBeNull();
      expect(result.downloadSize).toBe(0);
      expect(result.checksumsUrl).toBeNull();
      expect(result.releaseNotes).toBe("");
    });

    it("survives a failed check when no logger is wired", async () => {
      const ipcMain = { handle: vi.fn() };
      register(ipcMain as unknown as Electron.IpcMain, {});
      const noLoggerHandlers = ipcMain.handle.mock.calls.reduce(
        (acc, [channel, fn]) => {
          acc[channel as string] = fn as (...args: unknown[]) => unknown;
          return acc;
        },
        {} as Record<string, (...args: unknown[]) => unknown>,
      );
      electronMock.net.fetch.mockRejectedValue(new Error("offline"));

      const result = (await noLoggerHandlers[C.UPDATE.CHECK]!()) as Record<
        string,
        unknown
      >;
      expect(result.error).toBe("检查更新失败");
    });
  });

  describe("UPDATE.DOWNLOAD", () => {
    const updateInfo = {
      downloadUrl: DOWNLOAD_URL,
      checksumsUrl: CHECKSUMS_URL,
      latestVersion: LATEST_VERSION,
    };

    function scriptSuccessfulFetches(): Buffer {
      const bytes = installerBytes();
      scriptFetch({
        [CHECKSUMS_URL]: {
          ok: true,
          text: async () => checksumsContentFor(bytes, FILE_NAME),
        },
        [DOWNLOAD_URL]: {
          ok: true,
          headers: {
            get: (k: string) =>
              k === "content-length" ? String(bytes.length) : null,
          },
          body: {
            getReader: () => {
              const reader = makeReader();
              reader.push(bytes);
              queueMicrotask(() => reader.finish());
              return reader;
            },
          },
        },
      });
      return bytes;
    }

    it("rejects a second download while one is already running", async () => {
      const reader = makeReader();
      scriptFetch({
        [CHECKSUMS_URL]: {
          ok: true,
          text: async () => checksumsContentFor(installerBytes(), FILE_NAME),
        },
        [DOWNLOAD_URL]: {
          ok: true,
          headers: { get: () => "0" },
          body: { getReader: () => reader },
        },
      });

      const first = handlers[C.UPDATE.DOWNLOAD]!(
        fakeEvent(),
        updateInfo,
      ) as Promise<Record<string, unknown>>;
      // Mark handled early so a mid-test assertion failure cannot surface
      // the pending promise as an unhandled rejection.
      first.catch(() => undefined);
      // currentDownload is armed right before the installer fetch fires —
      // two fetches (checksums + installer) mean the guard is active.
      await vi.waitFor(() =>
        expect(electronMock.net.fetch).toHaveBeenCalledTimes(2),
      );

      const second = (await handlers[C.UPDATE.DOWNLOAD]!(
        fakeEvent(),
        updateInfo,
      )) as Record<string, unknown>;
      expect(second).toEqual({ success: false, error: "已有下载进行中" });

      // Cancel to unwind the first download and clean the temp file.
      expect(await handlers[C.UPDATE.CANCEL]!()).toEqual({ success: true });
      reader.push(Buffer.from("tail", "utf8"));
      const firstResult = (await first) as Record<string, unknown>;
      expect(firstResult.error).toBe("下载已取消");
      expect(fs.existsSync(path.join(tmpDir, FILE_NAME))).toBe(false);
    });

    it("rejects downloads missing required update info", async () => {
      scriptFetch({});
      const cases: unknown[] = [
        null,
        {},
        { downloadUrl: DOWNLOAD_URL },
        { downloadUrl: DOWNLOAD_URL, checksumsUrl: CHECKSUMS_URL },
      ];
      for (const info of cases) {
        const result = (await handlers[C.UPDATE.DOWNLOAD]!(
          fakeEvent(),
          info,
        )) as Record<string, unknown>;
        expect(result).toEqual({ success: false, error: "缺少下载信息" });
      }
      expect(electronMock.net.fetch).not.toHaveBeenCalled();
    });

    it("reports a checksums fetch failure to the window and returns the error", async () => {
      scriptFetch({
        [CHECKSUMS_URL]: { ok: false, status: 404 },
      });
      const win = fakeWin();
      electronMock.BrowserWindow.fromWebContents.mockReturnValue(win);

      const result = (await handlers[C.UPDATE.DOWNLOAD]!(
        fakeEvent(),
        updateInfo,
      )) as Record<string, unknown>;

      expect(result).toEqual({ success: false, error: "无法下载校验文件" });
      expect(win.webContents.send).toHaveBeenCalledWith(
        C.EVENTS.UPDATE_DOWNLOAD_ERROR,
        { error: "无法下载校验文件" },
      );
      expect(logger.error).toHaveBeenCalled();
    });

    it("reports a checksums file missing the installer entry", async () => {
      scriptFetch({
        [CHECKSUMS_URL]: {
          ok: true,
          text: async () => "deadbeef  some-other-file.dmg\n",
        },
      });

      const result = (await handlers[C.UPDATE.DOWNLOAD]!(
        fakeEvent(),
        updateInfo,
      )) as Record<string, unknown>;
      expect(result.error).toBe("校验文件中未找到对应文件");
    });

    it("reports a failed installer fetch with the HTTP status", async () => {
      scriptFetch({
        [CHECKSUMS_URL]: {
          ok: true,
          text: async () => checksumsContentFor(installerBytes(), FILE_NAME),
        },
        [DOWNLOAD_URL]: { ok: false, status: 500 },
      });

      const result = (await handlers[C.UPDATE.DOWNLOAD]!(
        fakeEvent(),
        updateInfo,
      )) as Record<string, unknown>;
      expect(result.error).toBe("下载失败: 500");
    });

    it("downloads, verifies, notifies, and reports completion", async () => {
      const bytes = scriptSuccessfulFetches();
      const win = fakeWin();
      electronMock.BrowserWindow.fromWebContents.mockReturnValue(win);
      electronMock.Notification.isSupported.mockReturnValue(true);

      const result = (await handlers[C.UPDATE.DOWNLOAD]!(
        fakeEvent(),
        updateInfo,
      )) as Record<string, unknown>;

      expect(result).toEqual({
        success: true,
        filePath: path.join(tmpDir, FILE_NAME),
        hashValid: true,
      });
      // The installer really landed in the temp dir.
      expect(fs.existsSync(path.join(tmpDir, FILE_NAME))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, "checksums-sha256.txt"))).toBe(
        true,
      );
      // Progress was pushed to the renderer (single chunk → 100%).
      expect(win.webContents.send).toHaveBeenCalledWith(
        C.EVENTS.UPDATE_DOWNLOAD_PROGRESS,
        { progress: 100, downloaded: bytes.length, total: bytes.length },
      );
      expect(win.webContents.send).toHaveBeenCalledWith(
        C.EVENTS.UPDATE_DOWNLOAD_COMPLETE,
        {
          filePath: path.join(tmpDir, FILE_NAME),
          version: LATEST_VERSION,
          hashValid: true,
        },
      );
      // A system notification was shown and clicking it focuses the window.
      const notification = electronMock.notificationInstances.at(-1)!;
      expect(notification.show).toHaveBeenCalled();
      const clickHandler = notification.on.mock.calls.find(
        (c) => c[0] === "click",
      )![1] as () => void;
      clickHandler();
      expect(win.show).toHaveBeenCalled();
      expect(win.focus).toHaveBeenCalled();
    });

    it("completes silently when the window is gone and notifications are unsupported", async () => {
      scriptSuccessfulFetches();
      const win = fakeWin(true); // destroyed
      electronMock.BrowserWindow.fromWebContents.mockReturnValue(win);

      const result = (await handlers[C.UPDATE.DOWNLOAD]!(
        fakeEvent(),
        updateInfo,
      )) as Record<string, unknown>;

      expect(result.success).toBe(true);
      expect(win.webContents.send).not.toHaveBeenCalled();
      expect(electronMock.notificationInstances).toHaveLength(0);
    });

    it("deletes the installer and reports an error on a checksum mismatch", async () => {
      scriptFetch({
        [CHECKSUMS_URL]: {
          ok: true,
          text: async () => `${"0".repeat(64)}  ${FILE_NAME}\n`,
        },
        [DOWNLOAD_URL]: {
          ok: true,
          headers: {
            get: (k: string) => (k === "content-length" ? "10" : null),
          },
          body: {
            getReader: () => {
              const reader = makeReader();
              reader.push(installerBytes());
              queueMicrotask(() => reader.finish());
              return reader;
            },
          },
        },
      });

      const result = (await handlers[C.UPDATE.DOWNLOAD]!(
        fakeEvent(),
        updateInfo,
      )) as Record<string, unknown>;

      expect(result.success).toBe(false);
      expect(result.error).toBe("SHA256 校验失败");
      // The default fromWebContents stub returns null → no window event;
      // the error broadcast itself is covered by the checksums-failure test.
      expect(fs.existsSync(path.join(tmpDir, FILE_NAME))).toBe(false);
    });

    it("names the installer with the .exe suffix on win32", async () => {
      const ORIG_PLATFORM_DESC = Object.getOwnPropertyDescriptor(
        process,
        "platform",
      );
      const defineWin32 = (): void => {
        Object.defineProperty(process, "platform", {
          value: "win32",
          configurable: true,
          writable: true,
        });
      };
      defineWin32();
      try {
        const bytes = installerBytes();
        const win32FileName = `Murmur-${LATEST_VERSION}.exe`;
        scriptFetch({
          [CHECKSUMS_URL]: {
            ok: true,
            text: async () => checksumsContentFor(bytes, win32FileName),
          },
          [DOWNLOAD_URL]: {
            ok: true,
            headers: {
              get: (k: string) =>
                k === "content-length" ? String(bytes.length) : null,
            },
            body: {
              getReader: () => {
                const reader = makeReader();
                reader.push(bytes);
                queueMicrotask(() => reader.finish());
                return reader;
              },
            },
          },
        });

        const result = (await handlers[C.UPDATE.DOWNLOAD]!(
          fakeEvent(),
          updateInfo,
        )) as Record<string, unknown>;

        expect(result.success).toBe(true);
        expect(result.filePath).toBe(path.join(tmpDir, win32FileName));
        expect(fs.existsSync(path.join(tmpDir, win32FileName))).toBe(true);
      } finally {
        if (ORIG_PLATFORM_DESC) {
          Object.defineProperty(process, "platform", ORIG_PLATFORM_DESC);
        }
      }
    });

    it("does not focus a destroyed window from the notification click", async () => {
      scriptSuccessfulFetches();
      const win = fakeWin(true); // destroyed
      electronMock.BrowserWindow.fromWebContents.mockReturnValue(win);
      electronMock.Notification.isSupported.mockReturnValue(true);

      const result = (await handlers[C.UPDATE.DOWNLOAD]!(
        fakeEvent(),
        updateInfo,
      )) as Record<string, unknown>;

      expect(result.success).toBe(true);
      // The notification itself is still shown; only its click handler
      // must skip the destroyed window.
      const notification = electronMock.notificationInstances.at(-1)!;
      expect(notification.show).toHaveBeenCalled();
      const clickHandler = notification.on.mock.calls.find(
        (c) => c[0] === "click",
      )![1] as () => void;
      clickHandler();
      expect(win.show).not.toHaveBeenCalled();
      expect(win.focus).not.toHaveBeenCalled();
    });

    it("downloads without content-length or a window (guard arms)", async () => {
      const bytes = installerBytes();
      scriptFetch({
        [CHECKSUMS_URL]: {
          ok: true,
          text: async () => checksumsContentFor(bytes, FILE_NAME),
        },
        [DOWNLOAD_URL]: {
          ok: true,
          headers: { get: () => null }, // no content-length
          body: {
            getReader: () => {
              const reader = makeReader();
              reader.push(bytes);
              queueMicrotask(() => reader.finish());
              return reader;
            },
          },
        },
      });
      // fromWebContents stays null (default).

      const result = (await handlers[C.UPDATE.DOWNLOAD]!(
        fakeEvent(),
        updateInfo,
      )) as Record<string, unknown>;

      expect(result.success).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, FILE_NAME))).toBe(true);
    });
  });

  describe("UPDATE.CANCEL", () => {
    it("reports failure when no download is running", () => {
      const result = handlers[C.UPDATE.CANCEL]!() as Record<string, unknown>;
      expect(result).toEqual({ success: false, error: "没有进行中的下载" });
    });
  });

  describe("UPDATE.INSTALL", () => {
    it("rejects empty and non-string paths", async () => {
      expect(await handlers[C.UPDATE.INSTALL]!(null, "")).toBe(false);
      expect(await handlers[C.UPDATE.INSTALL]!(null, 42)).toBe(false);
      expect(electronMock.shell.openPath).not.toHaveBeenCalled();
    });

    it("rejects paths outside the temp directory without opening anything", async () => {
      const result = await handlers[C.UPDATE.INSTALL]!(
        null,
        path.join(os.tmpdir(), "..", "etc", "passwd"),
      );
      expect(result).toBe(false);
      expect(logger.warn).toHaveBeenCalled();
      expect(electronMock.shell.openPath).not.toHaveBeenCalled();
      expect(electronMock.app.quit).not.toHaveBeenCalled();
    });

    it("opens an installer inside the temp directory and quits the app", async () => {
      const filePath = path.join(tmpDir, FILE_NAME);
      fs.writeFileSync(filePath, "x");

      const result = await handlers[C.UPDATE.INSTALL]!(null, filePath);

      expect(result).toBe(true);
      expect(electronMock.shell.openPath).toHaveBeenCalledWith(
        path.resolve(filePath),
      );
      expect(electronMock.app.quit).toHaveBeenCalled();
    });
  });
});
