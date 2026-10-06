#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const https = require("https");
const { execSync } = require("child_process");
const { createWriteStream } = require("fs");
const tar = require("tar");

// [20260802_Fix_WinEmbeddedPython] Cross-platform embedded Python builder.
// macOS: -apple-darwin, python/bin/python3.11, lib/python3.11/site-packages
// Windows: -pc-windows-msvc-shared, python.exe, Lib/site-packages
// Platform-specific paths and env vars are resolved via getters below.
// [20260802_Fix_WinEmbeddedPython] END

// [20261006_T8_PackagingSlimdown] Ticket #422 (spec #412 decisions 1/3/5):
// the embedded env is the funasr-onnx generation. The wheel set comes from
// the committed sha256-pinned lock (SBOM discipline — every wheel hashed
// for both shipping platforms), installed in ONE pip transaction with
// --require-hashes. numba/llvmlite ride along only because librosa (a
// funasr-onnx metadata dep) declares them; after install they are pruned
// BEHIND the real-inference gate (scripts/embedded-python/import_gate.py
// transcribes a non-wav fixture through the production adapters) — a gate
// failure restores them (降级不裁) and the packaging-state marker records
// what shipped.
class EmbeddedPythonBuilder {
  // [20261006_T8_PackagingSlimdown] Import names of the runtime stack the
  // env must provide; the former ["numpy", "torch", "librosa", "funasr"]
  // verified a stack the slimmed env deliberately no longer contains.
  static CRITICAL_DEPS = ["numpy", "soundfile", "onnxruntime", "funasr_onnx"];
  static PRUNE_PACKAGES = ["numba", "llvmlite"];
  static RUNTIME_LOCK_PATH = path.join(
    __dirname,
    "embedded-python",
    "requirements.lock",
  );
  static GATE_SCRIPT_PATH = path.join(
    __dirname,
    "embedded-python",
    "import_gate.py",
  );
  static PACKAGING_STATE_FILENAME = ".murmur-packaging-state.json";

  // [20261006_T8_PackagingSlimdown] Marker factory — the packaging-state
  // file is import_gate.py --check-only's consistency input, so "pruned"
  // must be true EXACTLY when the gate passed. Unknown outcomes throw:
  // silently recording a pruned:false tree would flip the CI gate's
  // verdict for a correctly pruned env (the bug class this guards).
  static buildPackagingState(outcome, gatedAt) {
    const prunedByOutcome = { "gate-passed": true };
    if (!(outcome in prunedByOutcome) && !outcome.startsWith("gate-")) {
      throw new Error(`unknown packaging outcome: ${outcome}`);
    }
    return {
      pruned: prunedByOutcome[outcome] === true,
      reason: outcome,
      packages: EmbeddedPythonBuilder.PRUNE_PACKAGES,
      gated_at: gatedAt,
    };
  }

  constructor() {
    this.pythonVersion = "3.11.6";
    this.buildDate = "20231002";
    this.pythonDir = path.join(__dirname, "..", "python");
    this.forceReinstall = false;
  }

  // [20260802_Fix_WinEmbeddedPython] Platform-aware path getters
  get isWindows() {
    return process.platform === "win32";
  }

  get pythonBin() {
    return this.isWindows
      ? path.join(this.pythonDir, "python.exe")
      : path.join(this.pythonDir, "bin", "python3.11");
  }

  get sitePackagesPath() {
    return this.isWindows
      ? path.join(this.pythonDir, "Lib", "site-packages")
      : path.join(this.pythonDir, "lib", "python3.11", "site-packages");
  }

  get downloadPlatform() {
    if (this.isWindows) return "pc-windows-msvc-shared";
    if (process.platform === "darwin") return "apple-darwin";
    return "unknown-linux-gnu";
  }

  /** Library path env vars for native extension loading. */
  get libPathEnv() {
    const libDir = path.join(this.pythonDir, this.isWindows ? "" : "lib");
    if (this.isWindows) {
      // Windows loads DLLs from PATH; prepend the python dir.
      return { PATH: `${this.pythonDir};${process.env.PATH || ""}` };
    }
    return {
      LD_LIBRARY_PATH: libDir,
      DYLD_LIBRARY_PATH: libDir,
    };
  }
  // [20260802_Fix_WinEmbeddedPython] END

  async build() {
    console.log("🐍 开始准备嵌入式Python环境...");

    try {
      // 1. 检查现有环境是否完整（除非强制重新安装）
      if (!this.forceReinstall) {
        const existingInfo = await this.getEmbeddedPythonInfo();
        if (existingInfo && existingInfo.ready) {
          console.log("✅ 检测到现有的嵌入式Python环境:");
          console.log(`   版本: ${existingInfo.version}`);
          console.log(
            `   大小: ${existingInfo.size.mb}MB (${existingInfo.size.files} 个文件)`,
          );

          // 验证关键依赖是否完整
          const isValid = await this.validateExistingEnvironment();

          if (isValid) {
            console.log("✅ 现有环境验证通过，跳过重新安装");
            // [20261006_T8_PackagingSlimdown] The prune step is idempotent
            // (marker short-circuit) and must also run on the skip path —
            // an env installed before the gate existed (or a degraded
            // marker) gets healed here instead of shipping unpruned.
            await this.maybePruneNumbaLlvmite();
            return;
          } else {
            console.log("⚠️ 现有环境不完整，将重新安装...");
          }
        } else {
          console.log("📋 未检测到现有环境或环境不可用，开始全新安装...");
        }
      } else {
        console.log("🔄 强制重新安装模式，跳过现有环境检查");
      }

      // 2. 清理现有Python目录
      await this.cleanup();

      // 3. 下载Python运行时
      await this.downloadPythonRuntime();

      // 4. 安装Python依赖
      await this.installDependencies();

      // 5. 清理不必要文件
      await this.cleanupUnnecessaryFiles();

      // [20260818_T3_PythonSelfCheckMilestone] (step 6 added by
      // [20261006_T8_PackagingSlimdown]) Prune numba/llvmlite behind the
      // real-inference gate — the installer-size payoff of the ONNX swap.
      await this.maybePruneNumbaLlvmite();

      console.log("✅ 嵌入式Python环境准备完成！");
    } catch (error) {
      console.error("❌ 准备Python环境失败:", error.message);
      process.exit(1);
    }
  }

  async cleanup() {
    if (fs.existsSync(this.pythonDir)) {
      console.log("🧹 清理现有Python目录...");
      fs.rmSync(this.pythonDir, { recursive: true, force: true });
    }
    fs.mkdirSync(this.pythonDir, { recursive: true });
  }

  async downloadPythonRuntime() {
    const arch = process.arch === "arm64" ? "aarch64" : "x86_64";
    // [20260802_Fix_WinEmbeddedPython] Platform-aware download URL
    const filename = `cpython-${this.pythonVersion}+${this.buildDate}-${arch}-${this.downloadPlatform}-install_only.tar.gz`;
    const url = `https://github.com/indygreg/python-build-standalone/releases/download/${this.buildDate}/${filename}`;
    // [20260802_Fix_WinEmbeddedPython] END
    const tarPath = path.join(this.pythonDir, "python.tar.gz");

    console.log(`📥 下载Python运行时 (${arch} / ${this.downloadPlatform})...`);
    console.log(`URL: ${url}`);

    await this.downloadFile(url, tarPath);

    console.log("📦 解压Python运行时...");
    await tar.extract({
      file: tarPath,
      cwd: this.pythonDir,
      strip: 1,
    });

    // 删除压缩包
    fs.unlinkSync(tarPath);

    console.log("✅ Python运行时下载完成");
  }

  async downloadFile(url, outputPath) {
    return new Promise((resolve, reject) => {
      const file = createWriteStream(outputPath);

      https
        .get(url, (response) => {
          if (response.statusCode === 302 || response.statusCode === 301) {
            // 处理重定向
            return this.downloadFile(response.headers.location, outputPath)
              .then(resolve)
              .catch(reject);
          }

          if (response.statusCode !== 200) {
            reject(new Error(`下载失败: HTTP ${response.statusCode}`));
            return;
          }

          const totalSize = parseInt(response.headers["content-length"], 10);
          let downloadedSize = 0;

          response.on("data", (chunk) => {
            downloadedSize += chunk.length;
            if (totalSize) {
              const progress = Math.round((downloadedSize / totalSize) * 100);
              process.stdout.write(
                `\r进度: ${progress}% (${Math.round(downloadedSize / 1024 / 1024)}MB / ${Math.round(totalSize / 1024 / 1024)}MB)`,
              );
            }
          });

          response.pipe(file);

          file.on("finish", () => {
            file.close();
            console.log("\n✅ 下载完成");
            resolve();
          });

          file.on("error", (error) => {
            fs.unlink(outputPath, () => {}); // 错误时清理
            reject(error);
          });
        })
        .on("error", (error) => {
          reject(error);
        });
    });
  }

  /** Build env vars for pip / python subprocess calls. */
  // [20260802_Fix_WinEmbeddedPython] Centralized env construction
  get pythonEnv() {
    return {
      ...process.env,
      PYTHONHOME: this.pythonDir,
      PYTHONPATH: this.sitePackagesPath,
      PYTHONDONTWRITEBYTECODE: "1",
      PYTHONIOENCODING: "utf-8",
      PYTHONUNBUFFERED: "1",
      PIP_NO_CACHE_DIR: "1",
      ...this.libPathEnv,
    };
  }
  // [20260802_Fix_WinEmbeddedPython] END

  // [20261006_T8_PackagingSlimdown] One pip transaction from the hashed
  // lock. The old per-dep loop (torch trio + librosa + funasr, unpinned
  // transitive resolution, retry-with-deps fallback) is gone: hash
  // verification is the SBOM discipline, so a mismatch fails the build
  // instead of falling back to unverified bytes.
  async installDependencies() {
    const pythonPath = this.pythonBin;
    const sitePackagesPath = this.sitePackagesPath;
    const lockPath = EmbeddedPythonBuilder.RUNTIME_LOCK_PATH;
    const wheelsDir = path.join(__dirname, "embedded-python", "wheels");

    if (!fs.existsSync(lockPath)) {
      throw new Error(`wheel lock missing: ${lockPath}`);
    }

    console.log("📦 安装Python依赖 (sha256 锁定清单)...");
    console.log(`🧾 lock: ${lockPath}`);

    // 确保pip是最新的
    console.log("⬆️ 升级pip...");
    try {
      execSync(`"${pythonPath}" -m pip install --upgrade pip`, {
        stdio: "inherit",
        env: this.pythonEnv,
      });
    } catch (_error) {
      console.warn("⚠️ pip升级失败，继续安装依赖...");
    }

    // Single transaction: pip verifies every downloaded wheel against the
    // recorded sha256. --find-links supplies the committed local jieba
    // wheel (upstream ships sdist only); everything else resolves from
    // PyPI and must match a recorded hash to install at all.
    execSync(
      `"${pythonPath}" -m pip install --target "${sitePackagesPath}" ` +
        `--require-hashes --only-binary=:all: --find-links "${wheelsDir}" ` +
        `-r "${lockPath}"`,
      { stdio: "inherit", env: this.pythonEnv },
    );

    // 验证关键依赖
    await this.verifyDependencies();
  }

  async verifyDependencies() {
    console.log("🔍 验证依赖安装...");

    for (const dep of EmbeddedPythonBuilder.CRITICAL_DEPS) {
      try {
        const result = execSync(
          `"${this.pythonBin}" -c "import ${dep}; print('${dep} OK')"`,
          { stdio: "pipe", env: this.pythonEnv },
        );
        console.log(`✅ ${dep} 验证通过: ${result.toString().trim()}`);
      } catch (error) {
        console.error(`❌ ${dep} 验证失败:`, error.message);
        console.error("错误输出:", error.stderr?.toString() || "无");
        throw new Error(`关键依赖 ${dep} 安装失败: ${error.message}`);
      }
    }
  }

  // [20261006_T8_PackagingSlimdown] Prune numba/llvmlite (~154MB unpacked)
  // ONLY behind the real-inference gate. Flow: move the packages to a
  // holding dir → run the gate (full mode: real transcription of a non-wav
  // fixture on real self-exported model bytes, asserting the stack imports
  // and transcribes without them) → pass = delete, fail = restore and
  // record the degradation. Without gate models (MURMUR_ONNX_GATE_MODELS_DIR
  // unset/empty) the prune is SKIPPED — an ungated prune is exactly the
  // failure mode the gate exists to prevent.
  async maybePruneNumbaLlvmite() {
    const statePath = path.join(
      this.pythonDir,
      EmbeddedPythonBuilder.PACKAGING_STATE_FILENAME,
    );
    const sitePackages = this.sitePackagesPath;

    const writeState = (outcome) => {
      const state = EmbeddedPythonBuilder.buildPackagingState(
        outcome,
        new Date().toISOString(),
      );
      try {
        fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n");
      } catch (error) {
        console.warn(`⚠️ 无法写入打包状态标记: ${error.message}`);
      }
    };

    const modelsDir = process.env.MURMUR_ONNX_GATE_MODELS_DIR;
    if (!modelsDir || !fs.existsSync(modelsDir)) {
      console.warn(
        "⚠️ 未提供门禁模型目录 (MURMUR_ONNX_GATE_MODELS_DIR)，跳过 numba/llvmlite 裁剪" +
          "（安装包将偏大；CI 与发布构建应提供该目录）",
      );
      writeState("gate-models-missing");
      return;
    }

    // Idempotency: an already-pruned, already-gated env needs no re-gate.
    // [20261006_T8_PackagingSlimdown] The marker alone is NOT trusted: a
    // later `pip install -r lock --target` re-run (lock refresh, manual
    // repair) silently re-extracts the pruned packages, so "pruned" must
    // also mean the dirs are actually ABSENT — otherwise the gate is
    // skipped and the installer ships with 158MB of dead weight (observed
    // locally: 225MB → 266MB dmg).
    const pruneTargetsPresent = EmbeddedPythonBuilder.PRUNE_PACKAGES.some(
      (pkg) => fs.existsSync(path.join(sitePackages, pkg)),
    );
    if (fs.existsSync(statePath) && !pruneTargetsPresent) {
      try {
        const prior = JSON.parse(fs.readFileSync(statePath, "utf8"));
        if (prior.pruned === true) {
          console.log("✅ 环境已裁剪并通过门禁，跳过重复裁剪");
          return;
        }
      } catch {
        // Unreadable marker → fall through and re-gate.
      }
    }

    const holdingDir = path.join(this.pythonDir, ".prune-holding");
    fs.rmSync(holdingDir, { recursive: true, force: true });
    fs.mkdirSync(holdingDir, { recursive: true });
    const moved = [];
    for (const pkg of EmbeddedPythonBuilder.PRUNE_PACKAGES) {
      const pkgDir = path.join(sitePackages, pkg);
      if (fs.existsSync(pkgDir)) {
        fs.renameSync(pkgDir, path.join(holdingDir, pkg));
        moved.push(pkg);
      }
      // Dist-info dirs ride along by prefix so pip metadata stays honest.
      const distInfos = fs
        .readdirSync(sitePackages)
        .filter((name) => name.toLowerCase().startsWith(`${pkg}-`))
        .filter((name) => name.endsWith(".dist-info"));
      for (const info of distInfos) {
        fs.renameSync(
          path.join(sitePackages, info),
          path.join(holdingDir, info),
        );
        moved.push(info);
      }
    }

    const restore = () => {
      for (const name of moved) {
        fs.renameSync(
          path.join(holdingDir, name),
          path.join(sitePackages, name),
        );
      }
      fs.rmSync(holdingDir, { recursive: true, force: true });
    };

    console.log(
      `✂️ 裁剪门禁: 移出 ${moved.join(", ")}，运行真转写门禁 (flac fixture)...`,
    );
    try {
      const result = execSync(
        `"${this.pythonBin}" "${EmbeddedPythonBuilder.GATE_SCRIPT_PATH}" ` +
          `--models-dir "${modelsDir}" --assert-numba-absent ` +
          `--fixture-wav "${path.join(
            __dirname,
            "onnx-spike",
            "fixtures",
            "onnx-spike-40s.wav",
          )}"`,
        { stdio: "pipe", env: this.pythonEnv, encoding: "utf8" },
      );
      console.log(result.toString().trim());
      fs.rmSync(holdingDir, { recursive: true, force: true });
      writeState("gate-passed");
      console.log("✅ 裁剪生效 (numba/llvmlite 已移除，门禁全过)");
    } catch (error) {
      console.error("❌ 裁剪门禁失败，恢复 numba/llvmlite (降级不裁):");
      console.error(
        (error.stdout || "") + (error.stderr || error.message || ""),
      );
      restore();
      writeState("gate-failed");
      console.warn(
        "⚠️ 裁剪已降级：环境保留 numba/llvmlite（安装包偏大但可用）",
      );
    }
  }

  async validateExistingEnvironment() {
    console.log("🔍 验证现有环境完整性...");

    try {
      // 检查Python可执行文件是否存在
      if (!fs.existsSync(this.pythonBin)) {
        console.log("❌ Python可执行文件不存在");
        return false;
      }

      // 检查关键依赖是否可用
      for (const dep of EmbeddedPythonBuilder.CRITICAL_DEPS) {
        try {
          execSync(
            `"${this.pythonBin}" -c "import ${dep}; print('${dep} OK')"`,
            {
              stdio: "pipe",
              env: this.pythonEnv,
              timeout: 10000, // 10秒超时
            },
          );
          console.log(`✅ ${dep} 可用`);
        } catch (error) {
          console.log(`❌ ${dep} 不可用: ${error.message}`);
          return false;
        }
      }

      console.log("✅ 现有环境验证完成，所有关键依赖都可用");
      return true;
    } catch (error) {
      console.log(`❌ 环境验证失败: ${error.message}`);
      return false;
    }
  }

  async cleanupUnnecessaryFiles() {
    console.log("🧹 清理不必要文件...");

    // [20260802_Fix_WinEmbeddedPython] Platform-aware cleanup paths
    const unnecessaryPaths = [
      path.join(this.pythonDir, "share", "doc"),
      path.join(this.pythonDir, "share", "man"),
      path.join(this.pythonDir, "include"),
      path.join(this.pythonDir, "lib", "pkgconfig"),
    ];

    // Platform-specific test/distutils dirs
    if (this.isWindows) {
      unnecessaryPaths.push(
        path.join(this.pythonDir, "Lib", "test"),
        path.join(this.pythonDir, "Lib", "distutils"),
      );
    } else {
      unnecessaryPaths.push(
        path.join(this.pythonDir, "lib", "python3.11", "test"),
        path.join(this.pythonDir, "lib", "python3.11", "distutils"),
      );
    }
    // [20260802_Fix_WinEmbeddedPython] END

    for (const unnecessaryPath of unnecessaryPaths) {
      if (fs.existsSync(unnecessaryPath)) {
        try {
          fs.rmSync(unnecessaryPath, { recursive: true, force: true });
          console.log(
            `🗑️ 删除: ${path.relative(this.pythonDir, unnecessaryPath)}`,
          );
        } catch (_error) {
          console.warn(`⚠️ 无法删除: ${unnecessaryPath}`);
        }
      }
    }

    // 删除.pyc文件
    this.deletePycFiles(this.pythonDir);

    console.log("✅ 清理完成");
  }

  deletePycFiles(dir) {
    const items = fs.readdirSync(dir);

    for (const item of items) {
      const fullPath = path.join(dir, item);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        if (item === "__pycache__") {
          fs.rmSync(fullPath, { recursive: true, force: true });
        } else {
          this.deletePycFiles(fullPath);
        }
      } else if (item.endsWith(".pyc")) {
        fs.unlinkSync(fullPath);
      }
    }
  }

  async getEmbeddedPythonInfo() {
    if (!fs.existsSync(this.pythonBin)) {
      return null;
    }

    try {
      const version = execSync(`"${this.pythonBin}" --version`, {
        encoding: "utf8",
        env: {
          ...process.env,
          PYTHONHOME: this.pythonDir,
          PYTHONDONTWRITEBYTECODE: "1",
        },
      }).trim();

      const sizeInfo = this.getDirectorySize(this.pythonDir);

      return {
        version,
        path: this.pythonBin,
        size: sizeInfo,
        ready: true,
      };
    } catch (error) {
      return {
        ready: false,
        error: error.message,
      };
    }
  }

  getDirectorySize(dirPath) {
    let totalSize = 0;
    let fileCount = 0;

    const calculateSize = (dir) => {
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
  const builder = new EmbeddedPythonBuilder();

  if (process.argv.includes("--info")) {
    const info = await builder.getEmbeddedPythonInfo();
    console.log("嵌入式Python信息:", JSON.stringify(info, null, 2));
    return;
  }

  // 检查是否强制重新安装
  if (process.argv.includes("--force")) {
    console.log("🔄 强制重新安装模式");
    builder.forceReinstall = true;
  }

  await builder.build();

  // 显示最终信息
  const info = await builder.getEmbeddedPythonInfo();
  console.log("\n📊 嵌入式Python环境信息:");
  console.log(`版本: ${info.version}`);
  console.log(`路径: ${info.path}`);
  console.log(`大小: ${info.size.mb}MB (${info.size.files} 个文件)`);
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = EmbeddedPythonBuilder;
