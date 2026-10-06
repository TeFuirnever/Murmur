# FAQ / 常见问题

---

## 中文

### macOS 提示"无法验证开发者"，无法打开应用

右键点击 Murmur 应用 → 选择"打开" → 在弹出的对话框中再次点击"打开"。

这是 macOS 对未签名应用的安全提示。Murmur 是开源软件，不收取费用，因此暂未购买 Apple 开发者证书进行签名。

### 首次启动很慢，需要下载什么？

<!-- [20261006_Docs_423_T10] spec #412 (T10): engine switched from fp32 torch
     (~1.24GB first-launch download) to ONNX int8. Size, sources and storage
     location below are pinned to scripts/onnx-export/model-pin.json by
     tests/unit/onnx-docs-sync.test.ts. -->

首次启动时 Murmur 需要下载语音识别模型（ONNX int8 量化版，约 671 MB）。模型下载完成后会缓存在本地，后续启动不再需要下载。

模型下载位置：应用数据目录下的 `models/onnx-int8/`（macOS `~/Library/Application Support/murmur/models/onnx-int8/`；Windows `%APPDATA%/murmur/models/onnx-int8/`）。

模型下载支持双源自动回退：默认从 ModelScope 下载（国内速度快），失败时自动切换到 GitHub Release 官方镜像（同一 sha256 清单校验，逐字节一致）。模型供应链（来源、pin 策略、完整性保证）详见 [`SECURITY.md`](../SECURITY.md) 的"模型供应链"章节与 [`docs/adr/017`](../docs/adr/017-self-export-model-trust-chain.md)。

### 如何配置 AI 文本优化？

1. 打开 Murmur 设置页面
2. 在 AI 配置区域填入 API Key
3. 选择模型提供商（支持通义千问、Kimi、智谱 AI、OpenAI 等）
4. 填写 API 地址和模型名称

修改即时生效，无需手动保存。

AI 文本优化是**可选功能**。不配置 API Key 也可以正常使用语音识别。

### 需要安装 ffmpeg 吗？

**通常不需要。** Murmur 使用 Python soundfile 处理音频格式转换，不再依赖系统 ffmpeg。音频格式转换（mp3、m4a 等）在 Python 端完成。

<!-- [20261006_Docs_423_T10] spec #412 decision 3 (#419): the audio entry
     path dropped librosa entirely (soundfile pure-C read + pure-C
     resampler), so the old "Python librosa/soundfile" wording is stale. -->

ffmpeg 仅作为可选回退方案：当 Python soundfile 无法解码某个格式时，Murmur 会尝试使用系统 ffmpeg。如需安装：

- **macOS**: `brew install ffmpeg`
- **Windows**: 从 [ffmpeg.org](https://ffmpeg.org/download.html) 下载，或使用 `winget install ffmpeg`
- **Linux**: `sudo apt install ffmpeg` 或 `sudo dnf install ffmpeg`

### 麦克风权限如何配置？

**macOS**: 系统偏好设置 → 隐私与安全性 → 麦克风 → 勾选 Murmur

**Windows**: 设置 → 隐私 → 麦克风 → 允许应用访问麦克风

### 数据存储在哪里？

转录记录存储在本地 SQLite 数据库中：

- **macOS**: `~/Library/Application Support/murmur/transcriptions.db`
- **Windows**: `%APPDATA%/murmur/transcriptions.db`

所有数据均在本地处理，不会上传到任何服务器。

### 支持哪些导出格式？

支持导出为：TXT、SRT（字幕）、VTT（Web 字幕）、Markdown、DOCX（Word 文档）。

### 全局热键是什么？

默认热键：`Cmd+Shift+Space`（macOS）/ `Ctrl+Shift+Space`（Windows/Linux）

按下热键开始录音，再次按下停止录音并自动将文字插入到当前光标位置。

---

## English

### macOS says "cannot verify developer" and won't open the app

Right-click the Murmur app → select "Open" → click "Open" again in the dialog.

This is macOS's security prompt for unsigned apps. Murmur is free, open-source software and does not have a paid Apple Developer certificate for signing.

### First launch is slow — what's being downloaded?

On first launch, Murmur downloads the speech recognition model (ONNX int8 quantized, ~671 MB). Once downloaded, it's cached locally and won't need to be downloaded again.

Model storage location: `models/onnx-int8/` under the app data directory (macOS `~/Library/Application Support/murmur/models/onnx-int8/`; Windows `%APPDATA%/murmur/models/onnx-int8/`).

Downloads use dual sources with automatic failover: ModelScope by default (fast in mainland China), falling back to the official GitHub Release mirror (verified against the same sha256 manifest, byte-identical). See the "Model Supply Chain" section of [`SECURITY.md`](../SECURITY.md) and [`docs/adr/017`](../docs/adr/017-self-export-model-trust-chain.md) for the full supply-chain policy (sources, pinning, integrity guarantees).

### How do I configure AI text optimization?

1. Open Murmur's Settings page
2. Enter your API Key in the AI configuration section
3. Select a model provider (supports Qwen, Kimi, Zhipu AI, OpenAI, etc.)
4. Fill in the API URL and model name

Changes take effect immediately — no manual save needed.

AI text optimization is **optional**. Voice recognition works without an API Key.

### Does it need ffmpeg?

**Usually not.** Murmur uses Python soundfile for audio format conversion and no longer depends on system ffmpeg. Conversion (mp3, m4a, etc.) happens on the Python side.

ffmpeg remains an optional fallback: when Python soundfile cannot decode a format, Murmur tries system ffmpeg. If needed:

- **macOS**: `brew install ffmpeg`
- **Windows**: Download from [ffmpeg.org](https://ffmpeg.org/download.html) or use `winget install ffmpeg`
- **Linux**: `sudo apt install ffmpeg` or `sudo dnf install ffmpeg`

### How do I configure microphone permissions?

**macOS**: System Preferences → Privacy & Security → Microphone → check Murmur

**Windows**: Settings → Privacy → Microphone → allow apps to access the microphone

### Where is data stored?

Transcription records are stored in a local SQLite database:

- **macOS**: `~/Library/Application Support/murmur/transcriptions.db`
- **Windows**: `%APPDATA%/murmur/transcriptions.db`

All data is processed locally. Nothing is uploaded to any server.

### What export formats are supported?

Export to: TXT, SRT (subtitles), VTT (Web subtitles), Markdown, DOCX (Word document).

### What is the global hotkey?

Default: `Cmd+Shift+Space` (macOS) / `Ctrl+Shift+Space` (Windows/Linux)

Press to start recording, press again to stop and auto-paste text at the cursor position.
