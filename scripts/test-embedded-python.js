const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

class EmbeddedPythonTester {
  constructor() {
    this.pythonDir = path.join(__dirname, "..", "python");
    this.pythonPath = path.join(this.pythonDir, "bin", "python3.11");
  }

  async runTests() {
    console.log("🧪 开始测试嵌入式Python环境...\n");

    try {
      // 1. 检查Python可执行文件
      await this.testPythonExecutable();

      // 2. 检查Python版本
      await this.testPythonVersion();

      // 3. 检查关键依赖
      await this.testDependencies();

      // 4. 测试FunASR导入
      await this.testFunASRImport();

      // 5. 测试环境隔离
      await this.testEnvironmentIsolation();

      console.log("\n✅ 所有测试通过！嵌入式Python环境工作正常。");
    } catch (error) {
      console.error("\n❌ 测试失败:", error.message);
      process.exit(1);
    }
  }

  async testPythonExecutable() {
    console.log("1️⃣ 检查Python可执行文件...");

    if (!fs.existsSync(this.pythonPath)) {
      throw new Error(`Python可执行文件不存在: ${this.pythonPath}`);
    }

    const stats = fs.statSync(this.pythonPath);
    if (!stats.isFile()) {
      throw new Error("Python路径不是文件");
    }

    // 检查执行权限
    try {
      fs.accessSync(this.pythonPath, fs.constants.X_OK);
    } catch (_error) {
      throw new Error("Python文件没有执行权限");
    }

    console.log("   ✅ Python可执行文件存在且有执行权限");
  }

  async testPythonVersion() {
    console.log("2️⃣ 检查Python版本...");

    const version = await this.runPythonCommand(["--version"]);
    console.log(`   ✅ Python版本: ${version.trim()}`);

    if (!version.includes("Python 3.11")) {
      throw new Error(`期望Python 3.11，实际: ${version}`);
    }
  }

  async testDependencies() {
    console.log("3️⃣ 检查关键依赖...");

    const dependencies = ["sys", "os", "json", "numpy", "torch", "librosa"];

    for (const dep of dependencies) {
      try {
        await this.runPythonCommand([
          "-c",
          `import ${dep}; print("${dep} OK")`,
        ]);
        console.log(`   ✅ ${dep} 导入成功`);
      } catch (error) {
        throw new Error(`依赖 ${dep} 导入失败: ${error.message}`);
      }
    }
  }

  async testFunASRImport() {
    console.log("4️⃣ 测试FunASR导入...");

    try {
      const result = await this.runPythonCommand([
        "-c",
        'import funasr; print("FunASR version:", getattr(funasr, "__version__", "unknown"))',
      ]);
      console.log(`   ✅ FunASR导入成功: ${result.trim()}`);
    } catch (error) {
      throw new Error(`FunASR导入失败: ${error.message}`);
    }
  }

  async testEnvironmentIsolation() {
    console.log("5️⃣ 测试环境隔离...");

    // 测试Python路径隔离
    const pythonPath = await this.runPythonCommand([
      "-c",
      'import sys; print("\\n".join(sys.path))',
    ]);

    const paths = pythonPath.split("\n").filter((p) => p.trim());
    const embeddedPaths = paths.filter((p) => p.includes(this.pythonDir));

    if (embeddedPaths.length === 0) {
      throw new Error("Python路径中没有找到嵌入式Python目录");
    }

    console.log("   ✅ Python路径正确指向嵌入式环境");
    console.log(`   📁 嵌入式路径数量: ${embeddedPaths.length}`);

    // 测试site-packages路径
    const sitePackages = await this.runPythonCommand([
      "-c",
      'import site; print("\\n".join(site.getsitepackages()))',
    ]);

    if (!sitePackages.includes(this.pythonDir)) {
      throw new Error("site-packages路径不在嵌入式Python目录中");
    }

    console.log("   ✅ site-packages路径正确");
  }

  async runPythonCommand(args) {
    return new Promise((resolve, reject) => {
      // 设置隔离环境变量
      const env = {
        ...process.env,
        PYTHONHOME: this.pythonDir,
        PYTHONPATH: path.join(
          this.pythonDir,
          "lib",
          "python3.11",
          "site-packages",
        ),
        PYTHONDONTWRITEBYTECODE: "1",
        PYTHONIOENCODING: "utf-8",
        PYTHONUNBUFFERED: "1",
      };

      // 清除可能干扰的环境变量
      delete env.PYTHONUSERBASE;
      delete env.PYTHONSTARTUP;
      delete env.VIRTUAL_ENV;

      const pythonProcess = spawn(this.pythonPath, args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: env,
      });

      let stdout = "";
      let stderr = "";

      pythonProcess.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      pythonProcess.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      pythonProcess.on("close", (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`命令失败 (退出码: ${code}): ${stderr || stdout}`));
        }
      });

      pythonProcess.on("error", (error) => {
        reject(new Error(`进程错误: ${error.message}`));
      });
    });
  }

  async getEnvironmentInfo() {
    console.log("📊 嵌入式Python环境信息:\n");

    try {
      // Python版本
      const version = await this.runPythonCommand(["--version"]);
      console.log(`Python版本: ${version.trim()}`);

      // Python路径
      console.log(`Python路径: ${this.pythonPath}`);

      // 环境大小
      const size = this.getDirectorySize(this.pythonDir);
      console.log(`环境大小: ${size.mb}MB (${size.files} 个文件)`);

      // 已安装包列表
      try {
        const packages = await this.runPythonCommand([
          "-m",
          "pip",
          "list",
          "--format=freeze",
        ]);
        const packageList = packages.split("\n").filter((p) => p.trim()).length;
        console.log(`已安装包数量: ${packageList}`);
      } catch (_error) {
        console.log("无法获取包列表");
      }

      // Python路径
      const pythonPaths = await this.runPythonCommand([
        "-c",
        'import sys; print("\\n".join(sys.path))',
      ]);
      console.log("\nPython搜索路径:");
      pythonPaths.split("\n").forEach((p) => {
        if (p.trim()) {
          console.log(`  ${p.trim()}`);
        }
      });
    } catch (error) {
      console.error("获取环境信息失败:", error.message);
    }
  }

  getDirectorySize(dirPath) {
    let totalSize = 0;
    let fileCount = 0;

    const calculateSize = (dir) => {
      try {
        const items = fs.readdirSync(dir);

        for (const item of items) {
          const fullPath = path.join(dir, item);
          const stat = fs.statSync(fullPath);

          if (stat.isDirectory()) {
            calculateSize(fullPath);
          } else {
            totalSize += stat.size;
            fileCount++;
          }
        }
      } catch (_error) {
        // 忽略权限错误等
      }
    };

    calculateSize(dirPath);

    return {
      bytes: totalSize,
      mb: Math.round(totalSize / 1024 / 1024),
      files: fileCount,
    };
  }
}

// 主函数
async function main() {
  const tester = new EmbeddedPythonTester();

  if (process.argv.includes("--info")) {
    await tester.getEnvironmentInfo();
    return;
  }

  await tester.runTests();
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = EmbeddedPythonTester;
