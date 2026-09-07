// [20260817_T1_EmbeddedLayout] Ticket #178 (spec #177 T1): the runtime's
// embedded-Python resolution only ever looked at the macOS layout
// (python/bin/python3.11 + lib/python3.11), while the Windows packaging
// step produces python/python.exe + Lib/site-packages — so a packaged
// Windows app could not find its own interpreter. RED first: these fail
// until resolution becomes platform-aware.
//
// Testing strategy: the platform logic lives in the pure exported
// embeddedPythonLayout(root); the production branch of path resolution is
// driven via a process.resourcesPath stub (no electron needed). The dev
// branch is the same layout join behind a lazy electron require and is
// covered by the pure-function tests.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";
import fs from "fs";
import os from "os";
import path from "path";

import PythonEnvironment, {
  embeddedPythonLayout,
} from "../../src/helpers/pythonEnvironment";
import { TIMEOUTS } from "../../src/utils/process";

// [20260906_Spec259_T2] Module-boundary mocks for the branch close-out
// describes below. The existing suites in this file never spawn processes or
// run pip commands, so these mocks do not alter their behavior; they only
// make findPythonExecutable / installFunASR / installPython drivable.
const spawnMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: spawnMock };
});

const runCommandMock = vi.hoisted(() => vi.fn());
vi.mock("../../src/utils/process", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/utils/process")>();
  return { ...actual, runCommand: runCommandMock };
});

const installerMock = vi.hoisted(() => ({
  installPython: vi.fn(),
  isPythonInstalled: vi.fn(),
}));
vi.mock("../../src/helpers/pythonInstaller", () => ({
  default: class {
    installPython = installerMock.installPython;
    isPythonInstalled = installerMock.isPythonInstalled;
  },
}));

const ORIG_PLATFORM = process.platform;
const ORIG_NODE_ENV = process.env.NODE_ENV;
const ORIG_RESOURCES_PATH = process.resourcesPath;

function setPlatform(platform: string): void {
  Object.defineProperty(process, "platform", {
    value: platform,
    configurable: true,
    writable: true,
  });
}

function setResourcesPath(value: string): void {
  Object.defineProperty(process, "resourcesPath", {
    value,
    configurable: true,
    writable: true,
  });
}

interface PythonEnvironmentSurface {
  _lastEmbeddedCheck: boolean | null;
}

function srv(
  instance: InstanceType<typeof PythonEnvironment>,
): PythonEnvironmentSurface {
  return instance as unknown as PythonEnvironmentSurface;
}

describe("[20260817_T1_EmbeddedLayout] embeddedPythonLayout pure helper", () => {
  afterEach(() => setPlatform(ORIG_PLATFORM));

  it("win32: packaging layout (python.exe, Lib, PATH-prepend python dir)", () => {
    setPlatform("win32");
    const layout = embeddedPythonLayout("/test-root");
    expect(layout.pythonBin).toBe(
      path.join("/test-root", "python", "python.exe"),
    );
    expect(layout.pythonDir).toBe(path.join("/test-root", "python"));
    expect(layout.libDir).toBe(path.join("/test-root", "python", "Lib"));
    expect(layout.sitePackagesDir).toBe(
      path.join("/test-root", "python", "Lib", "site-packages"),
    );
    expect(layout.binDir).toBe(path.join("/test-root", "python"));
    expect(layout.pathSep).toBe(";");
  });

  it("darwin: posix layout (bin/python3.11, lib/python3.11)", () => {
    setPlatform("darwin");
    const layout = embeddedPythonLayout("/test-root");
    expect(layout.pythonBin).toBe(
      path.join("/test-root", "python", "bin", "python3.11"),
    );
    expect(layout.libDir).toBe(
      path.join("/test-root", "python", "lib", "python3.11"),
    );
    expect(layout.sitePackagesDir).toBe(
      path.join("/test-root", "python", "lib", "python3.11", "site-packages"),
    );
    expect(layout.binDir).toBe(path.join("/test-root", "python", "bin"));
    expect(layout.pathSep).toBe(":");
  });
});

describe("[20260817_T1_EmbeddedLayout] interpreter path (production branch)", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "production";
    setResourcesPath("/test-res");
  });

  afterEach(() => {
    setPlatform(ORIG_PLATFORM);
    process.env.NODE_ENV = ORIG_NODE_ENV;
    setResourcesPath(ORIG_RESOURCES_PATH as string);
  });

  it("win32: resolves python/python.exe under app.asar.unpacked", () => {
    setPlatform("win32");
    const env = new PythonEnvironment(null);
    expect(env.getEmbeddedPythonPath()).toBe(
      path.join("/test-res", "app.asar.unpacked", "python", "python.exe"),
    );
  });

  it("darwin: keeps python/bin/python3.11", () => {
    setPlatform("darwin");
    const env = new PythonEnvironment(null);
    expect(env.getEmbeddedPythonPath()).toBe(
      path.join(
        "/test-res",
        "app.asar.unpacked",
        "python",
        "bin",
        "python3.11",
      ),
    );
  });
});

describe("[20260817_T1_EmbeddedLayout] env construction per platform", () => {
  let tmpRes: string;
  let unpackedRoot: string;

  beforeEach(() => {
    process.env.NODE_ENV = "production";
    tmpRes = fs.mkdtempSync(path.join(os.tmpdir(), "pyenv-layout-"));
    unpackedRoot = path.join(tmpRes, "app.asar.unpacked");
    setResourcesPath(tmpRes);
  });

  afterEach(() => {
    setPlatform(ORIG_PLATFORM);
    process.env.NODE_ENV = ORIG_NODE_ENV;
    setResourcesPath(ORIG_RESOURCES_PATH as string);
    delete process.env.PYTHONHOME;
    delete process.env.PYTHONPATH;
    fs.rmSync(tmpRes, { recursive: true, force: true });
  });

  function writeEmbeddedInterpreter(platform: string): void {
    if (platform === "win32") {
      fs.mkdirSync(path.join(unpackedRoot, "python"), { recursive: true });
      fs.writeFileSync(path.join(unpackedRoot, "python", "python.exe"), "");
    } else {
      fs.mkdirSync(path.join(unpackedRoot, "python", "bin"), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(unpackedRoot, "python", "bin", "python3.11"),
        "",
      );
    }
  }

  it("win32 with embedded env: Lib/site-packages PYTHONPATH, ';' separator, PATH prepends python dir", () => {
    setPlatform("win32");
    writeEmbeddedInterpreter("win32");

    const env = new PythonEnvironment(null).buildPythonEnvironment();

    expect(env.PYTHONUTF8).toBe("1");
    expect(env.PYTHONHOME).toBe(path.join(unpackedRoot, "python"));
    expect(env.PYTHONPATH).toBe(
      [
        path.join(unpackedRoot, "python", "Lib"),
        path.join(unpackedRoot, "python", "Lib", "site-packages"),
      ].join(";"),
    );
    expect(env.PATH?.startsWith(path.join(unpackedRoot, "python") + ";")).toBe(
      true,
    );
  });

  it("darwin with embedded env: lib/python3.11 PYTHONPATH, ':' separator, PATH prepends bin", () => {
    setPlatform("darwin");
    writeEmbeddedInterpreter("darwin");

    const env = new PythonEnvironment(null).buildPythonEnvironment();

    expect(env.PYTHONHOME).toBe(path.join(unpackedRoot, "python"));
    expect(env.PYTHONPATH).toBe(
      [
        path.join(unpackedRoot, "python", "lib", "python3.11"),
        path.join(unpackedRoot, "python", "lib", "python3.11", "site-packages"),
      ].join(":"),
    );
    expect(
      env.PATH?.startsWith(path.join(unpackedRoot, "python", "bin") + ":"),
    ).toBe(true);
  });

  it("without embedded env: no PYTHONHOME/PYTHONPATH leak into the child env", () => {
    setPlatform("win32");
    // No interpreter file written → embedded env considered absent.

    const env = new PythonEnvironment(null).buildPythonEnvironment();

    expect("PYTHONHOME" in env).toBe(false);
    expect("PYTHONPATH" in env).toBe(false);
  });

  it("setupIsolatedEnvironment mirrors the platform layout into process.env", () => {
    setPlatform("win32");
    writeEmbeddedInterpreter("win32");

    const usingEmbedded = new PythonEnvironment(
      null,
    ).setupIsolatedEnvironment();

    expect(usingEmbedded).toBe(true);
    expect(process.env.PYTHONHOME).toBe(path.join(unpackedRoot, "python"));
    expect(process.env.PYTHONPATH).toBe(
      [
        path.join(unpackedRoot, "python", "Lib"),
        path.join(unpackedRoot, "python", "Lib", "site-packages"),
      ].join(";"),
    );
  });

  it("cached env is invalidated when the embedded interpreter appears later", () => {
    setPlatform("darwin");

    const instance = new PythonEnvironment(null);
    const surface = srv(instance);
    const absentEnv = instance.buildPythonEnvironment();
    expect(surface._lastEmbeddedCheck).toBe(false);
    expect("PYTHONHOME" in absentEnv).toBe(false);

    writeEmbeddedInterpreter("darwin");
    const presentEnv = instance.buildPythonEnvironment();
    expect(surface._lastEmbeddedCheck).toBe(true);
    expect(presentEnv.PYTHONHOME).toBe(path.join(unpackedRoot, "python"));
  });
});

// [20260906_Spec259_T2] Branch close-out for the instrumented helpers
// (Spec #259 T2, ticket #274): drive findPythonExecutable and its fallback
// chain, getPythonVersion, the FunASR check cache, and the installFunASR /
// installPython / upgradePip orchestration through the mocked module
// boundaries above. External behavior only: spawned commands, runCommand
// arguments, logged output via the injected logger, and returned values.
describe("[20260906_Spec259_T2] pythonEnvironment branch close-out", () => {
  const ORIG_NODE_ENV = process.env.NODE_ENV;
  const ORIG_RESOURCES_PATH = process.resourcesPath;

  let tmpRes: string;
  let unpackedRoot: string;

  function setResourcesPath(value: string): void {
    Object.defineProperty(process, "resourcesPath", {
      value,
      configurable: true,
      writable: true,
    });
  }

  interface FakeProc extends EventEmitter {
    stdout: EventEmitter;
    stderr: EventEmitter;
  }

  // Fake child process whose events fire on a microtask, after the source
  // has registered its listeners (spawn() returns before handlers attach).
  function spawnEmitting(
    output: string,
    code: number | null,
    error?: Error,
  ): void {
    spawnDispatching(() => ({ output, code, error }));
  }

  interface SpawnSpec {
    output: string;
    stderr?: string;
    code: number | null;
    error?: Error;
  }

  // Dispatching fake: the payload depends on the argument vector, so the
  // interpreter probe (--version) and the FunASR import probe (-c) can each
  // get their own scripted result.
  function spawnDispatching(byArgs: (args: string[]) => SpawnSpec): void {
    spawnMock.mockImplementation((_cmd: string, args: string[]) => {
      const spec = byArgs(args);
      const proc = new EventEmitter() as FakeProc;
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      queueMicrotask(() => {
        if (spec.error) {
          proc.emit("error", spec.error);
        } else {
          if (spec.output) {
            proc.stdout.emit("data", Buffer.from(spec.output, "utf8"));
          }
          if (spec.stderr) {
            proc.stderr.emit("data", Buffer.from(spec.stderr, "utf8"));
          }
          proc.emit("close", spec.code);
        }
      });
      return proc;
    });
  }

  function spawnEnvOf(callIndex = 0): NodeJS.ProcessEnv {
    const options = spawnMock.mock.calls[callIndex]![2] as {
      env: NodeJS.ProcessEnv;
    };
    return options.env;
  }

  interface MockLogger {
    info: (message: string, ...args: unknown[]) => void;
    debug: (message: string, ...args: unknown[]) => void;
    warn: (message: string, ...args: unknown[]) => void;
    error: (message: string, ...args: unknown[]) => void;
  }

  function makeLogger(): MockLogger {
    return {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
  }

  function writeEmbeddedInterpreter(): void {
    fs.mkdirSync(path.join(unpackedRoot, "python", "bin"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(unpackedRoot, "python", "bin", "python3.11"),
      "",
    );
  }

  beforeEach(() => {
    process.env.NODE_ENV = "production";
    tmpRes = fs.mkdtempSync(path.join(os.tmpdir(), "pyenv-branch-"));
    unpackedRoot = path.join(tmpRes, "app.asar.unpacked");
    setResourcesPath(tmpRes);
  });

  afterEach(() => {
    process.env.NODE_ENV = ORIG_NODE_ENV;
    setResourcesPath(ORIG_RESOURCES_PATH as string);
    delete process.env.PYTHONHOME;
    delete process.env.PYTHONPATH;
    spawnMock.mockReset();
    runCommandMock.mockReset();
    installerMock.installPython.mockReset();
    installerMock.isPythonInstalled.mockReset();
    fs.rmSync(tmpRes, { recursive: true, force: true });
  });

  describe("dev-branch error paths (electron unavailable in test env)", () => {
    it("getFunASRServerPath throws when the dev branch cannot resolve electron", () => {
      process.env.NODE_ENV = "development";
      const env = new PythonEnvironment(null);
      expect(() => env.getFunASRServerPath()).toThrow();
    });

    it("environment builders throw in dev when electron is unavailable", () => {
      process.env.NODE_ENV = "development";
      const env = new PythonEnvironment(null);
      expect(() => env.setupIsolatedEnvironment()).toThrow();
      expect(() => env.buildPythonEnvironment()).toThrow();
    });
  });

  describe("setupIsolatedEnvironment / buildPythonEnvironment arms", () => {
    it("reports false and clears embedded env vars without an embedded interpreter", () => {
      process.env.PYTHONHOME = "/stale/python";
      process.env.PYTHONPATH = "/stale/lib";

      const usingEmbedded = new PythonEnvironment(
        null,
      ).setupIsolatedEnvironment();

      expect(usingEmbedded).toBe(false);
      expect("PYTHONHOME" in process.env).toBe(false);
      expect("PYTHONPATH" in process.env).toBe(false);
    });

    it("returns the cached env object when the embedded state is unchanged", () => {
      const env = new PythonEnvironment(null);
      const first = env.buildPythonEnvironment();
      const second = env.buildPythonEnvironment();
      expect(second).toBe(first);
    });

    it("falls back to an empty PATH entry when process.env.PATH is unset", () => {
      writeEmbeddedInterpreter();
      const origPath = process.env.PATH;
      delete process.env.PATH;
      try {
        const env = new PythonEnvironment(null).buildPythonEnvironment();
        expect(env.PATH).toBe(path.join(unpackedRoot, "python", "bin") + ":");
      } finally {
        process.env.PATH = origPath;
      }
    });
  });

  describe("findPythonExecutable resolution chain", () => {
    it("returns the memoized interpreter without spawning when pythonCmd is set", async () => {
      const env = new PythonEnvironment(null);
      env.pythonCmd = "/already/chosen/python";

      await expect(env.findPythonExecutable()).resolves.toBe(
        "/already/chosen/python",
      );
      expect(spawnMock).not.toHaveBeenCalled();
    });

    it("adopts a working embedded interpreter and isolates its environment", async () => {
      writeEmbeddedInterpreter();
      spawnEmitting("Python 3.11.9", 0);

      const env = new PythonEnvironment(makeLogger());
      const resolved = await env.findPythonExecutable();

      expect(resolved).toBe(env.getEmbeddedPythonPath());
      expect(process.env.PYTHONHOME).toBe(path.join(unpackedRoot, "python"));
      // The embedded probe must run inside the isolated env (PYTHONUTF8).
      const spawnEnv = spawnEnvOf();
      expect(spawnEnv.PYTHONUTF8).toBe("1");
      expect(spawnEnv.PYTHONHOME).toBe(path.join(unpackedRoot, "python"));
    });

    it("falls through to the production error when the embedded version is unsupported", async () => {
      writeEmbeddedInterpreter();
      spawnEmitting("Python 2.7.18", 0);

      const env = new PythonEnvironment(makeLogger());
      await expect(env.findPythonExecutable()).rejects.toThrow(
        /嵌入式Python环境不可用/,
      );
    });

    it("falls through when the embedded interpreter probe exits non-zero", async () => {
      writeEmbeddedInterpreter();
      spawnEmitting("", 1);

      const env = new PythonEnvironment(makeLogger());
      await expect(env.findPythonExecutable()).rejects.toThrow(
        /嵌入式Python环境不可用/,
      );
    });

    it("throws the install hint when no embedded interpreter exists in production", async () => {
      // No interpreter written.
      const env = new PythonEnvironment(makeLogger());
      await expect(env.findPythonExecutable()).rejects.toThrow(
        /嵌入式Python环境不可用/,
      );
    });
  });

  describe("getPythonVersion", () => {
    it("parses a supported version report from a zero exit", async () => {
      spawnEmitting("Python 3.11.9", 0);
      const env = new PythonEnvironment(null);
      await expect(env.getPythonVersion("/any/python")).resolves.toEqual({
        major: 3,
        minor: 11,
      });
      // Non-embedded probe runs in the inherited environment.
      expect("PYTHONHOME" in spawnEnvOf()).toBe(false);
    });

    it("returns null for unparseable output even on a zero exit", async () => {
      spawnEmitting("not a python report", 0);
      const env = new PythonEnvironment(null);
      await expect(env.getPythonVersion("/any/python")).resolves.toBeNull();
    });

    it("returns null for a non-zero exit", async () => {
      spawnEmitting("traceback", 1);
      const env = new PythonEnvironment(null);
      await expect(env.getPythonVersion("/any/python")).resolves.toBeNull();
    });

    it("returns null when the process fails to spawn", async () => {
      spawnEmitting("", null, new Error("ENOENT"));
      const env = new PythonEnvironment(null);
      await expect(env.getPythonVersion("/any/python")).resolves.toBeNull();
    });
  });

  describe("isPythonVersionSupported", () => {
    const env = new PythonEnvironment(null);

    it("rejects missing and pre-3.8 interpreters, accepts 3.8+", () => {
      expect(env.isPythonVersionSupported(null)).toBe(false);
      expect(env.isPythonVersionSupported({ major: 2, minor: 9 })).toBe(false);
      expect(env.isPythonVersionSupported({ major: 3, minor: 7 })).toBe(false);
      expect(env.isPythonVersionSupported({ major: 3, minor: 8 })).toBe(true);
      expect(env.isPythonVersionSupported({ major: 3, minor: 11 })).toBe(true);
    });
  });

  describe("findPythonExecutableWithFallback", () => {
    it("scans candidates until one reports a supported version", async () => {
      process.env.NODE_ENV = "production";
      // All candidates report garbage except the system python3 paths.
      spawnMock.mockImplementation((cmd: string) => {
        const proc = new EventEmitter() as FakeProc;
        proc.stdout = new EventEmitter();
        proc.stderr = new EventEmitter();
        queueMicrotask(() => {
          if (cmd === "python3") {
            proc.stdout.emit("data", Buffer.from("Python 3.10.4", "utf8"));
          } else {
            proc.stdout.emit("data", Buffer.from("nope", "utf8"));
          }
          proc.emit("close", 0);
        });
        return proc;
      });

      const env = new PythonEnvironment(makeLogger());
      const resolved = await env.findPythonExecutableWithFallback();
      expect(resolved).toBe("python3");
      expect(env.pythonCmd).toBe("python3");
    });

    it("throws the install hint after every candidate fails", async () => {
      spawnEmitting("", 1);
      const env = new PythonEnvironment(makeLogger());
      await expect(env.findPythonExecutableWithFallback()).rejects.toThrow(
        /未找到 Python 3.x/,
      );
    });

    it("continues past candidates whose probe throws (dev electron miss)", async () => {
      // In dev the embedded-path resolution inside getPythonVersion throws
      // for every candidate; the loop must swallow each error via its
      // catch/continue arm and still end with the install hint.
      process.env.NODE_ENV = "development";
      const env = new PythonEnvironment(makeLogger());
      await expect(env.findPythonExecutableWithFallback()).rejects.toThrow(
        /未找到 Python 3.x/,
      );
      // Every candidate was probed through spawn before its throw... the
      // probe itself throws before spawn, so spawn must never be reached.
      expect(spawnMock).not.toHaveBeenCalled();
    });
  });

  describe("checkFunASRInstallation", () => {
    function dispatchProbes(funasrSpec: SpawnSpec): void {
      spawnDispatching((args) =>
        args[0] === "--version"
          ? { output: "Python 3.11.9", code: 0 }
          : funasrSpec,
      );
    }

    beforeEach(() => {
      writeEmbeddedInterpreter();
    });

    it("caches the first verdict and serves it on subsequent calls", async () => {
      dispatchProbes({ output: "OK", code: 0 });

      const env = new PythonEnvironment(makeLogger());
      const first = await env.checkFunASRInstallation();
      const second = await env.checkFunASRInstallation();

      expect(first).toEqual({ installed: true, working: true });
      expect(second).toBe(first);
      expect(spawnMock).toHaveBeenCalledTimes(2); // version probe + check
    });

    it("reports a failing check with stderr as the error", async () => {
      dispatchProbes({
        output: "nope",
        stderr: "ModuleNotFoundError: funasr",
        code: 0,
      });

      const env = new PythonEnvironment(makeLogger());
      const result = await env.checkFunASRInstallation();
      expect(result.installed).toBe(false);
      expect(result.working).toBe(false);
      expect(result.error).toContain("ModuleNotFoundError");
    });

    it("falls back to stdout in the error payload when stderr is empty", async () => {
      dispatchProbes({ output: "boom", code: 1 });

      const env = new PythonEnvironment(makeLogger());
      const result = await env.checkFunASRInstallation();
      expect(result.error).toBe("boom");
    });

    it("reports the spawn error message when the probe fails to start", async () => {
      dispatchProbes({ output: "", code: null, error: new Error("EACCES") });

      const env = new PythonEnvironment(makeLogger());
      const result = await env.checkFunASRInstallation();
      expect(result).toEqual({
        installed: false,
        working: false,
        error: "EACCES",
      });
    });

    it("wraps the interpreter-resolution failure as an error verdict", async () => {
      // Remove the embedded interpreter so findPythonExecutable throws in
      // production; the check must degrade to a cached error verdict.
      fs.rmSync(path.join(unpackedRoot, "python"), {
        recursive: true,
        force: true,
      });

      const env = new PythonEnvironment(makeLogger());
      const result = await env.checkFunASRInstallation();
      expect(result.installed).toBe(false);
      expect(result.error).toContain("嵌入式Python环境不可用");
    });

    it("clearFunASRInstallCache forces a fresh probe", async () => {
      dispatchProbes({ output: "OK", code: 0 });
      const env = new PythonEnvironment(makeLogger());
      await env.checkFunASRInstallation();
      env.clearFunASRInstallCache();
      await env.checkFunASRInstallation();
      expect(spawnMock).toHaveBeenCalledTimes(3); // probe + 2 checks
    });
  });

  describe("installPython / checkPythonInstallation / upgradePip", () => {
    it("returns the installer result after re-resolving the interpreter", async () => {
      writeEmbeddedInterpreter();
      spawnEmitting("Python 3.11.9", 0);
      installerMock.installPython.mockResolvedValue({ method: "embedded" });

      const env = new PythonEnvironment(makeLogger());
      await expect(env.installPython()).resolves.toEqual({
        method: "embedded",
      });
    });

    it("wraps the resolution failure after a nominally successful install", async () => {
      // Installer succeeds but no interpreter can be resolved in production.
      installerMock.installPython.mockResolvedValue({ method: "PATH" });
      const env = new PythonEnvironment(makeLogger());
      await expect(env.installPython()).rejects.toThrow(
        /Python 已安装但在 PATH 中未找到/,
      );
    });

    it("logs and rethrows installer failures", async () => {
      installerMock.installPython.mockRejectedValue(new Error("网络错误"));
      const logger = makeLogger();
      const env = new PythonEnvironment(logger);
      await expect(env.installPython()).rejects.toThrow("网络错误");
      expect(logger.error).toHaveBeenCalled();
    });

    it("delegates checkPythonInstallation to the installer", async () => {
      installerMock.isPythonInstalled.mockResolvedValue({ installed: true });
      const env = new PythonEnvironment(makeLogger());
      await expect(env.checkPythonInstallation()).resolves.toEqual({
        installed: true,
      });
    });

    it("upgrades pip through runCommand with the pip-upgrade timeout", async () => {
      runCommandMock.mockResolvedValue({ output: "", code: 0 });
      const env = new PythonEnvironment(makeLogger());
      await env.upgradePip("/py/3.11");
      expect(runCommandMock).toHaveBeenCalledWith(
        "/py/3.11",
        ["-m", "pip", "install", "--upgrade", "pip"],
        { timeout: TIMEOUTS.PIP_UPGRADE },
      );
    });
  });

  describe("installFunASR orchestration", () => {
    // runCommand behavior keyed off the pip argument vector. Note the
    // distinction: --upgrade only appears in the pip-upgrade attempts,
    // while -U marks the funasr/librosa installs and --user their
    // user-mode fallbacks.
    function setRunCommandBehavior(
      behavior: (args: string[]) => Promise<void>,
    ): void {
      runCommandMock.mockImplementation((_cmd: string, args: string[]) =>
        behavior(args),
      );
    }

    function expectPipCall(nth: number, ...args: string[]): void {
      expect(runCommandMock).toHaveBeenNthCalledWith(
        nth,
        expect.any(String),
        args,
        expect.objectContaining({ timeout: expect.any(Number) }),
      );
    }

    beforeEach(() => {
      writeEmbeddedInterpreter();
      spawnDispatching((args) =>
        args[0] === "--version"
          ? { output: "Python 3.11.9", code: 0 }
          : { output: "", code: 0 },
      ); // interpreter probe only; runCommand is mocked separately
    });

    it("runs the pip upgrade, funasr, and librosa installs in order", async () => {
      setRunCommandBehavior(async () => undefined);
      const cb = vi.fn();
      const env = new PythonEnvironment(makeLogger());

      await expect(env.installFunASR(cb)).resolves.toEqual({
        success: true,
        message: "FunASR 安装成功",
      });

      expectPipCall(1, "-m", "pip", "install", "--upgrade", "pip");
      expectPipCall(2, "-m", "pip", "install", "-U", "funasr");
      expectPipCall(3, "-m", "pip", "install", "-U", "librosa");
      const stages = cb.mock.calls.map(
        (c) => (c[0] as { stage: string }).stage,
      );
      expect(stages).toEqual([
        "升级 pip...",
        "安装 FunASR...",
        "安装 librosa...",
        "安装完成！",
      ]);
    });

    it("completes without a progress callback", async () => {
      setRunCommandBehavior(async () => undefined);
      const env = new PythonEnvironment(makeLogger());
      await expect(env.installFunASR(null)).resolves.toEqual({
        success: true,
        message: "FunASR 安装成功",
      });
    });

    it("retries the pip upgrade with --user after a generic failure", async () => {
      setRunCommandBehavior(async (args) => {
        if (args.includes("--upgrade")) throw new Error("pip exploded");
      });
      const env = new PythonEnvironment(makeLogger());
      await expect(env.installFunASR(null)).resolves.toEqual({
        success: true,
        message: "FunASR 安装成功",
      });
      expectPipCall(2, "-m", "pip", "install", "--user", "--upgrade", "pip");
    });

    it("continues when both pip upgrade attempts fail", async () => {
      setRunCommandBehavior(async (args) => {
        if (args.includes("--upgrade")) throw new Error("pip exploded");
      });
      const logger = makeLogger();
      const env = new PythonEnvironment(logger);
      // The --user retry also fails (same --upgrade match) → warn + push on.
      await expect(env.installFunASR(null)).resolves.toEqual({
        success: true,
        message: "FunASR 安装成功",
      });
      expect(logger.warn).toHaveBeenCalled();
    });

    it("falls back to user-mode installs on a permission error", async () => {
      setRunCommandBehavior(async (args) => {
        if (args.includes("--user")) return;
        if (args.includes("-U")) throw new Error("Permission denied");
      });
      const cb = vi.fn();
      const env = new PythonEnvironment(makeLogger());
      await expect(env.installFunASR(cb)).resolves.toEqual({
        success: true,
        message: "FunASR 安装成功（用户模式）",
      });
      // Call 2 was the failed non-user funasr attempt; user-mode follows.
      expectPipCall(3, "-m", "pip", "install", "--user", "-U", "funasr");
      expectPipCall(4, "-m", "pip", "install", "--user", "-U", "librosa");
      const stages = cb.mock.calls.map(
        (c) => (c[0] as { stage: string }).stage,
      );
      // "安装 FunASR..." is announced before the failing install too.
      expect(stages).toEqual(["升级 pip...", "安装 FunASR...", "安装完成！"]);
    });

    it("recognizes the Windows spelling of the permission error", async () => {
      setRunCommandBehavior(async (args) => {
        if (args.includes("--user")) return;
        if (args.includes("-U")) throw new Error("access is denied");
      });
      const env = new PythonEnvironment(makeLogger());
      await expect(env.installFunASR(null)).resolves.toEqual({
        success: true,
        message: "FunASR 安装成功（用户模式）",
      });
    });

    it("throws when the user-mode fallback also fails", async () => {
      setRunCommandBehavior(async (args) => {
        if (args.includes("--user")) throw new Error("disk full");
        if (args.includes("funasr")) throw new Error("Permission denied");
      });
      const env = new PythonEnvironment(makeLogger());
      await expect(env.installFunASR(null)).rejects.toThrow(
        /FunASR 安装失败: disk full/,
      );
    });

    it("remaps the Visual C++ missing-tools error", async () => {
      setRunCommandBehavior(async (args) => {
        if (args.includes("--upgrade")) return;
        throw new Error("requires Microsoft Visual C++ 14.0 or greater");
      });
      const env = new PythonEnvironment(makeLogger());
      await expect(env.installFunASR(null)).rejects.toThrow(
        /需要 Microsoft Visual C\+\+ 构建工具/,
      );
    });

    it("remaps the no-matching-distribution error", async () => {
      setRunCommandBehavior(async (args) => {
        if (args.includes("--upgrade")) return;
        throw new Error("No matching distribution found for funasr");
      });
      const env = new PythonEnvironment(makeLogger());
      await expect(env.installFunASR(null)).rejects.toThrow(
        /Python 版本不兼容/,
      );
    });

    it("passes unrecognized errors through unchanged", async () => {
      setRunCommandBehavior(async (args) => {
        if (args.includes("--upgrade")) return;
        throw new Error("kaboom");
      });
      const env = new PythonEnvironment(makeLogger());
      await expect(env.installFunASR(null)).rejects.toThrow("kaboom");
    });
  });
});
