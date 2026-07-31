<div align="center">

<img src="assets/icon.png" width="120" height="120" alt="Murmur Logo" />

# Murmur

**开源 · 本地 · AI 语音转文字**

说话就能打字，音频秒转文字，AI 自动润色。基于 FunASR，数据不出你的电脑。

[![License: Apache 2.0](https://img.shields.io/badge/license-Apache_2.0-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)](#安装)

<!-- [20260731_README_DynamicBadge] Replaced hardcoded "tests-672 passing" /
     "coverage-95%" badges (which were stale — the 95% figure used the old
     narrow coverage scope of ~40 helper files; current full-src scope is
     ~46%, see CHANGELOG [1.1.0]) with a dynamic CI status badge. Coverage
     badge removed entirely because no codecov/coveralls uploader is wired
     into CI yet — to restore it, add codecov-action to .github/workflows
     and then link a codecov badge. -->

[![CI](https://img.shields.io/github/actions/workflow/status/TeFuirnever/Murmur/ci.yml?branch=main&label=CI&style=flat)](https://github.com/TeFuirnever/Murmur/actions/workflows/ci.yml)

<!-- [20260731_README_DynamicBadge] END -->

[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![Stars](https://img.shields.io/github/stars/TeFuirnever/Murmur?style=social)](https://github.com/TeFuirnever/Murmur)

[English](#english) · [中文](#中文)

<!-- [20260731_README_RewriteHero] Hero 区强化价值主张。
     TODO（需项目维护者录制）：录制 10 秒产品演示 GIF，
     展示「说话 → 文字出现 → AI 润色 → 自动粘贴」完整流程，
     替换下方占位注释。这是 README 最高 ROI 的转化元素。 -->
<!-- <img src="assets/demo.gif" width="800" alt="Murmur Demo — speak → text → AI polish → paste" /> -->
<!-- [20260731_README_RewriteHero] END -->

</div>

---

<a id="中文"></a>

## 为什么选择 Murmur？

**Murmur 是为中文优化的本地语音转文字工具。** 它不只是"语音输入"——按一下快捷键说话，文字出现在光标处；导入音频文件，批量转写并导出；再用 AI 去除口头禅、整理成会议纪要或小红书文案。全部在你的电脑上完成，无需联网，无需上传。

> **定位说明**：Murmur 不与 macOS/Windows 系统听写正面竞争实时性，而是聚焦三个系统听写做不到的事——**文件转录**、**AI 后处理**、**完全本地 + 可自定义模型**。实时流式转录在规划中（见[路线图](#-路线图)）。

### 🆚 与同类工具对比

| 能力                |   Murmur   | macOS 原生听写 |  讯飞语记  | Whisper Desktop |
| ------------------- | :--------: | :------------: | :--------: | :-------------: |
| **音频文件转录**    |     ✅     |       ❌       |     ✅     |       ✅        |
| **AI 后处理**       |     ✅     |       ❌       |     ❌     |       ❌        |
| **完全本地**        |     ✅     |       ✅       |     ❌     |       ✅        |
| **自定义 Prompt**   |     ✅     |       ❌       |     ❌     |       ❌        |
| **11+ AI 模型可选** |     ✅     |       ❌       |     ❌     |       ❌        |
| 中文识别精度        | ⭐⭐⭐⭐⭐ |     ⭐⭐⭐     | ⭐⭐⭐⭐⭐ |     ⭐⭐⭐      |
| 开源免费            |     ✅     |       ✅       |     ❌     |       ✅        |

> 系统听写在"实时性"上更强（流式低延迟），Murmur 在"转写后能做什么"上更强（AI 润色 + 文件批处理 + 隐私）。两者可以共存。

## ✨ 特性

| 🎤 高精度中文识别       | 🤖 AI 智能润色           | 📁 音频文件转录       | 🔒 完全本地 |
| ----------------------- | ------------------------ | --------------------- | ----------- |
| FunASR Paraformer-large | 去口头禅、修错字、整纪要 | wav/mp3/m4a/flac 批量 | 零数据上传  |

| ⌨️ 全局热键            | 🌐 11+ AI 模型                        | 💾 转录历史          | 🌍 双语支持  |
| ---------------------- | ------------------------------------- | -------------------- | ------------ |
| `Cmd+Shift+Space` 即录 | OpenAI/DeepSeek/通义/智谱/本地 Ollama | SQLite + 搜索 + 导出 | 中文/English |

## 🚀 安装

```bash
# macOS (Homebrew)
brew install --cask murmur

# Windows (Winget)
winget install TeFuirnever.Murmur
```

或从 [Releases](https://github.com/TeFuirnever/Murmur/releases) 下载安装包。

> **首次安装提示**
>
> - **macOS**：如遇"无法验证开发者"，右键点击应用 → 选择"打开"
> - **Windows**：如遇 SmartScreen 拦截，点击"更多信息" → "仍要运行"

## ⚡ 30 秒上手

1. 启动 Murmur，等待模型下载完成（首次约 1GB，后续秒开）
2. 按下 `Cmd+Shift+Space`（macOS）或 `Ctrl+Shift+Space`（Windows）开始说话
3. 文字自动出现在光标处

**使用 AI 润色**（可选）：打开设置 → 选择 AI 模型提供商 → 填入 API Key 或使用本地模型。设置页内置「快速开始」引导，DeepSeek / 硅基流动注册即送免费额度。

## 🤖 支持的 AI 模型

| 提供商               | Base URL               | 需要 API Key | 免费额度 |
| -------------------- | ---------------------- | :----------: | :------: |
| OpenAI               | api.openai.com/v1      |      ✅      |    —     |
| **DeepSeek** ⭐      | api.deepseek.com/v1    |      ✅      |  注册送  |
| 通义千问             | dashscope.aliyuncs.com |      ✅      |  新用户  |
| 智谱 GLM             | open.bigmodel.cn       |      ✅      |  注册送  |
| **硅基流动** ⭐      | api.siliconflow.cn     |      ✅      |  注册送  |
| Groq                 | api.groq.com           |      ✅      |  免费层  |
| Moonshot             | api.moonshot.cn        |      ✅      |    —     |
| MiniMax              | api.minimaxi.com       |      ✅      |    —     |
| OpenRouter           | openrouter.ai/api/v1   |      ✅      | 部分免费 |
| **Ollama (本地)**    | localhost:11434        |      ❌      |   免费   |
| **LM Studio (本地)** | localhost:1234         |      ❌      |   免费   |

> ⭐ 标记的提供商推荐新手使用——注册即送免费额度，国内访问稳定。

只需选择提供商，Murmur 自动填入地址和模型。

---

## 从源码构建

### 环境要求

- **Node.js** 18+ 和 [pnpm](https://pnpm.io)
- **Python** 3.8+（用于 FunASR）

### 快速开始

```bash
git clone https://github.com/TeFuirnever/Murmur.git
cd Murmur
pnpm install

# Python 环境（二选一）
# 方案 A: uv（推荐，自动管理虚拟环境）
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
pnpm test         # 运行测试（1000+ tests）
pnpm lint         # 代码检查（0 warnings）
pnpm typecheck    # TypeScript 类型检查
pnpm ci:check     # 本地运行所有 CI 门禁
```

---

## 🛠 技术栈

| 层级     | 技术                                                  |
| -------- | ----------------------------------------------------- |
| 桌面框架 | Electron 36                                           |
| 前端     | React 19, Tailwind CSS 4, Vite                        |
| 语音识别 | FunASR (Paraformer-large + FSMN-VAD + CT-Transformer) |
| AI 优化  | 11+ OpenAI 兼容模型 + 自定义 Prompt 模板              |
| 数据存储 | SQLite (better-sqlite3, safeStorage 加密)             |

## 📋 路线图

**已完成：**

- [x] 本地 FunASR 语音识别（Paraformer-large）
- [x] AI 文本智能优化（11+ 模型，含本地 Ollama/LM Studio）
- [x] 自定义 AI Prompt 模板
- [x] 音频文件导入转录（wav/mp3/m4a/flac）
- [x] 转录历史搜索（FTS5 全文搜索）和导出（TXT/SRT/Markdown/DOCX）
- [x] 全局热键 `Cmd+Shift+Space`
- [x] 多语言支持（中文/English）
- [x] 半自动更新（SHA256 校验）
- [x] 无障碍（ARIA + 键盘导航）
- [x] GPU 自动检测（CUDA > MPS > CPU）
- [x] TypeScript 严格模式（全 src 覆盖率门禁，测试与覆盖率详见 CI）
- [x] 文件配置支持（`~/.murmur.json`）
- [x] AI Provider 快速开始引导（免费 API Key 获取）

**进行中 / 规划：**

- [ ] 实时流式转录（目标 200ms 延迟）
- [ ] CLI 模式（`murmur transcribe --file`）
- [ ] ASR 多引擎支持（whisper.cpp / SenseVoice）
- [ ] 长音频分片转录（解决 10 分钟超时）
- [ ] AI 流式响应

详见 [docs/follow-ups.md](docs/follow-ups.md)（遗留事项跟踪）与 [CHANGELOG.md](CHANGELOG.md)（已交付）。`docs/strategic-plan-gap-analysis.md` 为历史战略快照，仅供参考。

## 🤝 参与贡献

PRs welcome! 见 [CONTRIBUTING.md](CONTRIBUTING.md) 了解开发环境搭建、代码规范和提交流程。

## 📊 项目状态

<div align="center">

[![Star History Chart](https://api.star-history.com/svg?repos=TeFuirnever/Murmur&type=Date)](https://star-history.com/#TeFuirnever/Murmur&Date)

</div>

## 致谢

- [蛐蛐(QuQu)](https://github.com/yan5xu/ququ) — 本项目的上游项目
- [FunASR](https://github.com/modelscope/FunASR) — 阿里巴巴开源语音识别工具包
- [shadcn/ui](https://ui.shadcn.com/) — UI 组件

## 许可证

[Apache License 2.0](LICENSE)

---

<a id="english"></a>

<div align="center">

**Open Source · Local · AI Speech-to-Text**

Speak to type, convert audio to text, AI auto-polish. Powered by FunASR, all on your device.

</div>

## Why Murmur?

**Murmur is a local-first speech-to-text tool optimized for Chinese.** It's more than "voice input" — press a hotkey to dictate, import audio files for batch transcription, then use AI to remove filler words, or turn the transcript into meeting notes or a Xiaohongshu post. All processed locally, no internet required.

> **Positioning**: Murmur doesn't compete head-on with macOS/Windows system dictation on real-time latency. It focuses on three things system dictation can't do — **file transcription**, **AI post-processing**, and **fully local + customizable models**. Real-time streaming is on the roadmap (see [Roadmap](#roadmap)).

### 🆚 Comparison

| Capability             |   Murmur   | macOS Dictation |  iFlytek   | Whisper Desktop |
| ---------------------- | :--------: | :-------------: | :--------: | :-------------: |
| **File Transcription** |     ✅     |       ❌        |     ✅     |       ✅        |
| **AI Post-processing** |     ✅     |       ❌        |     ❌     |       ❌        |
| **Fully Local**        |     ✅     |       ✅        |     ❌     |       ✅        |
| **Custom Prompts**     |     ✅     |       ❌        |     ❌     |       ❌        |
| **11+ AI Models**      |     ✅     |       ❌        |     ❌     |       ❌        |
| Chinese Accuracy       | ⭐⭐⭐⭐⭐ |     ⭐⭐⭐      | ⭐⭐⭐⭐⭐ |     ⭐⭐⭐      |
| Open Source            |     ✅     |       ✅        |     ❌     |       ✅        |

> System dictation wins on real-time latency (streaming); Murmur wins on "what you can do after transcription" (AI polish + batch files + privacy). They can coexist.

## Features

| 🎤 Accurate Chinese     | 🤖 AI Polish                   | 📁 File Transcription  | 🔒 Fully Local   |
| ----------------------- | ------------------------------ | ---------------------- | ---------------- |
| FunASR Paraformer-large | Filler removal, fix, summarize | wav/mp3/m4a/flac batch | Zero data upload |

| ⌨️ Global Hotkey  | 🌐 11+ AI Models                | 💾 History               | 🌍 i18n         |
| ----------------- | ------------------------------- | ------------------------ | --------------- |
| `Cmd+Shift+Space` | OpenAI/DeepSeek/Qwen/GLM/Ollama | SQLite + search + export | zh-CN / English |

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

**AI Polish** (optional): Settings → choose provider (DeepSeek, Qwen, Ollama, etc.) → enter API key or use local model. Built-in Quick Start guide helps you get a free API key.

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
| AI       | 11+ OpenAI-compatible models + custom prompt templates |
| Storage  | SQLite (better-sqlite3, safeStorage encryption)        |

## Roadmap

**Done:**

- [x] Local FunASR speech recognition (Paraformer-large)
- [x] AI text optimization (11+ models, incl. local Ollama/LM Studio)
- [x] Custom AI prompt templates
- [x] Audio file transcription (wav/mp3/m4a/flac)
- [x] History search (FTS5 full-text) and export (TXT/SRT/Markdown/DOCX)
- [x] Global hotkey
- [x] Multi-language (Chinese/English)
- [x] Semi-auto update (SHA256 verified)
- [x] Accessibility (ARIA + keyboard nav)
- [x] GPU auto-detection (CUDA > MPS > CPU)
- [x] TypeScript strict mode (full-src coverage gated, see CI for test count)
- [x] File config support (`~/.murmur.json`)
- [x] AI Provider quick-start guide (free API key)

**In Progress / Planned:**

- [ ] Real-time streaming transcription (target 200ms latency)
- [ ] CLI mode (`murmur transcribe --file`)
- [ ] Multi-engine ASR (whisper.cpp / SenseVoice)
- [ ] Long audio chunked transcription
- [ ] AI streaming response

## Contributing

PRs welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, code standards, and PR process.

## Acknowledgments

- [QuQu](https://github.com/yan5xu/ququ) — Upstream project
- [FunASR](https://github.com/modelscope/FunASR) — Alibaba open-source speech recognition
- [shadcn/ui](https://ui.shadcn.com/) — UI components

## License

[Apache License 2.0](LICENSE)
