# Follow-ups（v3 反思后遗留事项）

## P2-B: useModelStatus 双订阅
- `src/App.jsx:237` 和 `src/hooks/useRecording.js:36` 各 new 一次 `useModelStatus`
- 每次 `onModelDownloadProgress` / `onProcessingUpdate` 事件触发两次 setState
- TODO: 抽 Context 单例

## P2-C: C.FUNASR.GET_LOGS 错位
- 注册在 `src/helpers/ipc/systemHandlers.js:182`，应在 environmentHandlers
- 仅领域错位，无功能影响。下一轮重组 IPC 模块时一起处理

## P2-D: 20 个孤儿 ipcMain.handle（v3 删了 3 个，剩 17 个）

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

## P1：SHOW_ITEM / OPEN_LOG 路径遍历漏洞
`src/helpers/ipc/systemHandlers.js` 的路径校验用 `startsWith(userDataPath)` 但未调用 `path.resolve()`。
攻击向量：`/mock/userData/../../etc/passwd` 通过校验（以 `/mock/userData` 开头）。
修复方案：`const resolved = path.resolve(fullPath); if (!resolved.startsWith(userDataPath))`。
优先级高，v1 发布前应修。

## `useModelStatus` 现在多了一条 onSettingsUpdate 订阅
本轮加的 SETTINGS_UPDATE 监听器与 P2-B 双订阅叠加，每次保存设置触发**两次** `checkModelStatus`。修双订阅时一起解决。
