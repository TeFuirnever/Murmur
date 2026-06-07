# Follow-ups（v3 反思后遗留事项）

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
