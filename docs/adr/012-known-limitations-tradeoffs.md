# ADR 012: Known Limitations & Technical Debt (v1)

**Status**: Accepted — deferred to post-v1

**Updated**: 2026-05-31 — Issue 3 已修复，Issue 4 prompt 统一 + mode bug 已修复，prompt 质量仍待提升

## Context

v1 release 已知若干体验层面的技术债务。这些问题不阻塞发布，但影响用户感知到的产品完成度。记录于此以便后续迭代排期。

---

## 1. 长音视频文件转录超时

**现象**: 导入长音频/视频文件（通常 >30 分钟）时，转录过程可能触发 10 分钟超时 (`funasrServer.js:356`)，导致失败。

**根因**:

- `transcribeFile` 硬编码 `timeout: 600000`（10 分钟），无论文件时长
- FunASR Python 端一次性加载整个文件处理，无分片/流式机制
- 前端仅有 `FILE_TRANSCRIPTION_PROGRESS` 事件，无法根据文件大小动态调整超时

**Tradeoff**:

- v1 选择了固定超时而非动态计算，因为后者需要知道音频时长（需要 ffmpeg probe），增加了复杂度
- 超时阈值 10 分钟覆盖了绝大多数日常场景（<60 分钟音频），但对会议录音等长场景不够

**可能的改进方向**:

- Python 端分片处理（chunked transcription），分段返回结果
- 前端根据文件大小估算超时，或引入取消+重试机制
- 支持视频文件直接导入（当前需转音频，增加预处理时间）

---

## 2. 高噪声环境下 ASR 准确率低

**现象**: 在噪声较大的场景（街头、餐厅、多人同时说话），FunASR 转录结果错字率显著上升，包含大量乱码或遗漏。

**根因**:

- FunASR paraformer 模型在 SNR（信噪比）<10dB 时精度急剧下降，这是端侧模型的固有局限
- Murmur 当前无音频预处理管线（降噪、VAD 增强等），原始音频直接送入模型
- 录音设备差异大（MacBook 内置麦克风 vs 外接麦克风），内置麦克风降噪能力有限

**Tradeoff**:

- v1 不引入降噪预处理管线，因为：(a) 增加延迟和 CPU 占用；(b) 过度降噪可能损伤语音质量；(c) 端侧实时降噪方案成熟度不够
- 依赖用户选择较好的录音环境，产品定位偏"个人备忘/会议笔记"而非"嘈杂环境专业转写"

**可能的改进方向**:

- 引入 RNNoise / WebRTC降噪等轻量级预处理
- 支持 VAD（Voice Activity Detection）预过滤静音/噪声段，仅送有效语音段给模型
- 提供录音质量实时反馈（波形可视化、信噪比指示）
- 长期：评估 Whisper 等抗噪能力更强的模型作为备选引擎

---

## 3. ~~AI 文本处理请求超时~~ ✅ 已修复

`processTextWithAI` 添加 60s `AbortController` 超时，`checkAIStatus` 添加 15s 超时。超时后返回中文友好提示。两个函数的 catch 块均识别 `TIMEOUT` code。

---

## 4. 小红书 / 大众点评 AI 生成效果差

**现象**: 使用"小红书风格"和"大众点评"AI 创作稿模式时，生成内容质量明显低于预期：格式生硬、emoji 使用不自然、内容空洞、与原始转录关联度低。

**根因**:

- **Prompt 设计问题**: prompt 指令过于泛化，缺少高质量示例（few-shot）
- ~~**大众点评 prompt 更严重**: `getAIReviewPrompt` 在 `exportFormatters.js:287` 中定义，与主 prompt 系统 (`aiPrompts.js`) 完全分离~~ ✅ 已统一到 `aiPrompts.js`
- ~~**小红书 prompt 在两处定义**~~ ✅ 已统一，删除 `exportFormatters.js` 中的 `getAIReviewPrompt`
- ~~**AI_REVIEW 走了 `optimize` mode**~~ ✅ 已修复，`AI_REVIEW` 现在使用 `buildPrompt` + 原始 prompts 传入
- **无 prompt 版本管理**: 用户无法微调 prompt，所有平台风格共用同一套不可修改的指令

**已完成的修复**:

- `dianping`、`professional`、`raw_with_notes` 三个模式已移入 `aiPrompts.js`，统一管理
- `exportFormatters.js` 的 `getAIReviewPrompt` 已删除
- `AI_REVIEW` handler 改用 `buildPrompt(template, text)` + 原始 prompts 传入

**仍需改进**:

- 为每个平台风格添加 2-3 个高质量 few-shot 示例
- 支持用户自定义 prompt 模板（已有 `loadCustomTemplates` 基础设施，但 AI_REVIEW 未接入）
- 支持流式响应（`stream: true`），前端逐步展示生成结果

---

## Summary

| #   | Issue              | Severity   | Effort     | Status                           |
| --- | ------------------ | ---------- | ---------- | -------------------------------- |
| 1   | 长音视频转录超时   | Medium     | Medium     | Open — 需要 Python 端分片改造    |
| 2   | 高噪声 ASR 准确率  | Medium     | High       | Open — 模型能力 + 降噪管线       |
| 3   | AI 请求无超时控制  | ~~High~~   | ~~Low~~    | ✅ 已修复                        |
| 4a  | AI_REVIEW mode bug | ~~Medium~~ | ~~Low~~    | ✅ 已修复                        |
| 4b  | Prompt 重复/分裂   | ~~Medium~~ | ~~Medium~~ | ✅ 已统一                        |
| 4c  | Prompt 质量待优化  | Medium     | Medium     | Open — few-shot + 用户自定义模板 |
