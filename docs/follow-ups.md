# Follow-ups（v3 反思后遗留事项）

> [20260725_Autopilot_T1.5] 本文档为时间快照，文中 `.js` 文件名引用是写作时（ADR-010 big-bang 之前）的状态。当前源码已全部迁移到 `.ts`（见 `docs/adr/010-backend-ts-migration-strategy.md`）。下文保留原始文件名作为决策时的快照。

## ~~P1：路径遍历防护~~ ✅ 已修复

原始 SHOW_ITEM / OPEN_LOG channel 已在重构中移除。当前路径遍历防护覆盖：

- `src/helpers/audioPathValidator.js` — `validateAudioPath()` 使用 `path.resolve()` + `startsWith()` 双重校验，限制在 homedir/tmpdir/Volumes 内（从 `transcriptionHandlers.js` 提取）
- `src/helpers/updateManager.js` — 安装路径同样校验，限制在 app temp 目录内

## ~~P2-B: useModelStatus 双订阅~~ ✅ 已修复

提取为 `ModelStatusProvider` React Context 单例，App.tsx 和 useRecording.ts 共享一个实例。实现在 `src/hooks/useModelStatus.tsx`。

## ~~P2-C: C.FUNASR.GET_LOGS 错位~~ ✅ 已移除

GET_LOGS 相关 channel 和 handler 已在重构中完全移除，不再存在。

## ~~P2-D: 19 个孤儿 ipcMain.handle~~ ✅ 已清理

commit `4fd799f`: 15 个真正孤儿的 handler 注册和 contract 常量已删除（ENVIRONMENT 2、PYTHON 3、FUNASR 3、CLIPBOARD 2、SYSTEM 5）。
4 个误判（TRANSCRIPTION.GET/SEARCH/STATS、WINDOW.CLOSE_APP）已从白名单移除，它们在 preload 中正常暴露。
同时清理了死代码 EVENT.PYTHON_INSTALL_PROGRESS 和 systemHandlers.js 中未使用的 `path` 导入。

测试守门：`tests/unit/ipc-contracts-orphans.test.js` 的 `KNOWN_ORPHANS` 白名单现在只剩 AUDIO_EXTENSIONS 数组索引（非 IPC channel）。

## CSP 增加 dashscope（v2 备注）

当前 AI 调用走主进程，无需添加。如未来 renderer 直连 dashscope，再补。

## sandbox 决策评估

v1 release 后写 ADR 评估 `sandbox: true` 的收益与维护成本。

## P3：内部代码区分 ASR vs AI 概念

UI 文案本轮已澄清（"语音识别"≠"AI 文本优化"），但内部仍混用 `model` 一词：

- `ipc-contracts.js` 的 `MODELS.*` 已在之前的重构中清理
- `useModelStatus` hook 仍泛指 ASR 状态 — 可改 `useASRModelStatus`
- 写 ADR 文档化两类模型的边界，新人 onboarding 看一眼就懂

破坏面较大，v1 发布后再统一重构。

## Dev 启动防护网（P1/P2 后续）

> 来源：`docs/research/electron-dev-startup-hardening.md`（2026-07-28 审计）。P0 已落地于 commit `f5c7f3f`（dev:main 运行时 smoke + better-sqlite3 ABI preflight）。下列为剩余项。

### P2.1 — 消除 dev/prod 加载不对称 ✅ 已落地（commit 2e93278，PR #117）

dev:main 改用 `build:main && electron .`，dev/e2e/prod 加载同一 artifact（dist-main/main.js）。tsx-direct 路径整个消失，silent-hang 温床根除。采用一次性 build（非 --watch）：architect 确认更优（electron 主进程无 HMR，改 main.ts 反正重启）。

### P1.1 — canary 提升为 E2E 强断言 ⏸ 受阻（2026-07-28 试过）

目标：electron-launch.ts 缓冲 main 输出，firstWindow 后断言 `[main:canary]`。试过发现两个阻塞：

1. **canary 时序**：canary（`main.ts:12`）在 electron 启动早期触发，而 `mainOutputBuf` 在 `electron.launch()` 返回后才 attach → 错过早期 canary，gate 可能断言不到。需重想捕获方式（main 写文件 / gate 用晚期信号）。
2. **e2e 环境**：worktree firstWindow timeout（主 repo 同 e2e diag 过、worktree 不通，疑 embedded python/资源差异）；CI e2e 也 non-blocking（ADR-014 firstWindow 至今未解决）。

价值依赖 e2e 转 blocking（未来）；当前不急，#116 smoke 已是 blocking 兜底。

### P2.2 — 治本 dev/test ABI 互斥 ⏸ A 不可行（2026-07-28 试过）

- **Option A（`ELECTRON_RUN_AS_NODE` vitest）已证不可行**：试跑全 test → 84 fail / 79 files。Murmur test suite 不兼容 electron node runtime（electron-stub mock / 系统 node 模块行为差异，如 `preload-loadable.test.ts` 的 `requireCJS.cache["electron-stub"]`）。修 84 test 不值得。
- **当前最优 = #116**：rebuild（CI test 前）+ pretest probe（本地 dev/test 切换提示），已 merged。
- Option B（ADR 文档化排除契约）价值有限（#116 注释已解释 ABI split），按需。

## README 平台徽章承诺了未发布的 Linux（2026-08-19 视景评审 H-5）

README 平台徽章写着 macOS | Windows | Linux，但 Releases 只发布 dmg/exe。按 VISION.md「文档与现实一致」原则，应从徽章移除 Linux（或显式标注为规划中）。维护者裁决：暂不支持 Linux（完整记录见 `docs/vision-answers.md` H-5）。待维护者确认改法后执行。
