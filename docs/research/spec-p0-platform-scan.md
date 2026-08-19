# Murmur 全仓平台差异扫描报告（供 spec v2 使用）

扫描范围：`src/`、`scripts/`、`tests/`、`main.ts`、`funasr_server.py`、`download_models.py`、`pyproject.toml`/`uv.lock`、`.github/workflows/`、`docs/`、`CHANGELOG.md`。以下所有路径均为绝对路径缩写（仓库根 = `/Users/guanxueliang/Desktop/oh-my-ai/Murmur`）。

---

## A) 现有平台分支清单（file:line → 用途 → 与 5 个特性的关联风险）

### 主进程 src/ 与 main.ts

| 位置                                                                                                      | 用途                                                                                                                                                                                                       | 关联特性 / 风险                                                                                                                       |
| --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `main.ts:53-131` `setupProductionPath`                                                                    | darwin 注入 homebrew/框架 Python 到 PATH；win32 注入 `%LOCALAPPDATA%\Programs\Python` 与 `C:\Python3x` 到 PATH（分隔符硬编码 `:` / `;`，main.ts:86/120）                                                   | F3（重载 spawn 依赖 PATH）；仅嵌入式 Python 缺失时才走系统回退                                                                        |
| `main.ts:198`                                                                                             | darwin 非 CI 时隐藏 Dock 图标                                                                                                                                                                              | 无                                                                                                                                    |
| `main.ts:313-317` `window-all-closed`                                                                     | 非 darwin 才 quit（mac 常驻）                                                                                                                                                                              | F3：mac 下窗口全关不退出 → 空闲卸载计时器必须挂在主进程而非窗口生命周期                                                               |
| `main.ts:325-346` `will-quit`                                                                             | `gracefulShutdown()` + 5s race → `app.exit()`                                                                                                                                                              | F3：退出路径已有 taskkill 树杀（见下），可直接复用                                                                                    |
| `src/helpers/funasrServer.ts:155-163`                                                                     | spawn Python：`stdio:["pipe","pipe","pipe"]`、`windowsHide:true`、无 `shell`、无 `cwd`、env=pythonEnv                                                                                                      | F3/F4：新 env（线程覆盖变量）应经由 `buildPythonEnvironment()` 注入而非改这里                                                         |
| `src/helpers/funasrServer.ts:343-381` `gracefulShutdown`                                                  | 先写 `{action:"exit"}` 到 stdin，5s 后 win32 用 `spawnSync("taskkill",["/T","/F","/PID"])` 树杀，非 win32 `proc.kill("SIGKILL")`（358-365，注释 355-357 明确说明 `proc.kill()` 在 Windows 只杀直接子进程） | **F3 核心证据**：树杀逻辑只存在于这一处                                                                                               |
| `src/helpers/funasrServer.ts:327-341` `_stopFunASRServer`                                                 | exit 命令失败时回退 `this.serverProcess.kill()` —— **无 taskkill 分支**                                                                                                                                    | **F3 / BL-1**：`restartServer`（funasrManager.ts:143）走这里，Windows 上可能留下孤儿 Python 进程树                                    |
| `src/helpers/funasrServer.ts:283-318` `_handleServerCrash`                                                | 直接 `serverProcess=null` 后重启，**不先 kill 旧进程**（ping 超时=进程僵死而非退出时，两平台都会泄漏进程；Windows 更糟：树）                                                                               | **F3 / BL-1 原文对应点**                                                                                                              |
| `src/helpers/funasrServer.ts:239-245`                                                                     | 启动 120s 超时后 `serverProcess.kill()`（裸 kill，无树杀）                                                                                                                                                 | F3 次要                                                                                                                               |
| `src/helpers/pythonEnvironment.ts:66-80` `getEmbeddedPythonPath`                                          | dev 与 prod 都只解析 `python/bin/python3.11`（macOS 布局）                                                                                                                                                 | **全特性前置风险**：与 `scripts/prepare-embedded-python.js:30-34` 的 Windows 布局 `python/python.exe` **不一致**（见 B-0）            |
| `src/helpers/pythonEnvironment.ts:89-93 / 122-126`                                                        | `PYTHONPATH` 拼接，pathSep `;` vs `:`                                                                                                                                                                      | F3：重载/重启复用同一 env 构造，安全                                                                                                  |
| `src/helpers/pythonEnvironment.ts:110-115`                                                                | `env.PYTHONUTF8 = "1"`，注释明确记录 Windows GBK/CP936 中文路径乱码（"新录音"→"閲戝瓟锟絓…"）及修复                                                                                                        | **F5 编码基线**：中文经 stdin/stdout 协议在 Windows 已被证明可用                                                                      |
| `src/helpers/pythonEnvironment.ts:186-204`                                                                | dev 回退路径表：`.venv/bin/*`（POSIX）与 `.venv/Scripts/python.exe`（win）混列 + 绝对 POSIX 路径                                                                                                           | 仅 dev 模式                                                                                                                           |
| `src/helpers/pythonInstaller.ts:384-400`                                                                  | `installPython` 按 darwin/win32/linux 分派三套安装流程                                                                                                                                                     | 无（嵌入式优先，不走安装器）                                                                                                          |
| `src/helpers/pythonInstaller.ts:411-418`                                                                  | `isPythonInstalled` 仅 darwin 追加额外路径                                                                                                                                                                 | 无                                                                                                                                    |
| `src/helpers/environment.ts:64-77` `getDataDirectory`                                                     | win32 `%USERPROFILE%\AppData\Roaming\Murmur`；darwin `~/Library/Application Support/Murmur`                                                                                                                | 无直接关联（日志/数据目录）                                                                                                           |
| `src/helpers/modelManager.ts:100-168` `getModelCachePath`                                                 | 候选：dev `models/` → `userData/models` → `~/.cache/modelscope/hub/models`；识别条件是目录前缀 `speech_paraformer`/`speech_fsmn`/`punc_ct`（143-150）                                                      | **F5 硬风险**：SeACo 仓库名以 `speech_seaco_` 开头，不匹配 `speech_paraformer` 前缀 → 换模型后缓存探测失效（平台无关但必须写进 spec） |
| `src/helpers/audioFileHelpers.ts:27`                                                                      | ffmpeg 探测 `where` vs `which`                                                                                                                                                                             | F1 弱相关（`convertAudioFile` 标注为"预留 fallback"，101 行注释）                                                                     |
| `src/helpers/audioFileHelpers.ts:56-91` `createTempAudioFile`                                             | `os.tmpdir()` + `crypto.randomUUID()` + `fs.promises.writeFile`，扩展名固定 `.wav`                                                                                                                         | F1：麦克风路径的临时 WAV 落点，跨平台安全                                                                                             |
| `src/helpers/audioPathValidator.ts:40-44`                                                                 | win32 在任何 fs 调用前拒绝 UNC `\\server\share`（防 13s 网络超时，CHANGELOG PR #133）                                                                                                                      | F1/F2：TRANSCRIBE_FILE handler 入口已调用（transcriptionHandlers.ts:144），清洗器接缝在它之后                                         |
| `src/helpers/tray.ts:89`、`src/helpers/clipboard.ts:54-68,216`、`src/helpers/ipc/systemHandlers.ts:73,95` | darwin template 图标 / osascript vs PowerShell 粘贴 / macOS 辅助功能                                                                                                                                       | 与 5 特性无关                                                                                                                         |
| `src/helpers/updateManager.ts:61,164`                                                                     | 资产扩展名 `.dmg` vs `.exe`                                                                                                                                                                                | 无                                                                                                                                    |
| `src/helpers/logManager.ts:213`                                                                           | 日志带 `platform` 字段                                                                                                                                                                                     | F4：线程数日志可复用此结构                                                                                                            |

### scripts/

| 位置                                             | 用途                                                                                                                                                                                                                    | 关联特性 / 风险                                                                      |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `scripts/prepare-embedded-python.js:26-59`       | 平台 getter：win32→`python.exe`+`Lib/site-packages`+`PATH` 注入；darwin→`bin/python3.11`+`lib/python3.11/site-packages`+`DYLD/LD_LIBRARY_PATH`；`downloadPlatform`：`pc-windows-msvc-shared` vs `apple-darwin`（43-44） | **B-0 的另一半**：打包侧已支持 Windows，运行侧没有                                   |
| `scripts/prepare-embedded-python.js:197-208`     | 构建 env 含 `PYTHONIOENCODING:"utf-8"`、`PYTHONUNBUFFERED:"1"` —— 仅构建期，不进运行时                                                                                                                                  | F5：运行时靠 `PYTHONUTF8=1`，不冲突                                                  |
| `scripts/prepare-embedded-python.js:229-236`     | 依赖表：`numpy<2`、torch 2.0.1 系、librosa≥0.11、funasr≥1.2.7（`--only-binary=all` 装 wheel，249 行）                                                                                                                   | F1：numpy/soundfile 双平台经 wheel 分发（见 B-F1）                                   |
| `scripts/test-embedded-python.js:8`              | **硬编码 `bin/python3.11`**（macOS 布局）                                                                                                                                                                               | **Python 单测挂载点风险**：新 numpy 单测脚本若照抄此文件，Windows 上直接找不到解释器 |
| `scripts/diagnostics/test_text_insertion.js:207` | 非 darwin 跳过                                                                                                                                                                                                          | 无                                                                                   |

### tests/（现有平台测试模式）

| 位置                                                                                                                          | 模式                                                                                           | 说明                                     |
| ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `tests/unit/funasrServer-spawn.test.ts:209`                                                                                   | `it.skipIf(process.platform === "win32")`                                                      | SIGKILL 强杀用例只在非 Windows 跑        |
| `tests/unit/audioPathValidator-symlink.test.ts:34,57`                                                                         | `it.skipIf(...win32)` + 顶部 early-return                                                      | symlink 逃逸（POSIX 语义）跳过 Windows   |
| `tests/unit/regression-session-fixes.test.ts:777`                                                                             | 按平台选 badPath：win32 用 `\\unc-server\share\file.wav`，否则 `/opt/secret/file.wav`          | **双平台同测的既有范式**                 |
| `tests/unit/funasrServer-branches.test.ts:374-393`                                                                            | `setPlatform("win32")` mock（改 `process.platform` 后还原）                                    | taskkill 分支可在任意平台驱动            |
| `tests/unit/pythonInstaller.test.ts:105,739-756`                                                                              | `setPlatform()` mock 分派测试                                                                  | 同上                                     |
| `tests/unit/windows-compat.test.ts:62-100`                                                                                    | **源码契约测试**：断言 gracefulShutdown 源码含 `taskkill`/`/T`/`/F`/`/PID`/`win32`/`spawnSync` | 修改 kill 路径时必须同步更新，否则 CI 红 |
| `tests/unit/environment.test.ts:173-182`、`audioPathValidator-branches.test.ts:35`、`updateManager-behavioral.test.ts:77-133` | setPlatform 双平台路径断言                                                                     | 范式可复用                               |
| `tests/e2e/helpers/electron-launch.ts:63`                                                                                     | 打印 `platform/arch/node` 诊断                                                                 | 无                                       |

**重要负发现**：ADR-013（`docs/adr/013-platform-helper.md`）规划了 `src/helpers/platform.js` 收敛模块（含 `killTree(pid)` 设计，ADR:81、184），**但该文件不存在**（`src/helpers/` 目录无 platform.ts/js）。spec v2 不得假设存在统一平台抽象；`killTree` 若要复用需按 ADR-013 先落地或直接抽取 funasrServer.ts:358-365 的现有片段。

---

## B) 分特性平台风险清单（含证据）

### B-0（前置阻断）：Windows 生产环境的 Python 解析与打包布局不一致

- 运行时只认 `python/bin/python3.11`（pythonEnvironment.ts:66-80）；打包脚本在 Windows 产出 `python/python.exe` + `Lib/site-packages`（prepare-embedded-python.js:30-39）。src/ 中除 `.venv/Scripts/python.exe` dev 回退外**无任何 `python.exe` 引用**（全仓 grep 证实）。
- 且 `build.yml:224-226` 的 Windows "Prepare embedded Python" 步骤带 `continue-on-error: true`（注释：torch/funasr pip 可能超 CI 时限/磁盘）→ **Windows 安装包可能根本没带 Python 环境且构建仍绿**。
- 后果：5 个特性全部跑在 Python 子进程上；Windows 生产模式 `findPythonExecutable()` 会走到 pythonEnvironment.ts:171-173 直接抛"嵌入式Python环境不可用"。idle-unload 的 reload 也用同一解析路径（funasrManager.ts:159）。
- UNVERIFIED：是否有仓库外的 Windows 手工部署流程弥补此差异；仅能确认代码面不一致。

### B-1（F1：numpy 前处理）

- 依赖分发：numpy 实际代码为 1.26.4（`python/lib/python3.11/site-packages/numpy/version.py:2`），但 site-packages 同时存在 `numpy-1.26.4.dist-info` 与 `numpy-2.4.6.dist-info`（目录列表证实）——pip 元数据污染，源于 prepare-embedded-python.js:243-251 的 `--force-reinstall --no-deps` + `--only-binary=all` 双次安装。`verifyDependencies()`（275-293）只 `import` 不查版本，拦不住。**两平台同一脚本，同一风险**。
- soundfile：macOS 嵌入环境带 `_soundfile_data/libsndfile_arm64.dylib`（目录列表证实）；Windows 侧依赖 wheel 自带 `libsndfile.dll`（soundfile PyPI 标准行为），因 `--only-binary=all` 应同样成立 —— **UNVERIFIED**（本仓 `python/` 是 macOS 构建产物，无法直接验证 Windows 布局；且 build-win 该步骤 continue-on-error）。
- FLAC 直通（funasr_server.py:812-813）之后接 DSP 需重写 WAV：现清理逻辑只 unlink `was_converted` 的文件（797-802），若对 wav/flac 直通文件新增"重写临时 WAV"，必须把新临时文件纳入 finally 清理，否则 `%TEMP%` 泄漏（Windows 上文件被占用时 unlink 会失败——现有代码先 `close()` 再删，630-635/820-825，模式正确，照抄即可）。
- 麦克风路径输入：渲染端已把录音转成 16kHz mono WAV PCM 再发主进程（useRecording.ts:385-397 `AudioContext({sampleRate:16000})` + 手写 WAV 头 425-450），主进程原样落盘 `.wav`（audioFileHelpers.ts:60-79），Python `transcribe_audio`（funasr_server.py:339-437）**当前不做任何转换**直接喂 `generate()`（373）——新 load→DSP→rewrite 用 soundfile 即可，输入格式两平台一致。
- 平台差异结论：numpy/soundfile 数值与 I/O 行为一致（同一 wheel 生态）；风险全在依赖打包完整性（B-0 连带）与临时文件清理，不在 DSP 算法本身。

### B-2（F2：TS 文本清洗器）

- 两个接缝：`src/helpers/ipc/transcriptionHandlers.ts:75-80`（`C.TRANSCRIPTION.AUDIO` → `funasrManager.transcribeAudio`）与 `141-175`（`C.TRANSCRIPTION.TRANSCRIBE_FILE` → `transcribeFile` + 入库 155-171）。纯 TS 字符串处理，**无任何平台依赖**；Unicode 正则两平台 V8 行为一致。唯一注意点：TRANSCRIBE_FILE 入口在清洗器之前有 `validateAudioPath`（144 行），其中 win32 UNC 拒绝（audioPathValidator.ts:40-44）不改文本流。无平台风险。

### B-3（F3：空闲卸载 + 重载）

- 协议阻塞（已知 blocker 的平台放大）：Python 主循环 `run()` 是同步 `sys.stdin.readline()` 派发（funasr_server.py:1120-1196），mic 路径 `transcribe` 在主线程内联执行（1143-1146）；模型（重）加载在 `initialize()` 内起 3 线程并行、`join(timeout=300)`（262-297）。若 reload 在主循环内联做，stdin 无人读 → TS 侧健康监控 30s ping + 5s 超时（funasrServer.ts:255-273）判死并走 `_handleServerCrash`。该行为两平台相同，但 Windows 上叠加下一条会被放大。
- Windows 重载更慢：仓库内唯一证据是 `docs/research/spec-p0-adversarial-review.md:66`（"Windows HDD + Defender 可能放大一个数量级——需双平台 P50/P95 实测"）；本地热缓存数据点 `scripts/benchmark_results.json` `load_time_s: 2.75`（另一条 27.79）。代码/CHANGELOG 中无 Defender 直接记录。
- 进程语义：若实现选择"卸载=退出进程、重载=重启"，Windows 必须 taskkill 树杀（现有注释 funasrServer.ts:355-357 + windows-compat.test.ts:62-100 契约锁定）；`_stopFunASRServer`（327-341）与 `_handleServerCrash`（283-318）目前都缺树杀 —— 这就是 review BL-1"crash handler 先杀旧进程"要补的点。**仓库无 Windows Job Object 代码**（全仓 grep 无），既有约定是 `taskkill /T /F`。
- macOS 内存不归还：`_cleanup_memory()` 仅 `gc.collect()`（funasr_server.py:844-852），仓库无 malloc/allocator 相关注释 —— **UNVERIFIED**，spec 必须以实测 RSS 为准（且注意下条：psutil 缺失，测量手段要先解决）。
- **psutil 缺失（横切）**：`funasr_server.py:948` `import psutil`（diarize 内存检查），但 psutil 不在 pyproject.toml、不在 uv.lock、不在 prepare-embedded-python.js:229-236 依赖表、不在嵌入式 site-packages（目录列表 grep=0）——diarize 现状是潜伏 ImportError（`diarize_audio` 只 catch RuntimeError，986-988）。F3 若要用 psutil 报内存、F4 若要用 `psutil.cpu_count(logical=False)`，必须先把 psutil 加进三处依赖清单（pyproject/uv.lock/prepare 脚本），否则两平台一起坏。

### B-4（F4：线程自适应）

- 现状：`funasr_server.py:96-105` `_setup_runtime_environment` 仅 `os.environ["OMP_NUM_THREADS"]="4"`（在 `__init__` 94 行调用，早于 torch/模型加载，故 env 方式当前有效）；无 `torch.set_num_threads`、无 MKL_THREAD_LAYER、无 `os.cpu_count` 使用（全仓 grep 证实）。
- `os.cpu_count()` 语义：两平台都返回**逻辑核**（Windows 含 SMT；Apple Silicon 含 P+E 核）。Python stdlib 无物理核 API；spec 公式 `max(1, cores/2 + 2)` 基于逻辑核在两平台语义一致，可行——但要写明"逻辑核"以止争。
- OMP/MKL 差异：Windows torch 2.0.1 x64 走 MKL（受 `MKL_NUM_THREADS` 影响），macOS arm64 走 Accelerate/vecLib（不吃 MKL env）。只设 `torch.set_num_threads` 是唯一两平台同构的收敛点；若保留 env 方式需在 torch import 前设置（现状满足：102 行早于 116 行 `import torch`）。仓库无既有 MKL 调优证据（grep 无）。
- 覆盖模式先例：`MURMUR_DEVICE`（funasr_server.py:89，ADR-006）—— 环境变量覆盖有现成模式可抄。

### B-5（F5：热词）

- 编码：中文经协议已被证明在 Windows 可用——`PYTHONUTF8=1`（pythonEnvironment.ts:110-115，注释含 GBK/CP936 乱码实例）；历史修复记录 CHANGELOG:158、169（"新录音.m4a" CJK 路径乱码，已修）；`docs/promotion/screenshots/README.md:23`（"Windows 中文文件名乱码 bug…已修复（PYTHONUTF8）"）。Python 侧写出全部 `json.dumps(ensure_ascii=False)` + `sys.stdout.flush()`（936、1111、1135、1177、1188），读 `sys.stdin.readline()`（1123）；Node 侧 `stdin.write(JSON.stringify(...)+"\n")`（serverMessageRouter.ts:119、150，Node 默认写 UTF-8 字节），读侧 `data.toString()` 默认 utf8（serverMessageRouter.ts:53）。热词串沿用 `options.hotword` 字段零新增编码面。
- 透传半成品：Python 端 `generate(hotword=...)` 两个路径都已接（funasr_server.py:356/376 mic、445/642/718 file），默认空串；**TS 侧今天从不发送 hotword**（src/ 全仓 grep 无 hotword 引用）。spec 的"主进程注入 options.hotword"是全新 TS 代码。
- 设置存储：`settingsHandlers.ts:77/85/103` 走 `databaseManager.getSetting/setSetting`（SQLite settings 表）；safeStorage 只用于需要加密的值（database.ts:95-121，不可用时回退明文），热词是普通字符串不受 DPAPI/Keychain 差异影响；database.ts 内无平台分支。spec 还要求同步 `SettingsState/DEFAULT_SETTINGS/ALLOWED_SETTING_KEYS` 等（spec 已列）。
- 模型切换的三处同步点（平台无关但必须写进 spec，否则两平台一起坏）：`funasr_server.py:1075-1079`（run() 的 repos 检查）+ `:191`（ASR AutoModel 名）；`src/helpers/modelManager.ts:55-70`（modelConfigs）+ `:143-150`（**前缀匹配 `speech_paraformer`/`speech_fsmn`/`punc_ct`——SeACo 目录名不匹配，必须同步改**）；`download_models.py:44-56`（模型下载表）。

### B-6（F6 范畴：CI / 打包矩阵）

- `ci.yml:13-14`：**lint-and-test 仅 `macos-latest`** —— 单测（vitest）从不跑 Windows。e2e 全部 `continue-on-error`（99-126）。
- `build.yml:13-14`：发布前 test job 也仅 macOS；`build-mac`（52）与 `build-win`（172）各自打包，两者都有：Electron ABI 门禁（88-91 / 215-220）、preload 存在门禁（109-111 / 237-239）、**打包后真实安装+启动冒烟**（mac: 129-156，DMG 挂载启动查日志里程碑；win: 257-292，NSIS 静默安装 `/S` 到 `%LOCALAPPDATA%\Programs\murmur`，pwsh 查 `%APPDATA%\Murmur\logs\app.log` 里程碑）。
- 但 build-win 的 Python 准备步骤 `continue-on-error: true`（226）→ 冒烟只验"boot + preload bridge"，**不验 Python/ASR 链路**；冒烟里程碑（'主窗口创建成功' 等，283 行）不含模型/转录。
- Python 单测挂载点：`package.json` 现有 `test:python`（scripts/test-embedded-python.js，**macOS 硬编码路径**）。双平台需要新 runner 脚本（按 platform 选 `python.exe` vs `bin/python3.11`）且 ci.yml 需加 windows matrix —— 现状完全没有。
- CONTRIBUTING.md:134 只记录 ABI 门禁；无"双平台手测"要求（14 行仅列支持平台）。

### B-7（音频采集面）

- `useRecording.ts:92-107`：`getUserMedia({audio:{sampleRate:16000}})` + `MediaRecorder mimeType:"audio/webm;codecs=opus"`（107/126）——两平台 Chromium 实现一致；最终以 `convertToWav`（385-450）经 `AudioContext({sampleRate:16000})` 重采样到 16k WAV PCM，**设备原生采样率差异（mac 48k / win 44.1k 或 48k）被渲染端统一抹平**，Python 端看到的两平台输入同构。无平台分支（useRecording.ts 无 process.platform —— 渲染进程也不可用它）。

### B-8（历史教训，CHANGELOG/docs）

- v1.2.0 Windows 启动崩溃 #157：`file-uri-to-path` 缺失（CHANGELOG:26）；v1.3.0 macOS ABI 崩溃（CHANGELOG:20）；v1.0.0-v1.3.1 全平台 preload 缺失（CHANGELOG:14）→ 教训：**两平台安装包的"真实启动冒烟"门禁是新特性的最低验收线**。
- UNC 网络超时 PR#133（CHANGELOG:47）；Windows 中文路径乱码（CHANGELOG:169）；`PYTHONUTF8=1`（CHANGELOG:158）；Windows pnpm postinstall 无法 exec pnpm.mjs → hoisted + ignore-scripts（build.yml:191-206）；测试平台差异已用 `it.skipIf` 处理（CHANGELOG:49）。
- ADR-011（quick-experience-mode）：`minimum_ready`（ASR+VAD 必需、punc 可选并行）语义 —— F3 重载要复用的正是这套（modelManager `minimum_ready` 字段 + funasr_server repos/required_repos 1080 行）。
- ADR-012（known-limitations）只涉噪声鲁棒性，无平台条目。

---

## C) Spec v2 必须写入的平台决策（要求 + 理由 + 证据）

1. **[前置] 统一嵌入式 Python 路径解析（win32 `python/python.exe` + `Lib/site-packages`）**
   `pythonEnvironment.ts` 的 `getEmbeddedPythonPath`/`setupIsolatedEnvironment`/`buildPythonEnvironment` 增加平台分支（或落地 ADR-013 的 platform helper）；否则 5 特性在 Windows 生产模式全数无法验证。
   证据：pythonEnvironment.ts:66-80 vs prepare-embedded-python.js:30-39；src 无 python.exe 引用（grep）。

2. **[前置] build-win 的 Python 准备步骤不得 continue-on-error；新增 Windows Python 冒烟**
   至少断言 `python.exe -c "import numpy, soundfile, funasr"` 通过才允许打包；spec 的 Python 单测门禁同理。
   证据：build.yml:224-226；prepare-embedded-python.js:275-293 已有 verifyDependencies 范式。

3. **F3：任何"杀 Python 进程"的路径统一走树杀**
   抽取 funasrServer.ts:358-365 的 `spawnSync taskkill /T /F /PID`（win32）/ `SIGKILL`（其他）为单一 killTree 函数，`_stopFunASRServer`、`_handleServerCrash`、启动超时（242）全部改用它；重载/崩溃恢复前必须先 await killTree 完成（spawnSync 阻塞语义已由 windows-compat.test.ts:81-100 契约锁定，改动需同步该测试）。不引入 Windows Job Object（仓库无先例，taskkill 模式已被冒烟与单测双锁定）。
   理由：BL-1；Windows `proc.kill()` 不杀子树（funasrServer.ts:355-357 注释原文）。

4. **F3：reload 不得在 Python 主循环内联执行**
   卸载/重载动效需保证 stdin 仍被读取（复用现有 request_queue 推理线程模式，funasr_server.py:894-929，或 unload 后由 TS 端重启进程）。健康监控 30s ping + 5s 超时（funasrServer.ts:255-273）在重载窗口内必须暂停或放宽，否则重载被误判为 crash 触发 `_handleServerCrash`。
   证据：funasr_server.py:1120-1196 同步循环 + 262-297 加载 join(300s)。

5. **F3：重载时长文案与超时按平台实测分档**
   Windows（Defender/磁盘）重载可能比 macOS 热缓存 2.75s 大一个数量级；spec 应写"双平台 P50/P95 实测后再定提示秒数"，重载宽限期不得复用 120s 启动超时一刀切。
   证据：spec-p0-adversarial-review.md:66；benchmark_results.json `load_time_s:2.75/27.79`；UNVERIFIED 实际 Windows 数值。

6. **F3/F4：psutil 缺失必须显式决策**
   若 unload 需上报内存、或线程公式需物理核：把 psutil 加入 pyproject.toml + uv.lock + prepare-embedded-python.js 依赖表（三处同步）；否则明令"禁用 psutil，用 os.cpu_count()（逻辑核）+ 标准库"。现状 funasr_server.py:948 的 import psutil 是潜伏 bug，spec 应顺手修复（加依赖或 try/except 降级）。
   证据：pyproject.toml dependencies、uv.lock（无 psutil 条目）、embedded site-packages 目录（无 psutil）。

7. **F4：线程收敛点 = `torch.set_num_threads`（两平台同构），核数语义写明"逻辑核"**
   保留/替换 OMP_NUM_THREADS 时必须在 torch 首次 import 前设置（现 funasr_server.py:102 在 `_detect_device` import torch 之前成立，改造需保持此顺序）；env 覆盖沿用 MURMUR_DEVICE 模式（ADR-006）。Windows MKL 与 macOS Accelerate 后端差异意味着"只设 OMP env"在 mac 无意义、在 win 不充分。
   证据：funasr_server.py:96-125；grep 无 MKL/现有 set_num_threads。

8. **F5：热词/中文串走 JSON 协议不需要新增编码处理，但禁止绕过 `buildPythonEnvironment()`**
   新 spawn/重启路径（F3 会新增）必须复用带 `PYTHONUTF8=1` 的 env 构造；spec 写为硬约束 + 单测断言 env 含 PYTHONUTF8=1（现有测试先例 docs/research/deep-test-design-managers.md:1107-1112）。
   证据：pythonEnvironment.ts:110-115；CHANGELOG:158/169。

9. **F5：模型切换的四处同步清单（含前缀匹配）**
   funasr_server.py:1075-1079、funasr_server.py:191、modelManager.ts:55-70、modelManager.ts:143-150（前缀列表加 `speech_seaco`）、download_models.py:44-56。缓存迁移（用户故事 22）按 ADR-011 minimum_ready 语义扩展。
   证据：见 B-5。

10. **F1：DSP 临时文件遵循现有 close→unlink 模式；直通 wav/flac 重写后的新临时文件纳入 finally 清理**
    理由：Windows 上打开中的文件 unlink 失败；现有 `_convert_to_wav`/chunk 模式（funasr_server.py:630-636、820-826、797-802）是正确范式。
    证据：同左。

11. **测试矩阵：单测 CI 加 windows runner；Python 单测 runner 双平台化**
    新 Python 测试脚本不得照抄 `scripts/test-embedded-python.js:8` 的硬编码路径；ci.yml 的 lint-and-test 增加 `matrix: [macos-latest, windows-latest]`（或至少为 vitest 与 python 测试加 win job）。TS 平台分支测试沿用 `setPlatform`（funasrServer-branches.test.ts:374-393）与 `it.skipIf`（funasrServer-spawn.test.ts:209）既有范式；双平台输入差异用 regression-session-fixes.test.ts:777 的按平台选路径范式。
    证据：ci.yml:14 仅 macos；CHANGELOG:49。

12. **发布门禁：两平台打包冒烟需升级为"含 Python 链路"的最小断言**
    现有冒烟（build.yml:129-156 / 257-292）只验 boot+preload；spec 应要求至少 mac/win 各一条"embedded python 启动 + ping/pong"断言（可写入 app.log 里程碑），否则 B-0 类问题永远到不了门禁。
    证据：build.yml 冒烟里程碑清单 144/283 行不含 Python。

---

## D) 已确认跨平台安全（不要臆造问题）

1. **spawn 选项**：`stdio` 全 pipe、`windowsHide:true`、不用 `shell`、不依赖 `cwd`（funasrServer.ts:155-163）——两平台一致。
2. **gracefulShutdown（仅退出路径）**：win32 taskkill 树杀 + 其他平台 SIGKILL，已实现且有源码契约测试（funasrServer.ts:343-381；windows-compat.test.ts:62-100）。
3. **中文经 stdin/stdout 协议**：`PYTHONUTF8=1` + `json.dumps(ensure_ascii=False)` + Node 默认 UTF-8，Windows 已被线上修复记录证明（pythonEnvironment.ts:110-115；CHANGELOG:158/169；funasr_server.py:936/1111/1123）。
4. **Python 文件路径构造**：funasr_server.py 全部 `os.path.join`/`os.path.expanduser("~")`/`tempfile.gettempdir()`，无硬编码 `/` 拼接（grep 证实；仅 argparse help 文案里有一个示例路径）；`--damo-root` 由 TS 传入（funasrServer.ts:157），Windows 反斜杠经 JSON 传输无碍。
5. **模型缓存路径**：TS 侧 `userData/models` 优先（Electron `app.getPath` 跨平台），回退 `~/.cache/modelscope`（modelManager.ts:100-168）与 Python `_default_damo_root`（funasr_server.py:1058-1070）语义一致；`os.homedir()` 在 Windows 即 `%USERPROFILE%`。仓库不设置 `MODELSCOPE_CACHE`/`DAMO_ROOT` env（grep 为空），Python 侧仅作可选回退。
6. **日志编码**：`logging.FileHandler(..., encoding="utf-8")`（funasr_server.py:46）；`ELECTRON_USER_DATA` 由 Electron `app.getPath("userData")` 注入（main.ts:134）——两平台同构。
7. **音频扩展名白名单**：TS `AUDIO_EXTENSIONS`（ipc-contracts.ts:131-）与 Python `ALLOWED_EXTENSIONS`（funasr_server.py:127）当前一致（spec 改动时保持同步即可）。
8. **文本清洗器（F2）**：两接缝（transcriptionHandlers.ts:75-80、141-175）纯 TS 字符串处理，无平台分支需求。
9. **麦克风输入格式**：渲染端已统一转 16kHz mono WAV PCM（useRecording.ts:385-450），设备原生采样率差异被抹平；Python 收到的两平台输入同构。
10. **uv.lock**：含 win_amd64 wheels（116 处 win 标记）——锁文件本身是跨平台解析的。
11. **Windows 侧已知且已修的坑位**（UNC 拒绝、where/which、LOCALAPPDATA PATH、pnpm postinstall、中文路径乱码）均有现成分支与测试，spec 不需要重复设计。

**关键 UNVERIFIED 项汇总**：(a) Windows 嵌入式环境是否真的随安装包分发（build.yml:226 continue-on-error + B-0 代码不一致）；(b) Windows 嵌入环境内 soundfile/libsndfile.dll 与 numpy 实际版本；(c) Windows Defender 下模型重载实测时长；(d) macOS 卸载后 RSS 是否实际回落（无仓库证据，需实测）；(e) psutil 在任何已发布 Windows 包中是否存在。
