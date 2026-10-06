# ADR 018: 去 Python 化远期出口 — sherpa-onnx 原生路径现状（记录性决策）

**状态**: 已采纳 (2026-10-06，记录性决策，无实施承诺)

## 上下文

spec #412 的 Out-of-Scope 把"去 Python 化（GGUF / whisper.cpp / sherpa-onnx 原生绑定）"记为远期出口，并要求 ADR 记录 sherpa-onnx 为已证可行的原生路径。研究问句：sherpa-onnx 能否承载 Murmur 的 SeACo 热词偏置——这是任何 Tauri / Rust 重写的前置门（热词是 T15 起的核心特性）。

## 决策

维持嵌入式 Python 子进程路线（funasr-onnx，见 ADR 016）。sherpa-onnx 记为"原生运行时已证可行、但功能不对等"的远期出口；若上游立场或模型转换生态变化，以新的研究文件为准重新议决。

## 证据

`docs/research/2026-09-26-sherpa-onnx-hotword-spike.md`（四层独立确认）：

- **热词不支持**：官方文档明确 "only transducer models support hotwords"；HEAD 源码中 paraformer 路径仅 greedy、无 context 通路；维护者两次拒绝（2024-08 "无法支持"、2026-01 "目前没计划"）；可运行复现（paraformer 构造器不存在 `hotwords_file` 参数）。
- **产物形状不兼容**：sherpa-onnx paraformer 布局（metadata + tokens.txt）与 FunASR SeACo 导出形状不同，上游不存在 SeACo/contextual 转换；即便重导，其解码器也无 context 模块通路。
- **绑定健康**：Node N-API 与 Rust 官方绑定均活跃，但热词参数仅对 transducer 生效；社区 sherpa-rs 已弃维护。
- **判决：NOT-VIABLE for feature parity**——无热词的 Rust 原生 ASR 可行（SpeakSlow / Sona / kotone 先例），但 Murmur 的热词特性被挡。

## 影响

- 本决策是"为什么不现在去 Python 化"的记录，不是对 sherpa-onnx 的否定：纯转写场景它依然是成熟的原生出口。
- 若未来仍要绕过 Python，热词对等需要三条路之一：(a) 事后文本纠错（机制不同：文本级而非声学偏置）；(b) 换中文 zipformer transducer 模型族（原生热词，但需重新 CER 基准——此前基准 Paraformer 族是 Apple Silicon CPU 最优）；(c) 自研复刻 FunASR SeACo contextual 解码（上游已拒，实质永久自持）。
- 保持现状（嵌入式 Python + funasr-onnx）是唯一零回归热词路径。
