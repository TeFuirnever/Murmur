# Murmur 五级测试体系 GAP 分析（2026-09-06）

> 审计基线：branch `autopilot/p1p2p3`，HEAD `65262a7`（2026-09-06 12:05 +0800，"test: cover review-fix branches; push coverage past the 92% gate"）。v1.5.0 已于 2026-09-05 发布（`.omc/notepad.md` Priority Context）。
> 状态更新（2026-09-07）：本文 GAP 为交付前基线；Spec #266（issues #277–#297、#250/#251/#252）已全部交付于分支 `feat/five-level-test-tickets`，文中 G1–G5 与各域 GAP 的处置见对应 ticket。
> 审计性质：只读调查。未修改任何源码/测试。覆盖率数据读取自仓库现存产物 `coverage/coverage-final.json`（当前 HEAD 的 CI 覆盖率跑批产物），未重跑全量套件。
> 方法：先通读既有 8 份测试策略文档（§9 索引）避免重复，再盘点功能面（`src/helpers/ipc-contracts.ts` + 全部 helper/renderer/打包入口）、测试资产（`tests/unit` 130 文件、`tests/e2e` 14 suite 52 用例、`tests/python` 12 文件、`scripts/ci-check.js`、`.github/workflows/{ci,build}.yml`），最后做五级矩阵 GAP 分析。

---

## 0. TL;DR（一页结论）

**整体成熟度评级：B+（L1/L3 已达业界良好水准，L4 有资产但无门禁权，L5 发布门禁强、人工验收脚本缺失）。**

数量基线：L1/L2 单元与组件测试 130 文件（`tests/unit/`，`grep -c "test(\|it("` 计 1770 处用例定义，notepad 记录 2026-09-05 为 ~1709 用例全绿）；L3 契约测试 9 文件双向看护 65 个 invoke 通道 + 12 个推送事件；L4 端到端 14 suite / 52 用例（Playwright + 真实 Electron）；L5 本地 `pnpm ci:check` 11 道门 + 发布 workflow 5 类门禁。全 src 覆盖率 96.8% stmts / 92.0% branches / 95.7% funcs（71 文件，`coverage/coverage-final.json` @ `65262a7`），阈值 96/92/94/96 仅在 macOS CI 腿强制（`ci.yml:95-107`）。

**最大的 5 个 GAP（按对"发布信心"的削弱程度排序）：**

| #   | GAP                                                                                                                                                                                                                                                                                                                               | 层级  | 严重度 | 一句话证据                                                                                                                                                                                                                            |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | **52 条 E2E 在 CI 全部 `continue-on-error: true`，从未拦截过任何回归**                                                                                                                                                                                                                                                            | L4    | **P0** | `.github/workflows/ci.yml:137-164`（三个 e2e 步骤全部 non-blocking）；`backlog.md` ci-e2e-structural-fix                                                                                                                              |
| G2  | **真实麦克风 / 真实模型 / 真实 LLM 网络链路零自动化，也没有成文的人工验收脚本**——仓库自带的 ASR golden set（`scripts/golden_set/`，s00–s05 wav + 参考文本）只被手动 A/B 脚本使用，未进任何门禁                                                                                                                                    | L5    | **P0** | `scripts/golden_set/` 目录存在；`scripts/ab_preprocessing.py`、`benchmark_asr.py` 为手动脚本；`docs/research/e2e-functional-verification-strategy.md` §5.3 Tier-3（"developer machine, never CI"）从未落地成 checklist                |
| G3  | **Windows 腿平台分支覆盖断层**：双平台分支各自只测自己一侧（win 腿 branch 91.53% vs mac 92.19%），且 win 腿不设覆盖率阈值                                                                                                                                                                                                         | L1    | **P0** | `backlog.md` orphans-test-renderer-dim 注（CI run 33942345594 证据）；`ci.yml:102-107` 阈值 `if: runner.os == 'macOS'`；全库仅 3 个测试文件使用 `it.skipIf`                                                                           |
| G4  | **死通道仍在契约里且测试网看不见**：`EVENTS.TRANSCRIPTION_UPDATE/PROCESSING_UPDATE/ERROR/FUNASR_INSTALL_PROGRESS` + 半孤儿 handler（`WINDOW.SHOW/IS_MAX`、`SETTINGS.SAVE`、`SYSTEM.PERMISSIONS/REQUEST_PERMS/OPEN_PERMS`、`FUNASR.INSTALL`）——orphans 测试只检查 "handler **或** preload 引用即非孤儿"，没有 renderer-caller 维度 | L3    | **P1** | `src/helpers/ipc-contracts.ts:119-132`；`tests/unit/ipc-contracts-orphans.test.ts:67`（"referenced by either a handler or preload"）；`backlog.md` dead-channel-cleanup / orphans-test-renderer-dim（queued）                         |
| G5  | **托盘与剪贴板 manager 完全无行为测试**：`tray.ts`、`hotkeyManager.ts`、`clipboard.ts` 三个 Electron 依赖模块零行为断言，托盘菜单文案还是硬编码中文（无 i18n 也无测试可见）                                                                                                                                                       | L1/L2 | **P1** | `vitest.config.ts` coverage.exclude 8 文件清单；全 `tests/unit` 无 tray/hotkeyManager/clipboard manager 行为测试（grep 证实仅 handler 层有 `clipboardHandlers.test.ts`）；`src/helpers/tray.ts:111-143` 硬编码 "显示主窗口/关于/退出" |

一句话路线：**先给 E2E 门禁权（G1），再补平台臂与托盘/剪贴板的行为测试（G3/G5），同时把 golden set 变成半自动 ASR 回归（G2），用 renderer-caller 维度让死通道自动现形（G4）。** 详细清单见 §8（P0×5 / P1×10 / P2×8，共 23 项，含建议文件名与断言要点）。

---

## 1. 五级测试体系定义与业界依据

本文采用如下五级划分，它是 ISTQB 五级（CTFL v4.0：component / component integration / system / system integration / acceptance）与经典测试金字塔（Mike Cohn, _Succeeding with Agile_, 2009；Fowler 现代重述）在 **Electron 桌面应用**语境下的落地变体，并把 Testing Trophy 的"静态/集成优先"思想吸收进 L1/L2 的比例建议。

| 层级   | 名称                        | Murmur 语境下的含义                                                                                                                                                                                  | 运行环境 / 入口                                                 | 业界依据                                                                                                                         |
| ------ | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **L1** | 单元测试（开发自测试）      | 纯模块、纯函数、单 helper 的输入→输出断言；含 mock electron 的 manager 单测                                                                                                                          | vitest（node env），`pnpm test`                                 | 测试金字塔底层：多而快（Fowler 重述 Cohn）；Google "Small" 级：单进程无 I/O（Test Sizes, 2010）                                  |
| **L2** | 组件/集成测试               | React 组件渲染+交互（RTL + happy-dom/jsdom）；多模块协作（funasrManager↔funasrServer↔serverMessageRouter、handler↔database、main.ts 启动顺序）                                                       | vitest（happy-dom）+ RTL，`pnpm test`                           | ISTQB component integration（测自己软件内部的"缝"）；Testing Trophy 主张"mostly integration"（Kent C. Dodds）                    |
| **L3** | 契约测试（Electron 边界层） | IPC 通道注册完整性、preload↔main↔renderer 三方 surface 一致性、`electronAPI.d.ts` 类型契约、孤儿通道检测、payload 形状校验                                                                           | vitest（node + happy-dom），`pnpm test` / `pnpm typecheck`      | ISTQB v4.0 的 system integration 思想在单体应用内映射为"进程边界契约"；VS Code 用 contract/integration 分层同思路（vscode wiki） |
| **L4** | 系统端到端黑盒              | Playwright `_electron.launch` 启动真实 Electron + 真实 main bundle + 真实 handler（IPC mock 只用于注入状态），跨窗口用户旅程                                                                         | `pnpm test:e2e`（Playwright 1.60，workers=1）                   | Electron 官方推荐 Playwright（Automated Testing 教程）；VS Code v1.67 起复用 Playwright Electron smoke                           |
| **L5** | 验收/发布门禁与人工验收     | 本地 `ci:check` 11 门、CI 矩阵、发布 workflow 五类门禁（sqlite 探针 / preload 存在 / Python import / mac+win 打包 boot smoke / NSIS 命名）；真实麦克风、真实模型、真实网络、多显示器、无障碍人工走查 | `node scripts/ci-check.js`；`.github/workflows/build.yml`；人工 | ISTQB acceptance testing；Google 70/20/10（"Just Say No to More End-to-End Tests", 2015）——最上层少而关键                        |

**来源（全部经 WebSearch 核实，2026-09-06）：**

- ISTQB CTFL v4.0 五级：https://astqb.org/2-2-test-levels-and-test-types/ （"the following five test levels are described"）；https://istqb.org/certifications/certified-tester-foundation-level-ctfl-v4-0/
- 测试金字塔（Cohn 2009 → Fowler 现代重述）：https://martinfowler.com/articles/practical-test-pyramid.html
- Testing Trophy（"Write tests. Not too many. Mostly integration."）：https://kentcdodds.com/blog/write-tests ；https://kentcdodds.com/blog/the-testing-trophy-and-testing-classifications
- Google Test Sizes（Small=单进程无 I/O / Medium=单机 localhost / Large=跨机）：https://testing.googleblog.com/2010/12/test-sizes.html
- Google 70/20/10 与 e2e 反模式：https://testing.googleblog.com/2015/04/just-say-no-to-more-end-to-end-tests.html
- Playwright Electron API（experimental，`_electron.launch`）：https://playwright.dev/docs/api/class-electron
- Electron 官方 Automated Testing 教程（推荐 Playwright/WebdriverIO/自定义 driver）：https://electronjs.org/docs/latest/tutorial/automated-testing
- VS Code 测试分层（Unit / Integration / Extension / Smoke）与 Playwright Electron 采纳：https://github.com/microsoft/vscode/wiki/Writing-Tests ；https://code.visualstudio.com/updates/v1_67

**对五级划分的两点说明（推断）：**

1. Murmur 的 L3 是把 ISTQB "system integration" 收窄为 **preload/main/renderer 三进程边界**——这是 Electron 特有的、也是本仓库已经用 `ipc-contracts.ts` 单一注册表做了良好基建的一层；业界（VS Code wiki、electron-testing-best-practices.md §2）同样把 IPC 契约独立成层。
2. L5 拆成"自动化门禁"与"人工/探索性验收"两个半层，因为对本地 ASR 应用，真实麦克风、真实模型、真实钥匙串这三类场景**任何 mock 层都覆盖不了**（§5）。

---

## 2. 测试资产现状盘点（L1–L5）

### 2.1 L1 + L2：`tests/unit/`（130 文件，~1770 用例定义）

| 维度                      | 现状                                                                                                                                                                                                                                                                                                                                                                                                                             | 证据                                                                                       |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 规模                      | 130 个 `.test.ts(x)`（含 `bot/` 8、`components/` 10、`engines/` 1）；`grep -rc "test(\|it("` 合计 1770 处                                                                                                                                                                                                                                                                                                                        | `ls tests/unit \| wc -l` = 130                                                             |
| 通过状态                  | 2026-09-05 v1.5.0 发布时全绿（~1709 用例）；HEAD 又追加（`65262a7` "push coverage past the 92% gate"）                                                                                                                                                                                                                                                                                                                           | `.omc/notepad.md` Priority Context；`git log -1`                                           |
| 覆盖率                    | **96.8% stmts / 92.0% branches / 95.7% funcs**，71 个纳入度量的文件                                                                                                                                                                                                                                                                                                                                                              | `coverage/coverage-final.json`（当前 HEAD 产物，node 脚本重算）                            |
| 阈值                      | 96 S / 92 B / 94 F / 96 L；**仅 macOS CI 腿强制**，Windows 腿跑全量但不卡阈值                                                                                                                                                                                                                                                                                                                                                    | `vitest.config.ts:76-79`；`ci.yml:92-107`                                                  |
| 覆盖排除                  | 8 个 Electron 依赖 helper（clipboard/tray/hotkeyManager/pythonEnvironment/modelManager/updateManager/windowManager/logManager）+ `src/helpers/ipc/**` 不计入覆盖率，但**多数已有行为测试**（在度量之外）：updateManager-behavioral、windowManager-events/-deferred-load、logManager、modelManager-shape/-download-guards/-recovery、pythonEnvironment-embedded-layout、pythonInstaller(63 用例)、funasrManager×4、funasrServer×8 | `vitest.config.ts` exclude 注释块；文件清单                                                |
| L1 内真实零行为测试的模块 | `tray.ts`、`hotkeyManager.ts`、`clipboard.ts`（manager 本体；handler 层有测试但 mock 掉了 manager）                                                                                                                                                                                                                                                                                                                              | grep `tests/unit` 无对应行为测试文件                                                       |
| React 组件/hook           | 10 组件测试 + App 族 5 文件（app/app-expanded/app-behaviors/main-entry/appFileInjection）+ 7 hooks 测试（useRecording 49 用例、useFileTranscription、useHotkey、useModelStatus、usePermissions、useSettings-hook、hooks.test.tsx 覆盖 useWindowDrag）                                                                                                                                                                            | `tests/unit/components/`、`tests/unit/hooks.test.tsx:2`                                    |
| 已知反模式残余            | `phase0`–`phase7` 系列 + windows-compat 等仍以 `fs.readFileSync` + 正则断言源码文本（迁移里程碑门，非行为测试）；`phase3-semi-auto-update.test.ts` 24 用例全为文本断言，但已有 `updateManager-behavioral.test.ts`(8) 补行为；`phase5-a11y.test.ts` 10 用例全为文本断言                                                                                                                                                           | `tests/unit/phase3-semi-auto-update.test.ts:30-60`、`tests/unit/phase5-a11y.test.ts:22-40` |
| 基建                      | `_tsresolve` shim 已删（ESM + `vi.mock` + `vi.resetModules`）；共享 fixture 仅 `tests/fixtures/transcript-cleaner-golden.json`；无共享 mock 工厂                                                                                                                                                                                                                                                                                 | `vitest.config.ts:10-19` 注释                                                              |

### 2.2 L2 多模块集成（专项列出）

- `funasrManager-orchestration.test.ts`（38 用例）+ `funasrManager-idle-unload/init-race` + `funasrServer-*` 8 文件（spawn/crash-restart/killtree/reload-suppression/transcribe/branches/spawn-success）+ `server-message-router×2`——ASR 子进程编排链在 L2 已有厚网。
- `main-boot-order.test.ts`——**真实执行 `main.ts` 的 `startApp()`**（mock electron，记录调用顺序），看护 #211 钥匙串启动顺序（window→setSafeStorage→loadContent）与 will-quit 收尾。
- `ipcRateLimitIntegration.test.ts`——限流器挂真实 handler。
- `database*` 8 文件——真实 node:sqlite 临时库（spec #226 后无 ABI 舞蹈）。
- `dev-main-smoke.test.ts`、`predev-force-rebuild.test.ts`、`main-process-module-resolution.test.ts`、`package-runtime-dependencies.test.ts`、`deps-lean.test.ts`——启动链/打包内容守护。
- Python 侧（归 L2 主进程↔Python 协议集成）：`tests/python/` 12 文件（protocol contract、suppress_stdout 免疫 #208、seaco fallback、unload/reload、preprocess wiring、inference threads、repo-ready gate #255），经 `scripts/run-python-tests.js` 在 mac/win 双 CI 腿 + 本地 ci:check 运行。

### 2.3 L3 契约测试（9 文件）

| 文件                                                              | 看护内容                                                                                        | 强度                                                                                                                                |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `ipc-contracts.test.ts`                                           | 契约注册表本身（channel 名/分组）                                                               | 强                                                                                                                                  |
| `ipc-contract-completeness.test.ts`                               | 每个契约 channel 都有 handler（审计时点 305 条断言）                                            | 强                                                                                                                                  |
| `ipc-contracts-orphans.test.ts`                                   | 每个 channel 被 handler **或** preload 引用，否则进白名单                                       | **结构性盲区：无 renderer-caller 维度**（§4-U）                                                                                     |
| `preload-bridge-contract.test.ts`                                 | **真实执行 preload.ts**：mock `contextBridge` 捕获暴露对象，断言 ≥50 方法 + 关键方法 smoke 调用 | 强（业界标准做法，electron-testing-best-practices.md §4.2）                                                                         |
| `assert-electron-api.test.ts`                                     | renderer 启动断言（electronAPI 缺失时白屏防护）                                                 | 中                                                                                                                                  |
| `preload-loadable.test.ts` / `preload-listener-lifecycle.test.ts` | preload 可加载 / 事件 listener 生命周期                                                         | 中（后者在看护死事件的生命周期，§4-U）                                                                                              |
| `backend-type-safety.test.ts`                                     | 禁 `any` 等类型纪律                                                                             | 中                                                                                                                                  |
| `electronAPI.d.ts` + `pnpm typecheck`                             | 三端类型契约（编译期）                                                                          | 强                                                                                                                                  |
| **缺失**                                                          | payload 形状校验（invoke 参数/返回值的运行时 schema）                                           | 2026-08-20 审计曾在 e2e 抓到 3 处 payload 断言漂移（§9 scout §5.3-②），证明类型网+人工评审之外需要 L3 payload 网或至少 e2e 断言对齐 |

### 2.4 L4 端到端（14 suite / 52 用例）

| Suite                        | 用例数 | 实际覆盖（读自用例名）                                                                                                                            | mock 策略                                                         |
| ---------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `00-boot-health`             | 8      | DB round-trip、8 个 handler 域应答、preload ≥50 方法、React 挂载、无未捕获错误（KNOWN_RENDERER_NOISE 白名单）、session/CSP、吉祥物绘制、6s 内退出 | 真实链路（仅 DB 用 `:memory:`）                                   |
| `00-ftue` / `00-launch-only` | 3 / 1  | 首用引导、mic 禁用、纯启动诊断                                                                                                                    | 真实                                                              |
| `01-lifecycle`               | 5      | 启动、electronAPI、mic aria-label、semver、独立设置窗                                                                                             | 真实                                                              |
| `02-model-download`          | 4      | need_download / ready / 失败态 / payload 结构                                                                                                     | `ipc-mock.ts` 注入                                                |
| `03-recording`               | 6      | mic 点击起停、转录结果、AI 优化成功/失败、未就绪拦截                                                                                              | ipc-mock                                                          |
| `04-hotkey`                  | 3      | 热键展示（⌘⇧空格）、事件触发、注册                                                                                                                | 真实+事件注入                                                     |
| `05-file-import`             | 3      | tab 切换、validate 通过/拒绝                                                                                                                      | ipc-mock                                                          |
| `06-clipboard`               | 3      | 复制回读、auto_paste 设置、pasteText                                                                                                              | 真实+ipc-mock                                                     |
| `07-settings`                | 3      | set/get、getAll、provider presets                                                                                                                 | 真实 handler                                                      |
| `08-history`                 | 3      | 列表、客户端搜索、删除                                                                                                                            | 真实（:memory: DB）                                               |
| `09-window`                  | 3      | 最小化、最大化切换、置顶                                                                                                                          | 真实                                                              |
| `10-errors`                  | 2      | AI 失败、非法 save                                                                                                                                | ipc-mock                                                          |
| `11-cross-window-journeys`   | 4      | **持久化热键变更→全局快捷键重注册**、**语言切换实时传播到主窗**、**清空全部历史（带确认）**、**导出格式选择+取消静默**                            | 真实                                                              |
| 合计                         | **52** | 14 文件                                                                                                                                           | workers=1、timeout 45s、retries 0、globalSetup 先 build 三 bundle |

关键事实：**CI 上三个 e2e 步骤全部 `continue-on-error: true`**（`ci.yml:137-164`）——boot-health、launch 诊断、全量 e2e 都不阻塞合并。spec #226（node:sqlite）落地后 e2e 已在本地 46/46→52 用例全绿（backlog 二补注），转阻塞的技术障碍已消失，只剩 CI 验证与决策。E2E 隔离仅 `MURMUR_DB_PATH=:memory:`（`electron-launch.ts:237`），**userData 仍写真实 `~/Library/Application Support/murmur`**（scout §5.1/§6-8，未修）。

### 2.5 L5 门禁与人工验收

**本地门禁 `pnpm ci:check`（11 道阻塞门，`scripts/ci-check.js`）：** format:check、lint（--max-warnings 0）、license:check、typecheck、typecheck:tests、test:python:unit（stage1 六并行）→ build:main → build:preload → vitest+coverage → build:renderer → dev smoke（`pnpm run dev` 拉起全栈，轮询 vite :5173，`scripts/ci-check.js:70-137`）。security audit 非阻塞第 12 项。

**CI（`.github/workflows/ci.yml`）：** macos+windows 双腿矩阵跑全量单测；Python 单测双腿；覆盖率阈值仅 macOS 腿；e2e 三步 non-blocking；PR 时 dependency-review（fail on high）。

**发布门禁（`.github/workflows/build.yml`，tag `v*` 触发）：** (1) sqlite-opened-under-Electron 探针（双腿，node:sqlite 版）；(2) 嵌入式 Python 依赖 import 硬门（numpy/soundfile/funasr）；(3) preload bundle 存在门（历史版本曾全量缺 preload）；(4) mac 打包 boot smoke（启动里程碑 + preload 桥 + 冷缓存预热 360s 预算）；(5) win NSIS 安装包 boot smoke + 命名门；(6) SHA256 checksums。

**husky pre-commit：** 仅 `npx lint-staged`（eslint --fix + prettier），不跑测试。

**人工验收：** 无成文脚本。仓库自带的 ASR golden set（`scripts/golden_set/`：s00–s05 各 clean/rumble×3 增益 + `*_ref.txt` 参考文本）只服务于手动脚本 `scripts/ab_preprocessing.py` / `benchmark_asr.py` / `seaco_spike.py`，不在任何门禁内。

### 2.6 与既有策略文档的差异（哪些已过时）

| 文档                                                            | 状态                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `test-coverage-gap-analysis.md`（2026-07-24）                   | **大部分已失效**：better-sqlite3→node:sqlite 根除了 ABI 问题；e2e 已从"全红"到 52 用例；transcriptionHandlers/hotkeyHandlers/clipboardHandlers/updateManager 行为测试均已补齐；阈值已从 88% 分支推进到 92% 全 src。其"源码文本断言反模式"清单仍部分成立（phase 系列）。                                                                                                                    |
| `comprehensive-test-strategy.md`（2026-07-24）                  | 金字塔比例与 Tier 划分仍可作参考；其 P0（E2E CI headless）已由 spec #226 间接解决；Manager 单测清单大部分已落地（pythonInstaller 63 用例、logManager、updateManager-behavioral 等），**未落地：tray、hotkeyManager、clipboard manager 本体**。                                                                                                                                             |
| `deep-test-design-v2/managers/e2e/error-paths.md`（2026-07-25） | managers 文档的 P0/P1 批次基本执行完毕；e2e 文档的 journey 设计只落地了 boot-health 与 00–10（14-tray-journey、15-multi-window、16-error-resilience 仅 11-cross-window 部分兑现）；error-paths 文档（DB 10 条、文件转录 7 条、FunASR 10 条、AI 6 条）大部分已转化为 `database-*`、`funasrServer-*`、`aiHandlers` 等测试，但**磁盘满/DB 锁定/超时竞态**类仍无专门用例（推断，未逐条核对）。 |
| `e2e-functional-verification-strategy.md`                       | Gate 3 boot-health 已落地；Tier 分级与晋升策略（Stage 0→4）停留在 Stage 0——**CI e2e 至今 non-blocking，晋升从未发生**；§5.3 Tier-3（真实 ASR smoke，"developer machine, never CI"）从未落地成文档化 checklist。                                                                                                                                                                            |
| `electron-testing-best-practices.md`                            | 引用关系仍有效（Playwright `_electron`、ipc-mock removeHandler→handle 模式、contextIsolation 断言），无需更新。                                                                                                                                                                                                                                                                            |
| `2026-08-20-scout-full-audit.md`                                | §3 孤儿清单 A–H 中 F（热键设置）、G（default_mode）、H（i18n 主/历史窗）、E 中的 CLEAR 已修复（backlog Done，2026-09-06）；A/B/C/D/E 残余仍在（→本文 G4）。其 §6-9 e2e 修复包已合并（PR #213）。                                                                                                                                                                                           |

---

## 3. 功能点全景清单（按域分组，82 项）

来源：`src/helpers/ipc-contracts.ts`（65 invoke 通道 + 12 事件 + 7 音频扩展名）、`src/` 全文件树、`main.ts`/`preload.ts`、scout 审计 §1 功能清单、backlog。编号供 §4 矩阵引用。

**A. 实时语音输入（10 项）** A1 麦克风采集（MediaRecorder→16kHz WAV）；A2 `TRANSCRIPTION.AUDIO` 识别链；A3 录音态 UI（VoiceWaveIndicator/计时）；A4 流式阶段文案（checking→loading→ready）；A5 转录结果卡片；A6 自动粘贴（auto_paste 三档）；A7 录音中禁重复触发；A8 模型未就绪拦截录音；A9 空音频/采集失败错误链；A10 动态超时（`dynamicTranscriptionTimeout`）。

**B. 热键系统（7 项）** B1 全局热键注册（`CommandOrControl+Shift+Space`）；B2 热键触发→录音切换（HOTKEY_TRIGGERED 事件）；B3 F2 双击（hotkeyManager F2 通道）；B4 设置内自定义热键（hotkeyRecorder + 持久化 + 原子换绑 #246）；B5 注册失败 toast 与降级；B6 空闲卸载后热键预热（FUNASR.RELOAD_MODELS fire-and-forget）；B7 `HOTKEY.SET_STATE/GET_STATE` 录音态同步。

**C. AI 润色（8 项）** C1 `AI.PROCESS`（OpenAI 兼容 HTTP）；C2 内置模式集（optimize/format/correct/summarize/xiaohongshu…）；C3 自定义模板（userData/templates）；C4 few-shot 提示词；C5 default_mode 默认处理模式（#247 已通写入端）；C6 测试连接（CHECK_STATUS 15s AbortController）；C7 供应商预设（providerPresets + 本地模型探测 detectLocalModels）；C8 SSRF 校验（https 强制 + RFC1918/loopback/IPv6 拒绝）。

**D. 文件导入与转录（9 项）** D1 拖拽/选择导入（IMPORT_FILE dialog）；D2 `VALIDATE_FILE`（扩展名白名单 AUDIO_EXTENSIONS、500MB 上限、存在性）；D3 `TRANSCRIBE_FILE` 全链（校验→热词→清洗→存库→返回 id）；D4 进度推送（FILE_TRANSCRIPTION_PROGRESS）；D5 取消（CANCEL）；D6 说话人分离 DIARIZE（懒加载 speaker 模型）；D7 AI 创作稿 AI_REVIEW；D8 路径校验（audioPathValidator：win 盘符/UNC/8.3/尾点/symlink，mac realpath//Volumes）；D9 文件模式 UI（FileDropZone/FileImport/TranscriptionProgress）。

**E. 热词（4 项）** E1 设置录入（多行 textarea、200 行×32 字限额）；E2 sanitize（控制字符/lone surrogate/码点截断）；E3 转写时注入 + 调用方优先 + 失败不阻断；E4 空热词重试与降级 toast（hotword_degraded）。

**F. 转录历史与导出（9 项）** F1 历史窗（独立 BrowserWindow）；F2 列表分页（GET_ALL limit/offset）；F3 客户端搜索过滤；F4 单条删除；F5 清空全部（带确认，#248）；F6 单条导出 5 格式（txt/srt/vtt/md/docx）；F7 导出全部（格式选择，#248）；F8 导出文件落盘与取消静默；F9 转录清洗（transcriptCleaner T10 + golden fixture）。

**G. 设置系统（9 项）** G1 设置窗（4+1 section：general/permissions/ai/about/bot）；G2 SETTINGS.GET/SET/GET_ALL/SAVE/RESET；G3 ALLOWED_SETTING_KEYS 白名单校验；G4 API key safeStorage 加密落库；G5 `~/.murmur.json` 明文白名单（fileConfig FILE_CONFIGURABLE_KEYS）；G6 SETTINGS_UPDATE 广播→双窗缓存刷新；G7 主题即时应用；G8 "4 处同步"不变量（SettingsState+DEFAULT_SETTINGS+loadSettings+saveSettings，AGENTS 规则 #6）；G9 设置导入/导出通道已删除（GET_LEGACY/IMPORT/EXPORT 已移除）。

**H. 权限与辅助功能（4 项）** H1 麦克风真实探测（getUserMedia）；H2 辅助功能真实探测（pasteText 试粘贴）；H3 权限 UI（PermissionsSection）；H4 遗留 SYSTEM.PERMISSIONS/REQUEST_PERMS/OPEN_PERMS handler（孤儿）。

**I. 模型管理与 FunASR 生命周期（8 项）** I1 模型检测（MODELS.CHECK）；I2 下载（断点续传 + 停滞看门狗 #254）；I3 进度事件；I4 下载完成→自动重启 FunASR；I5 空闲卸载（5min，MURMUR_IDLE_UNLOAD_MS clamp）+ 转写计数防中途卸载；I6 服务崩溃自动重启（≤3 次）；I7 健康检查（120s 握手、ping 超时）；I8 SeACo-Paraformer 主模型 + 旧模型回退 + repo-ready 分片误判防护（#255）。

**J. Python 环境与子进程协议（7 项）** J1 嵌入式 Python 布局（win/mac 双布局）；J2 PATH 注入（main.ts:95-127）；J3 spawn/优雅关闭（taskkill /T /F vs SIGKILL）；J4 stdout 协议路由（serverMessageRouter）；J5 协议输出对 suppress_stdout 免疫（#208）；J6 热词 Python 侧二次消毒；J7 预处理接线（audio_preprocessing）。

**K. 窗口与托盘（8 项）** K1 主窗三窗体系（main/history/settings）；K2 最小化/最大化切换（WINDOW_MAXIMIZE_CHANGE 事件）；K3 置顶（SET_TOP + 持久化默认值）；K4 关闭行为 hide|quit；K5 托盘创建与图标（16×16 template）；K6 托盘菜单（显示主窗口/关于/退出——**硬编码中文**）；K7 CSP/sandbox 三窗一致；K8 单实例锁——**未实现**（`main.ts` 无 `requestSingleInstanceLock`，属功能缺失而非测试缺失）。

**L. 剪贴板（4 项）** L1 CLIPBOARD.COPY；L2 CLIPBOARD.PASTE（mac AppleScript / win PowerShell+windowsHide）；L3 粘贴超时 3s 防双 resolve；L4 auto_paste 设置三档生效。

**M. 应用更新（6 项）** M1 检查（GitHub Releases API + 平台资产）；M2 semver 比较；M3 下载 + SHA256 校验 + 进度/完成/错误三事件；M4 取消下载；M5 安装（tmpDir 路径逃逸守卫）；M6 关于页更新卡片状态机。

**N. i18n（5 项）** N1 zh-CN/en locale 文件；N2 locale-parity（键位齐平）；N3 主窗/历史窗接入（#247）；N4 语言切换实时传播（免重启）；N5 托盘/原生菜单文案——**未接入**（tray.ts:111-143）。

**O. BloubBot 吉祥物（6 项）** O1 动画引擎（engine/states/cycles）；O2 表情/皮肤/形状（expressions/skins/shape）；O3 eye-fit 测量表不变量（spec #224：数值为逐帧视频测量，禁止修约）；O4 文件态联动（botFileState）；O5 设置 section（BotSection）；O6 标题栏挂载与绘制。

**P. 数据库与持久化（6 项）** P1 node:sqlite 打开/初始化；P2 schema 与迁移；P3 CRUD/分页；P4 FTS/搜索降级；P5 safeStorage 加解密与失败回退；P6 backup。

**Q. 安全加固（6 项）** Q1 CSP + sandbox + contextIsolation；Q2 SSRF 校验（同 C8）；Q3 IPC 限流（ipcRateLimiter：AI 20/min、下载 3/5min）；Q4 audioPathValidator 跨平台路径防护（同 D8）；Q5 updateManager 安装路径守卫（同 M5）；Q6 API key 日志脱敏（maskApiKey）。

**R. 日志与诊断（4 项）** R1 logManager 文件日志与轮转；R2 SYSTEM.LOG（renderer 33 处调用）；R3 SYSTEM.DEBUG_INFO 聚合；R4 SYSTEM.INFO/VERSION/OPEN_EXTERNAL。

**S. 打包与发布（5 项）** S1 electron-builder 配置（files/asarUnpack）；S2 嵌入式 Python 下载与打包（prepare-embedded-python.js 双平台）；S3 安装包命名（NSIS "Murmur Setup"）；S4 entitlements/hardenedRuntime；S5 打包态 boot（含 Python 链路自检）。

**T. FTUE 与启动（5 项）** T1 启动顺序（#211 钥匙串序）；T2 首用三步引导；T3 模型未就绪 mic 禁用；T4 优雅退出（will-quit 5s 竞态超时）；T5 dev 模式启动（predev/predev-force-rebuild 钉子）。

**U. 测试基建自身（4 项）** U1 IPC 契约三方一致网；U2 孤儿检测网（缺 renderer-caller 维度）；U3 e2e mock 基建（ipc-mock eval-require 已修 #213）；U4 dev smoke 健康判据（仅 renderer 端口可达，主进程心跳缺失）。

---

## 4. 功能点 × 五级覆盖矩阵与 GAP

标记：✓ 已有看护（附代表测试）；◐ 部分/间接；✗ 缺失。严重度：**P0**=削弱发布信心 / **P1**=重要回归风险 / **P2**=完善性。

### 4-A 实时语音输入

| 功能点                 | L1/L2                                                                | L3         | L4                | L5                                 |
| ---------------------- | -------------------------------------------------------------------- | ---------- | ----------------- | ---------------------------------- |
| A1 采集→WAV            | ✓ `useRecording.test.tsx`(49)、`windows-compat`                      | —          | ◐ 3.1/3.2（mock） | ✗ 真实麦克风                       |
| A2 AUDIO 识别链        | ✓ `transcriptionHandlers(-clean).test.ts`、`funasrServer-transcribe` | ✓ 契约三端 | ◐ 3.3 ipc-mock    | ✗ 真实模型                         |
| A5 结果卡片/A7–A8 拦截 | ✓ `transcription-result.test.tsx`、`app-behaviors`                   | —          | ✓ 3.6             | ✗                                  |
| A6 自动粘贴            | ◐ `clipboardHandlers`（manager mock）                                | ✓          | ◐ 6.2/6.3         | ✗ 真实 AppleScript/PowerShell 粘贴 |
| A9 采集失败链          | ✓ useRecording 错误路径                                              | —          | ✗                 | ✗                                  |
| A10 动态超时           | ✓ `dynamicTranscriptionTimeout.test.ts`                              | —          | ✗                 | ✗                                  |

**GAP-A1（P0，同 G2）**：真实麦克风→真实 FunASR→文本上屏的全链路只有 L5 人工一条路，但没有成文 checklist 与判定标准。建议见 §8-P0-2。
**GAP-A2（P1）**：粘贴链的 OS 层（osascript/PowerShell）零行为测试且 manager 本体被排除在覆盖率外——`clipboard.ts` 的 pasteWindows/pasteLinux 命令构建纯逻辑可测（deep-test-design-managers.md §2.1 已有现成设计）。

### 4-B 热键系统

| 功能点             | L1/L2                                                                                            | L3  | L4                      | L5                                |
| ------------------ | ------------------------------------------------------------------------------------------------ | --- | ----------------------- | --------------------------------- |
| B1–B3 注册/触发/F2 | ◐ `hotkeyHandlers.test.ts`（handler 层）；**hotkeyManager 本体 ✗**                               | ✓   | ✓ 4.2/4.3               | ✗（真实 globalShortcut 冲突场景） |
| B4 自定义热键      | ✓ `hotkey-settings.test.tsx`(25) + `useHotkey.test.tsx`                                          | ✓   | ✓ 11.1（持久化→重注册） | ✗                                 |
| B5 注册失败降级    | ◐ app 测试 toast 分支                                                                            | —   | ✗                       | ✗（真实冲突热键人工验证脚本缺）   |
| B6 预热 reload     | ✓ `funasrManager-idle-unload`、`funasrServer-reload-suppression`、python `test_unload_reload.py` | ✓   | ✗                       | ✗                                 |

**GAP-B1（P1）**：`hotkeyManager.ts` 零行为测试（注册失败、unregisterAll、F2 双击去抖时序）；deep-test-design-managers §2.2 的 12 用例设计可直接采用。
**GAP-B2（P2）**：热键与其它应用冲突的 L5 场景（无法自动化，需人工脚本一条）。

### 4-C AI 润色

| 功能点          | L1/L2                                                                            | L3          | L4              | L5                |
| --------------- | -------------------------------------------------------------------------------- | ----------- | --------------- | ----------------- |
| C1–C2           | ✓ `aiHandlers.test.ts`（401/429/500/空 choices/超时）、`determineProcessingMode` | ✓           | ✓ 3.4/3.5、10.1 | ✗ 真实 LLM 端到端 |
| C3–C4           | ✓ `aiPrompts(.few-shot).test.ts`                                                 | —           | ✗               | ✗                 |
| C5 default_mode | ✓ general-section（写入端已补）                                                  | ✓ allowlist | ✗               | ✗                 |
| C6–C7           | ✓ `providerPresets.test.ts`、`detectLocalModels.test.ts`、ai-config-expanded     | ✓           | ✓ 7.3           | ◐ 人工配真实 key  |
| C8 SSRF         | ✓ aiHandlers IPv6/0.0.0.0/link-local 分支                                        | ✓           | ✗               | ✗                 |

**GAP-C1（P1）**：真实 LLM 供应商（OpenAI/DeepSeek/本地 Ollama）的 L5 兼容性走查无脚本；至少应有一份"三家供应商 × 测试连接 × 三种模式"的手动验收单。
**GAP-C2（P2）**：C5 无 e2e（设置→默认模式→下次录音自动润色走对模式的旅程）。

### 4-D/E 文件导入、转录、说话人分离、热词

| 功能点          | L1/L2                                                                                                    | L3            | L4                           | L5                 |
| --------------- | -------------------------------------------------------------------------------------------------------- | ------------- | ---------------------------- | ------------------ |
| D1–D3 主链      | ✓ `useFileTranscription.test.tsx`、`fileImportController`、`file-import.test.tsx`、transcriptionHandlers | ✓             | ◐ 仅 5.1–5.3（tab+validate） | ✗ 真实音频文件全链 |
| D4–D5 进度/取消 | ✓ transcriptionHandlers、`transcription-progress.test.tsx`                                               | ✓ 事件两端    | ✗                            | ✗                  |
| D6 说话人分离   | ◐ handler 分支（缺 segments/audio path）                                                                 | ✓             | ✗ **无任何 e2e**             | ✗                  |
| D7 AI_REVIEW    | ✓ handler                                                                                                | ✓             | ✗                            | ✗                  |
| D8 路径校验     | ✓ `audioPathValidator-branches/symlink` + #195 win 黑名单（**平台臂只测本侧**）                          | ✓             | ◐ 5.2/5.3                    | ✗ UNC/网络盘实机   |
| E1–E4 热词      | ✓ `hotwords.test.ts`、`hotword-injection.test.ts` + python 侧消毒                                        | ✓（复用通道） | ✗ **UI 端到端空白**          | ✗                  |

**GAP-D1（P1）**：文件转录旅程 e2e 只有 validate 一段；转录→进度→取消→导出全链无 L4（可用真实小 wav + 真实 handler 的 mock-free 路线，DB 已 :memory: 隔离，唯一重依赖是 FunASR——可用 ipc-mock 只替换 `transcribe-file` 一个通道）。
**GAP-D2（P1）**：diarize 全层级无旅程测试（按钮渲染条件仅 unit）。
**GAP-D3（P1）**：热词"设置→录入→下一次转写生效→降级 toast"无 e2e。
**GAP-D4（P0，同 G3）**：audioPathValidator 的 win32 臂（UNC/8.3/尾点/盘符快收）在 mac 腿上不被执行、darwin 臂（realpath//Volumes）在 win 腿上不被执行——`it.skipIf` 只让各腿跳过对侧。建议对侧臂 mock `process.platform` 双跑（§8-P1-2）。

### 4-F 转录历史与导出

| 功能点     | L1/L2                                                             | L3  | L4                                      | L5  |
| ---------- | ----------------------------------------------------------------- | --- | --------------------------------------- | --- |
| F1–F5      | ✓ `history-page.test.tsx`、database 族、`fileConfig(.errors)`     | ✓   | ✓ 8.1–8.3、11.3                         | ✗   |
| F6–F8 导出 | ✓ `export-formatters(.coverage).test.ts`（docx buffer/格式 info） | ✓   | ◐ 11.4（选择+取消；**落盘内容未断言**） | ✗   |
| F9 清洗    | ✓ transcriptCleaner + golden fixture                              | —   | ✗                                       | ✗   |

**GAP-F1（P1）**：e2e 11.4 未断言导出文件的**内容**（如 srt 时间轴行、docx 可解压且 document.xml 含文本）；`exportFormatters` 的 unit 是纯函数级，落盘链（dialog→writeFile）只有 handler 分支测试。
**GAP-F2（P2）**：大量记录（如 1000+ 条）下历史窗搜索/渲染的性能无任何度量（L5 探索性）。

### 4-G 设置系统

| 功能点              | L1/L2                                                                                                             | L3          | L4                                          | L5                                    |
| ------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------- | ------------------------------------- |
| G1–G3               | ✓ `settingsHandlers.test.ts`、`useSettings-hook.test.tsx`(33K)、`settings-sections/general-section`               | ✓ allowlist | ✓ 7.1–7.3                                   | ✗                                     |
| G4 加密             | ✓ `database-encryption-failure` + `main-boot-order`（#211 序）                                                    | ✓           | ✗                                           | ◐ 真实钥匙串弹窗（#211 场景只可人工） |
| G5 fileConfig       | ✓ `fileConfig(.errors).test.ts`                                                                                   | ✓           | ✗                                           | ✗                                     |
| G6 广播             | ✓ useSettings onSettingsUpdate 分支                                                                               | ✓ 事件      | ✗ 跨窗实时刷新无 e2e（11.2 只测 i18n 传播） | ✗                                     |
| G8 "4 处同步"不变量 | ✗ **无 meta-test**（grep 证实无任何测试交叉核对 DEFAULT_SETTINGS↔ALLOWED_SETTING_KEYS↔loadSettings↔saveSettings） | —           | —                                           | —                                     |

**GAP-G1（P1）**：AGENTS 禁令 #6（"加设置必须动 4 处 + ALLOWED_SETTING_KEYS"）目前只靠 code review 看守。可写一个 meta-test：解析 `useSettings.ts` 的 `SettingsState`/`DEFAULT_SETTINGS`/`loadSettings`/`saveSettings` 四个符号的键集合 + `settingsHandlers.ts` 的 `ALLOWED_SETTING_KEYS`，断言五者相等（漂移即红）。这是 AGENTS 里唯一没有测试钉子的 MUST 规则。
**GAP-G2（P2）**：G4 的真实钥匙串场景（adhoc 身份变更再升级→弹窗）无法自动化，写进 L5 升级路径人工脚本。

### 4-H 权限与辅助功能

| 功能点          | L1/L2                                               | L3                                    | L4                        | L5                 |
| --------------- | --------------------------------------------------- | ------------------------------------- | ------------------------- | ------------------ |
| H1–H3           | ✓ `usePermissions.test.ts`、PermissionsSection 组件 | ✓                                     | ✗ **权限 section 无 e2e** | ◐ 真实系统权限弹窗 |
| H4 孤儿 handler | —                                                   | ◐ orphans 网看不见（renderer 零调用） | —                         | —                  |

**GAP-H1（P1）**：a11y 深度不足——`phase5-a11y.test.ts` 全是"源码里出现过 aria-label 字样"的正则断言；无 axe-core 自动扫描、无键盘导航（Tab 焦点环/Enter 触发）测试；e2e 仅 1.3 一处 aria 断言。建议在 e2e 里加 axe 扫描主窗+设置窗（Playwright + axe-playwright），并把 phase5 改为 RTL 行为断言。
**GAP-H2（P2）**：H4 与 §4-U 死通道一并清理（dead-channel-cleanup）。

### 4-I/J 模型管理、FunASR 生命周期、Python 环境

| 功能点             | L1/L2                                                                                                            | L3         | L4                       | L5                   |
| ------------------ | ---------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------ | -------------------- |
| I1–I4              | ✓ modelManager-shape/-download-guards/-recovery、`download-stall-timeout`（#254）、`model-status-indicator`      | ✓          | ✓ 02 四用例（mock 进度） | ✗ 真实 1.2GB 下载    |
| I5–I8              | ✓ funasrManager×4、funasrServer×8、seaco×2 + python `test_seaco_fallback/_repo_ready`(#255)/`test_unload_reload` | ✓          | ✗                        | ✗                    |
| J1–J2              | ✓ `pythonEnvironment-embedded-layout`、environment.test.ts                                                       | ✓          | ◐ boot-health 隐含       | ✓ 发布门 S 门禁      |
| J3 双平台 killtree | ✓ `funasrServer-killtree`（**但同样存在平台臂只测本侧问题**）                                                    | —          | ✗                        | ✗ win 实机进程树清理 |
| J4–J6              | ✓ serverMessageRouter×2、`test_protocol_output_immunity`(#208)、`test_funasr_server_protocol`                    | ✓ 协议契约 | ✗                        | ✗                    |
| J7 预处理          | ✓ python `test_audio_preprocessing/_server_preprocess_wiring`                                                    | —          | ✗                        | ◐ golden_set 手动    |

**GAP-I1（P0，同 G2/G3 复合）**：模型下载/加载/识别这条最重链路在 L4 全 mock、在 L5 无脚本；golden set（`scripts/golden_set/` 6 句 ×3 增益 ×clean/rumble + 参考文本）天然就是 ASR 回归集，但目前只有手动 A/B 脚本。建议写 `scripts/asr-regression.js`（对每条 wav 调真实 FunASR server，WER 阈值门）+ `pnpm test:asr`（本地手动档，不进 CI），并在 `docs/qa/` 写一页"发版前真实模型走查"清单。
**GAP-I2（P1）**：killtree 的对侧臂（mac 腿没真跑 taskkill 分支、win 腿没真跑 SIGKILL 分支）——与 D4 同一修法。
**GAP-I3（P2）**：J3/J7 无 e2e 可接受（重依赖策略正确），但 e2e-functional-verification-strategy §5.3 设想的"本地 Tier-3 真实 ASR smoke"应落地为脚本而非永远口头。

### 4-K 窗口与托盘

| 功能点      | L1/L2                                                                    | L3  | L4                                                                                                   | L5                                                |
| ----------- | ------------------------------------------------------------------------ | --- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| K1–K4       | ✓ windowManager-events/-deferred-load、windowHandlers、`main-boot-order` | ✓   | ✓ 09、11（跨窗）                                                                                     | ✗ 多显示器/DPI                                    |
| K5–K6 托盘  | ✗ **tray.ts 零行为测试**；菜单文案硬编码中文（tray.ts:111–143）          | —   | ✗ **无托盘 journey**（comprehensive-test-strategy §5.1 08-tray 与 deep-test-design-e2e §4 均未落地） | ✗                                                 |
| K7 CSP      | ✓ boot-health 0.6（session/CSP 前置）+ windowManager 测试                | ✓   | ✓ 0.6                                                                                                | ✗                                                 |
| K8 单实例锁 | —                                                                        | —   | —                                                                                                    | —（功能缺失：双开会导致双托盘+DB 竞争，建议立项） |

**GAP-K1（P1，同 G5）**：tray.ts 的纯逻辑（图标路径 dev/prod、菜单模板构建、点击行为绑定）可用 mock electron 完整测试；deep-test-design-managers §2.3 已有 10 用例设计。
**GAP-K2（P1）**：托盘 e2e journey（Playwright 可经 `app.evaluate` 取 Tray 实例触发 click 事件，deep-test-design-e2e.md §4 已写好完整设计稿）。
**GAP-K3（P2）**：K6 托盘菜单未接 i18n——N 域 locale-parity 只扫 locale 文件，扫不到 tray 硬编码；接入后 locale-parity 自然看护。
**GAP-K4（P2）**：多显示器/高分 DPI 布局走查（人工清单）。

### 4-L 剪贴板

| 功能点        | L1/L2                              | L3  | L4        | L5                     |
| ------------- | ---------------------------------- | --- | --------- | ---------------------- |
| L1/L4         | ✓ clipboardHandlers + 06-clipboard | ✓   | ✓ 6.1/6.2 | ✗                      |
| L2/L3 OS 粘贴 | ✗ manager 本体零测试（同 GAP-A2）  | ✓   | ◐ 6.3     | ✗ 真实粘贴到第三方应用 |

### 4-M 应用更新

| 功能点    | L1/L2                                                                                                         | L3  | L4                                                                         | L5                                                             |
| --------- | ------------------------------------------------------------------------------------------------------------- | --- | -------------------------------------------------------------------------- | -------------------------------------------------------------- |
| M1–M5     | ✓ `updateManager-behavioral.test.ts`(8：semver/SHA256/checksums/路径守卫)、`updateManager-require-resolution` | ✓   | ✗ **无更新 journey**（deep-test-design-e2e §16 error-resilience 亦未落地） | ◐ 打 tag 真发版演练（notepad 记录 2026-09-05 曾实演 tag 重打） |
| M6 状态机 | ✓ `phase3`（文本）+ AboutSection 组件                                                                         | ✓   | ✗                                                                          | ✗                                                              |

**GAP-M1（P1）**：更新链 e2e 缺失可理解（真实网络），但"检查→解析→下载→校验→安装"可以用本地静态文件服务器 + 注入 Releases 响应做**全 mock 外网**的 journey（updateManager 走 fetch，可 mock）；至少把 CHECK→展示新版本卡片这段做进 e2e。
**GAP-M2（P2）**：phase3 文本断言测试应被 behavioral 版替代后删除（防假绿，comprehensive-test-strategy §3.2 旧账）。

### 4-N i18n

| 功能点      | L1/L2                                                                  | L3  | L4                         | L5             |
| ----------- | ---------------------------------------------------------------------- | --- | -------------------------- | -------------- |
| N1–N3       | ✓ `phase4-i18n`、`locale-parity`、settings-refactor（i18n 键提取核对） | ✓   | ✓ 11.2（实时切换传播主窗） | ◐ 双语视觉走查 |
| N5 托盘文案 | ✗                                                                      | —   | —                          | —              |

**GAP-N1（P2）**：N5 接入（tray.ts 菜单 label 走 i18n，主进程需监听语言变更重建菜单——接入时顺带补 tray 单测）。

### 4-O BloubBot 吉祥物

| 功能点 | L1/L2                                                                                                                                           | L3  | L4                              | L5                   |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | --- | ------------------------------- | -------------------- |
| O1–O4  | ✓ bot/ 8 文件（engine.test.ts 用 anchors/footprint 断言形状常量、skins.test.ts `TEST_HOOKS` 锁 eye-fit 位移——**spec #224 测量不变量已有钉子**） | —   | ✓ boot-health 0.7a（挂载+绘制） | ✗ 动画流畅度人眼走查 |
| O5–O6  | ✓ botSettings/botFileState/botAppearanceFlow                                                                                                    | ✓   | ◐ 0.7a                          | ✗                    |

**GAP-O1（P2）**：动画帧率/视觉回归无截图基线（可选 Playwright screenshot diff，代价低优先级低）；L5 加一条"发版前看 30 秒动画"人检。

### 4-P 数据库 / 4-Q 安全 / 4-R 日志诊断

| 功能点         | L1/L2                                                                | L3  | L4                                       | L5                                                      |
| -------------- | -------------------------------------------------------------------- | --- | ---------------------------------------- | ------------------------------------------------------- |
| P1–P6          | ✓ database×8（真实 node:sqlite、迁移失败、加密失败、FTS 降级、备份） | ✓   | ✓ boot-health 0.1（:memory: round-trip） | ✗ 真实磁盘满/DB 锁                                      |
| Q1 CSP/sandbox | ✓ windowManager 断言 + boot-health                                   | ✓   | ✓                                        | ✗ Electron 安全清单复核（可跑 `@electron/tools` audit） |
| Q3 限流        | ✓ ipcRateLimiter + Integration                                       | ✓   | ✗                                        | ✗                                                       |
| Q6 脱敏        | ✓ settingsHandlers maskApiKey 分支                                   | ✓   | ✗                                        | ✗ 日志人工抽查                                          |
| R1–R4          | ✓ logManager(9)、systemHandlers-channels                             | ✓   | ◐ 0.2 域应答                             | ✗ DEBUG_INFO 内容断言弱                                 |

**GAP-P1（P2）**：磁盘满/SQLite busy 锁定路径只有 deep-test-design-error-paths 的设计稿（§1.8/§1.10），无实现——node:sqlite 时代 busy_timeout 行为值得一条回归。
**GAP-P2（P2）**：boot-health 0.2 只断言 handler 应答存在，DEBUG_INFO 返回体（版本/平台/模型态聚合）无结构断言。

### 4-S 打包发布 / 4-T FTUE 启动 / 4-U 测试基建

| 功能点        | L1/L2                                                                                                  | L3  | L4                                   | L5                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------------ | --- | ------------------------------------ | ---------------------------------------------------------------------------------------------- |
| S1–S4         | ✓ package-runtime-dependencies、deps-lean、`pythonEnvironment-embedded-layout`、`predev-force-rebuild` | ✓   | ✗ **e2e 只跑 unpackaged dev bundle** | ✓ 打包门禁 5 类（build.yml）                                                                   |
| S5 打包态功能 | —                                                                                                      | —   | ✗                                    | ◐ mac/win boot smoke（仅启动+preload 桥，非功能）                                              |
| T1 启动序     | ✓ `main-boot-order`（含 setSafeStorage 抛出不阻断）                                                    | ✓   | ✓ 0.x/1.1                            | ◐ 真机升级路径（v1.4→v1.5 人工演练过）                                                         |
| T2–T3         | —                                                                                                      | —   | ✓ 00-ftue 0.1–0.3                    | ✗                                                                                              |
| T4 优雅退出   | ✓ main-boot-order（will-quit）                                                                         | —   | ✓ 0.7（6s 退出）                     | ✗                                                                                              |
| U1–U3         | ✓（见 §2.3/§2.4）                                                                                      | —   | —                                    | —                                                                                              |
| U4 dev smoke  | ✓ `dev-main-smoke.test.ts`（脚本自身）                                                                 | —   | —                                    | ◐ 只探 renderer 端口，主进程崩溃不挡（backlog 2026-09-05 补注，ci-check.js:98 仅 fetch :5173） |

**GAP-S1（P1）**：打包态只冒烟"能启动+preload 桥活着"，无任何打包态功能探针（如打包态下发起一次 mock-ASR 转录、打开设置窗）。发布门是唯一能抓"打包路径差异"（asar 路径、python 布局、entitlements）的层，建议在 mac/win smoke 的 `app.log` 里程碑外，经 Playwright 连接打包 app 跑 boot-health 子集（`test:e2e:boot` 指向已装 app 的可执行路径即可复用）。
**GAP-S2（P1）**：U4 dev smoke 判据升级为主进程心跳/IPC 探测（backlog 已列，处方：`runDevSmoke` 在端口可达后再向 main 进程发一条安全 IPC 探测，或扫 stdout 的 `[main:startup] phase=` 里程碑——main.ts:235/252 已埋好 phase 输出，零成本接入）。
**GAP-T1（P2）**：T4 的 will-quit 5s 竞态超时分支（卡死的 Python 子进程）仅 e2e 0.7 间接覆盖，无专门单测。

### 4-U 汇总：各域 GAP 热力

| 域                   | P0                      | P1                                  | P2  |
| -------------------- | ----------------------- | ----------------------------------- | --- |
| A 语音输入           | 1（真实链路）           | 1（粘贴 OS 层）                     | —   |
| B 热键               | —                       | 1（hotkeyManager）                  | 1   |
| C AI 润色            | —                       | 1（真实供应商）                     | 1   |
| D/E 文件/热词        | 1（平台臂）             | 3（转录旅程/diarize/热词旅程）      | —   |
| F 历史/导出          | —                       | 1（导出内容）                       | 1   |
| G 设置               | —                       | 1（4 处 meta-test）                 | 1   |
| H 权限/a11y          | —                       | 1（a11y 深度）                      | 1   |
| I/J 模型/Python      | 1（真实 ASR 回归）      | 2（killtree 臂、Tier-3 落地）       | —   |
| K 窗口/托盘          | —                       | 2（tray 单测、tray journey）        | 2   |
| L 剪贴板             | —                       | （并入 A2）                         | —   |
| M 更新               | —                       | 1（更新 journey）                   | 1   |
| N i18n               | —                       | —                                   | 1   |
| O 机器人             | —                       | —                                   | 1   |
| P/Q/R DB/安全/日志   | —                       | —                                   | 2   |
| S/T/U 打包/启动/基建 | —                       | 2（打包态功能冒烟、dev smoke 心跳） | 2   |
| 跨域（G1/G4）        | 2（e2e 门禁权、孤儿网） | —                                   | —   |

---

## 5. 黑盒/E2E 与人工验收的专项 GAP

以下场景**任何 mock 层都覆盖不了**，属于 L5 专属；现状是"能力散落、无成文脚本、无判定标准"。

| #   | 场景                                                                         | 为什么 mock 不行            | 现状证据                                                                                                  | 建议                                                                                                                          |
| --- | ---------------------------------------------------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 1   | 真实麦克风采集（权限弹窗、设备热插拔、蓝牙麦克风延迟）                       | MediaRecorder 走 OS 音频栈  | e2e 全部 mock 掉 `transcribe-audio`；无 getUserMedia 真实路径                                             | 人工 QA 清单（§8-P0-2）+ 可选 macOS `tccutil` 预授权的半自动脚本                                                              |
| 2   | 真实模型加载→识别（1.2GB 下载、torch 冷启动、SeACo/旧模型回退）              | 模型体积与加载时长          | `scripts/golden_set/` 已有 6 句×多 SNR 语料+参考文本，但只有手动 `ab_preprocessing.py`/`benchmark_asr.py` | **半自动 ASR 回归**：`scripts/asr-regression.js` 对 golden set 跑真实 server，WER 阈值判定；发版前手动档（torch 太重不进 CI） |
| 3   | 真实 LLM 网络（三家供应商、代理、超时）                                      | 真实 TLS/账单               | unit 全 mock fetch；无人工脚本                                                                            | 一页"供应商兼容性走查"清单进 `docs/qa/`                                                                                       |
| 4   | 打包态功能（asar 内 python 布局、entitlements、NSIS 安装路径带空格）         | e2e 只打 dev bundle         | build.yml:146/336 仅 boot+preload 桥                                                                      | 打包 smoke 扩展：跑 `test:e2e:boot` 指向已装 app（§8-P1-6）                                                                   |
| 5   | win32 专项（taskkill 进程树、UNC/8.3/尾点路径、PowerShell 粘贴、路径分隔符） | `process.platform` 分支     | 平台臂互不覆盖；仅 3 个测试文件有 `it.skipIf`；win e2e 在 CI non-blocking 且从未被当真                    | 对侧臂 mock 测试（P1）+ win 实机手测清单                                                                                      |
| 6   | macOS 钥匙串/权限（#211 升级弹窗、辅助功能授权）                             | safeStorage/OS 弹窗         | #211 启动序有单测，弹窗本身只能人工                                                                       | 升级路径人工脚本（v(n-1)→v(n) 装包升级走查）                                                                                  |
| 7   | 多显示器 / DPI / 深色模式 / 长文本溢出                                       | 窗口定位 OS 相关            | 无任何资产                                                                                                | 探索性 charter（session-based test management，每发版 30 分钟）                                                               |
| 8   | 无障碍真实读屏（VoiceOver/NVDA 走一遍主流程）                                | aria 静态断言不等于读屏可用 | phase5-a11y 为源码正则                                                                                    | 发版前读屏走查 3 条主旅程                                                                                                     |
| 9   | 长时运行（空闲卸载→次日预热、内存泄漏、日志轮转月级）                        | 时间尺度                    | idle-unload 有单测，无浸泡                                                                                | 每个大版本一次 24h 浸泡（可选）                                                                                               |

---

## 6. 开发自测试链路（lint/typecheck/pre-commit/dev smoke）的 GAP

| 环节                | 现状                                                                                                                    | GAP                                                                                                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| format/lint/license | ci:check stage1 + lint-staged pre-commit                                                                                | 无明显缺口（lint 0 警告强制）                                                                                                             |
| typecheck ×3        | src / tests / e2e 三个 tsconfig 全覆盖，且有 `test-typecheck-coverage.test.ts` meta-test 钉住 tsconfig.test.json 的存在 | 无缺口——这是本仓库"用测试看护测试基建"的最佳示范                                                                                          |
| 单测门              | vitest 阈值 96/92/94/96，macOS 腿强制                                                                                   | **Windows 腿不设阈值**（平台分支不可比的现实妥协），但缺"跨腿差值报警"：两腿 branch 差 0.66pp 无任何信号（→P0-3）                         |
| Python 单测         | 双腿 CI + 本地 ci:check                                                                                                 | 无覆盖率概念（stdlib unittest），协议分支靠用例数堆——可接受（推断）                                                                       |
| dev smoke           | 轮询 vite :5173 + SQLite 崩溃特征串                                                                                     | **主进程心跳盲区**：非 SQLite 的 main 崩溃不挡（GAP-S2）；vite 起来了但 main 起不来时 smoke 仍绿                                          |
| pre-commit          | 仅 lint-staged，不跑测试                                                                                                | 设计取舍合理（保提交速度）；但 **commit 前无快速单测钩子**，依赖自觉跑 `pnpm test`（可选：`lint-staged` 加相关文件 vitest run --related） |
| e2e 本地入口        | `pnpm test:e2e` / `:boot` / `:diag`；`ci:check --e2e` 可选                                                              | 文档化不足：CLAUDE.md 之外的贡献者不知道 e2e 存在（CONTRIBUTING.md 未提 e2e，推断——未逐字核对 CONTRIBUTING）                              |

---

## 7. 与业界成熟实践的对标

| 维度               | 业界参照                                                                                                                                                                                  | Murmur 现状                                                                              | 判定                                 |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------ |
| 分层结构           | VS Code：Unit / Integration / Extension / Smoke 四层 + 每层独立配置（vscode wiki "Writing Tests"）；Electron 官方推荐 Playwright（electronjs.org/docs/latest/tutorial/automated-testing） | 五级资产齐备，L1–L3 厚、L4 有资产无门禁、L5 自动化门强                                   | **结构达标**                         |
| 比例               | Google 70/20/10；Testing Trophy "mostly integration"                                                                                                                                      | L1+L2 ≈ 1770 用例 vs L4 52 用例 ≈ 97/3，符合金字塔；L2 集成厚实符合 Trophy               | **达标**                             |
| 契约先行           | central registry as source of truth（electron-testing-best-practices §2.1，VS Code 同构）                                                                                                 | `ipc-contracts.ts` 单一注册表 + 三方一致网 + d.ts 类型门——**超出典型 Electron 项目水准** | **优**                               |
| E2E 门禁权         | VS Code smoke 是发版门；Google：e2e 少但必须可信                                                                                                                                          | 52 用例 `continue-on-error`，从未拦过回归                                                | **未达标（最大差距）**               |
| 发布门禁           | VS Code/头部应用：打包态冒烟为 release blocker                                                                                                                                            | 五类发布门 + 真实发版演练记录（2026-09-05 tag 重打复盘）                                 | **优**（但打包态仅 boot 级，GAP-S1） |
| 平台矩阵           | VS Code 全平台 CI                                                                                                                                                                         | 单测双腿 ✓；平台分支臂互不覆盖、win 腿无阈值无差值报警                                   | **半达标**                           |
| a11y/视觉回归      | 头部应用常配 axe + 截图 diff                                                                                                                                                              | 仅源码正则 aria 断言                                                                     | **未达标（低风险优先级）**           |
| 测试基建 meta 护栏 | 用测试看护测试（typecheck meta-test 先例）                                                                                                                                                | 已有 typecheck/合同/ CI 配置 meta-test；缺 settings 4 处规则与覆盖率平台差值 meta-test   | **半达标**                           |
| 真实环境验收       | 桌面应用惯例：发版前手动 smoke 脚本                                                                                                                                                       | 无成文清单；golden set 闲置                                                              | **未达标**                           |

---

## 8. 优先级行动计划（23 项）

> 估时为单执行者人日。P0 建议本月内完成；P1 一个迭代；P2 随机会。与 backlog 的衔接：#P0-1 即 `ci-e2e-structural-fix` 剩余工作；#P0-4 即 `orphans-test-renderer-dim`；#P1-8 关联 `dead-channel-cleanup`。

### P0（恢复发布信心，5 项）

| #     | GAP                               | 层级 | 动作与建议文件                                                                                                                                                                                                       | 断言要点                                                                                                                                                                                                   | 估时 |
| ----- | --------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| P0-1  | G1：CI e2e 无门禁权               | L4   | 修改 `.github/workflows/ci.yml`：boot-health 步骤摘 `continue-on-error` + `retries: 1`（规格见 ci.yml:141-160 内嵌 PROMOTION PLAN）；观察 2–3 个 PR 全绿后再摘全量 e2e 的开关                                        | CI 红 = 合并Blocked；boot-health 8 用例在 mac/win 双腿绿                                                                                                                                                   | 0.5  |
| P0-2  | G2：真实链路无验收脚本            | L5   | 新建 `docs/qa/release-manual-checklist.md` + `scripts/asr-regression.js` + `package.json` 加 `test:asr`                                                                                                              | checklist 覆盖 §5 表 1/2/3/6/8；asr-regression 对 golden set 逐条跑真实 server，WER 超阈值非零退出                                                                                                         | 2    |
| P0-3  | G3：平台臂覆盖断层                | L1   | 新建 `tests/unit/platform-arms.test.ts`（或按模块拆 audioPathValidator-arms/funasrServer-arms）：`vi.mock`/stub `process.platform` 分别以 win32 与 darwin 身份执行对侧分支                                           | UNC 拒绝、8.3/尾点黑名单（win 语义）与 realpath//Volumes（mac 语义）在**同一台**机器上都断言；taskkill 与 SIGKILL 两臂同测                                                                                 | 2    |
| P0-3b | G3 配套：双腿差值无信号           | L1   | 新建 `tests/unit/coverage-meta.test.ts`：解析 vitest.config 阈值与 ci.yml，断言"阈值在 macOS 腿强制 + 记录 win 腿实测值注释"防静默漂移（轻量钉子）；或在 CI win 腿加 `--coverage.reporter=text` 输出供比对（非阻塞） | 阈值被下调/绕过时测试红                                                                                                                                                                                    | 0.5  |
| P0-4  | G4：孤儿网缺 renderer-caller 维度 | L3   | 扩展 `tests/unit/ipc-contracts-orphans.test.ts`：扫 `src/`（renderer 侧）`electronAPI.X` / `onXxx(` 调用，无 caller 的通道进黄名单（现有 KNOWN_ORPHANS 迁入并注明清理票）                                            | `EVENTS.TRANSCRIPTION_UPDATE/PROCESSING_UPDATE/ERROR/FUNASR_INSTALL_PROGRESS`、`FUNASR.INSTALL`、`WINDOW.SHOW/IS_MAX`、`SETTINGS.SAVE`、`SYSTEM.PERMISSIONS/REQUEST_PERMS/OPEN_PERMS` 全部落入黄名单显式化 | 1    |

### P1（重要回归风险，10 项）

| #     | GAP                                | 层级  | 动作与建议文件                                                                                                                                                                | 断言要点                                                                                                                                          | 估时 |
| ----- | ---------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| P1-1  | G5/K：tray 零行为测试              | L1    | 新建 `tests/unit/tray.test.ts`（设计稿：deep-test-design-managers §2.3）                                                                                                      | 图标路径 dev/prod、菜单模板三项、点击→show、退出→app.quit、createTray 异常不崩溃                                                                  | 1    |
| P1-2  | G5/B：hotkeyManager 零行为测试     | L1    | 新建 `tests/unit/hotkeyManager.test.ts`（设计稿：同上 §2.2）                                                                                                                  | register 失败日志、unregisterAll、F2 双击去抖窗口、状态机 set/get                                                                                 | 1    |
| P1-3  | G5/A：clipboard manager 本体零测试 | L1    | 新建 `tests/unit/clipboard.test.ts`（设计稿：同上 §2.1，纯命令构建 + windowsHide/超时防双 resolve）                                                                           | mac osascript / win PowerShell 命令串、3s 超时、非 darwin 不加载 osascript                                                                        | 1    |
| P1-4  | D：文件转录旅程 e2e 缺失           | L4    | 扩展 `tests/e2e/suites/05-file-import.test.ts`：真实小 wav fixture（生成 1s 静音 wav 进 `tests/fixtures/`），仅 mock `transcribe-file` 单通道                                 | 进度事件→结果卡→取消→导出按钮可达                                                                                                                 | 1    |
| P1-5  | D：diarize / 热词无旅程            | L4    | `05` 扩展或新建 `tests/e2e/suites/12-hotword-diarize.test.ts`                                                                                                                 | 热词录入→设置持久化→转录请求 options 含热词（ipc-mock 捕获入参）；diarize 按钮在 segments 存在时出现                                              | 1    |
| P1-6  | S：打包态无功能冒烟                | L5    | `.github/workflows/build.yml` 两个 smoke 步骤追加：以打包 app 为 target 跑 `pnpm exec playwright test tests/e2e/suites/00-boot-health.test.ts`（env 指向已装可执行）          | 打包态通过 boot-health 8 探针（含 mascot 与 6s 退出）                                                                                             | 1    |
| P1-7  | U/S：dev smoke 主进程盲区          | L6→L5 | `scripts/ci-check.js` `runDevSmoke`：端口可达后校验 stdout 已出现 `[main:startup] phase=window-created`（main.ts:235 现成里程碑）                                             | main 未打里程碑即超时→红                                                                                                                          | 0.5  |
| P1-8  | G4/U：死通道清理                   | L3    | 执行 backlog `dead-channel-cleanup`（沿用 `[20260816_Refactor_DeadChannels]` 先例），删除 P0-4 黄名单确认的死事件/孤儿 handler；`preload-listener-lifecycle.test.ts` 同步收缩 | 删除后 orphans 黄名单清空；全门禁绿                                                                                                               | 1    |
| P1-9  | G：settings 4 处规则 meta-test     | L3    | 新建 `tests/unit/settings-schema-invariants.test.ts`                                                                                                                          | `SettingsState` 键集 ≡ `DEFAULT_SETTINGS` ≡ `loadSettings` 读取集 ≡ `saveSettings` 写入集 ⊆ `ALLOWED_SETTING_KEYS`（解析源码 AST 或正则提取键名） | 1    |
| P1-10 | M：更新 journey                    | L4    | 新建 `tests/e2e/suites/13-update-journey.test.ts`：mock fetch 到本地 fixture 的 Releases JSON                                                                                 | 关于页出现新版本卡→下载进度事件→SHA256 失败分支展示错误                                                                                           | 1    |

### P2（完善性，8 项）

| #    | GAP                         | 动作                                                                                 | 估时 |
| ---- | --------------------------- | ------------------------------------------------------------------------------------ | ---- |
| P2-1 | H：a11y 深度                | e2e 接入 axe 扫描主/设置窗；phase5-a11y 改 RTL 行为断言                              | 1.5  |
| P2-2 | N/K：托盘菜单 i18n          | tray.ts 接 i18n + 语言变更重建菜单；locale-parity 自然看护                           | 0.5  |
| P2-3 | F：导出内容断言             | e2e 11.4 增加读回导出文件断言内容（srt 时间轴行首、docx unzip 含 document.xml 文本） | 0.5  |
| P2-4 | K：单实例锁                 | 先立项功能（`app.requestSingleInstanceLock`），随实现补测试                          | 1    |
| P2-5 | P：磁盘满/DB busy 路径      | 按 deep-test-design-error-paths §1.8/1.10 落两条 node:sqlite 回归                    | 0.5  |
| P2-6 | C：供应商兼容走查           | `docs/qa/provider-matrix.md` 三家供应商 × 测试连接 × 三模式手动单                    | 0.5  |
| P2-7 | O/M：phase 系列文本测试退役 | phase3/phase5 等被行为版替代后删除（老账，comprehensive-test-strategy §3.2）         | 0.5  |
| P2-8 | 多显示器/读屏/浸泡          | 纳入 release-manual-checklist 的探索性 charter，每大版本执行                         | 0.5  |

---

## 9. 附录：证据索引

### 9.1 命令与产物

```
ls tests/unit | wc -l                      # 130
grep -rc "test(\|it(" tests/unit ...       # 1770 处用例定义
grep -c "test(" tests/e2e/suites/*.test.ts # 52（14 文件）
node（解析 coverage/coverage-final.json）   # 96.8 stmts / 92.0 branches / 95.7 funcs / 71 files
git log -1                                  # 65262a7 @ autopilot/p1p2p3, 2026-09-06
git branch --show-current                   # autopilot/p1p2p3
```

### 9.2 关键文件

- 契约与边界：`src/helpers/ipc-contracts.ts`（65 invoke + 12 events）、`preload.ts`（256 行）、`src/electronAPI.d.ts`、`tests/unit/ipc-contracts-orphans.test.ts`（:67 handler-or-preload 判据）、`tests/unit/preload-bridge-contract.test.ts`
- 门禁：`scripts/ci-check.js`（11 门；dev smoke :70-137 仅探 :5173）、`.github/workflows/ci.yml`（:95-107 阈值 mac 腿限定；:137-164 e2e 三步 continue-on-error）、`.github/workflows/build.yml`（:78-80 sqlite 探针、:101-110 python import 门、:126-127 preload 门、:146 mac smoke、:336 win smoke）、`.husky/pre-commit`
- 覆盖率：`vitest.config.ts`（:76-79 阈值；exclude 8 helper + ipc/\*\*；:55-75 平台 scope 注释）、`coverage/coverage-final.json`
- GAP 实体：`src/helpers/tray.ts:111-143`（硬编码中文菜单）、`tests/unit/phase5-a11y.test.ts`（正则断言）、`tests/unit/phase3-semi-auto-update.test.ts`（文本断言）、`scripts/golden_set/`（闲置 ASR 语料）、`tests/e2e/helpers/electron-launch.ts`（:237 仅 DB 隔离）
- 平台臂：`backlog.md` orphans-test-renderer-dim 注（win 91.53% vs mac 92.19%，CI run 33942345594）；`it.skipIf` 仅 3 文件（audioPathValidator-branches/-symlink、funasrServer-spawn）
- 历史策略（本文与其差异见 §2.6）：`docs/research/test-coverage-gap-analysis.md`、`comprehensive-test-strategy.md`、`deep-test-design-{v2,managers,e2e,error-paths}.md`、`e2e-functional-verification-strategy.md`、`electron-testing-best-practices.md`、`2026-08-20-scout-full-audit.md`

### 9.3 业界来源（2026-09-06 经 WebSearch 核实）

1. ISTQB CTFL v4.0 Test Levels — https://astqb.org/2-2-test-levels-and-test-types/ ；https://istqb.org/certifications/certified-tester-foundation-level-ctfl-v4-0/
2. Test Pyramid（Cohn 2009，Fowler 重述）— https://martinfowler.com/articles/practical-test-pyramid.html
3. Testing Trophy — https://kentcdodds.com/blog/write-tests ；https://kentcdodds.com/blog/the-testing-trophy-and-testing-classifications
4. Google Test Sizes — https://testing.googleblog.com/2010/12/test-sizes.html
5. Google 70/20/10 — https://testing.googleblog.com/2015/04/just-say-no-to-more-end-to-end-tests.html
6. Playwright Electron API — https://playwright.dev/docs/api/class-electron
7. Electron Automated Testing — https://electronjs.org/docs/latest/tutorial/automated-testing
8. VS Code Writing Tests wiki — https://github.com/microsoft/vscode/wiki/Writing-Tests ；Playwright Electron 采纳 — https://code.visualstudio.com/updates/v1_67

### 9.4 诚实性声明

- 覆盖率数字来自仓库现存产物 `coverage/coverage-final.json`（HEAD 提交的 CI 跑批），未重跑全量套件；行覆盖率因 vitest v8 产物缺 `lineMap` 未从此文件重算，引用 notepad 记录的 97.1%（2026-09-05）。
- e2e 52 用例的"全绿"结论来自 `.omc/notepad.md`（2026-09-05 46/46）与 backlog 二补注 + 此后新增用例的用例名审查，未在本机重跑。
- §4 中标记"推断"的条目：dev smoke 文档化程度（CONTRIBUTING 未逐字核对）、deep-test-design-error-paths 落地度未逐条核对、Python 侧无覆盖率判断。
- 遵守任务约束：未修改任何源码或测试文件；本文档为唯一产出。
