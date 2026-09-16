# VibeVoice / meetily 能力引入调研

> 日期:2026-08-17 | 方法:两个并行研究代理分别对 `/Users/guanxueliang/Desktop/oh-my-ai/VibeVoice`(Microsoft,HEAD 含 VibeVoice-ASR-7B)与 `/Users/guanxueliang/Desktop/oh-my-ai/meetily`(Zackriya Solutions,v0.4.0,HEAD `0281737`)做源码级深挖,全部结论以仓库原始代码/文档为准(文末附文件引用)。
>
> 调研问题:这两个项目有哪些能力可以引入 Murmur?优先级:①语音识别准确性 ②性能 ③功耗,同时兼顾其他能力。

## TL;DR

1. **两个前提纠正**:VibeVoice 是 **Microsoft** 的项目(不是腾讯);meetily 的旧 Python/FastAPI 后端**已整体归档废弃**,当前是 Tauri 2 + Rust 单进程架构(`meetily/CLAUDE.md:9-11`、`meetily/backend/README.md`)。
2. **VibeVoice-ASR-7B 不能也不应直接引入**:它是 Qwen2.5-7B 基座的离线 LLM 式转写(音频给全 → 整体出带说话人/时间戳的 JSON),无流式、无量化实现、依赖 NVIDIA GPU,且 README 明确"不建议未加测试直接用于商业产品"(`VibeVoice/README.md:198-205`)。它与 Murmur"本地低功耗实时中文转写"的定位正交。**但它的 6 个工程件(热词、RMS 归一化、FFmpeg 管道解码、重复环自动恢复、鲁棒 JSON 解析、LoRA 微调数据格式)可以立刻借走。**
3. **meetily 是更对口的借鉴对象**:同样是本地优先桌面转写应用,其"Silero VAD 分段 + 段级实时转写"管线、麦克风前处理链(HPF → RNNoise 可选 → EBU R128 响度归一化)、幻觉文本清洗器、硬件分级自适应、LLM sidecar 空闲自杀,几乎每一项都对应 Murmur 的路线图缺口(实时流式转录,`README.md` 路线图"目标 200ms 延迟")。
4. **中文准确性上 Murmur 本身领先**:meetily 无任何中文专项优化(无 zh prompt、无中文标点后处理,摘要默认先出英文再翻译);whisper large-v3 中文弱于 Murmur 现有的 Paraformer-large。**不建议为中文引入 whisper 引擎**;meetily 的价值在管线工程而非模型。

---

## 1. Murmur 现状基线(对比参照)

| 维度           | 现状                                                                                                   | 来源                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| ASR 模型       | Paraformer-large(zh-cn-16k,vocab8404,离线非流式,PyTorch)                                               | `funasr_server.py:191`                                                                        |
| VAD / 标点     | FSMN-VAD + CT-Transformer 标点(与 ASR 并行加载)                                                        | `funasr_server.py:210,240,271-287`                                                            |
| 说话人分离     | CAM++ 声纹模型,**懒加载**(首次 diarize 时才加载,且先检查可用内存)                                      | `funasr_server.py:943-968`                                                                    |
| 说话人         | 两个被调研项目都弱于 Murmur:meetily 无 diarization(PRO 规划),VibeVoice-ASR 联合输出 speaker 但无法嵌入 | `meetily/README.md:47,223`;`VibeVoice/vibevoice/processor/vibevoice_asr_processor.py:360-364` |
| 设备策略       | GPU 自动检测 CUDA > MPS > CPU,无硬件分级参数                                                           | `README.md` 路线图"GPU 自动检测"                                                              |
| 进程模型       | Python 子进程常驻内存,**无空闲卸载/超时退出**(仅 `exit` 命令与 gracefulShutdown)                       | `funasr_server.py:1173`、`src/helpers/funasrManager.ts:121`                                   |
| 音频采集       | 渲染进程 `getUserMedia` + `MediaRecorder`,录完再转(按住说话);无前处理链                                | `src/hooks/useRecording.ts:92,106`                                                            |
| 引擎接缝       | 已有可插拔 `ASREngine` 接口 + 注册表(单实现)                                                           | `src/helpers/engines/asrEngine.ts:10-33`                                                      |
| 已有而对方没有 | safeStorage 加密 SQLite、FTS5 全文搜索、UI i18n(中/英)、全局热键、TXT/SRT/MD/DOCX 导出                 | —                                                                                             |
| 路线图缺口     | 实时流式转录(目标 200ms)、CLI 模式                                                                     | `README.md` 路线图                                                                            |

---

## 2. VibeVoice 调研摘要

### 2.1 它是什么

Microsoft 的开源语音基础模型家族:TTS(1.5B / Realtime-0.5B)+ **ASR-7B**(当前主打)。ASR 基座为 **Qwen2.5-7B**,声学+语义双 tokenizer 以 7.5 Hz 帧率编码 24 kHz 原始波形,输出是 LLM 自回归生成的 JSON(`Start time/End time/Speaker ID/Content`),宣称 50+ 语言、支持 code-switching 与 hotwords 上下文(`VibeVoice/README.md:51-67`、`VibeVoice/docs/vibevoice-asr.md:27-28`)。

仓库内报告的精度(中文会议场景,AISHELL-4 WER 21.40 / AliMeeting 27.40;英语 MLC-Challenge WER 7.99)(`VibeVoice/docs/vibevoice-asr.md:98-121`)——注意无任何可复现评测脚本(`vibevoice/scripts/` 为空)。

### 2.2 为什么不能直接引入

- **无流式 ASR**:全仓库无 VAD、无 chunk 级 partial 结果、无麦克风识别流("streaming"仅指 60s 段卷积编码、TTS 流式、输出 token 流式显示三种无关事物)。
- **重型 GPU 形态**:主路径假设 NVIDIA GPU + flash-attn;CPU/MPS 技术可行但 7B fp32 无实用性;仓库内无 int8/fp8/GGUF 量化实现。
- **商用风险**:代码 MIT,但 README 明示"intended for research and development purposes only",模型权重许可在 HF 侧需单独核(还叠加 Qwen2.5 基座许可链)。

### 2.3 可引入的工程件(全部可独立于模型使用)

| 能力                  | 内容                                                                                                                       | 来源                                                                                |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 热词机制              | 自定义热词/背景知识拼进 prompt("with extra info: ..."),零成本提升专名识别                                                  | `vibevoice_asr_processor.py:361-364`                                                |
| RMS 响度归一化        | 归一到 -25 dBFS 再防削波,比 peak-normalize 更稳的 ASR 前处理                                                               | `vibevoice/processor/audio_utils.py:149-217`                                        |
| FFmpeg 管道解码       | `ffprobe` 探采样率 → `ffmpeg` pipe 输出 s16le mono → float32;无 temp 文件,信号量限并发;20+ 扩展名白名单                    | `audio_utils.py:80-104`                                                             |
| 重复环检测 + 自动恢复 | n-gram 重复检测(≥10 次)→ assistant 前缀续写重试 + 阶梯升温(0.2/0.3/0.4)→ 只展示段边界外的安全内容                          | `vllm_plugin/tests/test_api_auto_recover.py:102-260`                                |
| 鲁棒 JSON 后处理      | 剥 ```json 围栏、括号配平提取、多套 key 别名映射                                                                           | `vibevoice_asr_processor.py:490-565`                                                |
| LoRA 微调样板         | audio+同名 JSON(含 speaker/start/end/hotwords)数据格式;冻结 encoder 只调 LM;训练右 padding/推理左 padding 语义区分         | `finetuning-asr/README.md:36-60`、`finetuning-asr/lora_finetune.py:123-125,419-427` |
| (跟踪项) VibeASR.cpp  | VibeVoice-ASR-BitNet 异构量化:4.62 GB → 1.58 GB,3+ CPU 线程 RTF < 1,无需 GPU——桌面端 LLM-ASR 路线,代码在外部仓库需另行调研 | `VibeVoice/README.md:27`                                                            |

---

## 3. meetily 调研摘要

### 3.1 架构与流式形态

单进程 Tauri 2 应用:Rust 核心(cpal/cidre 采集、whisper-rs 转写、sqlx SQLite、摘要编排)+ Next.js UI;本地 LLM 走 **llama-helper sidecar 子进程**(stdin/stdout JSON 行协议)。转写是**边录边转**:"音频回调 → ring buffer 混音 → Silero VAD 切段 → 每段立即送 whisper → `transcript-update` 事件"(段级流式,非 token 级)(`frontend/src-tauri/src/audio/pipeline.rs:817-880`)。

### 3.2 关键能力清单(对 Murmur 有参考价值的)

**音频采集**

- 系统音频:macOS 用 Core Audio process tap(cidre,mono global tap)+ AggregateDevice;Windows 用 WASAPI loopback(`audio/capture/core_audio.rs:90-117`、`audio/devices/platform/windows.rs:8-94`)。
- 统一 48 kHz mono:rubato SincFixedIn 持久化重采样器,按比率自适应 sinc 参数;专修蓝牙麦克风采样率错配导致的 3x 变速问题(`pipeline.rs:227-364,399-472`)。
- 麦克风前处理链:**80 Hz 高通 → RNNoise 降噪(可选,10–15 dB)→ EBU R128 响度归一化 -23 LUFS**;顺序固定以防噪声被放大(`pipeline.rs:268-313,511-572`)。
- 混音:600ms 窗 ring buffer(4.8s 防溢出)+ 软限幅(避免硬削波);蓝牙断连重连监测;`BLUETOOTH_PLAYBACK_NOTICE.md` 蓝牙回放变速的用户教育文档。

**转写管线**

- 模型:whisper.cpp GGML 全目录(tiny→large-v3,f16 与 Q5 量化;默认 large-v3-turbo,1549 MB / Q5_0 547 MB);第二引擎 Parakeet-tdt-0.6b ONNX int8(`config.rs:8-36`)。
- **VAD 驱动分段,非固定时间片**:Silero VAD 30ms 帧,`positive=0.50/negative=0.35/redemption=400ms/pre-pad=300ms/post-pad=400ms/min-speech=250ms`,<50ms 段丢弃(`audio/vad.rs:37-59`、`pipeline.rs:727,840`);官方称 VAD 过滤降低 ~70% whisper 负载(`CLAUDE.md:348`)。
- whisper 参数纪律:`set_no_timestamps(true)` 防丢整段、`no_speech_thold=0.55`(从 0.75 调低的实测值)、suppress_non_speech_tokens、token 级时间戳(`whisper_engine.rs:516-575`)。
- **幻觉/重复清洗器** `clean_repetitive_text()`:无意义模式黑名单 + 连续词重复折叠 + 2–5 词短语重复删除 + 重复率 >0.7 整段丢弃(`whisper_engine.rs:366-513`)。
- 置信度 <0.3 的段丢弃;模型下载带 GGML magic 校验、大小 ≥90% 校验、断点续传、并发去重(`whisper_engine.rs:897-1136`)。

**可靠性**

- **零丢失关停协议**:停止时发特殊 flush chunk 冲刷 VAD(消除 30s+ 关停延迟),worker 用 queued/completed 原子计数 + 最多 10 次重试对账(`pipeline.rs:1030-1073`、`transcription/worker.rs:361-400`)。
- **音频 checkpoint 崩溃恢复**:WAV 每 30s checkpoint,崩溃后可恢复(`audio/incremental_saver.rs`)。
- 原子写文件(tmp + rename)、SQLite WAL 损坏自恢复。

**摘要**

- map-reduce 长文:chunk(词边界切分,overlap=100)→ 逐块摘要 → combine 合成(`summary/processor.rs:180-251,447-473`)。
- JSON 模板系统(sections/instructions,内置 daily_standup / standard_meeting)。
- 多语言策略:先生成英文标准摘要并缓存,目标语言非英文再翻译一遍——保证多语言摘要质量稳定(`processor.rs:526-576`)。
- prompt 中用 XML 标签包裹转写内容并要求忽略注入指令。

**性能/功耗纪律**

- 硬件分级(Low/Medium/High/Ultra → beam_size 1/2/3/5、temperature 0.4→0.1、threads 2→8;Low 强制 CPU;Windows 特判 beam=2)(`audio/hardware_detector.rs:204-250`)。
- llama-helper:**空闲 300s 自动退出**(下次用时重启)、线程数 = cores/2+2 不饿死 UI、按文件大小估算 GPU 层数与 KV cache(`llama-helper/src/main.rs:131-275,358-365,548-571`)。
- 热路径零开销日志(release 编译为空)、指标批处理(每 200 chunk/60s 才输出)、C 库日志压制。
- 批处理并行 worker 的资源红线:内存 70% / CPU 80% / 温度 85°C,超限自动减 worker(`system_monitor.rs:19-32`)。

### 3.3 meetily 的负发现(不具备的能力)

无 diarization、无跨 chunk 上下文延续(无 initial prompt/best-of/温度 fallback 链)、无 token 级 partial 覆盖、无 UI i18n、无全局热键、无 FTS5(仅 LIKE 查询)、数据库不加密、无 AEC、无中文专项优化。

---

## 4. 引入建议(按优先级 + 实施成本分级)

### P0 — 当前架构内的低成本高收益(直接补准确性/功耗短板)

| #   | 建议                                                                                                                                       | 来源                                                                      | 预期收益                                                                       | 成本                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------- |
| 1   | **麦克风音频前处理链**:80 Hz 高通 + 响度归一化(EAU R128 -23 LUFS 或 VibeVoice 的 -25 dBFS RMS;RNNoise 设为可选开关,注释称其对强模型非必需) | meetily `pipeline.rs:511-572`、VibeVoice `audio_utils.py:149-217`         | 直接提升 Paraformer 在响度不稳/低频隆隆声场景的准确率;两项目独立收敛到同一结论 | 低:渲染端 Web Audio 或服务端 numpy 均可;TDD 覆盖     |
| 2   | **转写文本清洗器**:重复折叠 + 无意义模式黑名单 + 重复率阈值丢弃(VibeVoice 的 n-gram 检测器 + 阶梯重试可作进阶)                             | meetily `whisper_engine.rs:366-513`、VibeVoice `test_api_auto_recover.py` | 消除 Paraformer 长录音的重复/幻觉段                                            | 低:纯函数,易测试                                     |
| 3   | **FunASR 服务端空闲超时卸载**:llama-helper 式"空闲 300s 退出/卸载模型,下次用时重启"(CAM++ 已是懒加载,推广到主模型)                         | meetily `llama-helper/src/main.rs:548-571`                                | 功耗+内存:按住说话场景下大部分时间模型白驻内存                                 | 低-中:需权衡模型重载耗时(可在 UI 提示"首次转写较慢") |
| 4   | **torch 线程数硬件自适应**:`max(1, cores/2+2)` 不饿死 UI;低核机降线程                                                                      | meetily `llama-helper main.rs:358-365`、`hardware_detector.rs:204-250`    | 功耗:避免满核跑满导致风扇/发热                                                 | 低:`funasr_server.py` 加 `torch.set_num_threads`     |
| 5   | **热词支持**:用户自定义热词表(专有名词/人名)喂给 FunASR 热词机制(FunASR SeACo-Paraformer / hotword 参数),VibeVoice 验证了该方向价值        | VibeVoice `vibevoice_asr_processor.py:361-364`                            | 中文专名识别准确率零成本提升;与"自定义 AI Prompt 模板"同级别的产品特性         | 中:需换/增 SeACo 模型或验证现有模型 hotword 入参     |

### P1 — 实时流式转录路线(呼应 Murmur 路线图 200ms 目标)

| #   | 建议                                                                                                                                                                                                                                                                                                                   | 来源                                                | 说明                                                                                                                 |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 6   | **"客户端 Silero VAD 分段 + 段级实时转写"作为流式第一版**:meetily 证明放弃 token 级 streaming、用 VAD 段级产出即可获得良好实时体验;参数组(threshold 0.50/0.35、redemption 400ms、pre/post-pad 300/400ms)可直接起步。Murmur 服务端已有 FSMN-VAD,可在前端/主进程做轻量 VAD 分段,分段送现有 Paraformer,立即 emit 增量结果 | meetily `audio/vad.rs:37-59`、`pipeline.rs:817-880` | 比 FunASR streaming 模型改造更小;VAD 顺带降 ~70% 无效负载。FunASR 官方流式 Paraformer 可作第二阶段                   |
| 7   | **零丢失关停协议**:flush 信号冲刷 VAD + queued/completed 原子对账(最多 N 次重试),消除"停止录音后丢尾巴"                                                                                                                                                                                                                | meetily `worker.rs:361-400`                         | 流式场景的可靠性底座                                                                                                 |
| 8   | **音频 checkpoint 崩溃恢复**:录音每 30s 落盘 checkpoint                                                                                                                                                                                                                                                                | meetily `incremental_saver.rs`                      | 长会议崩溃不丢音频                                                                                                   |
| 9   | **重采样纪律**:统一目标采样率 + 持久化重采样器,专防蓝牙设备采样率错配(meetily 实测蓝牙麦 16k/44.1k 错配导致 3x 变速)                                                                                                                                                                                                   | meetily `pipeline.rs:399-472`                       | Murmur 用 MediaRecorder,需检查 AudioContext 采样率协商;配套蓝牙回放用户教育文档(`BLUETOOTH_PLAYBACK_NOTICE.md` 模板) |

### P2 — 大功能/产品扩展

| #   | 建议                                                                                                                                            | 来源                                                   | 说明                                                                                                                                                                                                              |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 10  | **系统音频采集(会议场景)**:macOS Core Audio process tap + Windows WASAPI loopback                                                               | meetily `core_audio.rs:90-117`、`windows.rs:8-94`      | 让 Murmur 从"语音输入"扩展到"会议转写"的关键能力。Electron 下实现路径不同(Windows 可用 `desktopCapturer`/`getDisplayMedia` audio;macOS 需 native 模块或屏幕共享音频授权),meetily 的平台方案是蓝图。需独立立项评估 |
| 11  | **转写稿↔音频回放对齐**:段落带 audio_start/end_time,点击段落跳播                                                                                | meetily `worker.rs:26-39`                              | Murmur 已存 segments(含时间戳),主要是 UI 工作                                                                                                                                                                     |
| 12  | **历史重转写(Enhance)**:对历史录音换引擎/换参数重跑                                                                                             | meetily `retranscription.rs`                           | Murmur 已有 ASREngine registry,多引擎后自然获得                                                                                                                                                                   |
| 13  | **长文 AI 处理 map-reduce + 摘要模板系统**:词边界分块 + overlap → 逐块 → 合并;JSON 模板(sections/instructions);"标准语言摘要再翻译"的多语言策略 | meetily `processor.rs:180-251,447-473,526-576`         | Murmur 已有 aiPrompts.ts 与 11+ 提供商,补长文分块与模板结构即可;长会议纪要场景直接受益                                                                                                                            |
| 14  | **whisper.cpp 作为可选多语言引擎**(非中文主力):Q5_0 量化(547 MB large-v3-turbo)CPU 可跑,配合 meetily 的下载管理实践(magic/大小校验、断点续传)   | meetily `config.rs:8-36`、`whisper_engine.rs:897-1136` | 仅当 Murmur 决定支持英文/多语言场景时;挂在现有 ASREngine 接口后                                                                                                                                                   |
| 15  | **模型下载管理增强**:完整性校验 + 断点续传 + 并发去重(对照 modelManager.ts 差距)                                                                | meetily `whisper_engine.rs:897-1136`                   | 随 #14 一并做                                                                                                                                                                                                     |
| 16  | **工程纪律**:CLAUDE.md 式"按症状定位文件"排障文档、热路径零开销日志、指标批处理、批处理资源红线(内存 70%/CPU 80%/温度 85°C)                     | meetily `CLAUDE.md`、`system_monitor.rs`               | 渐进采纳                                                                                                                                                                                                          |

### 跟踪项(不立即引入)

- **VibeASR.cpp / VibeVoice-ASR-BitNet**(1.58 GB、CPU RTF<1):桌面端本地 LLM-ASR 的潜力路线,代码在外部仓库,建议季度性评估其成熟度与权重许可(`VibeVoice/README.md:27`)。
- **VibeVoice LoRA 微调工具链**:若未来想为特定领域(医疗/法律术语)定制,其数据格式(audio+JSON 含 speaker/hotwords)是现成样板;FunASR 自身也有微调工具,二选一(`finetuning-asr/README.md`)。

### 明确不建议引入

| 项                                 | 理由                                                                                                       |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| VibeVoice-ASR-7B 嵌入式部署        | 7B GPU 依赖、无流式、微软明示"research and development purposes only"、权重许可链未核(`README.md:198-205`) |
| whisper.cpp 作为中文主引擎         | meetily 无中文专项优化佐证;Paraformer-large 中文优于 whisper;引入只增加 0.5–1.5 GB 模型负担                |
| Parakeet ONNX 引擎                 | NVIDIA NeMo 许可风险、无 confidence 输出、对中文无优势                                                     |
| PostHog 遥测                       | 与 Murmur"本地/隐私"定位冲突(meetily 自己也默认关闭)                                                       |
| meetily 旧 Python/FastAPI 后端模式 | 已被其官方废弃,无借鉴价值                                                                                  |

---

## 5. 许可风险备忘

- VibeVoice 代码 MIT(Microsoft);**模型权重许可在 HF model card,叠加 Qwen2.5 基座,引入前必须单独核**;README 有明确的商用免责表述。
- meetily 代码 MIT(Zackriya Solutions);其依赖中 Silero VAD(MIT)、RNNoise(BSD)、whisper.cpp/llama.cpp(MIT)均可借用,**直接拷代码需保留 copyright 头**;Parakeet 涉 NVIDIA NeMo 许可(仅借用代码/参数不受影响)。

---

## 附录:主要文件引用索引

**VibeVoice**(`/Users/guanxueliang/Desktop/oh-my-ai/VibeVoice`)

- `README.md:27,44,51-67,198-205` — 模型家族、BitNet、商用警告
- `docs/vibevoice-asr.md:18-28,54-66,98-121,129-131` — 60 分钟上下文、语言、精度表、许可
- `vibevoice/processor/vibevoice_asr_processor.py:27,150-155,360-364,490-565` — 转写 prompt、归一化、热词、JSON 后处理
- `vibevoice/processor/audio_utils.py:8-22,80-104,149-217` — FFmpeg 管道、RMS 归一化
- `vibevoice/modular/modeling_vibevoice_asr.py:62-83,208-331` — 架构与 60s 分段编码
- `finetuning-asr/lora_finetune.py:123-125,304-324,404,419-427`、`finetuning-asr/README.md:36-60,118-128` — LoRA 工具链
- `vllm_plugin/tests/test_api_auto_recover.py:102-260,394-433` — 重复环自动恢复
- `vllm_plugin/scripts/start_server.py:94-109,202-268` — vLLM 服务参数

**meetily**(`/Users/guanxueliang/Desktop/oh-my-ai/meetily`,注意 `backend/` 为已归档旧代码)

- `CLAUDE.md:9-11,156-171,218-240,330-360` — 架构、事件流、性能纪律
- `frontend/src-tauri/src/audio/pipeline.rs:16-190,227-364,399-472,511-572,727-880,1030-1073` — 混音/重采样/前处理/VAD/关停
- `frontend/src-tauri/src/audio/vad.rs:37-59` — Silero VAD 参数组
- `frontend/src-tauri/src/audio/capture/core_audio.rs:60-117`、`audio/devices/platform/windows.rs:8-94` — 系统音频采集
- `frontend/src-tauri/src/audio/incremental_saver.rs`、`audio/hardware_detector.rs:121-152,204-250` — checkpoint、硬件分级
- `frontend/src-tauri/src/whisper_engine.rs:89-90,366-513,516-575,735,897-1136` — 参数、清洗器、下载管理
- `frontend/src-tauri/src/transcription/worker.rs:26-39,45-404` — 串行 worker、零丢失对账
- `frontend/src-tauri/src/summary/processor.rs:149-170,180-251,323-580` — map-reduce、模板、语言策略
- `llama-helper/src/main.rs:131-275,358-365,548-571` — sidecar、VRAM/GPU 层数、空闲自杀
- `frontend/src-tauri/src/config.rs:8-36`、`summary/summary_engine/models.rs:166-211` — 模型目录
- `PRIVACY_POLICY.md:23-76` — 遥测与隐私
