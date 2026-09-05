# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **数据库引擎迁移到 node:sqlite(根治 ABI 状态机)**(spec #226):`better-sqlite3`(dependencies 中唯一的原生插件)被 Node ≥22.5 / Electron 39 内置的 `node:sqlite` 取代。历史上所有"测试后 dev 起不来 / dev 后测试红 / v1.3.0 打包崩"的事故共享同一根因——磁盘上一份 `better_sqlite3.node` 要在系统 Node 与 Electron 两个 ABI 间人工翻面,且翻面工具会静默跳过。引擎内置后该类问题结构性消失:`predev`/`pretest`/`postinstall` 的 rebuild 链与 `scripts/check-native-abi.js` 删除,发版门禁的 native ABI 门等价改写为 node:sqlite 真实开库门(不降级)。行为不变:同 schema、同 WAL、同 safeStorage 加密语义;1661 用例零 ABI 翻面全绿。注意:Node 22.5+ 成为运行与构建的硬要求。

- **bloub 吉祥物**:标题栏新增会动的 Bot 头像(spec #224,决策过程见 wayfinder 总图 #217)。移植自 [bloub](https://github.com/jeremy-prt/bloub)(MIT,`src/bot/` 引擎零框架、纯时间函数,测量常数逐帧取自参考视频、零漂移校验)。吉祥物按应用状态变形:待机呼吸、录音睁眼、识别思考点、润色/模型下载/文件转写旋环、错误分级惊叹号;复制成功眨眼、转写完成彗星;指针停留窗内时眼神缓慢轮换六枚零滚轮心情、离窗即回设置表情(#227)。设置窗新增「Bot」区,可自选 8 形状/12 颜色(默认跟随明暗主题)/16 表情。设置键 `bot_shape`/`bot_color`/`bot_expression`。注意:本特性与已移除的旧视觉特效系统(ogl/motion)无关,不依赖也不重启该栈。

## [1.4.0] - 2026-08-20

### Fixed

- **v1.3.2 的 Windows 与 macOS 安装包均无法下载模型、无法转写**（issues #176 #196，spec #177 B-0）：两个独立打包缺陷。Windows：运行时在所有平台都按 macOS 布局（`python/bin/python3.11`）查找嵌入式 Python，而 Windows 包内的实际布局是 `python/python.exe`——路径永远对不上，应用始终报"嵌入式Python环境不可用"。macOS：Python 二进制位于 `app.asar` 归档内部，应用能"看到"但操作系统无法执行归档内的二进制，FunASR 服务器进程永远起不来（报"FunASR服务器未就绪"）。修复（PR #178）：运行时按平台解析正确布局，生产环境改从 `app.asar.unpacked` 真实文件路径加载。同时硬化构建流水线（PR #184）：嵌入式 Python 环境准备从 Windows 侧的静默容错（`continue-on-error`，正是它让 v1.2.0–v1.3.2 的 Windows 包静默缺 Python 而构建全绿）改为双平台硬性步骤并配缓存，打包前必须用该环境真实 import numpy/soundfile/funasr，打包后在 CI 真实安装启动 mac DMG 与 Windows EXE 并验证 Python 链路。**请 v1.3.2 及更早版本的用户升级本版本。**
- **模型加载成功后 FunASR 服务器进程崩溃**（PR #207）：三个模型加载器在并行线程中各自使用 `suppress_stdout()`（临时把 stdout 指向 devnull，防止 FunASR 库的非 JSON 输出污染协议通道），但其保存/恢复是无锁的按线程操作——多线程同时在抑制窗口内时，交错恢复会让 `sys.stdout` 指向一个已被其他线程关闭的 devnull，模型全部加载成功后的协议输出随即抛 `ValueError: I/O operation on closed file`，服务器进程退出（用户表现为转写时报"FunASR服务器未就绪"，重启 3 次耗尽）。该竞态自并行加载引入（2025-09）起潜伏，仅在磁盘上已有模型的机器上触发，CI runner 无模型故从未拦截。修复为锁 + 引用计数的全局抑制，模型加载并行度不变；双平台打包启动冒烟的致命模式列表同时加入 `Unhandled Rejection`。

### Added

- **热词支持**（PR #199 #200，spec #177 T13-T15）：设置 → 通用 → 热词，每行一个（上限 200 行、每行 32 字），识别时自动注入，提升同事姓名、产品名等生僻专名的命中率（实测：张含月→张晗玥）。若热词导致识别失败会自动去除热词重试并提示检查配置。配套将默认 ASR 模型切换为支持热词的 SeACo-Paraformer（见下）。
- **空闲自动卸载模型 + 快捷键预热**（PR #201 #202，spec #177 T11-T12）：转写结束后约 5 分钟无活动自动卸载模型释放内存（约 2GB 级）；下次按下录音快捷键时自动在后台重载，等待期间界面明确显示模型未就绪而非静默失败。

### Changed

- **默认 ASR 模型切换为 SeACo-Paraformer**（PR #200）：热词能力版 Paraformer-large（`speech_seaco_paraformer_large_asr_nat-zh-cn-16k-common-vocab8404-pytorch`，约 950MB），标准测试集零识别回归；本地已有旧模型而未下载新模型时自动回退旧模型，不会静默触发大体积下载。
- **音频预处理提升困难场景识别**（PR #194，spec #177 T6-T7）：转写前自动做 80Hz 高通滤波（抑制低频嗡嗡声/风噪）与分段响度归一化（近静音直通、峰值限幅保护），麦克风录音与文件导入两条路径均生效。
- **转写文本清洗**（PR #194，spec #177 T9-T10）：折叠 ASR 幻觉式的连续重复字符（≥6 连续折叠至 3）与连续重复短语（≥3 次折叠），带标点边界保护与数字豁免（电话号、长数字串不折叠）；清洗前的原文完整保留在记录的 raw_text 字段中。
- **推理线程自适应与并行加载**（PR #194 #198，spec #177 T8）：推理线程数按逻辑核数自适应（`min(max(1, 核数-2), 8)`）——多核机器转写更快，小核机器为界面留出余量不再卡顿；ASR/VAD/标点三个模型并行加载，启动显著加快。
- **进程清理与双平台 CI**（PR #194，spec #177 T2 T4）：退出时统一按进程树终止 Python 子进程（Windows `taskkill /T /F`），不再残留孤儿进程；CI 升级为 Windows + macOS 双平台矩阵运行全部测试。

## [1.3.2] - 2026-08-16

### Fixed

- **所有历史安装包缺少 preload 脚本**（v1.0.0 → v1.3.1 均受影响）：Build Installers 流水线的 build-mac/build-win 两个 job 从未执行 `build:preload`，打出的 app.asar 里没有 `dist-preload/preload.js`。安装后主进程能启动、窗口能创建，但渲染进程拿不到 Electron API，界面弹出「Electron API 不可用 / preload 脚本加载失败，主功能均无法工作」，全部功能不可用。此前无人报告的原因：v1.2.0 的 Windows 包在更早的启动阶段就崩溃（#157），mac 用户基数小。修复：两个构建 job 补上 `build:preload`，并新增打包门禁 —— `dist-preload/preload.js` 不存在则拒绝打包（electron-builder 的 files 通配会静默跳过缺失文件，这正是问题长期潜伏的机制）。**请所有用户升级到 v1.3.2；v1.3.1 及更早版本均不可用。**

## [1.3.1] - 2026-08-16

### Fixed

- **v1.3.0 的 macOS 安装包启动崩溃**：v1.3.0 的 dmg 内 `better_sqlite3.node` 是按系统 Node ABI 137 编译的（Electron 39 需要 ABI 140），首次 `new Database()` 即抛 `NODE_MODULE_VERSION` 不匹配，主窗口无法打开。根因：CI 上 pnpm 的 `onlyBuiltDependencies` 白名单允许 better-sqlite3 在安装时下载系统 Node 的预编译产物，而随后的 `electron-builder install-app-deps` 重建是约 0.2 秒的静默 no-op，从未替换成 Electron ABI 版本。修复：mac 构建 job 改为 `npx @electron/rebuild -f -w better-sqlite3` 强制真实重建；mac/win 两个 job 在打包前新增 ABI 门禁 —— 必须在 Electron 运行时下真实打开一次 SQLite 内存库才能继续打包。**v1.3.0 的 macOS dmg 不可用，请 macOS 用户改装 v1.3.1**（v1.3.0 的 Windows 安装包经核实 ABI 正确，不受影响）。

## [1.3.0] - 2026-08-16

### Fixed

- **Windows 安装包启动崩溃**（Issue #157）：打包后的 Windows 应用启动即报 `Cannot find module 'file-uri-to-path'`、GUI 无法打开 —— pnpm 依赖布局下 electron-builder 把 `bindings` 打进了 app.asar 却漏掉其运行时依赖。已将 `file-uri-to-path@1.0.0` 声明为直接生产依赖并加回归测试锁定（修复方案来自 @LauraGPT 的 PR #158，因 lockfile 冲突在 main 上重放）。v1.2.0 的 Windows 用户请升级本版本。
- **AI 润色失败只显示通用错误**（PR #164）：真实失败原因（如推理模型把全部 `max_tokens` 预算耗在 reasoning tokens 上导致正文为空）在上报前被丢弃，用户只能看到"AI处理失败"。现在真实错误会透传到界面，`max_tokens` 默认值同时调大。
- **窗口生命周期 UX 整改**（PR #136）：隐藏窗口不再卡死 AI 定时器（关闭 backgroundThrottling）、任务栏重新显示应用图标、子窗口关闭后焦点回到主窗口、文本输入中按 Escape 不再隐藏窗口；设置项改为即时自动保存，Toast 移到底部居中不再遮挡表单。

### Removed

- Visual-effects feature (History-window animated background, its settings toggle, and the `motion`/`ogl` dependencies) — a default-off decorative layer.
- Placeholder model-management IPC channels and dead settings/transcription channels with no UI callers.

### Changed

- Lean pass: ~4,500 net lines of dead code, unused dependencies, and duplicate logic removed; `pnpm audit` now reports against the official registry (99 → 2 advisories, both without upstream fixes).
- Toolchain: Electron 36 → 39.8.10, electron-builder 24 → 26, better-sqlite3 11 → 12 (Electron 39 ABI).
- Minimalism pass (2026-08-16): the dead F2 double-click IPC chain, the web-modal SettingsPanel fallback, and seven unused environment config getters were removed; the settings window now loads `settings.html` in dev and production alike.
- Test coverage pushed to **96.6% statements / 92.8% branches / 94.5% functions / 97.1% lines** (1,406 unit tests) with vitest thresholds raised to 96/92/94/96.
- `pnpm ci:check` now runs a **dev smoke gate** (10 checks): it boots `pnpm run dev` and verifies the vite dev server answers, catching native-ABI and startup regressions the static gates miss. The gate leaves better-sqlite3 in the electron-ABI state `pnpm run dev` expects.

## [1.2.0] - 2026-08-02

### Fixed

- **UNC 路径网络超时**（PR #133）：`audioPathValidator` 对 `\\server\share\...` 格式的 UNC 路径执行 `fs.realpathSync` 时，逐级 walk-up 触发 DNS 查找，非-existent 主机导致 13 秒以上挂起。修复：在扩展名校验后立即拒绝 UNC 路径，跳过所有 fs 调用。
- ESLint 忽略 `website/.astro/` 自动生成的 `.d.ts` 文件（Astro 产物，不应 lint）
- Unix-only 测试（symlink escape / SIGKILL kill）在 Windows 上用 `it.skipIf` 跳过

### Changed

- `postinstall` 用系统 Node 重编 better-sqlite3 导致 ABI 不匹配(`NODE_MODULE_VERSION 137` vs Electron 36 需要的 `135`),`pnpm run dev` 加载原生模块即崩且错误被 `concurrently` 吞掉、终端无输出。删除有害的 `pnpm rebuild better-sqlite3`,改由 `electron-builder install-app-deps` 统一用 Electron ABI 编译。

## [1.1.0] - 2026-07-31

> [20260731_Changelog_BackfillV110] 补录 v1.1.0。本范围内的 PR（#119/#120/#122-#126）已并入 main，但发版动作（CHANGELOG 条目 + git tag + GitHub Release）此前未同步执行。本条目为补录。
> [20260731_Changelog_BackfillV110] END

### Added

- **Fox 吉祥物 rebrand + react-bits 视觉特效**（PR #119, commit `a6a8d48`）：应用图标从通用蓝绿螺旋改为可爱手绘狐狸（Duolingo/LINE Friends 风格），统一 app icon / favicon / og-image / theme-color（薰衣草紫 #c4b5fd）；狐在中国文化中象征机敏专注，契合"Murmur 轻语"的中文语音输入定位。同时引入 react-bits 视觉特效组件
- React 组件集成测试基础设施：jsdom + React Testing Library 环境，覆盖 5 个核心组件（PR #123, commit `8d48eae`）
- 65 个新组件/hook 单元测试，前端覆盖率从无覆盖提升到 55%（PR #124, commit `ce23981`）
- 77 个新组件/hook 单元测试，前端覆盖率 55% → 65%（PR #125, commit `3ad10c6`）
- 17 个 App/杂项组件测试，前端覆盖率 65% → 70%（PR #126, commit `c41aeca`）
- 58 个 useRecording/model-status/App 扩展测试，覆盖率 70% → 79%（PR #128, commit `0cb65ed`）
- 36 个 AIConfigSection/sonner 扩展测试，**lines 覆盖率突破 80%**（PR #130, commit `6c2170e`）

### Changed

- **vitest coverage 范围扩展**：从仅 `helpers/utils/bootstrap`（~40 文件）扩展到全 `src/**`（~86 文件），对齐行业最佳实践（commit `c5087ff`, PR #122）。此前 95% 覆盖率数字基于窄范围统计口径，扩展后真实整体覆盖率回落至 ~46%，由此启动了 65% → 70% → 80% 的追赶路线图
- **coverage 阈值抬升**：`vitest.config.ts` thresholds 最终提升到 `statements: 77 / branches: 64 / functions: 73 / lines: 78`，锁定 80% lines 业界标准
- **测试总数**：783 → 1184（+401），全 src/ 覆盖率：79.6% statements / **80.3% lines** / 76.2% functions / 67.1% branches

### Fixed

- **dev/prod 加载同构**（commit `2e93278`, P2.1）：dev:main 改用 esbuild bundle（`build:main && electron .`），dev/e2e/prod 加载同一 artifact（`dist-main/main.js`）。根除 tsx-direct 路径导致的 silent-hang 温床（electron 不透传命令行 `--import`，致 `main.ts` 永不加载）。详见 `docs/research/electron-dev-startup-hardening.md` §P2.1
- **dev 启动链路加固**（commit `b917fbf`）：修复 postinstall ABI 覆盖、tsx loader silent hang（改 `NODE_OPTIONS=--import tsx`）；新增 dev:main 运行时 smoke（断言 canary，抓 silent-hang）、better-sqlite3 ABI preflight、CI test 前 rebuild ABI
- effects 隔离检查对 CSS media query 的误报（commit `163f9bc`, PR #120）

### Notes

- 本版本包含一个面向用户的视觉变更（Fox rebrand + 视觉特效）+ 多项内部工程改进（测试覆盖率 80% 业界标准）
- 完整覆盖率路线图记录在 `docs/strategic-plan-gap-analysis.md`（历史快照）与 `CONTRIBUTING.md` CI Gates 段

## [1.0.3] - 2026-07-27

### Added

- [20260725_Autopilot_T1.4] Backend TypeScript migration (ADR-010, big-bang completed 2026-07-24): all 39 backend `.js` files atomically migrated to `.ts`. ESM `import` source, esbuild bundles to `dist-main/main.js` + `dist-preload/preload.js` (CJS for Electron sandbox). `__dirname` → `app.getAppPath()` (13 sites).
- E2E boot health smoke gate (7 tests covering Phase A-E of boot sequence) per `docs/research/e2e-functional-verification-strategy.md` §4.1
- E2E launch diagnosis instrumentation (env dump, bundle check, stderr/stdout listeners)
- Module identity regression test guard (prevents future cache-leak risk from `vi.resetModules` removal)
- Dependabot remediation plan (`docs/research/dependabot-remediation-plan.md`, 30 alerts triaged)
- TypeScript migration tech debt audit (`docs/research/ts-migration-tech-debt-audit.md`, 7 dimensions)
- ADR-013: ManagersBag cast seam documentation
- ADR-014: e2e CI macOS Electron launch investigation (8 CI iterations, root cause isolated to runtime not install)
- AI prompt few-shot examples for platform modes (xiaohongshu, zhihu, douyin, dianping) — ADR-012 Issue #4c resolved
- Promotion content: community post templates and video scripts
- Promotion infographics: competitor comparison matrix and bento-grid features overview
- Windows `bindings` runtime dependency fix (credit: @Deeeemooo, PR #50)
- ASR benchmark scripts comparing Paraformer-large vs SenseVoice vs Fun-ASR-Nano

### Changed

- **Complete test migration to TypeScript**: 54 unit test files + 13 e2e suites + 4 e2e helpers all migrated from `.js` to `.ts` (100% TypeScript tests)
- **Deleted `_tsresolve.setup.js`**: 118-line Node module monkey-patch removed; all 96 `require()` calls converted to ESM `import` across test files
- **Typecheck gate strengthened**: `tsconfig.test.json` now has ZERO per-file exclusions (was 7); all 64 strict-mode errors in previously-excluded files fixed
- **`no-require-imports` lint rule** re-enabled for `tests/unit/**` (Tier 3.3)
- **Root config files migrated**: `vitest.config.js` → `.ts`, `postcss.config.js` → `.ts`, `playwright.config.js` → `.ts`
- **database.ts typed Row helpers**: `getRow<T>()` + `getCount()` eliminate 7 structural casts for better-sqlite3 queries
- Settings page refactored: 1195-line monolith split into 7 focused modules with full i18n coverage (154 keys, zero hardcoded Chinese)
- Dynamic transcription timeout based on file size (replaces hardcoded 5-minute limit)
- OpenRouter provider preset added with free-tier models
- `ProviderPreset` type unified: `type ProviderPreset = AIProviderPreset`
- Preload bridge: `export const preloadApi: ElectronAPI` drift detector + `makeListener<T>()` helper (10 listeners refactored)
- `electronAPI.d.ts`: `any` → `unknown` at 2 sites; `OperationResult`, `ProcessingUpdateData`, `FileTranscriptionProgressData` type extracts

### Fixed

- CRITICAL: `auto_paste` option value mismatch (`'clipboard'` → `'clipboard_only'`) causing wrong paste behavior
- Security: `tar` bumped from `^7.4.3` to `^7.5.19` (resolves 1 critical + 2 medium CVE)
- Restored lost functionality: `cancelUpdateDownload` button, `testResult.usage` display, live `setAlwaysOnTop` side-effect, `localStorage` language persistence
- Removed 21 dead TS re-export stubs that provided zero type safety
- `main.ts`: `startApp()` now properly awaited in `whenReady` callback; `app.dock.show()` guarded on CI
- Removed 3 dead legacy e2e test files (`tests/e2e/legacy/`)
- Swept stale `.js` references across 8+ docs/ADRs to reflect `.ts` migration
- AI prompt few-shot examples for platform modes (xiaohongshu, zhihu, douyin, dianping) — ADR-012 Issue #4c resolved
- Promotion content: community post templates (即刻/V2EX/少数派) and video scripts (B站/抖音)
- Promotion infographics: competitor comparison matrix and bento-grid features overview (HTML+Playwright)
- Windows `bindings` runtime dependency fix (credit: @Deeeemooo, PR #50)
- ASR benchmark scripts comparing Paraformer-large vs SenseVoice vs Fun-ASR-Nano

### Changed

- Settings page refactored: 1195-line monolith split into 7 focused modules with full i18n coverage (154 keys, zero hardcoded Chinese)
- Dynamic transcription timeout based on file size (replaces hardcoded 5-minute limit) — ADR-012 Issue #1 resolved
- OpenRouter provider preset added with free-tier models
- esbuild `--resolve-extensions=.js,.ts` to handle dual .ts/.js backend files during bundling (no longer needed post-big-bang; kept defensively)
- Provider registration guide text moved from providerPresets.js to i18n locale files
- `ProviderPreset` type unified: `type ProviderPreset = AIProviderPreset` (single source of truth in types/ipc.ts)

### Fixed

- CRITICAL: `auto_paste` option value mismatch (`'clipboard'` → `'clipboard_only'`) causing wrong paste behavior
- Restored lost functionality: `cancelUpdateDownload` button, `testResult.usage` display, live `setAlwaysOnTop` side-effect, `localStorage` language persistence
- Removed 21 dead TS re-export stubs that provided zero type safety (code review finding)

## [1.0.2] - 2026-06-07

### Added

- E2E test infrastructure: Playwright Electron with IPC-level mocking, 11 test suites (35 tests) covering FTUE, lifecycle, recording, hotkeys, file import, clipboard, settings, history, window management, and error resilience
- Model download guard unit tests (13 cases) covering missing models, Windows Chinese path validation, and audio format guards
- `MURMUR_DB_PATH` env var for in-memory test isolation (`database.js`)
- `data-testid` attributes on mic button, file drop zone, and transcription result for E2E selectors
- `PYTHONUTF8=1` in Python subprocess environment to prevent encoding corruption on Windows Chinese locales

### Changed

- Extracted `validateAudioPath()` from `transcriptionHandlers.js` into `src/helpers/audioPathValidator.js` for testability
- Rewrote `tests/e2e/helpers/ipc-mock.js` to properly wrap `electronApp.evaluate()` with serializable responses
- Replaced all `waitForTimeout()` with `expect.poll()` in E2E suites for deterministic assertions
- Moved legacy E2E tests to `tests/e2e/legacy/`

### Fixed

- Chinese file path encoding corruption: file paths with CJK characters (e.g. `新录音.m4a`) were garbled when passed to Python subprocess on Windows (GBK/CP936 locale) — now forced UTF-8 via `PYTHONUTF8=1`
- Misleading test 3.6: mock was applied to wrong app instance — now correctly tests default no-models state
- Fragile `__dirname` 4-level traversal in `electron-launch.js` replaced with `PROJECT_ROOT` constant

## [1.0.1] - 2026-05-31

### Fixed

- AI_REVIEW handler hardcoded "optimize" mode, overriding platform-specific system prompts (xiaohongshu, dianping) — now uses correct prompt per template
- `processTextWithAI` and `checkAIStatus` had no request timeout — added AbortController with 60s and 15s limits respectively, with friendly Chinese error messages
- Removed dead `SYSTEM.UPDATES` IPC handler and added error handling for clipboard PASTE
- Removed 15 orphan IPC handlers and stale type declarations

### Changed

- Unified prompt definitions: moved `dianping`, `professional`, `raw_with_notes` prompts from `exportFormatters.js` into `aiPrompts.js`, eliminating duplicate prompt systems
- `getAIReviewPrompt` removed from `exportFormatters.js`; `AI_REVIEW` handler now uses `buildPrompt` directly

### Added

- ADR 012: known limitations & technical debt document (`docs/adr/012-known-limitations-tradeoffs.md`)

## [1.0.0] - 2026-05-27

### Added

- i18n internationalization: i18next integration with zh-CN/en translations and language selector in settings
- Accessibility: ARIA labels, keyboard navigation, focus-visible styles, decorative aria-hidden
- Semi-auto update with SHA256 verification, progress UI, and system notification
- TypeScript strict mode: `strictNullChecks`, `noImplicitAny`, `noUncheckedIndexedAccess` across entire frontend
- Full TypeScript migration: all hooks, components, and pages migrated to TS/TSX
- AI provider presets: 11 providers (OpenAI, DeepSeek, Qwen, GLM, SiliconFlow, Groq, Moonshot, MiniMax, OpenRouter, Ollama, LM Studio) with auto-fill and registration links
- Quick Start guide: one-click registration links for providers with free tiers (DeepSeek, SiliconFlow recommended)
- Local model auto-detection: probes Ollama (11434) and LM Studio (1234) with 2s timeout
- Custom AI prompt templates with user-defined system/user prompts
- Quick experience mode: per-model download progress, optional punc model for faster startup
- Configurable AI temperature and max_tokens settings
- File-based config (`~/.murmur.json`): DB-first with file fallback, bidirectional sync
- ASR engine abstraction interface for future multi-engine support
- SQLite FTS5 full-text search with trigram tokenizer for CJK text
- SQLite integrity check on startup
- IPC rate limiting for expensive handlers
- FunASR server auto-restart on crash with health monitor (30s ping/pong)
- GPU auto-detection (CUDA > MPS > CPU)
- E2E testing with Playwright: launch, settings, and IPC integration tests
- CI gate enforcement: format check, coverage thresholds, license compliance, build verification
- Local CI gate script (`scripts/ci-check.js`) with `--fix`, `--json`, `--quiet`, `--e2e` modes
- Dependabot configuration for npm and GitHub Actions
- Node version pinning via `.nvmrc`
- Pre-commit hooks via husky + lint-staged (eslint --fix, prettier --write)
- GitHub Actions Node 24 readiness (`FORCE_JAVASCRIPT_ACTIONS_TO_NODE24`)
- CI config validation tests (12 tests for husky, lint-staged, dependabot, workflow config)
- 593 unit tests with high coverage

### Changed

- Audio format conversion: replaced system ffmpeg dependency with Python librosa/soundfile (zero new deps)
- AI prompt engineering overhaul: system/user role separation + XML `<transcript>` tags
- AI optimization redesign: platform styles, humanizer, speaker diarization
- SSRF protection for AI base URLs: https-only + RFC1918 loopback blocking in handler layer
- CSP `connect-src` relaxed to `https:` (SSRF guard now enforced in `aiHandlers.js`, not CSP)
- Log sanitization: AI requests log `inputLength`/`outputLength` instead of full text content
- AI processing mode auto-selects based on transcript length (`optimize` vs `optimize_long`)
- FunASR decomposition: monolithic `funasrManager.js` → thin facade + 4 sub-modules
- IPC architecture: monolithic `ipcHandlers.js` → 9 domain-scoped handler modules
- App.tsx refactored: extracted 5 inline components for maintainability
- Postinstall: `electron-rebuild` → `electron-builder install-app-deps` for CI compatibility
- TypeScript added as explicit devDependency (was missing from package.json)
- Windows CI build: `npx electron-rebuild` → `pnpm rebuild better-sqlite3`

### Fixed

- Audio import: librosa converts MP3/OGG to WAV without requiring system ffmpeg
- MPS device: skipped Apple GPU due to FunASR float64 incompatibility, falls back to CPU
- Hotkey registration: shows toast warning when shortcut is occupied by another app
- FunASR initialization: failure path no longer skips preInitializeModels
- Audio duration: bare except now logs warnings for diagnostic visibility
- History page: shows toast on load/delete failures
- Model verification: correctly handles directory-based models (APFS `statSync` size semantics)
- Contract mismatch: `FUNASR.STATUS` spread order corrected
- Contract mismatch: `saveTranscription` preload signature aligned with handler
- Settings save button no longer blocks users with AI optimization disabled
- Clipboard null safety: `clipboard.readText()` returns null when empty
- Native module version mismatch on Node upgrade (`lastInsertRowid` path fix)
- Recording save path: use `lastInsertRowid` instead of `id`
- File transcription result: unified `lastInsertRowid` usage
- Post-transcription experience: unified recording & file-import flows
- Prettier formatting: 12 files reformatted to pass CI format check
- TypeScript 6.0 `baseUrl` deprecation: added `ignoreDeprecations: "6.0"` to tsconfig
- Missing CSS module type declarations: added `src/vite-env.d.ts` with Vite client types

### Removed

- Dead `useTextProcessing.js` hook (handleTranscription was never called)
- System ffmpeg dependency for audio conversion (replaced by Python librosa)
- `.claude/skills/` files from git index (local-only, already in `.gitignore`)

### Security

- SSRF validation on AI base URL (block internal networks: localhost, 127.x, 10.x, 172.16-31.x, 192.168.x, 169.254.x)
- Settings import whitelist validation and SQL parameter escaping
- License compliance check blocking GPL/AGPL dependencies
- API key encryption at rest using `electron.safeStorage`
- Plaintext-to-encrypted migration for existing API keys
- Path validation on `show-item-in-folder` (restricted to userData)
- HTTPS-only validation on `open-external`
- CSP `connect-src` for AI providers (modelscope, openai, bigmodel)
- `sandbox: true` on all BrowserWindow instances
