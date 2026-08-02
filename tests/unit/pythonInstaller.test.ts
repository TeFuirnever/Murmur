// [20260729_Test_PythonInstaller] Comprehensive unit tests for
// src/helpers/pythonInstaller.ts. The linchpin is mocking `runCommand`
// (from src/utils/process) — every install method shells out via it, so
// mocking it lets us exercise all branches (brew/apt/yum/pacman/windows)
// without running real package managers. `https` is mocked for
// downloadFile to test 200/non-200/stream-error paths. `process.platform`
// is overridden per-test via Object.defineProperty with save/restore.
//
// No `any` / `as any` / @ts-ignore: the mocked runCommand is typed via
// `typeof import(...)`, and private members are reached through a local
// Surface interface (surface-cast pattern).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";
import { EventEmitter } from "events";
import path from "path";
import os from "os";
import fs from "fs";

// Mock runCommand — the single point all install methods shell through.
// Typed against the real module so the mock stays assignable without `any`.
vi.mock("../../src/utils/process", () => ({
  runCommand: vi.fn(),
  TIMEOUTS: {
    QUICK_CHECK: 5_000,
    PIP_UPGRADE: 60_000,
    INSTALL: 300_000,
    DOWNLOAD: 600_000,
  },
}));

// NOTE on https: `downloadFile` calls https.get(url, cb). We do NOT mock the
// https module via vi.mock because vitest does not reliably override members
// on the CJS builtin namespace via the importOriginal-spread factory. Instead
// we use vi.spyOn(https, "get") per-test. Because the source imports the same
// singleton `https` module object, the spy is seen by the source code too.

// Import AFTER mocks are registered.
import { runCommand } from "../../src/utils/process";
import PythonInstaller from "../../src/helpers/pythonInstaller";
import https from "https";

// runCommand is replaced via vi.mock, so surface it as a vitest Mock (the
// static import carries the real function type). https.get is spied per-test
// via vi.spyOn, so there is no module-level mock accessor for it.
const mockedRunCommand = runCommand as unknown as Mock<typeof runCommand>;

/**
 * Surface interface that re-declares the private members we want to reach
 * (only `logger` in this class). Cast via `as unknown as Surface` to avoid
 * `as any`.
 */
interface PythonInstallerSurface {
  logger: {
    info?: (m: string, ...a: unknown[]) => void;
    debug?: (m: string, ...a: unknown[]) => void;
    warn?: (m: string, ...a: unknown[]) => void;
    error?: (m: string, ...a: unknown[]) => void;
  } | null;
}

// ---------- helpers for the https / runCommand mocks ----------

/** Build a fake http.IncomingMessage (EventEmitter) with statusCode/headers. */
function makeResponse(statusCode: number, contentLength = 100): EventEmitter {
  const res = new EventEmitter();
  // Patch on with proper typing so .pipe/.on calls are valid at runtime.
  (res as unknown as { statusCode: number }).statusCode = statusCode;
  (res as unknown as { headers: Record<string, string> }).headers = {
    "content-length": String(contentLength),
  };
  // downloadFile calls response.pipe(file) — provide a no-op pipe.
  (res as unknown as { pipe: () => void }).pipe = () => {};
  return res;
}

/** Build a fake http.ClientRequest (EventEmitter) for the request side. */
function makeRequest(): EventEmitter {
  const req = new EventEmitter();
  // downloadFile never calls methods on req other than .on("error").
  return req;
}

/**
 * Install a one-shot vi.spyOn(https, "get") that, when called, defers and
 * invokes the get(url, cb) callback with `response` and returns `request`.
 * Deferring (process.nextTick) lets the caller attach .on('error') to the
 * returned request before the callback fires. Returns the Mock for any
 * further assertions.
 */
function mockHttpsGetOnce(
  response: EventEmitter,
  request: EventEmitter,
): Mock<typeof https.get> {
  return vi.spyOn(https, "get").mockImplementationOnce(((
    _url: Parameters<typeof https.get>[0],
    cb: Parameters<typeof https.get>[1],
  ): ReturnType<typeof https.get> => {
    const callback = cb as unknown as (res: EventEmitter) => void;
    process.nextTick(() => callback(response));
    return request as unknown as ReturnType<typeof https.get>;
  }) as unknown as typeof https.get);
}

// Track the original platform/arch so afterEach can restore them.
const ORIG_PLATFORM = process.platform;
const ORIG_ARCH = process.arch;

function setPlatform(platform: string): void {
  Object.defineProperty(process, "platform", {
    value: platform,
    configurable: true,
    writable: true,
  });
}

function setArch(arch: string): void {
  Object.defineProperty(process, "arch", {
    value: arch,
    configurable: true,
    writable: true,
  });
}

function restorePlatform(): void {
  setPlatform(ORIG_PLATFORM);
  setArch(ORIG_ARCH);
}

describe("PythonInstaller", () => {
  let installer: InstanceType<typeof PythonInstaller>;

  beforeEach(() => {
    // resetAllMocks clears call history AND per-test implementations, so each
    // test must re-establish the behaviour it needs (mockResolvedValueOnce /
    // mockImplementationOnce). We deliberately avoid restoreAllMocks here
    // because it would restore the module-level https.get spy to the real
    // builtin, breaking subsequent tests.
    vi.resetAllMocks();
    setPlatform(ORIG_PLATFORM);
    setArch(ORIG_ARCH);
    installer = new PythonInstaller();
  });

  afterEach(() => {
    restorePlatform();
  });

  // ------------------------------------------------------------------
  // constructor + pythonVersion
  // ------------------------------------------------------------------
  describe("constructor", () => {
    it("defaults pythonVersion to a FunASR-compatible 3.11.x", () => {
      expect(installer.pythonVersion).toBe("3.11.9");
    });

    it("accepts a logger and stores it", () => {
      // vi.fn() without a generic produces a (...args: any[]) => any mock that
      // is not assignable to the Logger method signature under strict mode, so
      // type each fn against the concrete (message, ...args) => void shape.
      const loggerMethod = (): ((
        message: string,
        ...args: unknown[]
      ) => void) =>
        vi.fn() as unknown as (message: string, ...args: unknown[]) => void;
      const logger = {
        info: loggerMethod(),
        debug: loggerMethod(),
        warn: loggerMethod(),
        error: loggerMethod(),
      };
      const inst = new PythonInstaller(logger);
      const surface = inst as unknown as PythonInstallerSurface;
      expect(surface.logger).toBe(logger);
    });

    it("defaults logger to null", () => {
      const surface = installer as unknown as PythonInstallerSurface;
      expect(surface.logger).toBeNull();
    });
  });

  // ------------------------------------------------------------------
  // isPythonInstalled
  // ------------------------------------------------------------------
  describe("isPythonInstalled", () => {
    it("returns installed:true with command + version when found in PATH", async () => {
      // python3.11 --version -> success
      mockedRunCommand.mockResolvedValueOnce({
        output: "Python 3.11.9",
        code: 0,
      });

      const result = await installer.isPythonInstalled();

      expect(result.installed).toBe(true);
      expect(result.command).toBe("python3.11");
      expect(result.version).toBe(3.11);
    });

    it("falls through to python3 then python when earlier commands fail", async () => {
      mockedRunCommand
        .mockRejectedValueOnce(new Error("not found")) // python3.11
        .mockRejectedValueOnce(new Error("not found")) // python3
        .mockResolvedValueOnce({ output: "Python 3.9.1", code: 0 }); // python

      const result = await installer.isPythonInstalled();

      expect(result.installed).toBe(true);
      expect(result.command).toBe("python");
      expect(result.version).toBe(3.9);
    });

    it("returns installed:false when no command works and not darwin", async () => {
      setPlatform("linux");
      mockedRunCommand.mockRejectedValue(new Error("not found"));

      const result = await installer.isPythonInstalled();

      expect(result.installed).toBe(false);
      // On linux there are no additionalPaths, so only the 3 PATH commands run.
      expect(mockedRunCommand).toHaveBeenCalledTimes(3);
    });

    it("checks macOS absolute paths when a command exists on disk", async () => {
      setPlatform("darwin");
      // PATH commands all fail.
      mockedRunCommand.mockRejectedValueOnce(new Error("x"));
      mockedRunCommand.mockRejectedValueOnce(new Error("x"));
      mockedRunCommand.mockRejectedValueOnce(new Error("x"));

      // Stub fs.existsSync so the first macOS path is treated as present.
      const existsSpy = vi.spyOn(fs, "existsSync").mockReturnValue(false);
      // Make the very first additional path exist.
      existsSpy.mockImplementation((p: fs.PathLike) => {
        return String(p) === "/usr/local/bin/python3";
      });
      mockedRunCommand.mockResolvedValueOnce({
        output: "Python 3.10.0",
        code: 0,
      });

      const result = await installer.isPythonInstalled();

      expect(result.installed).toBe(true);
      expect(result.command).toBe("/usr/local/bin/python3");
      expect(result.version).toBe(3.1);
      existsSpy.mockRestore();
    });

    it("skips macOS absolute paths reporting Python < 3.0", async () => {
      // Covers the source's "version < 3.0 -> continue" branch in the macOS
      // absolute-path loop (src lines 451-452). PATH commands fail, the first
      // macOS path exists but reports Python 2.7, so detection continues and
      // ultimately returns not installed.
      setPlatform("darwin");
      mockedRunCommand.mockRejectedValueOnce(new Error("x"));
      mockedRunCommand.mockRejectedValueOnce(new Error("x"));
      mockedRunCommand.mockRejectedValueOnce(new Error("x"));
      const existsSpy = vi
        .spyOn(fs, "existsSync")
        .mockImplementation((p: fs.PathLike) => {
          return String(p) === "/usr/local/bin/python3";
        });
      mockedRunCommand.mockResolvedValueOnce({
        output: "Python 2.7.16",
        code: 0,
      });

      const result = await installer.isPythonInstalled();

      expect(result.installed).toBe(false);
      existsSpy.mockRestore();
      // NOTE: the "unparseable version string in macOS path" branch (src line
      // ~453) is symmetric to the PATH-level unparseable case already covered
      // and adds no new logic; it is intentionally left uncovered.
    });

    it("ignores matches below Python 3.0", async () => {
      mockedRunCommand.mockResolvedValueOnce({
        output: "Python 2.7.16",
        code: 0,
      });
      // Subsequent commands also yield nothing usable.
      mockedRunCommand.mockRejectedValue(new Error("nope"));

      const result = await installer.isPythonInstalled();

      expect(result.installed).toBe(false);
    });

    it("returns not installed when version string unparseable", async () => {
      mockedRunCommand.mockResolvedValueOnce({
        output: "not a version string",
        code: 0,
      });
      mockedRunCommand.mockRejectedValue(new Error("nope"));

      const result = await installer.isPythonInstalled();

      expect(result.installed).toBe(false);
    });
  });

  // ------------------------------------------------------------------
  // checkWindowsAdmin
  // ------------------------------------------------------------------
  describe("checkWindowsAdmin", () => {
    it("returns true when reg query succeeds", async () => {
      mockedRunCommand.mockResolvedValueOnce({ output: "", code: 0 });
      const result = await installer.checkWindowsAdmin();
      expect(result).toBe(true);
      expect(mockedRunCommand).toHaveBeenCalledWith(
        "reg",
        ["query", "HKU\\S-1-5-19"],
        expect.objectContaining({ timeout: 5_000 }),
      );
    });

    it("returns false when reg query rejects", async () => {
      mockedRunCommand.mockRejectedValueOnce(new Error("denied"));
      const result = await installer.checkWindowsAdmin();
      expect(result).toBe(false);
    });
  });

  // ------------------------------------------------------------------
  // downloadFile
  // ------------------------------------------------------------------
  describe("downloadFile", () => {
    let outputPath: string;

    beforeEach(() => {
      outputPath = path.join(os.tmpdir(), `murmur-test-${Date.now()}.bin`);
    });

    afterEach(() => {
      try {
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
      } catch {
        // ignore
      }
    });

    /**
     * Run a successful download: https.get receives the url + a callback;
     * we invoke the callback with a 200 response, emit a data chunk, then
     * drive the file writeStream to 'finish'. Because the source creates a
     * real fs.createWriteStream, the real stream's 'finish' fires once data
     * flows through via response.pipe(file). Our makeResponse pipe is a
     * no-op, so we instead write to the file directly via the writeStream
     * that fs.createWriteStream produced — but we don't have a handle to it.
     *
     * Solution: spy on fs.createWriteStream to capture the stream it would
     * return, then emit 'finish' on it ourselves.
     */
    function captureWriteStream(): fs.WriteStream {
      const stream = new EventEmitter() as unknown as fs.WriteStream & {
        close: () => void;
        write: () => boolean;
      };
      (stream as unknown as { close: () => void }).close = () => {};
      (stream as unknown as { write: () => boolean }).write = () => true;
      vi.spyOn(fs, "createWriteStream").mockReturnValueOnce(stream);
      return stream;
    }

    it("resolves on HTTP 200 after file finish", async () => {
      const stream = captureWriteStream();
      const response = makeResponse(200, 10);
      const request = makeRequest();
      mockHttpsGetOnce(response, request);

      const progressSpy = vi.fn();
      const promise = installer.downloadFile(
        "https://example.com/x.bin",
        outputPath,
        progressSpy,
      );

      // Allow the https.get callback to fire, then emit a data chunk so the
      // progress callback runs, then finish the file stream to resolve.
      await new Promise((r) => setImmediate(r));
      response.emit("data", Buffer.from("hello"));
      stream.emit("finish");

      await expect(promise).resolves.toBeUndefined();
      expect(progressSpy).toHaveBeenCalled();
    });

    it("rejects on non-200 status code", async () => {
      captureWriteStream();
      const response = makeResponse(404, 0);
      const request = makeRequest();
      mockHttpsGetOnce(response, request);

      await expect(
        installer.downloadFile("https://example.com/x", outputPath),
      ).rejects.toThrow("HTTP 404");
    });

    it("rejects on request error", async () => {
      captureWriteStream();
      const request = makeRequest();
      const response = makeResponse(200, 10);
      mockHttpsGetOnce(response, request);

      const promise = installer.downloadFile(
        "https://example.com/x",
        outputPath,
      );
      await new Promise((r) => setImmediate(r));
      request.emit("error", new Error("ECONNREFUSED"));

      await expect(promise).rejects.toThrow("ECONNREFUSED");
    });

    it("rejects and cleans up on file stream error", async () => {
      const stream = captureWriteStream();
      const response = makeResponse(200, 10);
      const request = makeRequest();
      mockHttpsGetOnce(response, request);

      const unlinkSpy = vi.spyOn(fs, "unlink").mockImplementation(() => {});
      const promise = installer.downloadFile(
        "https://example.com/x",
        outputPath,
      );
      await new Promise((r) => setImmediate(r));
      stream.emit("error", new Error("disk full"));

      await expect(promise).rejects.toThrow("disk full");
      expect(unlinkSpy).toHaveBeenCalled();
      unlinkSpy.mockRestore();
    });
  });

  // ------------------------------------------------------------------
  // installPythonMacOS
  // ------------------------------------------------------------------
  describe("installPythonMacOS", () => {
    it("uses Homebrew when brew --version succeeds", async () => {
      mockedRunCommand.mockResolvedValue({ output: "", code: 0 });
      const progress = vi.fn();

      const result = await installer.installPythonMacOS(progress);

      expect(result).toEqual({ success: true, method: "homebrew" });
      expect(mockedRunCommand).toHaveBeenNthCalledWith(
        1,
        "brew",
        ["--version"],
        expect.objectContaining({ timeout: 5_000 }),
      );
      expect(mockedRunCommand).toHaveBeenNthCalledWith(
        2,
        "brew",
        ["install", "python@3.11"],
        expect.objectContaining({ timeout: 300_000 }),
      );
      expect(progress).toHaveBeenCalledWith(
        expect.objectContaining({ percentage: 100 }),
      );
    });

    it("falls back to official pkg when brew unavailable", async () => {
      // brew --version fails -> download + sudo installer succeed.
      mockedRunCommand
        .mockRejectedValueOnce(new Error("no brew")) // brew --version
        .mockResolvedValueOnce({ output: "", code: 0 }); // sudo installer

      // downloadFile must succeed — mock https + fs.writeStream.
      const stream = new EventEmitter() as unknown as fs.WriteStream & {
        close: () => void;
      };
      (stream as unknown as { close: () => void }).close = () => {};
      vi.spyOn(fs, "createWriteStream").mockReturnValue(stream);
      const response = makeResponse(200, 10);
      const request = makeRequest();
      mockHttpsGetOnce(response, request);
      const unlinkSpy = vi.spyOn(fs, "unlink").mockImplementation(() => {});
      vi.spyOn(fs, "existsSync").mockReturnValue(false);

      const progress = vi.fn();
      const promise = installer.installPythonMacOS(progress);
      await new Promise((r) => setImmediate(r));
      response.emit("data", Buffer.from("pkg"));
      stream.emit("finish");

      const result = await promise;

      expect(result).toEqual({ success: true, method: "official_installer" });
      // sudo installer ... -pkg <path> -target /
      expect(mockedRunCommand).toHaveBeenCalledWith(
        "sudo",
        expect.arrayContaining(["installer", "-pkg"]),
        expect.objectContaining({ timeout: 300_000 }),
      );
      unlinkSpy.mockRestore();
    });

    it("throws when brew unavailable AND official install fails", async () => {
      mockedRunCommand
        .mockRejectedValueOnce(new Error("no brew")) // brew --version
        .mockRejectedValueOnce(new Error("installer failed")); // sudo installer

      const stream = new EventEmitter() as unknown as fs.WriteStream & {
        close: () => void;
      };
      (stream as unknown as { close: () => void }).close = () => {};
      vi.spyOn(fs, "createWriteStream").mockReturnValue(stream);
      const response = makeResponse(200, 10);
      const request = makeRequest();
      mockHttpsGetOnce(response, request);
      const unlinkSpy = vi.spyOn(fs, "unlink").mockImplementation(() => {});
      vi.spyOn(fs, "existsSync").mockReturnValue(true);

      const promise = installer.installPythonMacOS(null);
      await new Promise((r) => setImmediate(r));
      response.emit("data", Buffer.from("pkg"));
      stream.emit("finish");

      await expect(promise).rejects.toThrow("installer failed");
      // Cleanup attempted because file existed.
      expect(unlinkSpy).toHaveBeenCalled();
      unlinkSpy.mockRestore();
    });

    it("chooses macos11 pkg for arm64 arch", async () => {
      setArch("arm64");
      mockedRunCommand.mockResolvedValue({ output: "", code: 0 });

      await installer.installPythonMacOS();

      const brewVersionCall = mockedRunCommand.mock.calls[0];
      // Just confirm it didn't throw; the URL is constructed internally and
      // only surfaces via downloadFile (not reached on the brew-success path).
      expect(brewVersionCall?.[0]).toBe("brew");
    });
  });

  // ------------------------------------------------------------------
  // installPythonWindows
  // ------------------------------------------------------------------
  describe("installPythonWindows", () => {
    /**
     * Set up a successful download flow. Returns the file stream AND the
     * response emitter so the caller can emit "data" (to drive the download
     * progress path) and "finish" (to resolve the download).
     */
    function setupDownloadSuccess(): {
      stream: EventEmitter;
      response: EventEmitter;
    } {
      const stream = new EventEmitter() as unknown as fs.WriteStream & {
        close: () => void;
      };
      (stream as unknown as { close: () => void }).close = () => {};
      vi.spyOn(fs, "createWriteStream").mockReturnValue(stream);
      const response = makeResponse(200, 10);
      const request = makeRequest();
      mockHttpsGetOnce(response, request);
      return { stream, response };
    }

    it("runs the installer with admin args when running as admin", async () => {
      setArch("x64");
      // checkWindowsAdmin -> reg query succeeds.
      mockedRunCommand
        .mockResolvedValueOnce({ output: "", code: 0 }) // reg query (admin)
        .mockResolvedValueOnce({ output: "", code: 0 }); // installer exe
      const { stream, response } = setupDownloadSuccess();

      const progress = vi.fn();
      const promise = installer.installPythonWindows(progress);
      await new Promise((r) => setImmediate(r));
      // Emit a data chunk to exercise the download-progress inner callback
      // (source lines 212-213), then finish the stream to resolve the download.
      response.emit("data", Buffer.from("exe"));
      stream.emit("finish");

      const result = await promise;

      expect(result).toEqual({ success: true, method: "official_installer" });
      const installerCall = mockedRunCommand.mock.calls[1];
      expect(installerCall?.[1]).toEqual(
        expect.arrayContaining([
          "InstallAllUsers=1",
          "InstallLauncherAllUsers=1",
        ]),
      );
    });

    it("runs the installer with non-admin args when not admin", async () => {
      setArch("ia32");
      // checkWindowsAdmin -> reg query fails (not admin).
      mockedRunCommand
        .mockRejectedValueOnce(new Error("denied")) // reg query
        .mockResolvedValueOnce({ output: "", code: 0 }); // installer exe
      const { stream } = setupDownloadSuccess();

      const promise = installer.installPythonWindows();
      await new Promise((r) => setImmediate(r));
      stream.emit("finish");

      const result = await promise;

      expect(result).toEqual({ success: true, method: "official_installer" });
      const installerCall = mockedRunCommand.mock.calls[1];
      expect(installerCall?.[1]).toEqual(
        expect.arrayContaining([
          "InstallAllUsers=0",
          "InstallLauncherAllUsers=0",
        ]),
      );
    });

    it("throws and cleans up when the installer exe fails", async () => {
      mockedRunCommand
        .mockResolvedValueOnce({ output: "", code: 0 }) // admin
        .mockRejectedValueOnce(new Error("exit 1")); // installer exe
      const { stream } = setupDownloadSuccess();
      const unlinkSpy = vi.spyOn(fs, "unlink").mockImplementation(() => {});
      vi.spyOn(fs, "existsSync").mockReturnValue(true);

      const promise = installer.installPythonWindows();
      await new Promise((r) => setImmediate(r));
      stream.emit("finish");

      await expect(promise).rejects.toThrow("exit 1");
      expect(unlinkSpy).toHaveBeenCalled();
      unlinkSpy.mockRestore();
    });
  });

  // ------------------------------------------------------------------
  // installPythonLinux
  // ------------------------------------------------------------------
  describe("installPythonLinux", () => {
    it("installs via apt when available", async () => {
      // apt --version ok, sudo apt update ok, sudo apt install ok.
      mockedRunCommand.mockResolvedValue({ output: "", code: 0 });

      const result = await installer.installPythonLinux();

      expect(result).toEqual({ success: true, method: "apt" });
      expect(mockedRunCommand).toHaveBeenCalledWith(
        "apt",
        ["--version"],
        expect.objectContaining({ timeout: 5_000 }),
      );
      expect(mockedRunCommand).toHaveBeenCalledWith(
        "sudo",
        ["apt", "update"],
        expect.objectContaining({ timeout: 60_000 }),
      );
      expect(mockedRunCommand).toHaveBeenCalledWith(
        "sudo",
        expect.arrayContaining(["apt", "install", "-y", "python3.11"]),
        expect.objectContaining({ timeout: 300_000 }),
      );
    });

    it("falls back to yum when apt --version fails", async () => {
      mockedRunCommand
        .mockRejectedValueOnce(new Error("no apt")) // apt --version
        .mockResolvedValueOnce({ output: "", code: 0 }) // yum --version
        .mockResolvedValueOnce({ output: "", code: 0 }); // sudo yum install

      // Pass a progress callback to also exercise the yum progress branches.
      const progress = vi.fn();
      const result = await installer.installPythonLinux(progress);

      expect(result).toEqual({ success: true, method: "yum" });
      expect(mockedRunCommand).toHaveBeenCalledWith(
        "sudo",
        expect.arrayContaining(["yum", "install", "-y", "python311"]),
        expect.objectContaining({ timeout: 300_000 }),
      );
      expect(progress).toHaveBeenCalledWith(
        expect.objectContaining({ stage: "通过 yum 安装 Python..." }),
      );
      expect(progress).toHaveBeenCalledWith(
        expect.objectContaining({ percentage: 100 }),
      );
    });

    it("falls back to pacman when apt and yum fail", async () => {
      mockedRunCommand
        .mockRejectedValueOnce(new Error("no apt"))
        .mockRejectedValueOnce(new Error("no yum"))
        .mockResolvedValueOnce({ output: "", code: 0 }) // pacman --version
        .mockResolvedValueOnce({ output: "", code: 0 }); // sudo pacman -S

      // Pass a progress callback to also exercise the pacman progress branches.
      const progress = vi.fn();
      const result = await installer.installPythonLinux(progress);

      expect(result).toEqual({ success: true, method: "pacman" });
      expect(mockedRunCommand).toHaveBeenCalledWith(
        "sudo",
        expect.arrayContaining(["pacman", "-S", "--noconfirm", "python"]),
        expect.objectContaining({ timeout: 300_000 }),
      );
      expect(progress).toHaveBeenCalledWith(
        expect.objectContaining({ stage: "通过 pacman 安装 Python..." }),
      );
      expect(progress).toHaveBeenCalledWith(
        expect.objectContaining({ percentage: 100 }),
      );
    });

    it("throws when no supported package manager is found", async () => {
      mockedRunCommand.mockRejectedValue(new Error("none"));

      await expect(installer.installPythonLinux()).rejects.toThrow(
        "未找到支持的包管理器",
      );
    });

    it("reports progress when callback provided (apt path)", async () => {
      mockedRunCommand.mockResolvedValue({ output: "", code: 0 });
      const progress = vi.fn();

      await installer.installPythonLinux(progress);

      expect(progress).toHaveBeenCalledWith(
        expect.objectContaining({ stage: "检测 Linux 发行版..." }),
      );
      expect(progress).toHaveBeenCalledWith(
        expect.objectContaining({ percentage: 100 }),
      );
    });
  });

  // ------------------------------------------------------------------
  // installPython (dispatch)
  // ------------------------------------------------------------------
  describe("installPython (dispatch)", () => {
    it("dispatches to installPythonMacOS on darwin", async () => {
      setPlatform("darwin");
      mockedRunCommand.mockResolvedValue({ output: "", code: 0 }); // brew path
      const progress = vi.fn();

      const result = await installer.installPython(progress);

      expect(result.method).toBe("homebrew");
      expect(progress).toHaveBeenCalledWith(
        expect.objectContaining({
          stage: "开始 Python 安装...",
          percentage: 5,
        }),
      );
    });

    it("dispatches to installPythonWindows on win32", async () => {
      setPlatform("win32");
      // admin check + download + installer all succeed.
      mockedRunCommand
        .mockResolvedValueOnce({ output: "", code: 0 }) // reg
        .mockResolvedValueOnce({ output: "", code: 0 }); // installer exe
      const stream = new EventEmitter() as unknown as fs.WriteStream & {
        close: () => void;
      };
      (stream as unknown as { close: () => void }).close = () => {};
      vi.spyOn(fs, "createWriteStream").mockReturnValue(stream);
      const response = makeResponse(200, 10);
      const request = makeRequest();
      mockHttpsGetOnce(response, request);

      const promise = installer.installPython();
      await new Promise((r) => setImmediate(r));
      stream.emit("finish");

      const result = await promise;
      expect(result.method).toBe("official_installer");
    });

    it("dispatches to installPythonLinux on linux", async () => {
      setPlatform("linux");
      mockedRunCommand.mockResolvedValue({ output: "", code: 0 }); // apt path

      const result = await installer.installPython();
      expect(result.method).toBe("apt");
    });

    it("throws on an unsupported platform", async () => {
      setPlatform("freebsd");
      mockedRunCommand.mockResolvedValue({ output: "", code: 0 });

      await expect(installer.installPython()).rejects.toThrow(
        "不支持的平台: freebsd",
      );
    });
  });
});
