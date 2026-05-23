# ADR 005: AI Provider Presets + Local Model Detection

**状态**: 已采纳 (2026-05-23)

## 上下文

用户配置 AI 时需要手动查找并填写 base URL 和模型名称，门槛高。本地运行的模型（Ollama、LM Studio）虽然有 SSRF 支持，但用户不知道如何配置。

## 决策

两层方案：
1. **Provider Presets 注册表**：预定义 8 个已知 provider（OpenAI、DeepSeek、通义千问、智谱 GLM、硅基流动、Groq、Ollama、LM Studio），包含 base URL 和推荐模型
2. **Local Model Auto-Detection**：启动时探测 localhost:11434 (Ollama) 和 localhost:1234 (LM Studio)，2 秒超时

前端设置页直接使用 preset 按钮，本地模型跳过 API key 验证。

## 理由

参考 OpenCode 支持 75+ 模型的策略，Murmur 从"用户必须自己找 API Key"进化为"开箱即用 + 按需扩展"。Preset 按钮是最直观的方式，自动检测提供即时反馈。

## 影响

- `src/helpers/providerPresets.js` — 8 个 provider 预设 + `getProviderPresets`/`getProviderByName`
- `src/helpers/detectLocalModels.js` — `detectLocalModels` 探测本地运行模型
- `src/settings.jsx` — 新增 SiliconFlow/Groq/Ollama/LM Studio 预设按钮
- `src/helpers/ipc/aiHandlers.js` — 新增 `GET_PROVIDER_PRESETS` 和 `DETECT_LOCAL_MODELS` IPC
