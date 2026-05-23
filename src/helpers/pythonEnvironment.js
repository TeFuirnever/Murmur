const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const PythonInstaller = require("./pythonInstaller");
const { runCommand, TIMEOUTS } = require("../utils/process");

class PythonEnvironment {
  constructor(logger = null) {
    this.logger = logger || console;
    this.pythonCmd = null;
    this.funasrInstalled = null;
    this.pythonInstaller = new PythonInstaller();
    this._cachedPythonEnv = null;
    this._lastEmbeddedCheck = null;
  }

  getFunASRServerPath() {
    if (process.env.NODE_ENV === "development") {
      return path.join(__dirname, "..", "..", "funasr_server.py");
    }
    return path.join(
      process.resourcesPath,
      "app.asar.unpacked",
      "funasr_server.py",
    );
  }

  getEmbeddedPythonPath() {
    if (process.env.NODE_ENV === "development") {
      return path.join(__dirname, "..", "..", "python", "bin", "python3.11");
    }
    return path.join(
      process.resourcesPath,
      "app.asar.unpacked",
      "python",
      "bin",
      "python3.11",
    );
  }

  setupIsolatedEnvironment() {
    const isUsingEmbedded = fs.existsSync(this.getEmbeddedPythonPath());
    if (isUsingEmbedded) {
      const pythonDir = path.dirname(
        path.dirname(this.getEmbeddedPythonPath()),
      );
      process.env.PYTHONHOME = pythonDir;
      const pathSep = process.platform === "win32" ? ";" : ":";
      const pythonPath = [
        path.join(pythonDir, "lib", "python3.11"),
        path.join(pythonDir, "lib", "python3.11", "site-packages"),
      ].join(pathSep);
      process.env.PYTHONPATH = pythonPath;
    } else {
      delete process.env.PYTHONHOME;
      delete process.env.PYTHONPATH;
    }
    return isUsingEmbedded;
  }

  buildPythonEnvironment() {
    const isUsingEmbedded = fs.existsSync(this.getEmbeddedPythonPath());

    if (this._cachedPythonEnv && this._lastEmbeddedCheck === isUsingEmbedded) {
      return this._cachedPythonEnv;
    }

    const env = { ...process.env };

    if (isUsingEmbedded) {
      const pythonDir = path.dirname(
        path.dirname(this.getEmbeddedPythonPath()),
      );
      env.PYTHONHOME = pythonDir;
      const pathSep = process.platform === "win32" ? ";" : ":";
      env.PYTHONPATH = [
        path.join(pythonDir, "lib", "python3.11"),
        path.join(pythonDir, "lib", "python3.11", "site-packages"),
      ].join(pathSep);

      const binDir = path.join(pythonDir, "bin");
      env.PATH = binDir + pathSep + (env.PATH || "");

      env.MPLBACKEND = "Agg";
      delete env.TERM;
    }

    this._cachedPythonEnv = env;
    this._lastEmbeddedCheck = isUsingEmbedded;
    return env;
  }

  async findPythonExecutable() {
    if (this.pythonCmd) return this.pythonCmd;

    const embeddedPython = this.getEmbeddedPythonPath();
    this.logger.info &&
      this.logger.info("检查嵌入式Python", {
        path: embeddedPython,
        exists: fs.existsSync(embeddedPython),
      });

    if (fs.existsSync(embeddedPython)) {
      try {
        this.setupIsolatedEnvironment();
        const version = await this.getPythonVersion(embeddedPython);
        if (this.isPythonVersionSupported(version)) {
          this.pythonCmd = embeddedPython;
          this.logger.info &&
            this.logger.info("使用嵌入式Python", {
              path: embeddedPython,
              version: `${version.major}.${version.minor}`,
            });
          return embeddedPython;
        }
      } catch (error) {
        this.logger.warn && this.logger.warn("嵌入式Python不可用", error);
      }
    }

    if (process.env.NODE_ENV === "development") {
      this.logger.warn && this.logger.warn("开发模式：回退到系统Python");
      return await this.findPythonExecutableWithFallback();
    }

    throw new Error(
      "嵌入式Python环境不可用。请重新安装应用或运行构建脚本准备Python环境。",
    );
  }

  async findPythonExecutableWithFallback() {
    const projectRoot = path.join(__dirname, "..", "..");
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
        if (this.isPythonVersionSupported(version)) {
          this.pythonCmd = pythonPath;
          return pythonPath;
        }
      } catch (_error) {
        continue;
      }
    }

    throw new Error("未找到 Python 3.x。使用 installPython() 自动安装。");
  }

  async getPythonVersion(pythonPath) {
    return new Promise((resolve) => {
      const isEmbedded = pythonPath === this.getEmbeddedPythonPath();
      const env = isEmbedded ? this.buildPythonEnvironment() : process.env;
      const testProcess = spawn(pythonPath, ["--version"], { env });
      let output = "";
      testProcess.stdout.on("data", (data) => (output += data));
      testProcess.stderr.on("data", (data) => (output += data));
      testProcess.on("close", (code) => {
        if (code === 0) {
          const match = output.match(/Python (\d+)\.(\d+)/i);
          resolve(match ? { major: +match[1], minor: +match[2] } : null);
        } else {
          resolve(null);
        }
      });
      testProcess.on("error", () => resolve(null));
    });
  }

  isPythonVersionSupported(version) {
    return !!(version && version.major === 3 && version.minor >= 8);
  }

  async installPython(progressCallback = null) {
    try {
      this.pythonCmd = null;
      const result = await this.pythonInstaller.installPython(progressCallback);
      try {
        await this.findPythonExecutable();
        return result;
      } catch (_findError) {
        throw new Error("Python 已安装但在 PATH 中未找到。请重启应用程序。");
      }
    } catch (error) {
      this.logger.error && this.logger.error("Python 安装失败:", error);
      throw error;
    }
  }

  async checkPythonInstallation() {
    return await this.pythonInstaller.isPythonInstalled();
  }

  async checkFunASRInstallation() {
    if (this.funasrInstalled !== null) return this.funasrInstalled;

    try {
      const pythonCmd = await this.findPythonExecutable();
      const result = await new Promise((resolve) => {
        const pythonEnv = this.buildPythonEnvironment();
        const checkProcess = spawn(
          pythonCmd,
          ["-c", 'import funasr; print("OK")'],
          { env: pythonEnv },
        );
        let output = "";
        let errorOutput = "";
        checkProcess.stdout.on("data", (data) => (output += data.toString()));
        checkProcess.stderr.on(
          "data",
          (data) => (errorOutput += data.toString()),
        );
        checkProcess.on("close", (code) => {
          if (code === 0 && output.includes("OK")) {
            resolve({ installed: true, working: true });
          } else {
            this.logger.error &&
              this.logger.error("FunASR检查失败", {
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
        checkProcess.on("error", (error) => {
          resolve({ installed: false, working: false, error: error.message });
        });
      });
      this.funasrInstalled = result;
      return result;
    } catch (error) {
      const errorResult = {
        installed: false,
        working: false,
        error: error.message,
      };
      this.funasrInstalled = errorResult;
      return errorResult;
    }
  }

  async upgradePip(pythonCmd) {
    return runCommand(pythonCmd, ["-m", "pip", "install", "--upgrade", "pip"], {
      timeout: TIMEOUTS.PIP_UPGRADE,
    });
  }

  async installFunASR(progressCallback = null) {
    const pythonCmd = await this.findPythonExecutable();

    if (progressCallback)
      progressCallback({ stage: "升级 pip...", percentage: 10 });

    try {
      await this.upgradePip(pythonCmd);
    } catch (error) {
      this.logger.warn &&
        this.logger.warn("第一次 pip 升级尝试失败:", error.message);
      try {
        await runCommand(
          pythonCmd,
          ["-m", "pip", "install", "--user", "--upgrade", "pip"],
          { timeout: TIMEOUTS.PIP_UPGRADE },
        );
      } catch (_userError) {
        this.logger.warn && this.logger.warn("pip 升级完全失败，尝试继续");
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
      if (
        error.message.includes("Permission denied") ||
        error.message.includes("access is denied")
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
          throw new Error(`FunASR 安装失败: ${userError.message}`);
        }
      }

      let message = error.message;
      if (message.includes("Microsoft Visual C++")) {
        message =
          "需要 Microsoft Visual C++ 构建工具。请安装 Visual Studio Build Tools。";
      } else if (message.includes("No matching distribution")) {
        message = "Python 版本不兼容。FunASR 需要 Python 3.8-3.11。";
      }
      throw new Error(message);
    }
  }

  clearFunASRInstallCache() {
    this.funasrInstalled = null;
  }
}

module.exports = PythonEnvironment;
