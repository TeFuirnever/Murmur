<!-- [20260907_Spec299_BilingualSplit] T3 (Spec #299) split the single
     bilingual README: this file is now the English front door (standard-readme:
     "README.md is reserved for English"); Chinese lives in README.zh-CN.md.
     The 9 en-half gaps found by the audit (§3) are filled here: mascot
     blurb, screenshot archive link, environment requirements, dev commands,
     first-install tips, roadmap reference links, hotkey details, 10-minute
     timeout note, provider table, Project Status section. -->
<!-- [20260907_Spec299_BilingualSplit] END -->

<!-- [20260907_Spec299_P0Facts] Factual-sync provenance for the lines in this
     file: Electron 36→39, FTS5 → client-side filtering, Python 3.11+,
     GPU CUDA > CPU (MPS intentionally skipped), macOS Dictation marked
     not open source. Full rationale lives in git history (T1, #300). -->

<div align="center">

<img src="assets/icon.png" width="120" height="120" alt="Murmur Logo" />

# Murmur

**Open Source · Local · AI Speech-to-Text**

Speak to type, convert audio to text, AI auto-polish. Powered by FunASR, all on your device.

English · [简体中文](./README.zh-CN.md)

[![License: Apache 2.0](https://img.shields.io/badge/license-Apache_2.0-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey)](#-install)

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

<!-- [20260907_Spec299_EmbedMedia] T4 (Spec #299): embedded the archived
     macOS screenshot as the hero visual — the audit found zero embedded
     media was below the peer floor (5/5 benchmark projects render an image
     in the first screenful). Replaces the [20260731_README_RewriteHero]
     demo-GIF TODO placeholder; recording the GIF remains a maintainer
     follow-up. Screenshots taken 2026-07-20 predate the Fox rebrand (7/29)
     — re-capture before promoting them further. -->
<!-- [20260907_Spec299_EmbedMedia] END -->

<img src="docs/promotion/screenshots/screenshot-macos.jpg" width="800" alt="Murmur on macOS — dictation in action with transcript and AI polish" />

📦 [Screenshot archive](docs/promotion/screenshots/) · macOS UI / AI Xiaohongshu mode / Windows bug story

</div>

---

## Why Murmur?

**Murmur is a local-first speech-to-text tool optimized for Chinese.** It's more than "voice input" — press a hotkey to dictate and text appears at your cursor; import audio files for batch transcription and export; then let AI remove filler words or turn the transcript into meeting notes or a Xiaohongshu post. Everything happens on your computer, no internet, no uploads.

> **Positioning**: Murmur doesn't compete head-on with macOS/Windows system dictation on real-time latency. It focuses on three things system dictation can't do — **file transcription**, **AI post-processing**, and **fully local + customizable models**. Real-time streaming is on the roadmap (see [Roadmap](#-roadmap)).

### 🆚 Comparison

| Capability             |   Murmur   | macOS Dictation |  iFlytek   | Whisper Desktop |
| ---------------------- | :--------: | :-------------: | :--------: | :-------------: |
| **File Transcription** |     ✅     |       ❌        |     ✅     |       ✅        |
| **AI Post-processing** |     ✅     |       ❌        |     ❌     |       ❌        |
| **Fully Local**        |     ✅     |       ✅        |     ❌     |       ✅        |
| **Custom Prompts**     |     ✅     |       ❌        |     ❌     |       ❌        |
| **11+ AI Models**      |     ✅     |       ❌        |     ❌     |       ❌        |
| Chinese Accuracy       | ⭐⭐⭐⭐⭐ |     ⭐⭐⭐      | ⭐⭐⭐⭐⭐ |     ⭐⭐⭐      |
| Open Source            |     ✅     |       ❌        |     ❌     |       ✅        |

> System dictation wins on real-time latency (streaming); Murmur wins on "what you can do after transcription" (AI polish + batch files + privacy). They can coexist.

## ✨ Features

| 🎤 Accurate Chinese     | 🤖 AI Polish                   | 📁 File Transcription  | 🔒 Fully Local   |
| ----------------------- | ------------------------------ | ---------------------- | ---------------- |
| FunASR Paraformer-large | Filler removal, fix, summarize | wav/mp3/m4a/flac batch | Zero data upload |

| ⌨️ Global Hotkey  | 🌐 11+ AI Models                | 💾 History               | 🌍 i18n         |
| ----------------- | ------------------------------- | ------------------------ | --------------- |
| `Cmd+Shift+Space` | OpenAI/DeepSeek/Qwen/GLM/Ollama | SQLite + search + export | zh-CN / English |

> 🤖 **Meet the animated Bot mascot** — the little fellow in the title bar morphs with app state: eyes wide open while recording, thinking dots while recognizing, a comet when a transcription finishes. The engine is ported from [bloub](https://github.com/jeremy-prt/bloub) (MIT) with frame-by-frame measured animation constants, replicated with zero drift. Pick its shape / color / expression under Settings → Bot.

## 🚀 Install

<!-- [20260803_InstallHonesty] Homebrew/Winget are planned (see docs/homebrew, docs/winget)
     but not yet submitted upstream — only GitHub Releases works today. -->

Download the latest build from [Releases](https://github.com/TeFuirnever/Murmur/releases/latest):

- **macOS**: `Murmur-<version>-arm64.dmg`
- **Windows**: `Murmur.Setup.<version>.exe`

> **Package managers (planned):** Homebrew (`brew install --cask murmur`) and Winget (`winget install TeFuirnever.Murmur`) are coming soon — cask/manifest definitions live in `docs/homebrew/` and `docs/winget/` but are not yet submitted upstream.
>
> **Linux**: no official packages for now (limited maintainer capacity — macOS/Windows quality comes first). Community contributions for Linux packaging and maintenance are welcome (issues / PRs).

<!-- [20260803_InstallHonesty] END -->

> **First install notes**
>
> - **macOS**: if macOS reports "cannot verify the developer", right-click the app → **Open**
> - **Windows**: if SmartScreen blocks the installer, click **More info** → **Run anyway**

## ⚡ Quick Start

1. Launch Murmur and wait for the model download (~1GB the first time, instant afterwards)
2. Press `Cmd+Shift+Space` (macOS) or `Ctrl+Shift+Space` (Windows) and start speaking
3. Text appears at your cursor

**AI Polish** (optional): Settings → choose provider (DeepSeek, Qwen, Ollama, etc.) → enter API key or use a local model. A built-in Quick Start guide helps you get a free API key (DeepSeek / SiliconFlow grant free credits on sign-up).

## 🤖 Supported AI Models

| Provider              | Base URL               | Needs API Key |   Free tier    |
| --------------------- | ---------------------- | :-----------: | :------------: |
| OpenAI                | api.openai.com/v1      |      ✅       |       —        |
| **DeepSeek** ⭐       | api.deepseek.com/v1    |      ✅       | Sign-up bonus  |
| Qwen (通义千问)       | dashscope.aliyuncs.com |      ✅       |   New users    |
| Zhipu GLM (智谱)      | open.bigmodel.cn       |      ✅       | Sign-up bonus  |
| **SiliconFlow** ⭐    | api.siliconflow.cn     |      ✅       | Sign-up bonus  |
| Groq                  | api.groq.com           |      ✅       |   Free tier    |
| Moonshot              | api.moonshot.cn        |      ✅       |       —        |
| MiniMax               | api.minimaxi.com       |      ✅       |       —        |
| OpenRouter            | openrouter.ai/api/v1   |      ✅       | Partially free |
| **Ollama (local)**    | localhost:11434        |      ❌       |      Free      |
| **LM Studio (local)** | localhost:1234         |      ❌       |      Free      |

> ⭐ Providers marked with a star are beginner-friendly — free credits on sign-up, stable access within mainland China.

Just pick a provider — Murmur fills in the base URL and models automatically.

---

## Build from Source

### Requirements

- **Node.js** 22.5+ and [pnpm](https://pnpm.io)
- **Python** 3.11+ (for FunASR, matching the `pyproject.toml` requires-python)

### Quick start

```bash
git clone https://github.com/TeFuirnever/Murmur.git
cd Murmur
pnpm install

# Python setup (choose one)
# Option A: uv (recommended, manages the virtualenv for you)
curl -LsSf https://astral.sh/uv/install.sh | sh
uv sync && uv run python download_models.py

# Option B: system Python
pip install funasr modelscope torch torchaudio librosa numpy
python download_models.py

pnpm dev
```

### Development commands

```bash
pnpm dev          # start dev mode
pnpm test         # unit tests (coverage gate enforced by ci:check)
pnpm lint         # linting (0 warnings)
pnpm typecheck    # TypeScript type check
pnpm ci:check     # run all CI gates locally
```

---

## 🛠 Tech Stack

| Layer    | Technology                                             |
| -------- | ------------------------------------------------------ |
| Desktop  | Electron 39                                            |
| Frontend | React 19, Tailwind CSS 4, Vite                         |
| Speech   | FunASR (Paraformer-large + FSMN-VAD + CT-Transformer)  |
| AI       | 11+ OpenAI-compatible models + custom prompt templates |
| Storage  | SQLite (node:sqlite, safeStorage encryption)           |

## 📋 Roadmap

**Done:**

- [x] Local FunASR speech recognition (Paraformer-large)
- [x] AI text optimization (11+ models, incl. local Ollama/LM Studio)
- [x] Custom AI prompt templates
- [x] Audio file transcription (wav/mp3/m4a/flac)
- [x] History search (instant client-side filtering) and export (TXT/SRT/Markdown/DOCX)
- [x] Global hotkey (`Cmd+Shift+Space`)
- [x] Multi-language (Chinese/English)
- [x] Semi-auto update (SHA256 verified)
- [x] Accessibility (ARIA + keyboard nav)
- [x] GPU auto-detection (CUDA > CPU; MPS intentionally skipped — FunASR float64 unsupported)
- [x] TypeScript strict mode (full-src coverage gated, see CI)
- [x] File config support (`~/.murmur.json`)
- [x] AI Provider quick-start guide (free API key)

**In Progress / Planned:**

- [ ] Real-time streaming transcription (target 200ms latency)
- [ ] CLI mode (`murmur transcribe --file`)
- [ ] Multi-engine ASR (whisper.cpp / SenseVoice)
- [ ] Long audio chunked transcription (solves the 10-minute timeout)
- [ ] AI streaming response

See [docs/follow-ups.md](docs/follow-ups.md) (open items) and [CHANGELOG.md](CHANGELOG.md) (shipped). `docs/strategic-plan-gap-analysis.md` is a historical strategy snapshot, kept for reference only.

## 🤝 Contributing

<!-- [20260907_Spec299_HelpLinks] T4 (Spec #299): GitHub's README guidance
     expects "where to get more help" and opensource.guide's pre-launch
     checklist requires linking CONTRIBUTING/SECURITY from the README.
     FAQ, Troubleshooting and SECURITY.md existed but were orphaned. -->

PRs welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, code standards, and the PR process.

**Help & community**: questions → [FAQ](docs/faq.md) · troubleshooting → [Troubleshooting](docs/troubleshooting.md) · security issues → [Security Policy](SECURITY.md) (please report vulnerabilities privately, not as public issues).

## 📊 Project Status

<div align="center">

[![Star History Chart](https://api.star-history.com/svg?repos=TeFuirnever/Murmur&type=Date)](https://star-history.com/#TeFuirnever/Murmur&Date)

</div>

## Acknowledgments

- [QuQu](https://github.com/yan5xu/ququ) — Upstream project
- [FunASR](https://github.com/modelscope/FunASR) — Alibaba open-source speech recognition
- [shadcn/ui](https://ui.shadcn.com/) — UI components

## License

[Apache License 2.0](LICENSE)
