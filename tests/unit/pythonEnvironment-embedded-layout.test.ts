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
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

import PythonEnvironment, {
  embeddedPythonLayout,
} from "../../src/helpers/pythonEnvironment";

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
