# SeACo-Paraformer ONNX 可行性 Spike（2026-09-26）

> 目的：验证 Murmur 当前 ASR 模型（SeACo-Paraformer 热词版）能否以 ONNX int8 运行，用可运行证据替代文档推断。
> 环境：Apple Silicon（Darwin 27, arm64），Python 3.12.13 独立 venv（`/tmp/onnx-spike-venv`），未触碰仓库与 `python/` 环境。
> 基线（torch 管线，同机，`docs/research/2026-09-26-mac-runtime-measurements.md`）：40s 音频 e2e 2.51s（VAD 0.08 / ASR 1.69 / PUNC 0.36），RSS 峰值 2519 MB。

## 结论速览

| 模型                           | ONNX int8/quant 可用性                                        | 来源                   | 结论                                                      |
| ------------------------------ | ------------------------------------------------------------- | ---------------------- | --------------------------------------------------------- |
| SeACo-Paraformer large（热词） | 有 quant 版（345MB+34MB）                                     | 社区 repo（无官方）    | **GO**（有第三方来源前提）                                |
| Paraformer large（无热词）     | `iic/...-vocab8404-onnx` 官方                                 | 官方 iic               | **GO**                                                    |
| Punc CT-Transformer zh 272727  | `iic/punc_...-vocab272727-onnx` 官方，283MB quant             | 官方 iic               | **GO**                                                    |
| FSMN-VAD                       | `iic/speech_fsmn_vad_zh-cn-16k-common-onnx` 官方，0.5MB quant | 官方 iic               | **GO**                                                    |
| Punc large 中英 471067         | quant 1012MB（过大）                                          | 官方 iic               | **NO-GO**（尺寸不可接受）                                 |
| 本地 torch checkpoint 直接导出 | funasr_onnx 有内置导出回退（需 funasr+torch）                 | 代码确认，未跑通全流程 | **GO-WITH-DEGRADATION**（回退路径存在但未实测导出成功率） |

## Q1. pip install + 依赖足迹

- `pip install funasr-onnx onnxruntime` 在 arm64 + Python 3.12 **一次成功**（0 warnings）。funasr-onnx 0.4.3。
- venv 总计 520MB（含 pip 自身）。大头：llvmlite 125MB、scipy 97MB、onnxruntime 80MB、numpy 56MB、sklearn 47MB、jieba 41MB、numba 29MB。
- **torch 完全不在依赖树**。funasr-onnx 0.4.3 声明依赖：jieba, kaldi-native-fbank, librosa, numpy, onnxruntime, PyYAML, scipy, sentencepiece。
- funasr-onnx wheel 本体 40KB。真体积在传递依赖（librosa→scipy/numba/llvmlite/sklearn）。

## Q2. funasr_onnx 0.4.3 暴露的模型类

`funasr_onnx/__init__.py` 导出：`Paraformer`、`ContextualParaformer`、`SeacoParaformer(ContextualParaformer)`, `Fsmn_vad`、`Fsmn_vad_online`, `CT_Transformer`、`CT_Transformer_VadRealtime`, `SenseVoiceSmall`、`Paraformer-online`（`paraformer_online_bin.py`）。

- `SeacoParaformer` 期望模型目录含 `model(_quant).onnx` + `model_eb(_quant).onnx`（热词 embedding 分支），签名 `(model_dir, quantize=True/False, intra_op_num_threads, ...)`，调用签名 `(wav, hotwords)`，`hotwords` 需以位置参数传入（空串 = 无热词）。
- ONNX 文件缺失时回退到 `funasr.AutoModel.export(type="onnx", quantize=...)`（需要完整 funasr+torch）。
- **官方 iic 命名空间下没有 seaco ONNX 仓库**（ModelScope API 404 已验证）。
- 社区 quant repo（ModelScope API 实测）：
  - `marxyz/speech_seaco_paraformer_large_asr_nat-zh-cn-16k-common-vocab8404-onnx-quant`：`model_quant.onnx` 345.1MB + `model_eb_quant.onnx` 34.0MB = **379MB**（本次实测用这套）
  - `manyeyes/paraformer-seaco-large-zh-timestamp-int8-onnx-offline`：288.4MB + 34.0MB = 322MB（文件名是 `model.int8.onnx` 命名，funasr_onnx 需重命名才能加载）
  - `pofice/speech_seaco_paraformer_large_onnx`：与 marxyz 字节数完全一致（345.1MB + 34.0MB，同一导出物的重复上传）
  - fp32 参考：`marxyz/...-onnx`（非 quant）：`model.onnx` 957.7MB + `model_eb.onnx` 34.0MB

## Q3. 实测推理（int8 quant, marxyz 模型）

测试音频：`/tmp/murmur-test.wav`（40s 中文语音，内容为 ASR/端到端模型话题）。

| 指标                     | torch 基线 | ONNX int8 实测                                                                                                                         |
| ------------------------ | ---------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 模型加载（ASR）          | —          | 0.76–1.04s                                                                                                                             |
| 首次调用（冷）           | —          | 2.27s（含 ORT warm-up）；首次全局冷启动（磁盘冷缓存）出现过 32.65s 一次，复测未复现                                                    |
| ASR 稳态（40s 音频）     | 1.69s      | **0.69–0.74s（RTF≈0.018）**                                                                                                            |
| ASR 2 vs 4 线程          | —          | 0.80s / 0.69s                                                                                                                          |
| VAD                      | 0.08s      | 0.08s（warm）                                                                                                                          |
| PUNC                     | 0.36s      | **0.01s**                                                                                                                              |
| ASR+VAD+PUNC e2e（warm） | 2.51s      | **~0.82s**                                                                                                                             |
| RSS 峰值（ASR 单独）     | —          | ~1140MB                                                                                                                                |
| RSS 峰值（ASR+VAD+PUNC） | 2519MB     | **1653MB（-34%）**                                                                                                                     |
| 识别文本                 | —          | 全文连贯正确（ASR/端到端话题），标点正确；小瑕疵：误插“中间，表示”（拆开了“中间表示”）、“架构/端到端模型”间漏逗号                      |
| 热词路径                 | —          | 通过。`model(wav, "深度学习 语音识别 端到端")` 正常返回；本片段中热词本身已被正确识别，输出与无热词一致（符合预期——bias 只影响易错词） |
| 时间戳                   | torch 版有 | ONNX 版同样返回 `timestamp` 字段（bonus，Murmur 未用）                                                                                 |

## Q4. 本地 torch checkpoint 导出路径

- 官方 iic torch repo 只有 `model.pt`（989.8MB），无 ONNX 文件；SeACo 的 ONNX 只能靠导出或社区 repo。
- funasr_onnx 的 `ContextualParaformer.__init__` 内置导出回退：ONNX 文件缺失时调用 `funasr.AutoModel(model=model_dir).export(type="onnx", quantize=...)`——需要完整 funasr+torch（仓库 python/ 环境即具备）。
- 未实测完整导出（时间盒限制 + 不动仓库环境）；多个社区 repo 的存在证明导出可成功，但导出质量/quant 校准细节不可控，优先用社区已导出的 int8 产物。

## Q5. punc / vad 可用性与尺寸

- VAD：`iic/speech_fsmn_vad_zh-cn-16k-common-onnx` — `model_quant.onnx` 0.5MB + `config.yaml` + `am.mvn`。实测 0.08s/40s 音频。
- Punc zh（Murmur 同款）：`iic/punc_ct-transformer_zh-cn-common-vocab272727-onnx` — `model_quant.onnx 283MB` + config/tokens。
- Punc 中英 large：`iic/...-cn-en-common-vocab471067-large-onnx` quant 1012MB — 尺寸不可接受。
- 两者 funasr_onnx 类都支持 `quantize=True`，且在 ONNX 缺失时同样回退 funasr 导出。

## Q6. 最小推理路径的运行时 import

实测（加载 ASR+VAD+PUNC 后）：

| 模块        | 是否被 import                                           |
| ----------- | ------------------------------------------------------- |
| torch       | **否（永不）**                                          |
| sklearn     | 否（pip 传递依赖，经 librosa 引入；运行时不加载）       |
| jieba       | **是**（`funasr_onnx/utils/utils.py:24` 模块级 import） |
| librosa     | 是（import 级；音频加载路径用）                         |
| numba/scipy | 否（pip 装了，但运行时未加载）                          |

Runtime import 集：numpy, onnxruntime, kaldi-native-fbank, soundfile/soxr, jieba, librosa, sentencepiece, yaml。
若生产化，可用窄化依赖（替换 librosa 为 soundfile+resampy 之类）进一步瘦身——需 fork/垫片，非本 spike 范围。

## 尺寸账（安装包视角）

| 项          | 当前（torch 栈）                      | ONNX 栈                                      |
| ----------- | ------------------------------------- | -------------------------------------------- |
| Python 环境 | 871MB（torch 271MB + sympy 43MB + …） | ~440MB（520MB venv 减 pip 自身；生产可再瘦） |
| ASR 模型    | 953MB（torch）                        | **379MB（quant onnx）**                      |
| Punc 模型   | 292MB（torch）                        | 283MB（quant onnx）                          |
| VAD         | 1.7MB                                 | 0.5MB                                        |
| **合计**    | **~2118MB**                           | **~1182MB（-44%）**                          |

## 判读

1. **可行性成立**：SeACo 热词版 ONNX int8 在 arm64 mac 实测可跑、快 2.3 倍、内存 -34%、体积 -44%，torch 从运行时彻底消失。
2. **主要风险是模型来源**：官方 iic 无 seaco ONNX 仓库，必须依赖社区 repo（marxyz / pofice 字节一致，manyeyes 更小但需改名）。生产化前应固定 revision + 校验 sha256，并在 VISION.md 的验收口径下评估第三方模型信任问题。
3. **model_eb 分支（热词 embedding）在所有社区 repo 都是 fp32 34MB**（名为 `_quant` 实为 fp32 尺寸）——热词分支未真正量化，属已知降级点，对内存影响小。
4. punc 常见小瑕疵（“中间，表示”误断、偶发漏逗号）与 torch 版是否一致未对比；ASR 字流无错。
5. 建议后续：长音频（>1min）分段行为、并发/多会话 RSS、Windows arm64/x64 对应模型兼容性（x64 onnxruntime 需同模型验证）、冷启动首转写延迟。
