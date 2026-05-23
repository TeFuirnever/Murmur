# ADR 003: ASR 引擎抽象接口

**状态**: 已采纳 (2026-05-23)

## 上下文

Murmur 的 ASR（语音识别）功能硬耦合 FunASR，涉及 6 层共 ~2000 行代码。要支持其他引擎（whisper.cpp、faster-whisper）需要完全重写。

## 决策

引入 ASREngine 策略模式接口：
- `validateASREngine(engine)` — 验证对象是否实现接口
- `createASREngineRegistry()` — 引擎注册表，支持注册、切换、获取活跃引擎

接口要求 5 个方法：`transcribeAudio`, `transcribeFile`, `cancelTranscription`, `checkStatus`, `shutdown`

FunASRManager 已验证满足该接口。

## 理由

策略模式允许在不修改调用代码的情况下替换 ASR 引擎。先定义接口，后续接入 whisper.cpp 时只需实现接口并注册。注册表模式支持运行时切换引擎。

## 影响

- `src/helpers/engines/asrEngine.js` — 新增接口定义和注册表
- 现有代码无需修改 — FunASRManager 天然满足接口
- 未来：创建 `funasrEngine.js` 适配层，将 FunASRManager 包装为标准 ASREngine
