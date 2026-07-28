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

### P1.1 — canary 提升为 E2E 强断言（~2h）

`tests/e2e/helpers/electron-launch.ts` 缓冲 stderr，`firstWindow()` 后断言 `[main:canary]` 存在；失败时打印捕获的 stderr。硬化所有 E2E suite（不只新 smoke），关闭审计 Hole 3（canary 信号存在但无测试断言）。

### P2.1 — 消除 dev/prod 加载不对称（silent-hang 的结构性根因）

dev（tsx 直跑 `main.ts`）与 prod（`dist-main/main.js` bundle）加载机制不同，正是 silent-hang class 的温床。

- **Option A**（ponytail 之选，~0.5d）：`esbuild main.ts --bundle --watch` 给 dev，`dev:main` 指向 bundle，dev/prod 同一 artifact。复用现有 esbuild config（`package.json` build:main）。
- **Option B**（业界默认，~1 周）：迁 electron-vite，main/preload/renderer 统一 bundle + renderer HMR，结构性消除该 class。

P0.1 smoke 已让 tsx-direct 安全可留 → Option A 可选；Option B 待第二次 dev-path 回归或 predev 手动 rebuild 的 dev-loop 痛点 justify 再启动。

### P2.2 — 治本 dev/test ABI 互斥

- 跑 UT 用 `ELECTRON_RUN_AS_NODE=1`（共享 electron ABI 135），消除 dev/test 切换。
- 或把 better-sqlite3 在系统 Node 下的排除契约正式化（ADR + `vitest.config.ts:27-48` 边界文档化），让排除是 deliberate boundary 而非偶然。
