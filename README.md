<div align="center">

<img src="assets/icon.png" width="120" height="120" alt="Murmur Logo" />

# Murmur

**开源 · 本地 · AI 语音输入**

说话就能打字，音频秒转文字。基于 FunASR，数据不出你的电脑。

[English](#english) · [中文](#中文)

[![License: Apache 2.0](https://img.shields.io/badge/license-Apache_2.0-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)](#安装)
[![Tests](https://img.shields.io/badge/tests-534%20passing-brightgreen)](tests/)
[![Coverage](https://img.shields.io/badge/coverage-95%25-brightgreen)](tests/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

<!-- TODO: 添加产品演示 GIF -->
<!-- <img src="assets/demo.gif" width="800" /> -->

</div>

---

<a id="中文"></a>

## 为什么选择 Murmur？

|               |   Murmur   | macOS 原生听写 |  讯飞语记  | Whisper Desktop |
| ------------- | :--------: | :------------: | :--------: | :-------------: |
| 中文精度      | ⭐⭐⭐⭐⭐ |     ⭐⭐⭐     | ⭐⭐⭐⭐⭐ |     ⭐⭐⭐      |
| 完全本地      |     ✅     |       ✅       |     ❌     |       ✅        |
| AI 后处理     |     ✅     |       ❌       |     ❌     |       ❌        |
| 开源免费      |     ✅     |       ✅       |     ❌     |       ✅        |
| 10+ AI 模型   |     ✅     |       ❌       |     ❌     |       ❌        |
| 自定义 Prompt |     ✅     |       ❌       |     ❌     |       ❌        |

## 特性

| 🎤 高精度中文识别       | 🤖 AI 智能润色       | ⌨️ 全局热键       | 🔒 完全本地 |
| ----------------------- | -------------------- | ----------------- | ----------- |
| FunASR Paraformer-large | 去除口头禅、修正错话 | `Cmd+Shift+Space` | 零数据上传  |

| 🌐 10+ AI 模型                        | 📁 音频文件转录  | 💾 转录历史          | 🌍 双语支持  |
| ------------------------------------- | ---------------- | -------------------- | ------------ |
| OpenAI/DeepSeek/通义/智谱/本地 Ollama | wav/mp3/m4a/flac | SQLite + 搜索 + 导出 | 中文/English |

## 安装

```bash
# macOS (Homebrew)
brew install --cask murmur

# Windows (Winget)
winget install TeFuirnever.Murmur
```

或从 [Releases](https://github.com/TeFuirnever/Murmur/releases) 下载安装包。

> **首次安装**：macOS 如遇"无法验证开发者"，右键点击应用 → 选择"打开"
>
> Windows 如遇 SmartScreen 拦截，点击"更多信息" → "仍要运行"

## 30 秒上手

1. 启动 Murmur，等待模型下载完成（首次约 1GB）
2. 按下 `Cmd+Shift+Space` 开始说话
3. 文字自动出现在光标处

**使用 AI 润色**（可选）：打开设置 → 选择 AI 模型提供商（DeepSeek、通义千问、Ollama 等） → 填入 API Key 或使用本地模型

## 支持的 AI 模型

| 提供商               | Base URL               | 需要 API Key |
| -------------------- | ---------------------- | :----------: |
| OpenAI               | api.openai.com/v1      |      ✅      |
| DeepSeek             | api.deepseek.com/v1    |      ✅      |
| 通义千问             | dashscope.aliyuncs.com |      ✅      |
| 智谱 GLM             | open.bigmodel.cn       |      ✅      |
| 硅基流动             | api.siliconflow.cn     |      ✅      |
| Groq                 | api.groq.com           |      ✅      |
| Moonshot             | api.moonshot.cn        |      ✅      |
| MiniMax              | api.minimaxi.com       |      ✅      |
| **Ollama (本地)**    | localhost:11434        |      ❌      |
| **LM Studio (本地)** | localhost:1234         |      ❌      |

只需选择提供商，Murmur 自动填入地址和模型。

---

## 从源码构建

### 环境要求

- **Node.js** 18+ 和 [pnpm](https://pnpm.io)
- **Python** 3.8+（用于 FunASR）
- **ffmpeg**（macOS: `brew install ffmpeg`）

### 快速开始

```bash
git clone https://github.com/TeFuirnever/Murmur.git
cd Murmur
pnpm install

# Python 环境（二选一）
# 方案 A: uv（推荐）
curl -LsSf https://astral.sh/uv/install.sh | sh
uv sync && uv run python download_models.py

# 方案 B: 系统 Python
pip install funasr modelscope torch torchaudio librosa numpy
python download_models.py

pnpm dev
```

### 开发命令

```bash
pnpm dev          # 启动开发模式
pnpm test         # 运行测试（521 tests）
pnpm lint         # 代码检查
pnpm typecheck    # TypeScript 类型检查
pnpm ci:check     # 本地运行所有 CI 门禁
```

---

## 技术栈

| 层级     | 技术                                                  |
| -------- | ----------------------------------------------------- |
| 桌面框架 | Electron 36                                           |
| 前端     | React 19, Tailwind CSS 4, Vite                        |
| 语音识别 | FunASR (Paraformer-large + FSMN-VAD + CT-Transformer) |
| AI 优化  | 10+ OpenAI 兼容模型 + 自定义 Prompt 模板              |
| 数据存储 | SQLite (better-sqlite3, safeStorage 加密)             |

## 路线图

- [x] 本地 FunASR 语音识别
- [x] AI 文本智能优化（10+ 模型）
- [x] 自定义 AI Prompt 模板
- [x] 本地模型支持（Ollama / LM Studio）
- [x] 音频文件导入转录
- [x] 转录历史搜索和导出
- [x] 全局热键
- [x] 多语言支持（中文/English）
- [x] 自动更新检测
- [x] 无障碍（ARIA + 键盘导航）
- [x] GPU 自动检测（CUDA > MPS > CPU）
- [x] TypeScript 严格模式
- [x] 文件配置支持（~/.murmur.json）
- [ ] 实时流式转录（200ms 延迟）
- [ ] CLI 模式
- [ ] ASR 多引擎支持（whisper.cpp）

详见 [Projects](https://github.com/TeFuirnever/Murmur/projects) 查看完整规划。

## 参与贡献

PRs welcome! 见 [CONTRIBUTING.md](CONTRIBUTING.md) 了解开发环境搭建、代码规范和提交流程。

## 致谢

- [蛐蛐(QuQu)](https://github.com/yan5xu/ququ) — 本项目的上游项目
- [FunASR](https://github.com/modelscope/FunASR) — 阿里巴巴开源语音识别工具包
- [shadcn/ui](https://ui.shadcn.com/) — UI 组件

## 许可证

[Apache License 2.0](LICENSE)

---

<a id="english"></a>

## Why Murmur?

|                    |   Murmur   | macOS Dictation |  iFlytek   | Whisper Desktop |
| ------------------ | :--------: | :-------------: | :--------: | :-------------: |
| Chinese Accuracy   | ⭐⭐⭐⭐⭐ |     ⭐⭐⭐      | ⭐⭐⭐⭐⭐ |     ⭐⭐⭐      |
| Fully Local        |     ✅     |       ✅        |     ❌     |       ✅        |
| AI Post-processing |     ✅     |       ❌        |     ❌     |       ❌        |
| Open Source        |     ✅     |       ✅        |     ❌     |       ✅        |
| 10+ AI Models      |     ✅     |       ❌        |     ❌     |       ❌        |
| Custom Prompts     |     ✅     |       ❌        |     ❌     |       ❌        |

## Features

| 🎤 Accurate Chinese     | 🤖 AI Refinement                  | ⌨️ Global Hotkey  | 🔒 Fully Local   |
| ----------------------- | --------------------------------- | ----------------- | ---------------- |
| FunASR Paraformer-large | Remove filler words, fix mistakes | `Cmd+Shift+Space` | Zero data upload |

| 🌐 10+ AI Models                | 📁 File Transcription | 💾 History               | 🌍 i18n         |
| ------------------------------- | --------------------- | ------------------------ | --------------- |
| OpenAI/DeepSeek/Qwen/GLM/Ollama | wav/mp3/m4a/flac      | SQLite + search + export | zh-CN / English |

## Install

```bash
# macOS (Homebrew)
brew install --cask murmur

# Windows (Winget)
winget install TeFuirnever.Murmur
```

Or download from [Releases](https://github.com/TeFuirnever/Murmur/releases).

## Quick Start

1. Launch Murmur, wait for model download (~1GB first time)
2. Press `Cmd+Shift+Space` and start speaking
3. Text appears at your cursor

**AI Polish** (optional): Settings → choose provider (DeepSeek, Qwen, Ollama, etc.) → enter API key or use local model

## Build from Source

```bash
git clone https://github.com/TeFuirnever/Murmur.git
cd Murmur && pnpm install

# Python setup (choose one)
curl -LsSf https://astral.sh/uv/install.sh | sh  # Option A: uv (recommended)
uv sync && uv run python download_models.py

pip install funasr modelscope torch torchaudio librosa numpy  # Option B: system Python
python download_models.py

pnpm dev
```

## Tech Stack

| Layer    | Technology                                             |
| -------- | ------------------------------------------------------ |
| Desktop  | Electron 36                                            |
| Frontend | React 19, Tailwind CSS 4, Vite                         |
| Speech   | FunASR (Paraformer-large + FSMN-VAD + CT-Transformer)  |
| AI       | 10+ OpenAI-compatible models + custom prompt templates |
| Storage  | SQLite (better-sqlite3, safeStorage encryption)        |

## Roadmap

- [x] Local FunASR speech recognition
- [x] AI text optimization (10+ models)
- [x] Custom AI prompt templates
- [x] Local model support (Ollama / LM Studio)
- [x] Audio file transcription
- [x] History search and export
- [x] Global hotkey
- [x] Multi-language (Chinese/English)
- [x] Auto-update detection
- [x] Accessibility (ARIA + keyboard nav)
- [ ] Real-time streaming transcription
- [ ] CLI mode
- [ ] Multi-engine ASR (whisper.cpp)

## Contributing

PRs welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, code standards, and PR process.

## Acknowledgments

- [QuQu](https://github.com/yan5xu/ququ) — Upstream project
- [FunASR](https://github.com/modelscope/FunASR) — Alibaba open-source speech recognition
- [shadcn/ui](https://ui.shadcn.com/) — UI components

## License

[Apache License 2.0](LICENSE)
