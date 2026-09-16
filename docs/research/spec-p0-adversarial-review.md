# Spec #177 对抗评审报告(Review Team 汇总)

> 日期:2026-08-17 | 评审对象:[Issue #177](https://github.com/TeFuirnever/Murmur/issues/177)「转写质量与资源效率增强包」spec
>
> 评审团队:4 个独立对抗评审(critic / architect / analyst / security-reviewer),各自对仓库源码取证后输出分级发现;本文为交叉汇总。发现按"独立命中该问题的评审数"标注置信度(4/4 最高)。
>
> **总裁决:REVISE——方向成立,但必须修订后才可进入实现。** 四份评审一致认为五项功能选型有源码级调研背书、项目规则内嵌质量高;一致认为 spec 对运行时接缝的既有事实验证不足,"spec 假设的架构"与"代码实际的架构"存在成批偏差。

## 一、BLOCKER(实现前 spec 必须修改)

### BL-1. 空闲卸载与 health monitor / crash-restart 确定性互踩 【4/4 命中,最高置信度】

事实链(全部有代码证据):

- `transcribe` action 在 Python **主读循环内同步执行**(`funasr_server.py:1143-1146`),其懒 `initialize()`(`:341-344`)重载 840MB 模型需 5-30 秒;
- 重载期间 stdin 无人读 → TS health monitor 每 30s ping、5s 超时(`funasrServer.ts:255-273`)→ 误判 crash;
- `_handleServerCrash` **不杀旧进程**直接 spawn 新进程(`funasrServer.ts:283-318`)→ 遗留 ~1GB 孤儿 Python 进程、双实例并存;
- `restartCount > 3` 后 `serverReady=false` 永久放弃 → 数个空闲周期后转写功能彻底不可用;
- 另一竞态:`transcribe_file` 走独立 `_inference_worker` 线程(`funasr_server.py:1154-1163`),`unload_models` 若在主循环执行会与进行中的长转写跨线程互踩(卸掉正在使用的 `asr_model`,下一个 chunk 即 AttributeError);
- `transcribe_file_audio` **没有 init guard**(`:439` 起)——卸载后文件导入路径直接撞 None。

spec 必须写入的修正:① `unload_models` 经 `request_queue` 序列化(与转写天然互斥);② reload 不在主读循环执行(worker 线程),或 TS 在 loading 状态抑制 health ping;③ unloaded 状态 ping 仍回 pong;④ 有意 reload 不计入 `restartCount`,unload 超时不触发 crash-restart;⑤ `transcribe_file_audio` 补 init guard;⑥ unload 重置 `initialized`;⑦ 测试计划补"重载期间 ping 不触发 crash-restart"用例;⑧ 顺带修 `_handleServerCrash` 不杀旧进程的存量缺陷。

### BL-2. 卸载后按热键连录音都被挡住——Story 11 依赖未声明的 UI 门控改动 【analyst + critic 命中】

`useRecording.ts:89-98`:`!modelStatus.isReady` 时 `startRecording()` 直接 throw。卸载后状态必非 ready → 用户按热键得到错误提示,**话都录不上**。spec 必须决策并写明:unloaded 是**可开始录音**的状态;重载在**热键按下的瞬间**触发(用户说话的几秒恰好覆盖重载窗口,优于 spec 原定的"下一次转写请求"——那是串行等待的最差时机);录完若仍在 loading 显示等待提示。此为 spec 与现有代码行为直接冲突的唯一硬伤,需把修改就绪 guard 列为显式需求。

### BL-3. Story 22"模型缓存平滑迁移"物理上不可能 【critic + analyst 命中】

SeACo 是**不同权重文件**,旧 paraformer 缓存在数学上不可能"迁移"——每个存量用户必须重新下载约 840MB(SeACo 实际体积 UNVERIFIED,需实测)。且升级后新模型未下载完 → `minimum_ready=false` → **核心转写完全不可用**;离线/弱网用户没有任何 story。必须改写为可实现目标:升级不破坏旧缓存与历史转写;下载完成前旧模型 fallback 可继续转写;下载失败自动回滚;新模型加载成功 + hotword smoke test 通过才算迁移完成;旧缓存(~840MB 双占)清理策略需决策。

### BL-4. 热词透传路径与 spec 自身约束矛盾 【critic 命中,architect 佐证】

`preload.ts:61` `transcribeAudio` 不接受 options;渲染端只传 arrayBuffer(`useRecording.ts:186`)。"转写请求经 IPC 透传热词"按字面实现必须改 preload 签名 → **违反 spec 自己"不动 preload 边界"的约束**。必须明确决策:**主进程 transcriptionHandlers 从 settings 读取热词注入 `options.hotword`,preload 与 IPC 契约签名不变**。另修正事实表述:Python 端 hotword 管道**已端到端存在**(`funasr_server.py:357-358,376,445-446,642,717`),是**模型**忽略该参数而非管道缺失——实现 scope 因此缩小。

### BL-5. DSP"单一接缝"不存在:麦克风路径在 Python 侧根本没有解码步骤 【architect 命中 BLOCKER,critic M7 佐证】

- Mic 路径:`transcribe_audio` 把文件路径直接喂 `vad_model.generate`/`asr_model.generate`(`funasr_server.py:367,373`),解码发生在 FunASR 库内部,**服务端代码拿不到 numpy 采样点**——"解码之后应用"需新增 load→DSP→rewrite-WAV 步骤;
- File 路径:`_convert_to_wav`(`:805-830`)对原生 wav/flac **直接透传**(`:812-813`),今天没有任何全量读写——DSP 必须在转换后对 wav/flac 分支同样覆盖;
- 因此接缝是**两个具名调用点**,不是"一处实现";
- diarize 路径读原始未处理音频(`:991`),是否同样前处理需决策;1 小时音频全量加载 float64 约 460MB,需 blockwise 内存策略;
- RMS 归一化**窗口语义未定义**(全局 vs 分段):长录音被静音主导时全局 RMS 归一 = 语音噪声等比放大(SNR 不变),Story 2/3 目标不成立。建议按 VAD 合并区域或固定窗 + look-ahead。

### BL-6. 28 条 user story 无一有验收标准 【analyst + critic 命中(系统性缺口)】

"错字更少""不再识别错""保守清洗"全部不可判定 pass/fail。必须建立三套 golden set 并写数字:

1. **音频集**(前处理 A/B):带标注参照的音频,开/关前处理 CER 对比(注意 mic 路径已有浏览器 AGC/NS/HPF,`useRecording.ts:92-100`,服务端归一化对 mic 的边际收益可能≈0——需分路径 A/B;真正受益者是文件导入);
2. **清洗器文本集**:正常语料(含真实口语重复——`scripts/benchmark_results.json` 的 text_sample 里就有说话人真说两遍的"确实确实",是现成的防误删活证据)**0 处改动** + 病理语料消除率;
3. **热词集**:加词前后命中率 + 非热词文本 CER 无回归(换模型改变**所有用户**的基线,含不用热词的)。

## 二、MAJOR(应当修改)

| #    | 发现                                                                                                                                                                                                                                                                                                                                                                                                                                  | 命中                     | 要点                                                                                                                                                                                                                                                                                                 |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MJ-1 | **清洗器接缝误述**:ADR-003 registry 是死代码(零消费者),真实接缝是 AUDIO + TRANSCRIBE_FILE 两个 handler;**绝不能挂通用 SAVE**(会二次清洗 AI 润色/用户编辑后的文本);需决策 segments 是否逐段清洗                                                                                                                                                                                                                                        | critic+architect         | 同时清洗 `text` 与 `raw_text` 使 AI/落库自然继承;**DB 已有双列先例**(text/raw_text),复用即可保留清洗前原文,零 schema 成本                                                                                                                                                                            |
| MJ-2 | **清洗器规则对中文口语不安全**:"2–5 字短语重复删除"取自 meetily 的英文 whisper 语境;中文"对对对""好的好的"是合法强调;0.7 整段丢弃与"保守"自相矛盾;短语音高重复 → 空结果且无 UI 反馈                                                                                                                                                                                                                                                   | critic+analyst+security  | v1 规则改严:字符折叠仅 ≥4 连续、短语删除仅 ≥3 次出现、整段丢弃降级为折叠(或三条件严苛同时满足)、短输入豁免、空结果必须有可见反馈;清洗动作记 debug 日志;regex 必须 linear-time 防 ReDoS                                                                                                               |
| MJ-3 | **线程公式三重问题**:`funasr_server.py:102` 已硬编码 `OMP_NUM_THREADS="4"`(spec 未提及,且今日它在 torch import 后设置、效力存疑);4 核 → 4 线程吃满全部核(Story 14 的目标用户恰是 4 核机,零改善);2 核 → 3 线程超订阅;cores 指物理核还是逻辑核未定义                                                                                                                                                                                    | critic+architect+analyst | 删除硬编码统一收口(env + `torch.set_num_threads` 同源);低核 clamp(如 `max(1, cores-2)`);诚实记录各核数档位相对现状 delta;实测后定稿                                                                                                                                                                  |
| MJ-4 | **Python 测试进门禁在 GitHub CI 上是空的**:`.github/workflows/ci.yml` **不运行 `pnpm ci:check`**(逐条镜像、无 Python 环境),macos-latest 系统 python3 无 numpy——新门禁只在本地生效,GitHub CI 永远不跑                                                                                                                                                                                                                                  | architect                | ci.yml(及 build.yml test job)加 setup-python + numpy 步骤;协议测试需先把 action 分发从 `run()` 主循环抽取为可测函数(本身是生命周期改动,需自带测试);测试需设 `MURMUR_DEVICE`、注意 `__init__` 的 `signal.signal` 非主线程限制与日志文件副作用                                                         |
| MJ-5 | **SeACo 换模实际要改 5 处 + 前缀发现 bug**:模型身份硬编码于三份清单(`funasr_server.py:1075-1079`、`modelManager.ts:53-73`、`download_models.py:44-57`);`modelManager.ts:84-86,146-151` 用 `startsWith("speech_paraformer")` 发现缓存,**SeACo 目录名不匹配任何前缀** → 缓存已下载仍报缺失;`_build_segments_from_timestamps` 完全依赖 timestamp 输出(`:650-657,726`),SeACo 行为 UNVERIFIED——退化会波及 segments/合并/diarize/导出全链条 | architect+critic         | spec 列出全部 5 处必改点;timestamp 兼容性列为验证任务;SeACo 体积/加载时长/基线 CER 对比做实施前 spike                                                                                                                                                                                                |
| MJ-6 | **热词输入全链路零校验**:options 经 renderer(unknown 类型)原样透传到 `generate(hotword=...)`;VAD 分段路径**每个 chunk 都带 hotword 调一次 generate**,开销按 chunk 数放大;粘贴 10000 字符、非法类型、lone surrogate(可使 Python stdout 编码异常)均可造成自我 DoS;坏设置持久化在 DB → 每次重启复现,叠加 maxRestarts=3 后假死                                                                                                            | security                 | IPC/设置边界结构化校验(string、行数/行长/总长上限、剔除控制字符与 lone surrogate、空表完全不发送 hotword 字段);Python 侧 defense-in-depth(类型+长度校验,不合法降级为空串并 log);连续 N 次失败自动降级空热词重试并向 UI 指向设置项;与 `MAX_VALUE_LENGTH=10000` 协调;热词不进 `FILE_CONFIGURABLE_KEYS` |
| MJ-7 | **前处理数值合约不完整**:chunk 读取 `sf.read` 返回**原生 dtype**(`:627`,int16 → float 差 32768 倍);近静音被 RMS 归一 = **把噪声底放大到满刻度**(恰是幻觉触发器,与功能 2 对冲);防削波机制未定义;逐样本 IIR 在 60 分钟音频上是分钟级 CPU                                                                                                                                                                                                | security                 | 合约:入口 `astype(float32)/32768` 归一;`isfinite` guard(非有限值拒绝该输入);RMS/peak 低于 eps 直通不放大;防削波 = peak limiter(`gain=min(target, 0.99/peak)`);在重采样到 16kHz 之后应用;向量化实现 + RTF 预算(如 <0.05)纳入测试                                                                      |
| MJ-8 | **模型供应链零完整性校验**:`download_models.py` 委托 ModelScope 下载无 hash;`_verifyModel` 目录分支只查文件名存在(**0 字节 model.pt 也判完整**);`.pt` 是 pickle,加载不受信权重 = 任意代码执行                                                                                                                                                                                                                                         | security                 | 借换模时机关闭存量缺口:pinned revision 记录并校验 sha256(至少 model.pt);目录模式补 size/magic;迁移验收 = 实际加载 + hotword smoke test                                                                                                                                                               |
| MJ-9 | **env 覆盖边界与 clamp 缺失**:覆盖值若可经 settings/file-config/IPC 触达(idle=0 可制造 unload/reload 风暴);非法值(0/负数/非数字)未定义                                                                                                                                                                                                                                                                                                | security                 | 三项硬约束:env 覆盖仅从真实进程环境读取、永不进入 ALLOWED_SETTING_KEYS/FILE_CONFIGURABLE_KEYS/IPC;解析 clamp(threads∈[1,cores],idle∈[10s,24h]);非法值回退默认并 log                                                                                                                                  |

## 三、MINOR(择要)

- 重载时长"几秒钟"无测量支撑:`scripts/benchmark_results.json` 有单模型热缓存 2.75s 数据点,但 Windows HDD + Defender 可能放大一个数量级——需双平台 P50/P95 实测后再定提示文案(critic/analyst)
- 空闲计时复位语义:仅在转写/diarize 入口复位,**ping/status 不复位**(否则 ping 每 30s 一次,模型永远不卸载)(architect)
- `cam_model`(懒加载 diarize)卸不卸、重载后是否保持懒加载,一句话决策(三个评审)
- Story 10"CPU 归零"因果错位:空闲本就阻塞 readline(CPU≈0),若风扇转是 OMP spin-wait——那是功能 4 解决的问题(critic)
- `-25 dBFS` 选择缺 rationale(纯 numpy 可实现 vs LUFS 需 K-weighting;对语音量级接近),且该值与 0.7 阈值均移植自其他模型的管线,需 A/B 验证(critic/analyst)
- 热词对中英夹杂(code-switching)生效是**机制移植假设**:SeACo 的 embedding 式热词 ≠ VibeVoice 的 prompt 注入式,无任何证据——需 5-10 词 spike,失败则 Story 18 降级改写(analyst)
- 热词应明确覆盖文件导入路径(长录音恰是专名最多场景)(analyst)
- "(满足 Python 逻辑进门禁的决策)"引用了不存在的决策,删掉或给出处(critic)
- env 覆盖对打包后的 GUI App 无效(不继承 shell 环境),Stories 13/16 是开发者故事所以成立,加一行注记(critic)
- `model_download_path` 休眠键在 ALLOWED_SETTING_KEYS 中但零消费者,本次不动它(security)
- ADR-006 文本已落后于代码(MPS 实际被跳过,`funasr_server.py:107-125`),spec 引用时注明以代码为准(critic)

## 四、交付顺序修订建议

原顺序(清洗器最先)被三个评审挑战:清洗器**静默改写用户可见输出**且无验收集,风险实际高于只变换输入的前处理。建议:

**前处理(带分路径 A/B)→ 线程自适应 → 清洗器(golden set 齐备后)→ 空闲卸载(先解决 BL-1)→ 热词(含 SeACo spike)**

## 五、实施前必须完成的 Spike(UNVERIFIED 清单)

1. SeACo 下载体积、加载时长、与 paraformer-large 的基线 CER 对比(决定 Story 21 与 `expected_size`)
2. SeACo 与 FSMN-VAD / ct-punc 链路兼容性 + timestamp 输出行为(segments 全链条依赖)
3. SeACo 热词对中英混合词的实际效果(Story 18 成败)
4. 重载 P50/P95 时长(双平台)
5. 长录音重复/幻觉在当前 paraformer 上的实际复现率(顺带采集 golden set 素材)
6. OMP spin-wait 是否真是空闲 CPU 的可观测根因

## 六、Spec 做对了的(修订时不要误伤)

1. 前处理放 Python 服务端、固定 HPF→归一化顺序、明确拒绝 RNNoise——五项里接缝选择最干净的方向(critic)
2. 项目规则主动内嵌(设置四处+ALLOWED_SETTING_KEYS、IPC 常量、tag 注释、i18n),引用的测试先例全部真实存在(critic)
3. 诚实的风险注记 + "hotword 格式以官方文档为准"的合理延后 + 空闲超时用常量而非 v1 设置项(critic)
4. 无新增远程攻击面,"不新增联网数据流动"声明与代码核实一致(security)

## 七、修订路线

将 #177 修订为 v2 需:① 重写空闲卸载并发/reload 章节(BL-1/BL-2);② 热词注入决策 + Story 22 改写 + 5 处换模清单(BL-3/BL-4/MJ-5);③ DSP 两个具名调用点 + 数值合约 + 窗口语义(BL-5/MJ-7);④ 清洗器两接缝 + 中文保护规则 + raw 保留(MJ-1/MJ-2);⑤ 三套 golden set + 数字验收(BL-6);⑥ 线程公式收口(MJ-3);⑦ CI 补 Python 步骤(MJ-4);⑧ 安全缓解六项(MJ-6/8/9);⑨ 交付顺序调整 + Spike 清单前置。
