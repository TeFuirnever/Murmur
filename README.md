<div align="center">

<img src="assets/icon.png" width="120" height="120" alt="Murmur Logo" />

# Murmur

**开源免费的 AI 语音输入工具 | 为中文而生**

[English](#english) · [中文](#中文)

[![License: Apache 2.0](https://img.shields.io/badge/license-Apache_2.0-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)](#安装)
[![GitHub Release](https://img.shields.io/github/v/release/TeFuirnever/Murmur?include_prereleases)](https://github.com/TeFuirnever/Murmur/releases)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![Build](https://img.shields.io/github/actions/workflow/status/TeFuirnever/Murmur/build.yml?branch=main)](https://github.com/TeFuirnever/Murmur/actions)

</div>

---

<a id="中文"></a>

## Murmur 是什么？

Murmur 是一款桌面端语音输入工具，让你**说话就能打字**。内置阿里巴巴 FunASR 语音识别引擎，所有音频在**本地处理**，不上传任何数据。支持连接 AI 模型（通义千问、Kimi、智谱、OpenAI 等）自动润色文本。

### 核心特性

- 🎤 **高精度中文识别** — FunASR Paraformer-large 模型，本地运行，隐私安全
- 🤖 **AI 智能润色** — 自动过滤口头禅、修正错话、整理格式
- ⌨️ **全局热键** — `Cmd+Shift+Space` 一键开始/停止，自动粘贴到当前光标
- 📁 **音频文件转录** — 支持 wav/mp3/m4a/flac 格式导入
- 💾 **转录历史** — SQLite 本地存储，支持搜索和导出（TXT/SRT/VTT/MD/DOCX）
- 🎯 **国产模型优先** — 适配通义千问、Kimi、智谱 AI 等，延迟更低

## 安装

### 下载安装包

从 [Releases](https://github.com/TeFuirnever/Murmur/releases) 下载最新版本：

| 平台 | 文件 | 说明 |
|------|------|------|
| macOS (Apple Silicon) | `Murmur-*.dmg` | 双击安装 |
| Windows | `Murmur-Setup-*.exe` | 双击安装 |
| Linux | 自行构建 | 见下方开发指南 |

> **首次安装提示**：
> - **macOS**: 如遇"无法验证开发者"，右键点击应用 → 选择"打开"
> - **Windows**: 如遇 SmartScreen 拦截，点击"更多信息" → "仍要运行"

### 首次运行

1. 启动 Murmur，等待模型下载完成（首次约 1GB）
2. 打开设置页面，填入 AI 模型的 API Key（可选，不配置也能使用语音识别）
3. 按下 `Cmd+Shift+Space` 开始说话

---

## 从源码构建

### 环境要求

- **Node.js** 18+ 和 [pnpm](https://pnpm.io)
- **Python** 3.8+（用于 FunASR）
- **Git**

### 快速开始

```bash
# 克隆仓库
git clone https://github.com/TeFuirnever/Murmur.git
cd Murmur

# 安装依赖
pnpm install

# 准备 Python 环境（二选一）

# 方案 A: 使用 uv（推荐，自动管理 Python 版本）
curl -LsSf https://astral.sh/uv/install.sh | sh
uv sync
uv run python download_models.py

# 方案 B: 使用系统 Python
pip install funasr modelscope torch torchaudio librosa numpy
python download_models.py

# 启动开发模式
pnpm dev
```

### 构建安装包

```bash
# 准备嵌入式 Python
pnpm run prepare:python:embedded

# 构建 macOS DMG（未签名）
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm electron-builder --mac

# 构建 Windows EXE（需在 Windows 上）
pnpm electron-builder --win
```

### 开发命令

```bash
pnpm dev          # 启动开发模式
pnpm test         # 运行测试
pnpm lint         # 代码检查
pnpm run build    # 构建生产版本
```

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 桌面框架 | Electron 36 |
| 前端 | React 19, Tailwind CSS 4, Vite |
| 语音识别 | FunASR (Paraformer-large + FSMN-VAD + CT-Transformer) |
| AI 优化 | 兼容 OpenAI API 的任意模型 |
| 数据存储 | SQLite (better-sqlite3) |
| IPC 通信 | Electron contextBridge + ipcMain/ipcRenderer |

## 项目结构

```
├── main.js                    # Electron 主进程
├── preload.js                 # 预加载脚本（IPC 桥接）
├── funasr_server.py           # FunASR Python 服务
├── src/
│   ├── App.jsx                # 主界面
│   ├── settings.jsx           # 设置页面
│   ├── history.jsx            # 历史记录
│   ├── components/            # UI 组件
│   ├── hooks/                 # React Hooks
│   ├── helpers/               # 主进程模块
│   │   ├── funasrManager.js   # FunASR 进程管理
│   │   ├── ipcHandlers.js     # IPC 处理器
│   │   ├── database.js        # 数据库管理
│   │   └── windowManager.js   # 窗口管理
│   └── utils/                 # 工具函数
├── tests/                     # 测试文件
├── scripts/                   # 构建脚本
└── assets/                    # 图标和资源
```

## 参与贡献

我们欢迎所有形式的贡献！请阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 了解：

- 开发环境搭建
- 代码规范和提交格式
- PR 提交流程

## 路线图

- [x] 本地 FunASR 语音识别
- [x] AI 文本智能优化
- [x] 音频文件导入转录
- [x] 转录历史搜索和导出
- [x] 全局热键
- [x] 健康监控和自动恢复
- [ ] 实时流式转录（200ms 延迟）
- [ ] 自定义 AI Prompt 模板
- [ ] 多语言支持（中/英/日）
- [ ] 自动更新

详见 [Projects](https://github.com/TeFuirnever/Murmur/projects) 查看完整规划。

## 致谢

- [FunASR](https://github.com/modelscope/FunASR) — 阿里巴巴开源语音识别工具包
- [OpenWhispr](https://github.com/HeroTools/open-whispr) — 架构参考
- [shadcn/ui](https://ui.shadcn.com/) — UI 组件

## 许可证

[Apache License 2.0](LICENSE)

---

<a id="english"></a>

## What is Murmur?

Murmur is a desktop voice input tool that lets you **type by speaking**. It uses Alibaba's FunASR speech recognition engine with all audio processed **locally** — no data ever leaves your machine. Optionally connect an AI model (Qwen, Kimi, Zhipu, OpenAI, etc.) to auto-polish your text.

### Key Features

- 🎤 **Accurate Chinese recognition** — FunASR Paraformer-large, runs locally
- 🤖 **AI text refinement** — Auto-remove filler words, fix mistakes, format output
- ⌨️ **Global hotkey** — `Cmd+Shift+Space` to start/stop, auto-paste at cursor
- 📁 **File transcription** — Import wav/mp3/m4a/flac files
- 💾 **History & export** — SQLite storage, search, export to TXT/SRT/VTT/MD/DOCX
- 🎯 **China-friendly** — Optimized for Qwen, Kimi, Zhipu AI models

## Install

Download from [Releases](https://github.com/TeFuirnever/Murmur/releases):

| Platform | File | Notes |
|----------|------|-------|
| macOS (Apple Silicon) | `Murmur-*.dmg` | Double-click to install |
| Windows | `Murmur-Setup-*.exe` | Double-click to install |
| Linux | Build from source | See below |

> **First install tips**:
> - **macOS**: If you see "cannot verify developer", right-click the app → "Open"
> - **Windows**: If SmartScreen blocks it, click "More info" → "Run anyway"

### First Run

1. Launch Murmur and wait for model download (~1GB on first run)
2. Open Settings and enter your AI model's API Key (optional — voice recognition works without it)
3. Press `Cmd+Shift+Space` and start speaking

## Build from Source

### Prerequisites

- **Node.js** 18+ and [pnpm](https://pnpm.io)
- **Python** 3.8+ (for FunASR)
- **Git**

### Quick Start

```bash
git clone https://github.com/TeFuirnever/Murmur.git
cd Murmur
pnpm install

# Python setup (choose one)

# Option A: uv (recommended)
curl -LsSf https://astral.sh/uv/install.sh | sh
uv sync
uv run python download_models.py

# Option B: System Python
pip install funasr modelscope torch torchaudio librosa numpy
python download_models.py

# Start dev mode
pnpm dev
```

### Build Installers

```bash
# Prepare embedded Python
pnpm run prepare:python:embedded

# Build macOS DMG (unsigned)
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm electron-builder --mac

# Build Windows EXE (requires Windows machine)
pnpm electron-builder --win
```

### Dev Commands

```bash
pnpm dev          # Start dev mode
pnpm test         # Run tests
pnpm lint         # Lint check
pnpm run build    # Production build
```

## Tech Stack

| Layer | Technology |
|-------|------------|
| Desktop | Electron 36 |
| Frontend | React 19, Tailwind CSS 4, Vite |
| Speech Recognition | FunASR (Paraformer-large + FSMN-VAD + CT-Transformer) |
| AI Optimization | Any OpenAI API-compatible model |
| Storage | SQLite (better-sqlite3) |
| IPC | Electron contextBridge + ipcMain/ipcRenderer |

## Project Structure

```
├── main.js                    # Electron main process
├── preload.js                 # Preload script (IPC bridge)
├── funasr_server.py           # FunASR Python service
├── src/
│   ├── App.jsx                # Main UI
│   ├── settings.jsx           # Settings page
│   ├── history.jsx            # History page
│   ├── components/            # UI components
│   ├── hooks/                 # React Hooks
│   ├── helpers/               # Main process modules
│   │   ├── funasrManager.js   # FunASR process management
│   │   ├── ipcHandlers.js     # IPC handlers
│   │   ├── database.js        # Database management
│   │   └── windowManager.js   # Window management
│   └── utils/                 # Utilities
├── tests/                     # Test files
├── scripts/                   # Build scripts
└── assets/                    # Icons and resources
```

## Contributing

We welcome all contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for:

- Development environment setup
- Code standards and commit format
- PR submission process

## Roadmap

- [x] Local FunASR speech recognition
- [x] AI text optimization
- [x] Audio file transcription
- [x] History search and export
- [x] Global hotkey
- [x] Health monitor with auto-restart
- [ ] Real-time streaming transcription (200ms latency)
- [ ] Custom AI Prompt templates
- [ ] Multi-language support (Chinese/English/Japanese)
- [ ] Auto-update

## Acknowledgments

- [FunASR](https://github.com/modelscope/FunASR) — Alibaba open-source speech recognition toolkit
- [OpenWhispr](https://github.com/HeroTools/open-whispr) — Architecture reference
- [shadcn/ui](https://ui.shadcn.com/) — UI components

## License

[Apache License 2.0](LICENSE)
