# T4b fp32 诊断报告：热词分支 fp32 vs int8 对照——hw_jedediah 单例根因（#444 / spec #412 T4b）

> 日期：2026-10-06 · 分支：`agent/onnx-444`（基线 main `d6f3a26`） · status：**诊断完成——既非 int8 量化敏感，也非导出路径问题；根因是 funasr_onnx 运行时热词分词缺口（无 lowercase、无 seg_dict，大写字母→\<unk\>）**
>
> 诊断对象：T4 NO-GO 的唯一超标贡献者 `hw_jedediah`（英文热词 "Jedediah Kellerberg"，int8 ONNX 开/关热词输出逐字相同）。方法：T1 导出管道重跑产出 SeACo 主图（bb 图）fp32 变体，热词域 6 例 × {fp32, int8} × {开, 关热词} 全矩阵实测，再以偏置注入探针做机制级归因。本工单只诊断，不改产品代码；后续路线回 #412 议决，本文不替 owner 拍板。

## 一句话结论

**英文热词零效果与 int8 量化无关（fp32 主图逐字复现同样的零效果），与导出路径无关（导出图的 bias 输入通道在两种精度下都被正确消费——中文热词 张晗玥 在 int8 与 fp32 上同样修复成功），真正的根因是 funasr_onnx 运行时的热词分词：`proc_hotword` 逐字符查 vocab8404，而该词表没有大写字母（J、K→\<unk\> id 8403），也没有 torch 侧的 lowercase + seg_dict 分段——把热词改为全小写后，同一个 bias 通道立即产生拉力（int8 与 fp32 同样拉动）。**

## 证据一览（三选一裁决）

| 假设                       | 裁决     | 决定性证据                                                                                                                                                                                                                                       |
| -------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| int8 量化敏感              | **否定** | 热词域逐域 CER：int8 9.59% → fp32 9.59%（delta 0.00pp）；`hw_jedediah` 开/关热词在 fp32 下仍是逐字相同的 `G D D A keler berg`；受控注入实验中 zeros==own 在 **fp32 同样成立**（bias 不变性两种精度一致）                                         |
| 导出路径问题               | **否定** | 导出图正确消费 `bias_embed`：`hw_zhanghanyue` 音频上，张晗玥 embedding 使解码从 张含月→张晗玥，**int8 与 fp32 图都如此**；若导出破坏了 bias 输入，fp32 图应同样无反应。且 fp32 变体与 10-01 导出字节级一致（sha256 `3305c3bb…`，T1 导出确定性）  |
| 其他（运行时热词分词缺口） | **成立** | vocab8404 无任何大写字母、无空格 token（`tokens.json` 直接核验）；`proc_hotword("Jedediah Kellerberg")` 产生 J、K→\<unk\> 的 id 序列；改喂全小写 `jedediah kellerberg`（全在词表）后，同一通道在 **int8 与 fp32 上都把输出拉向 `J E E D D E …`** |

## 一、fp32 变体产出与校验（验收项 1）

T1 导出管道重跑（`export_onnx_models.export_funasr_model` 的同一调用：funasr `AutoModel.export(type="onnx", quantize=True)`，同产 fp32+int8 图），产物与校验：

- 暂存脚本：`scripts/onnx-export/stage_fp32_asr.py`（TDD，11 单测）——快照离线信任链（非图文件 sha256 对 `model-pin.json`）、T1 导出调用、fp32 运行时文件集组装（`onnx_export_common.FP32_ASR_RUNTIME_FILES`：model.onnx + model_eb.onnx + config.yaml + am.mvn + tokens.json + seg_dict）、pin 形独立 manifest 的严格校验（缺文件/篡改/多余文件/集合漂移全 FAIL）。
- `verify_artifacts.py --manifest work/artifacts-fp32/manifest.json --artifacts work/artifacts-fp32` → **`VERIFY: PASS`**（asr 6 files 953.8 MiB，checkpoint commit `71684869ca6d`）；int8 pin 原模式 → **`VERIFY: PASS`**（未受影响）。
- 导出确定性：新导出的 `model_quant.onnx` 与 pinned 产物 **sha256 逐字节一致**；fp32 `model.onnx` 与 10-01 T1 导出的 stage 产物 **sha256 一致（`3305c3bb…`）**——fp32 变体与已发布 int8 图来自同一工具链 + 同一 checkpoint 字节。

## 二、全矩阵实测（验收项 2）

驱动：harness 零改动，经 A/B 判决服务器新增的 fp32 臂（环境变量 `MURMUR_ONNX_ASR_VARIANT=fp32`；VAD/punc 两臂均保持 int8 pin 产物，唯一变量是 ASR 图精度）。39 例全语料跑两遍，热词域逐例（判别性文本为 harness 口径，含 punc）：

| 用例            | int8 · 关热词                          | int8 · 开热词                      | fp32 · 关热词                    | fp32 · 开热词                  |
| --------------- | -------------------------------------- | ---------------------------------- | -------------------------------- | ------------------------------ |
| hw_zhanghanyue  | 请把会议纪要发给张含月和刘冲。         | 请把会议纪要发给张**晗玥**和刘冲。 | 同 int8 关                       | 同 int8 开（**两精度同修复**） |
| hw_gongshen     | 下周由公审带队去深圳湾总部。           | 下周由龚沈带队去深圳湾总部。       | 同 int8 关                       | 同 int8 开                     |
| **hw_jedediah** | 这个项目的负责人是G D D A keler berg。 | **逐字不变**                       | **逐字不变（同 int8）**          | **逐字不变（同 int8）**        |
| hw_mishujuan    | 把蜜书娟的工位调整到靠窗的位置。       | 把幂淑娟的工位调整到靠窗的位置。   | 把密淑娟的工位调整到靠窗的位置。 | 同 int8 开                     |
| hw_dazhiyuan    | 联系达致远，确认明天的评审时间。       | 联系达志远，确认明天的评审时间。   | 同 int8 关                       | 同 int8 开                     |
| hw_yunyunfei    | 帮我把袁云飞的行程改到周四下午。       | 帮我把沅云飞的行程改到周四下午。   | 同 int8 关                       | 同 int8 开                     |

- 热词域逐域 CER：int8 9.59% ↔ fp32 9.59%（delta 0.00pp）；热词修复率两侧同 14.29%（1/7，均为 张晗玥）。
- 其余 6 域（附带观察，非判决维度）：real-clean/farfield/accent/hotword/timestamp 完全同值；codeswitch −0.60pp（fp32 略优）；noise +3.33pp（fp32 略差，短句边缘替换，本工单不展开）。
- 探针交叉自检：`hotword_bias_probe.py` 的服务端同构管线（DSP+PCM16+VAD 区域+punc）复现了 harness 两臂 12 个热词 pass 的逐字输出（机器可读对照见 `2026-10-06-fp32-diag-bias-probe.json` 的 `matrix`）。

## 三、机制级归因（验收项 3 的证据链）

探针 `scripts/onnx-ab/hotword_bias_probe.py` 复刻 `funasr_onnx.ContextualParaformer.__call__` 内部路径（load→extract→bb_infer→decode→timestamp 后处理），注入受控 bias 向量：

**1) bb bias 通道活着、内容选择性强、精度无关**

| 音频           | bias 注入                                  | int8 bb 解码                      | fp32 bb 解码                     |
| -------------- | ------------------------------------------ | --------------------------------- | -------------------------------- |
| hw_zhanghanyue | 全零                                       | …张含月和刘冲                     | …张含月和刘冲                    |
| hw_zhanghanyue | 张晗玥 embedding                           | **…张晗玥和刘冲**                 | **…张晗玥和刘冲**                |
| hw_zhanghanyue | Jedediah embedding                         | …张含月和刘冲（同零）             | 同 int8                          |
| hw_jedediah    | 全零                                       | …G D D A keler berg               | 同                               |
| hw_jedediah    | "Jedediah Kellerberg" embedding            | **逐字不变**                      | **逐字不变**                     |
| hw_jedediah    | 张晗玥 embedding（对照）                   | 逐字不变                          | 逐字不变                         |
| hw_jedediah    | **全小写 "jedediah kellerberg" embedding** | **…J E E D D E er R G（被拉动）** | **…J E E D D E E R G（被拉动）** |

**2) eb 分支两臂数值相同**：六个热词串的 eb embedding int8 图 vs fp32 图 cosine = 1.0（L2 逐位相同）——eb 图两臂同为 fp32 数值（T1 已知行为），精度差全部在 bb 图，而 bb 图行为已被上表证明一致。

**3) 词表与分词差异（源码级根因）**

- `tokens.json`（vocab8404）：**无任何大写字母**（A-Z 全缺）、无空格 token、小写字母齐全；英文以 `@@` 后缀 BPE 片元表达（音频解码原始 token 实证：`gddak@@el@@er@@ber@@g` → 显示层 `G D D A keler berg`，显示大写是 `sentence_postprocess` 的渲染，音频路径无 \<unk\>）。
- **funasr_onnx** `proc_hotword`（paraformer_bin.py）：逐字符 `vocab.get(char, 8403)`——不 lowercase、不用 seg_dict ⇒ "Jedediah Kellerberg" → `[<unk>,e,d,e,d,i,a,h] + [<unk>,e,l,l,e,r,b,e,r,g]`（J、K 两处 \<unk\>，机器可读：bias-probe JSON `token_audit`）。
- **torch**（funasr 1.3.1 `contextual_paraformer/model.py:494-510` `seg_tokenize`）：先 `word.lower()`，再查 **seg_dict**（31 万条 BPE 片元表，非图运行时文件已随产物分发）：`jedediah → je@@ de@@ di@@ ah`（表内直接命中），`kellerberg` 表内**未命中**且非中文字符模式 → 整词一个 `<unk>`。⇒ torch 的热词 embedding 第一词干净、第二词损坏 ⇒ **恰好解释 T3/T4 观察到的 torch 部分修复（"jedediah keler bert"——名修复、姓未修复）**。

**结论（三选一）**：英文热词零效果 = **其他——funasr_onnx 运行时热词分词缺口**（无 lowercase、无 seg_dict，大写→\<unk\> 导致 eb embedding 条件损坏、对 bias 无拉力）；非 int8 量化敏感、非导出路径问题。torch 侧"能部分拉回"与其 seg_dict 分段行为自洽。

## 四、fp32 主图代价数字（验收项 4，仅记录）

`scripts/onnx-ab/fp32_cost_probe.py`（每臂独立进程测 ru_maxrss；macOS arm64，ORT 默认 intra_op=4，热词域 6 例各一遍开热词全管线）：

| 指标                           | int8 主图                  | fp32 主图                    | delta                   |
| ------------------------------ | -------------------------- | ---------------------------- | ----------------------- |
| ASR 产物目录体积               | 387,556,112 B（369.6 MiB） | 1,000,108,809 B（953.8 MiB） | **+612.6 MB（2.58×）**  |
| 其中主图文件                   | model_quant.onnx 345.1 MB  | model.onnx 957.7 MB          | +612.6 MB               |
| 三模型进程峰值 RSS（载入后）   | 1761.2 MB                  | 2092.9 MB                    | **+331.7 MB（+18.9%）** |
| 推理后峰值 RSS                 | 1768.3 MB                  | 2104.5 MB                    | +336.2 MB               |
| 模型载入墙钟（asr / vad+punc） | 0.80s / 0.14s              | 1.03s / 0.13s                | +0.23s / −0.01s         |
| 热词域 6 例推理墙钟合计        | 0.312s                     | 0.326s                       | +4.5%                   |
| 平均 RTF（6 例均值）           | 0.0152                     | 0.0158                       | +0.0006                 |

（本机 arm64 上 fp32 与 int8 的推理速度差远小于安装包/内存差；速度数字为短句样本口径，正式 RTF/RSS 门禁属 T5/发布证据链口径。记录以上数字不构成路线建议——bb 图保持 fp32 与"修运行时分词"两条路的取舍回 #412/T10 ADR。）

## 五、对后续动作的输入（不拍板）

- **低成本可修的候选（另开工单）**：在 Murmur 服务端/判决服务器把热词串做 lowercase + seg_dict 分段后喂 `proc_hotword` 的等价 id 序列（seg_dict 已在产物文件集内，`jedediah→je@@ de@@ di@@ ah` 直接命中）——探针已证 id 修好则通道有拉力；torch 侧 kellerberg 整词 \<unk\> 的行为提示"完整修复英文姓"即使 torch 也未达成，门禁口径（英文专名是否单列）仍属 owner 议决。
- B 计划（官方 contextual-paraformer ONNX）的热词行为测试项应包含**大写英文热词**用例——其运行时若同构自 funasr_onnx 大概率同病。
- release note 已知限制措辞素材：中文热词路径两种引擎一致；英文专名热词在 ONNX 引擎上当前不生效（根因=运行时分词，非量化；torch 上也仅部分拉回）。

## 六、方法学边界

1. **T4 基线锚点漂移（已定位，不影响本诊断）**：本次 int8 臂与 T4 提交运行（10-01）相比 39 例中 6 例边缘漂移（noise/accent/codeswitch 单字符级），根因是 #419 在 T4 判决后重构了 `audio_preprocessing.py` 的高通滤波（brickwall FFT → 分块 FIR），判决服务器消费的 DSP 字节已变；**热词域 12 个 pass 中 11 个逐字一致、1 个（hw_mishujuan 关热词 蜜/密）同 CER 同判定**，判决性用例 hw_jedediah 完全一致。本诊断的 fp32-vs-int8 对照两臂同机同时同管线代码，内部有效性不受影响。
2. fp32 变体为诊断专用，不进 pin、不进发布镜像；`verify_artifacts.py` 新增 `--manifest` 模式仅校验本地独立 manifest，发布校验路径不变。
3. 探针/harness 均为 mac arm64 单机；Windows 侧结论无平台理由不同（图与运行时全跨平台一致），未单独取证。
4. staging 脚本在完成全部工作并输出 JSON 后、进程退出阶段有 onnxruntime teardown 的 SIGABRT（exit 134，libc++abi recursive_mutex）——发生在校验门禁（独立进程 `verify_artifacts.py`）之后，不影响产物正确性，记录备查。

## 七、产物与复现命令

| 产物                                          | 路径                                                                           |
| --------------------------------------------- | ------------------------------------------------------------------------------ |
| 诊断报告（本文）                              | `docs/research/2026-10-06-fp32-hotword-diagnosis.md`                           |
| int8 臂全语料 harness 报告（当日锚点）        | `docs/research/2026-10-06-fp32-diag-int8-run.json`                             |
| fp32 臂全语料 harness 报告                    | `docs/research/2026-10-06-fp32-diag-fp32-run.json`                             |
| 偏置注入探针 + 词表审计 + eb 对照（机器可读） | `docs/research/2026-10-06-fp32-diag-bias-probe.json`                           |
| fp32/int8 体积/内存/速度代价（机器可读）      | `docs/research/2026-10-06-fp32-diag-cost.json`                                 |
| fp32 变体独立 sha256 manifest                 | `docs/research/2026-10-06-fp32-diag-stage-manifest.json`                       |
| fp32 暂存脚本（TDD，11 单测）                 | `scripts/onnx-export/stage_fp32_asr.py`                                        |
| A/B 判决服务器 fp32 臂（TDD，14 单测）        | `scripts/onnx-ab/funasr_server_onnx_ab.py`                                     |
| 偏置探针 / 代价探针                           | `scripts/onnx-ab/hotword_bias_probe.py` / `scripts/onnx-ab/fp32_cost_probe.py` |

复现（开发机，导出 venv = `scripts/onnx-export/.venv`）：

```bash
# 1. 产出并校验 fp32 变体（快照已缓存，~30s；产物在 gitignored work/ 下）
scripts/onnx-export/.venv/bin/python scripts/onnx-export/stage_fp32_asr.py
scripts/onnx-export/.venv/bin/python scripts/onnx-export/verify_artifacts.py
scripts/onnx-export/.venv/bin/python scripts/onnx-export/verify_artifacts.py \
    --manifest scripts/onnx-export/work/artifacts-fp32/manifest.json \
    --artifacts scripts/onnx-export/work/artifacts-fp32

# 2. int8 臂全语料（当日锚点）
node scripts/asr-ab-harness.js --engine onnx \
    --server-script scripts/onnx-ab/funasr_server_onnx_ab.py \
    --interpreter scripts/onnx-export/.venv/bin/python \
    --report scripts/onnx-ab/work/int8-anchor-444.json

# 3. fp32 臂全语料（harness 零改动，经环境变量选择 fp32 臂）
MURMUR_ONNX_ASR_VARIANT=fp32 node scripts/asr-ab-harness.js --engine onnx \
    --server-script scripts/onnx-ab/funasr_server_onnx_ab.py \
    --interpreter scripts/onnx-export/.venv/bin/python \
    --report scripts/onnx-ab/work/fp32-444.json

# 4. 机制探针（偏置注入 + 词表审计 + eb 对照）
scripts/onnx-export/.venv/bin/python scripts/onnx-ab/hotword_bias_probe.py \
    --out scripts/onnx-ab/work/hotword-bias-probe.json

# 5. fp32 代价数字（体积/RSS/载入/RTF）
scripts/onnx-export/.venv/bin/python scripts/onnx-ab/fp32_cost_probe.py \
    --out scripts/onnx-ab/work/fp32-cost-probe.json

# 6. 两臂对照（本诊断口径：热词域 0.00pp）
node scripts/asr-ab-harness.js --compare docs/research/2026-10-06-fp32-diag-int8-run.json \
    docs/research/2026-10-06-fp32-diag-fp32-run.json
```
