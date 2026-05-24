# Murmur：一款为中文而生的开源语音输入工具，所有数据本地处理

## 痛点

你有没有遇到过这些场景：

- 写文档、回复消息时打字太慢，恨不得能直接说话
- 用过语音输入，但识别效果差，口头禅一堆，还要手动改半天
- 想用语音输入，但不想把语音数据上传到云端（隐私顾虑）
- macOS 自带的语音控制识别中文效果一般

市面上的语音输入工具要么收费（Wispr Flow $10/月），要么依赖云服务（讯飞、搜狗），要么对中文支持不好（whisper.cpp 偏英文）。

## Murmur 是什么

Murmur 是一款**开源免费**的桌面端语音输入工具，核心特点：

**1. 本地识别，隐私安全**

内置阿里巴巴 FunASR Paraformer-large 语音识别模型，所有音频在**本地处理**，不上传任何数据。你的语音数据不会经过任何第三方服务器。

**2. 中文识别效果优秀**

FunASR 是达摩院开源的中文语音识别引擎，专为中国用户优化。在中文场景下识别精度优于 Whisper 等英文优先的模型。

**3. AI 智能润色**

说话难免有口头禅、重复、语序混乱。Murmur 支持接入 AI 模型（通义千问、Kimi、智谱、OpenAI 等），自动过滤语气词、修正错话、整理格式。说出来的话直接变成干净的文字。

**4. 全局热键，一键开始**

`Cmd+Shift+Space` 一键录音，说完自动粘贴到当前光标位置。不需要切换窗口，不影响工作流。

**5. 音频文件转录**

支持 wav/mp3/m4a/flac 格式导入，转录结果可导出为 TXT、SRT（字幕）、VTT、Markdown、Word 等格式。适合会议录音转文字、视频字幕制作。

## 技术栈

对于开发者来说，Murmur 的技术方案也值得一看：

| 层级     | 技术                                                  |
| -------- | ----------------------------------------------------- |
| 桌面框架 | Electron 36                                           |
| 前端     | React 19 + Tailwind CSS 4 + Vite                      |
| 语音识别 | FunASR (Paraformer-large + FSMN-VAD + CT-Transformer) |
| AI 优化  | 兼容 OpenAI API 的任意模型                            |
| 数据存储 | SQLite (better-sqlite3)                               |

Murmur 基于 [蛐蛐(QuQu)](https://github.com/yan5xu/ququ) 二次开发，感谢 yan5xu 和 QuQu 团队的原始贡献。

## 安装

```bash
# macOS
brew install --cask murmur

# Windows
winget install TeFuirnever.Murmur
```

或从 [GitHub Releases](https://github.com/TeFuirnever/Murmur/releases) 下载安装包。

首次启动需要下载 FunASR 语音识别模型（约 1GB），之后无需网络即可使用语音识别功能。

## 开源地址

GitHub: https://github.com/TeFuirnever/Murmur

License: Apache 2.0

欢迎 Star、PR、Issue！
