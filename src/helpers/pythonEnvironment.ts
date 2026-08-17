// [20260724_TS_BigBang_PythonEnvironment] Migrated from .js to .ts (ADR-010).
// `module.exports = PythonEnvironment` became `export default PythonEnvironment`.
// Lazy require("electron") kept inside methods/try-catch (special case: import
// is hoisted and would throw at load time in unit tests without electron).
// PythonInstaller and runCommand/TIMEOUTS use ESM imports.
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import PythonInstaller from "./pythonInstaller";
import { runCommand, TIMEOUTS } from "../utils/process";

/** Logger interface (accepts console or LogManager). */
interface Logger {
  info?(message: string, ...args: unknown[]): void;
  debug?(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error?(message: string, ...args: unknown[]): void;
}

interface PythonVersion {
  major: number;
  minor: number;
}

interface FunASRInstallResult {
  installed: boolean;
  working: boolean;
  error?: string;
}

type ProgressCallback = (progress: Record<string, unknown>) => void;

// [20260817_T1_EmbeddedLayout] Ticket #178 (spec #177 T1): platform-aware
// embedded-env layout, shared by interpreter resolution and env
// construction. The Windows half mirrors scripts/prepare-embedded-python.js
// exactly (python/python.exe, Lib/site-packages, DLLs resolved via PATH
// prepend of the python dir itself); macOS keeps bin/python3.11 +
// lib/python3.11. Before this, the runtime only ever resolved the macOS
// layout, so a packaged Windows app could not find its own interpreter.
export interface EmbeddedPythonLayout {
  /** Absolute interpreter path. */
  pythonBin: string;
  /** Distribution root — also used as PYTHONHOME. */
  pythonDir: string;
  /** First PYTHONPATH entry (stdlib dir). */
  libDir: string;
  /** Second PYTHONPATH entry. */
  sitePackagesDir: string;
  /** Prepended to PATH (Windows: the python dir; macOS: its bin/). */
  binDir: string;
  /** Platform path-list separator. */
  pathSep: string;
}

export function embeddedPythonLayout(rootDir: string): EmbeddedPythonLayout {
  const pythonDir = path.join(rootDir, "python");
  if (process.platform === "win32") {
    return {
      pythonBin: path.join(pythonDir, "python.exe"),
      pythonDir,
      libDir: path.join(pythonDir, "Lib"),
      sitePackagesDir: path.join(pythonDir, "Lib", "site-packages"),
      binDir: pythonDir,
      pathSep: ";",
    };
  }
  return {
    pythonBin: path.join(pythonDir, "bin", "python3.11"),
    pythonDir,
    libDir: path.join(pythonDir, "lib", "python3.11"),
    sitePackagesDir: path.join(pythonDir, "lib", "python3.11", "site-packages"),
    binDir: path.join(pythonDir, "bin"),
    pathSep: ":",
  };
}

class PythonEnvironment {
  private logger: Logger;
  pythonCmd: string | null;
  funasrInstalled: FunASRInstallResult | null;
  private pythonInstaller: PythonInstaller;
  private _cachedPythonEnv: NodeJS.ProcessEnv | null;
  private _lastEmbeddedCheck: boolean | null;

  constructor(logger: Logger | null = null) {
    this.logger = logger || console;
    this.pythonCmd = null;
    this.funasrInstalled = null;
    this.pythonInstaller = new PythonInstaller();
    this._cachedPythonEnv = null;
    this._lastEmbeddedCheck = null;
  }

  getFunASRServerPath(): string {
    if (process.env.NODE_ENV === "development") {
      // [20260724_TS_BigBang_DirnameFix] Use app.getAppPath() instead of
      // __dirname so the path survives esbuild bundling. Lazy require
      // avoids loading electron in unit tests that don't need it.
      const { app } = require("electron");
      return path.join(app.getAppPath(), "funasr_server.py");
      // [20260724_TS_BigBang_DirnameFix] END
    }
    return path.join(
      process.resourcesPath,
      "app.asar.unpacked",
      "funasr_server.py",
    );
  }

  // [20260817_T1_EmbeddedLayout] Root of the embedded distribution:
  // project dir in dev, unpacked resources in production. Single place the
  // dev/prod split lives; everything downstream is layout-driven.
  private _embeddedRoot(): string {
    if (process.env.NODE_ENV === "development") {
      // [20260724_TS_BigBang_DirnameFix] app.getAppPath()-based path
      const { app } = require("electron");
      return app.getAppPath();
    }
    return path.join(process.resourcesPath, "app.asar.unpacked");
  }

  getEmbeddedPythonPath(): string {
    // [20260817_T1_EmbeddedLayout] Platform layout: python/python.exe on
    // Windows, bin/python3.11 on macOS.
    return embeddedPythonLayout(this._embeddedRoot()).pythonBin;
  }

  setupIsolatedEnvironment(): boolean {
    const layout = embeddedPythonLayout(this._embeddedRoot());
    const isUsingEmbedded = fs.existsSync(layout.pythonBin);
    if (isUsingEmbedded) {
      process.env.PYTHONHOME = layout.pythonDir;
      process.env.PYTHONPATH = [layout.libDir, layout.sitePackagesDir].join(
        layout.pathSep,
      );
    } else {
      delete process.env.PYTHONHOME;
      delete process.env.PYTHONPATH;
    }
    return isUsingEmbedded;
  }

  buildPythonEnvironment(): NodeJS.ProcessEnv {
    const layout = embeddedPythonLayout(this._embeddedRoot());
    const isUsingEmbedded = fs.existsSync(layout.pythonBin);

    if (this._cachedPythonEnv && this._lastEmbeddedCheck === isUsingEmbedded) {
      return this._cachedPythonEnv;
    }

    const env = { ...process.env };

    // Force UTF-8 for stdin/stdout — critical on Windows where the default
    // is GBK/CP936 on Chinese locales. Without this, Chinese file paths
    // sent via JSON over stdin are decoded as GBK instead of UTF-8,
    // producing mojibake (e.g. "新录音" → "閲戝瓟锟絓…").
    env.PYTHONUTF8 = "1";

    if (isUsingEmbedded) {
      env.PYTHONHOME = layout.pythonDir;
      env.PYTHONPATH = [layout.libDir, layout.sitePackagesDir].join(
        layout.pathSep,
      );
      env.PATH = layout.binDir + layout.pathSep + (env.PATH || "");

      env.MPLBACKEND = "Agg";
      delete env.TERM;
    }

    this._cachedPythonEnv = env;
    this._lastEmbeddedCheck = isUsingEmbedded;
    return env;
  }

  async findPythonExecutable(): Promise<string> {
    if (this.pythonCmd) return this.pythonCmd;

    const embeddedPython = this.getEmbeddedPythonPath();
    this.logger.info?.("检查嵌入式Python", {
      path: embeddedPython,
      exists: fs.existsSync(embeddedPython),
    });

    if (fs.existsSync(embeddedPython)) {
      try {
        this.setupIsolatedEnvironment();
        const version = await this.getPythonVersion(embeddedPython);
        if (version && this.isPythonVersionSupported(version)) {
          this.pythonCmd = embeddedPython;
          this.logger.info?.("使用嵌入式Python", {
            path: embeddedPython,
            version: `${version.major}.${version.minor}`,
          });
          return embeddedPython;
        }
      } catch (error) {
        this.logger.warn("嵌入式Python不可用", error);
      }
    }

    if (process.env.NODE_ENV === "development") {
      this.logger.warn("开发模式：回退到系统Python");
      return await this.findPythonExecutableWithFallback();
    }

    throw new Error(
      "嵌入式Python环境不可用。请重新安装应用或运行构建脚本准备Python环境。",
    );
  }

  async findPythonExecutableWithFallback(): Promise<string> {
    // [20260724_TS_BigBang_DirnameFix] Derive project root without __dirname.
    let projectRoot: string;
    try {
      const { app } = require("electron");
      projectRoot = app.getAppPath();
    } catch {
      projectRoot = process.cwd();
    }
    // [20260724_TS_BigBang_DirnameFix] END
    const possiblePaths = [
      path.join(projectRoot, ".venv", "bin", "python3.11"),
      path.join(projectRoot, ".venv", "bin", "python3"),
      path.join(projectRoot, ".venv", "bin", "python"),
      path.join(projectRoot, ".venv", "Scripts", "python.exe"),
      path.join(projectRoot, ".venv", "Scripts", "python3.11.exe"),
      path.join(projectRoot, ".venv", "Scripts", "python3.exe"),
      "python3.11",
      "python3",
      "python",
      "/usr/bin/python3.11",
      "/usr/bin/python3",
      "/usr/local/bin/python3.11",
      "/usr/local/bin/python3",
      "/opt/homebrew/bin/python3.11",
      "/opt/homebrew/bin/python3",
      "/usr/bin/python",
      "/usr/local/bin/python",
    ];

    for (const pythonPath of possiblePaths) {
      try {
        const version = await this.getPythonVersion(pythonPath);
        if (version && this.isPythonVersionSupported(version)) {
          this.pythonCmd = pythonPath;
          return pythonPath;
        }
      } catch {
        continue;
      }
    }

    throw new Error("未找到 Python 3.x。使用 installPython() 自动安装。");
  }

  async getPythonVersion(pythonPath: string): Promise<PythonVersion | null> {
    return new Promise((resolve) => {
      const isEmbedded = pythonPath === this.getEmbeddedPythonPath();
      const env = isEmbedded ? this.buildPythonEnvironment() : process.env;
      const testProcess = spawn(pythonPath, ["--version"], { env });
      let output = "";
      testProcess.stdout.on("data", (data: Buffer) => (output += data));
      testProcess.stderr.on("data", (data: Buffer) => (output += data));
      testProcess.on("close", (code: number | null) => {
        if (code === 0) {
          const match = output.match(/Python (\d+)\.(\d+)/i);
          resolve(match ? { major: +match[1]!, minor: +match[2]! } : null);
        } else {
          resolve(null);
        }
      });
      testProcess.on("error", () => resolve(null));
    });
  }

  isPythonVersionSupported(version: PythonVersion | null | undefined): boolean {
    return !!(version && version.major === 3 && version.minor >= 8);
  }

  async installPython(
    progressCallback: ProgressCallback | null = null,
  ): Promise<unknown> {
    try {
      this.pythonCmd = null;
      const result = await this.pythonInstaller.installPython(progressCallback);
      try {
        await this.findPythonExecutable();
        return result;
      } catch {
        throw new Error("Python 已安装但在 PATH 中未找到。请重启应用程序。");
      }
    } catch (error) {
      this.logger.error?.("Python 安装失败:", error);
      throw error;
    }
  }

  async checkPythonInstallation(): Promise<{ installed: boolean }> {
    return await this.pythonInstaller.isPythonInstalled();
  }

  async checkFunASRInstallation(): Promise<FunASRInstallResult> {
    if (this.funasrInstalled !== null) return this.funasrInstalled;

    try {
      const pythonCmd = await this.findPythonExecutable();
      const result = await new Promise<FunASRInstallResult>((resolve) => {
        const pythonEnv = this.buildPythonEnvironment();
        const checkProcess = spawn(
          pythonCmd,
          ["-c", 'import funasr; print("OK")'],
          { env: pythonEnv },
        );
        let output = "";
        let errorOutput = "";
        checkProcess.stdout.on(
          "data",
          (data: Buffer) => (output += data.toString()),
        );
        checkProcess.stderr.on(
          "data",
          (data: Buffer) => (errorOutput += data.toString()),
        );
        checkProcess.on("close", (code: number | null) => {
          if (code === 0 && output.includes("OK")) {
            resolve({ installed: true, working: true });
          } else {
            this.logger.error?.("FunASR检查失败", {
              code,
              output,
              errorOutput,
            });
            resolve({
              installed: false,
              working: false,
              error: errorOutput || output,
            });
          }
        });
        checkProcess.on("error", (error: Error) => {
          resolve({ installed: false, working: false, error: error.message });
        });
      });
      this.funasrInstalled = result;
      return result;
    } catch (error) {
      const errorResult: FunASRInstallResult = {
        installed: false,
        working: false,
        error: (error as Error).message,
      };
      this.funasrInstalled = errorResult;
      return errorResult;
    }
  }

  async upgradePip(pythonCmd: string): Promise<unknown> {
    return runCommand(pythonCmd, ["-m", "pip", "install", "--upgrade", "pip"], {
      timeout: TIMEOUTS.PIP_UPGRADE,
    });
  }

  async installFunASR(
    progressCallback: ProgressCallback | null = null,
  ): Promise<{ success: boolean; message: string }> {
    const pythonCmd = await this.findPythonExecutable();

    if (progressCallback)
      progressCallback({ stage: "升级 pip...", percentage: 10 });

    try {
      await this.upgradePip(pythonCmd);
    } catch (error) {
      this.logger.warn("第一次 pip 升级尝试失败:", (error as Error).message);
      try {
        await runCommand(
          pythonCmd,
          ["-m", "pip", "install", "--user", "--upgrade", "pip"],
          { timeout: TIMEOUTS.PIP_UPGRADE },
        );
      } catch {
        this.logger.warn("pip 升级完全失败，尝试继续");
      }
    }

    if (progressCallback)
      progressCallback({ stage: "安装 FunASR...", percentage: 30 });

    try {
      await runCommand(pythonCmd, ["-m", "pip", "install", "-U", "funasr"], {
        timeout: TIMEOUTS.DOWNLOAD,
      });
      if (progressCallback)
        progressCallback({ stage: "安装 librosa...", percentage: 60 });
      await runCommand(pythonCmd, ["-m", "pip", "install", "-U", "librosa"], {
        timeout: TIMEOUTS.DOWNLOAD,
      });
      if (progressCallback)
        progressCallback({ stage: "安装完成！", percentage: 100 });
      this.funasrInstalled = null;
      return { success: true, message: "FunASR 安装成功" };
    } catch (error) {
      const errMsg = (error as Error).message;
      if (
        errMsg.includes("Permission denied") ||
        errMsg.includes("access is denied")
      ) {
        try {
          await runCommand(
            pythonCmd,
            ["-m", "pip", "install", "--user", "-U", "funasr"],
            { timeout: TIMEOUTS.DOWNLOAD },
          );
          await runCommand(
            pythonCmd,
            ["-m", "pip", "install", "--user", "-U", "librosa"],
            { timeout: TIMEOUTS.DOWNLOAD },
          );
          if (progressCallback)
            progressCallback({ stage: "安装完成！", percentage: 100 });
          this.funasrInstalled = null;
          return { success: true, message: "FunASR 安装成功（用户模式）" };
        } catch (userError) {
          throw new Error(`FunASR 安装失败: ${(userError as Error).message}`);
        }
      }

      let message = errMsg;
      if (message.includes("Microsoft Visual C++")) {
        message =
          "需要 Microsoft Visual C++ 构建工具。请安装 Visual Studio Build Tools。";
      } else if (message.includes("No matching distribution")) {
        message = "Python 版本不兼容。FunASR 需要 Python 3.8-3.11。";
      }
      throw new Error(message);
    }
  }

  clearFunASRInstallCache(): void {
    this.funasrInstalled = null;
  }
}

export default PythonEnvironment;
