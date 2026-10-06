# ADR 016: ASR 推理引擎切换 — fp32 torch → funasr-onnx（ONNX int8）

**状态**: 已采纳 (2026-10-06)

## 上下文

Murmur 的安装包过大（win NSIS 357MB / mac zip 354MB），首启还要再下 ~1.24GB 模型，ASR 进程常驻 ~2.3GB 内存。根因是推理栈用 fp32 PyTorch：仅 torch 系解包即 400MB+，三模型全量常驻。2026 年本地 AI 应用的主流形态是量化推理 + 按需下载（faster-whisper / whisper.cpp / Ollama / LM Studio 全部默认量化权重），fp32 torch 是异类。

spec #412 及其证据底座（`docs/research/` 下 2026-09-26 四份研究）确立了迁移方向；SeACo ONNX int8 spike 实测：RTF 0.063→0.018、三模型峰值 RSS 2519→1653MB、热词路径可用、输出连贯带标点带时间戳。

## 决策

**单刀切换，无双引擎过渡期**：

- funasr-onnx（ASR SeacoParaformer + VAD fsmn-vad + Punc CT-Transformer 272727 词表 int8 + 说话人 CAM++ ONNX）一次性替换 funasr AutoModel 全家；打包环境同批删除 torch/torchaudio/torchvision 依赖。
- stdin/stdout 服务器协议**字节级不变**——这是整个迁移的解耦缝，转写后处理（AI 润色、历史、搜索）天然无感。
- 长音频安全：ONNX 路径无 torch 的 batch_size_s 时间分块，服务端对 VAD 区域做 ≤60s 子分块。
- 音频入口去 librosa 化（#419）：soundfile 纯 C 读取 + 纯 C 重采样，打包期裁剪 numba/llvmlite（#422）。
- 升级迁移为显式告知（#420）：首启提示体积与"完成前无法转写"，断点续传/重试/暂缓；旧 torch 模型缓存保留一个版本周期作回退。

## 理由（证据）

- **可行性**：`docs/research/2026-09-26-seaco-onnx-feasibility-spike.md`——端到端可跑、热词可用、时间戳结构保留。
- **质量门禁（A/B 四维判决）**：`docs/research/2026-10-01-onnx-ab-verdict.md`——真实语料 39 例 × 7 域，torch vs ONNX 逐域 CER / punc 插删差 / 热词修复率 / timestamp 四维门禁；T4a 口径落地下翻 GO（#443）。
- **已知限制（如实记录）**：英文专名热词在 ONNX 引擎当前不生效。根因是 funasr_onnx 运行时热词分词缺口（无 lowercase、无 seg_dict，大写字母→\<unk\>），**既非 int8 量化敏感、也非导出路径问题**——fp32 主图逐字复现同样零效果，torch 侧也仅部分拉回。完整诊断见 `docs/research/2026-10-06-fp32-hotword-diagnosis.md`（#444）；低成本修复候选（热词串 lowercase + seg_dict 分段后喂 id 序列）是否实施回 #412 议决，本 ADR 不替 owner 拍板。
- **win x64 证据**：`docs/research/2026-10-01-onnx-win-x64-spike.md`——CI 上安装 + 四模型加载 + 40s 推理 + RSS + 冷启动全绿。
- **打包收益**：#422——mac DMG 354MB→225.4MB（嵌入式 Python 换 funasr-onnx 栈 + numba/llvmlite 门禁裁剪）。

## 影响

- 用户得到：安装包 −100MB 级、常驻内存 −34%、转写更快（RTF ~3.5x）；热词（中文）与说话人分离保留。
- 模型权重不再随包分发：分发与信任链见 ADR 017；`SECURITY.md` "Model Supply Chain" 章节是公开声明。
- sherpa-onnx 原生化评估为远期出口，结论见 ADR 018。
- 残余风险（接受并监控）：热词 eb 分支在所有量化仓保持 fp32；ORT 内存竞技场不向 OS 归还——内存验收以长音频峰值为准（#421）。
