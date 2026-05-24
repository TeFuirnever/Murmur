# FAQ / 常见问题

---

## 中文

### macOS 提示"无法验证开发者"，无法打开应用

右键点击 Murmur 应用 → 选择"打开" → 在弹出的对话框中再次点击"打开"。

这是 macOS 对未签名应用的安全提示。Murmur 是开源软件，不收取费用，因此暂未购买 Apple 开发者证书进行签名。

### 首次启动很慢，需要下载什么？

首次启动时 Murmur 需要下载 FunASR 语音识别模型（约 1GB）。模型下载完成后会缓存在本地，后续启动不再需要下载。

模型下载位置：`./models/` 目录（项目根目录）或应用数据目录。

### 如何配置 AI 文本优化？

1. 打开 Murmur 设置页面
2. 在 AI 配置区域填入 API Key
3. 选择模型提供商（支持通义千问、Kimi、智谱 AI、OpenAI 等）
4. 填写 API 地址和模型名称
5. 保存设置

AI 文本优化是**可选功能**。不配置 API Key 也可以正常使用语音识别。

### 如何安装 ffmpeg？

Murmur 使用 ffmpeg 处理音频格式转换（mp3、m4a 等非 WAV 格式需要 ffmpeg）。

- **macOS**: `brew install ffmpeg`
- **Windows**: 从 [ffmpeg.org](https://ffmpeg.org/download.html) 下载，或使用 `winget install ffmpeg`
- **Linux**: `sudo apt install ffmpeg` 或 `sudo dnf install ffmpeg`

如果只使用 WAV 格式录音，无需安装 ffmpeg。

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

On first launch, Murmur downloads the FunASR speech recognition model (~1GB). Once downloaded, it's cached locally and won't need to be downloaded again.

### How do I configure AI text optimization?

1. Open Murmur's Settings page
2. Enter your API Key in the AI configuration section
3. Select a model provider (supports Qwen, Kimi, Zhipu AI, OpenAI, etc.)
4. Fill in the API URL and model name
5. Save settings

AI text optimization is **optional**. Voice recognition works without an API Key.

### How do I install ffmpeg?

Murmur uses ffmpeg for audio format conversion (mp3, m4a, and other non-WAV formats require ffmpeg).

- **macOS**: `brew install ffmpeg`
- **Windows**: Download from [ffmpeg.org](https://ffmpeg.org/download.html) or use `winget install ffmpeg`
- **Linux**: `sudo apt install ffmpeg` or `sudo dnf install ffmpeg`

If you only record in WAV format, ffmpeg is not required.

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
