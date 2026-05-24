# Follow-ups（v3 反思后遗留事项）

## ~~P1：SHOW_ITEM / OPEN_LOG 路径遍历漏洞~~ ✅ 已修复

commit `615f879`: 使用 `path.resolve()` + `startsWith()` 双重校验。

## ~~P2-B: useModelStatus 双订阅~~ ✅ 已修复

commit `e856cd0`: 提取为 `ModelStatusProvider` React Context 单例，App.jsx 和 useRecording.js 共享一个实例。

## ~~P2-C: C.FUNASR.GET_LOGS 错位~~ ✅ 已修复

commit `db464d0`: 从 systemHandlers 移至 environmentHandlers。

## P2-D: 19 个孤儿 ipcMain.handle（v3 删了 3 个，本轮移了 1 个 GET_LOGS，剩 19 个）

下列 channel 在主进程注册但 preload 未暴露、renderer 无人调用。需逐个判断"删 vs 暴露"：

- `C.ENVIRONMENT.GET_CONFIG`
- `C.ENVIRONMENT.VALIDATE`
- `C.PYTHON.CHECK`
- `C.PYTHON.INSTALL`
- `C.PYTHON.TEST_ENV`
- `C.FUNASR.CHECK`
- `C.FUNASR.SERVER_STATUS`
- `C.FUNASR.GET_LOGS`
- `C.TRANSCRIPTION.GET`
- `C.TRANSCRIPTION.SEARCH`
- `C.TRANSCRIPTION.STATS`
- `C.CLIPBOARD.INSERT`
- `C.CLIPBOARD.MACOS_A11Y`
- `C.SYSTEM.SHOW_ITEM`
- `C.SYSTEM.GET_APP_PATH`
- `C.SYSTEM.GET_APP_LOGS`
- `C.SYSTEM.GET_LOG_PATH`
- `C.SYSTEM.OPEN_LOG`
- `C.WINDOW.CLOSE_APP`

测试守门：`tests/unit/ipc-contracts-orphans.test.js` 的 `KNOWN_ORPHANS` 白名单保护以上常量，每删一个需同步白名单。

## CSP 增加 dashscope（v2 备注）

当前 AI 调用走主进程，无需添加。如未来 renderer 直连 dashscope，再补。

## sandbox 决策评估

v1 release 后写 ADR 评估 `sandbox: true` 的收益与维护成本。

## P3：内部代码区分 ASR vs AI 概念

UI 文案本轮已澄清（"语音识别"≠"AI 文本优化"），但内部仍混用 `model` 一词：

- `ipc-contracts.js` 的 `MODELS.*` 实际只指 ASR — 可重命名为 `ASR_MODELS.*`
- `useModelStatus` hook 名同上 — 可改 `useASRModelStatus`
- 写 ADR 文档化两类模型的边界，新人 onboarding 看一眼就懂

破坏面较大，v1 发布后再统一重构。
