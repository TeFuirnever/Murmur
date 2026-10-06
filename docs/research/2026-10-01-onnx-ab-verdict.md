# ONNX A/B 四维判决书：CER / punc / 热词 / timestamp GO-NOGO（#416 / spec #412 T4）

> 日期：2026-10-01 · 分支：`agent/onnx-416`（基线 main `5ebd2dc`） · status：**NO-GO（单域超标——热词域逐域 CER delta +3.09pp > +2pp 门禁；其余三维全部 PASS）**
>
> 判决对象：T1 自导出 ONNX int8 产物（`model-pin.json` pin 的四模型，本机
> `scripts/onnx-export/work/artifacts/`）对 T3 真实语料 39 例（7 域）的 A/B 结果，
> 对照 T3 记录的 torch 基线。**NO-GO 的下一步选项回 #412 议决，本文不替 owner
> 拍板路线。**

## 一句话判决

四维中三维干净通过（逐域 CER 7 域中 6 域过、punc 插删差逐例完全一致、timestamp
18 边界 17 个毫秒级一致、热词修复率 14.29% = torch），**唯一 FAIL 是热词域的
逐域 CER delta +3.09pp（6.50% → 9.59%，门禁 +2pp）**，且该超标 **100% 由单个
英文热词用例 `hw_jedediah` 贡献**：torch 的热词通道把 "GDDA keler bert" 部分
修复成 "jedediah keler bert"（术语级判定仍是 still-wrong），ONNX 的热词通道
对该英文术语完全不生效（开/关热词输出逐字相同）。

## 判决输入与复现命令

| 环节             | 命令                                                                                                                                                                                                          | 结果                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| T1 产物 pin 验证 | `scripts/onnx-export/.venv/bin/python scripts/onnx-export/verify_artifacts.py`                                                                                                                                | `VERIFY: PASS`（asr/vad/punc/speaker 四模型逐文件 sha256 对上 `model-pin.json`） |
| ONNX 引擎全语料  | `node scripts/asr-ab-harness.js --engine onnx --server-script scripts/onnx-ab/funasr_server_onnx_ab.py --interpreter scripts/onnx-export/.venv/bin/python --report docs/research/2026-10-01-onnx-ab-run.json` | 39 例 0 失败                                                                     |
| 四维门禁对比     | `node scripts/asr-ab-harness.js --compare docs/research/2026-10-01-asr-ab-torch-baseline.json docs/research/2026-10-01-onnx-ab-run.json`                                                                      | `VERDICT: FAIL (gate regression)`（exit 1，热词单域）                            |

驱动方式：本工单新增 **ONNX A/B 判决服务器** `scripts/onnx-ab/funasr_server_onnx_ab.py`
——funasr-onnx + T1 产物说与 `funasr_server.py` 字节同构的 stdin/stdout 协议，
经 harness 的 `--server-script` 缝接入（**harness 零改动**）。公平性由
`tests/python/test_funasr_server_onnx_ab.py`（24 例）钉死：pin 就绪闸门（缺文件/
篡改/多余文件全 FAIL）、DSP 同源（`audio_preprocessing`）、PCM_16 量化往返
（torch 侧模型读的是 DSP 后的 PCM_16 临时 wav）、VAD 区域合并/切分/缓冲与
segment 构建策略逐常量照抄 `funasr_server.py`。

## 四维总表（torch 基线 vs ONNX int8）

| 维度                 | torch 基线    | ONNX int8     | delta                  | 门禁              | 判定                   |
| -------------------- | ------------- | ------------- | ---------------------- | ----------------- | ---------------------- |
| 逐域 CER（7 域）     | 见下表        | 见下表        | 6 域 ≤0 / 1 域 +3.09pp | 每域 delta ≤ +2pp | **FAIL（hotword 域）** |
| 热词修复率           | 14.29%（1/7） | 14.29%（1/7） | 0                      | ≥ torch           | **PASS**               |
| punc 插删差          | 插 5 / 删 11  | 插 5 / 删 11  | 0（逐例一致）          | 无回归            | **PASS**               |
| timestamp meanAbsDev | 64ms          | 64ms          | +1ms                   | delta ≤ +150ms    | **PASS**               |

### 维度 1：逐域 CER（标点剥离）

| 域          | n   | torch mean | ONNX mean | delta       | 门禁           |
| ----------- | --- | ---------- | --------- | ----------- | -------------- |
| real-clean  | 8   | 0.00%      | 0.00%     | 0.00pp      | PASS           |
| noise       | 6   | 23.73%     | 24.92%    | +1.19pp     | PASS（门禁内） |
| farfield    | 4   | 6.94%      | 6.94%     | 0.00pp      | PASS           |
| accent      | 6   | 2.31%      | 2.31%     | 0.00pp      | PASS           |
| codeswitch  | 6   | 16.22%     | 15.63%    | −0.60pp     | PASS（改善）   |
| **hotword** | 6   | **6.50%**  | **9.59%** | **+3.09pp** | **FAIL**       |
| timestamp   | 3   | 0.00%      | 0.00%     | 0.00pp      | PASS           |

逐例归因（全 39 例中两引擎 CER 不同的仅 3 例）：

- `hw_jedediah`（hotword）：3.70% → 22.22%，**唯一超标贡献者**，见维度 3。
- `noise_pink_snr10_5700`（noise）：35.71% → 42.86%（14 字短句多 1 个替换：
  「微流电机」→「微流电**冰**」），域均值仍在门禁内。
- `cs_tts_01`（codeswitch）：10.71% → 7.14%（ONNX 更好：torch 幻听多插
  3 个字符「tes」，ONNX 只多插 2 个「no」）。

### 维度 2：punc 插删差（量化数字 + 实例列表）

总量：torch 插 5 / 删 11；ONNX 插 5 / 删 11。**21 个可评分用例（作者标点
用例）逐例 ins/del 计数完全一致**，无任何一例插删方向或数量不同。文本差异仅
剩全/半角变体（harness 按等价计）：

| 用例            | ref（作者标点）                                       | torch                         | ONNX                | 计数（两引擎同） |
| --------------- | ----------------------------------------------------- | ----------------------------- | ------------------- | ---------------- |
| cs_tts_00       | 客户的feedback说要支持dark **，**优先级是P1**。**     | …dark mode**，**优先级是k一。 | 同 torch            | 0/0              |
| cs_tts_01       | 把这段meeting notes翻译成英文**，**发给整个team**。** | …发给整个team**.**            | …发给整个team**。** | 0/1（删「，」）  |
| hw_jedediah     | …Kellerberg**。**                                     | …keler berg**.**              | …keler berg**。**   | 0/0              |
| accent_zh_hk_00 | 我们这一季度的重点**，**是把…                         | 重点是把…（无「，」）         | 同 torch            | 0/1              |
| accent_zh_tw_00 | 我们这一季度的重点**，**是把…                         | 重点是把…                     | 同 torch            | 0/1              |
| cs_stitch_01    | 里**，**…周五**，**owner…                             | 无两处「，」                  | 同 torch            | 0/2              |
| cs_stitch_02    | 进度**，**…one-on-one**。**                           | 「，」缺失；句末变「…会议。」 | 同 torch            | 1/3              |
| hw_dazhiyuan    | 联系笪志远确认…                                       | 达志远**，**确认…             | 同 torch            | 1/0（多「，」）  |
| ts_budget       | 体验**。**这个…                                       | 体验这个方案的预算**，**超出… | 同 torch            | 1/1              |
| ts_daily        | 落地**。**记得…电话**。**报告…                        | 落地**，**记得…电话报告…      | 同 torch            | 1/2              |
| ts_roadmap      | …路线图**。**…参会人员**。**…评审**。**               | 十点**，**在三号…             | 同 torch            | 1/0              |

（其余 10 例两引擎均 0/0。）

### 维度 3：热词修复率 ≥ torch（含「热词也没修复」对照）

修复率：**torch 14.29% = ONNX 14.29%**（repaired=1, still-wrong=6,
always-right=0, regressed=0，两侧逐术语判定完全一致）。

| 用例·术语                       | 无热词（两引擎同） | 有热词 torch        | 有热词 ONNX            | 判定（两侧同）                                                     |
| ------------------------------- | ------------------ | ------------------- | ---------------------- | ------------------------------------------------------------------ |
| hw_zhanghanyue·张晗玥           | 张含月             | **张晗玥**          | **张晗玥**             | repaired                                                           |
| hw_zhanghanyue·刘翀             | 刘冲               | 刘冲                | 刘冲                   | still-wrong                                                        |
| hw_gongshen·龚燊                | 公审               | 龚沈                | 龚沈                   | still-wrong（「龚」修复「燊」未修复）                              |
| hw_jedediah·Jedediah Kellerberg | GDDA keler bert    | jedediah keler bert | **G D D A keler berg** | still-wrong（两侧术语级都没修对；**行为差异见下**）                |
| hw_mishujuan·宓淑娟             | 密书娟             | 幂淑娟              | 幂淑娟                 | still-wrong                                                        |
| hw_dazhiyuan·笪志远             | 达致远             | 达志远              | 达志远                 | still-wrong（「志远」修复「笪」未修复）                            |
| hw_yunyunfei·贠云飞             | 袁云飞             | 沅云飞              | 沅云飞                 | still-wrong（ONNX 侧日志：`oov character 贠 … replaced by <unk>`） |

**NO-GO 根因样本——`hw_jedediah`（ref：这个项目的负责人是 Jedediah Kellerberg）**：

- torch：无热词 `GDDA keler bert`（CER 22.22%）→ 有热词 `jedediah keler
bert`（CER 3.70%，英文专名被热词通道部分拉回）。
- ONNX：无热词 `G D D A keler berg`（22.22%）→ 有热词 **逐字不变**
  `G D D A keler berg`（22.22%）——热词偏置对英文术语零效果。
- 中文热词路径在 ONNX 上功能正常：张晗玥 两侧同样修复；龚燊/笪志远 两侧同样
  部分修复；贠 的 OOV 替换行为也与 torch 侧 vocab 语义一致。
- 热词域 CER delta 分解：+3.09pp 全部来自本例（(22.22−3.70)/6 ≈ 3.09pp）；
  其余 5 例开/关热词输出与 torch 逐字相同。

### 维度 4：timestamp 黄金集逐条比对（18 边界）

两引擎均：mean 64ms · 缺失 0 · 多余 0（torch median 63ms / ONNX 58ms；
p95 185ms / max 185ms 两侧相同）。逐边界（Δstart, Δend），**17/18 个边界
毫秒级一致**：

| 黄金段       | torch (ms)  | ONNX (ms)      |
| ------------ | ----------- | -------------- |
| ts_budget#0  | (−10, +145) | (−10, +145)    |
| ts_budget#1  | (0, +125)   | (0, +125)      |
| ts_budget#2  | (−20, +15)  | (−20, +15)     |
| ts_daily#0   | (−10, +165) | (−10, +165)    |
| ts_daily#1   | (−50, +185) | (−50, +185)    |
| ts_daily#2   | (−60, +75)  | **(−50, +95)** |
| ts_roadmap#0 | (+10, +65)  | (+10, +65)     |
| ts_roadmap#1 | (−70, +65)  | (−70, +65)     |
| ts_roadmap#2 | (0, +75)    | (0, +75)       |

唯一差异边界 ts_daily#2 两引擎相差 ≤20ms，且各自绝对偏差仍在同一量级。

## 附带观察（非判决维度）

- **推理速度**：ONNX 全语料 45 次请求推理墙钟合计 3.2s（torch 59.0s）；整跑
  含模型加载 4.8s（torch 72.3s）。与 spec #412 的 RTF 0.018 vs 0.063 预期同向
  （正式 RTF/RSS 门禁属 T5/发布证据链，不在本工单口径）。
- **确定性**：同一产物第二次全量重跑，39 例文本/热词判定/timestamp 汇总与第一
  次逐字节一致（`scripts/onnx-ab/work/onnx-run2.json` 比对 diffs=0）。

## 方法学边界（读数字前必读）

1. **同机同语料同评分器**：torch 基线（2026-09-30，T3 分支 `ba238db`）与本次
   ONNX 跑（2026-10-01，`agent/onnx-416`，基 main `5ebd2dc`）之间
   `scripts/asr-corpus/`、`scripts/asr-ab-harness.js`、`scripts/asr-regression.js`
   `git diff` 为空（评分输入与评分器字节相同）；两跑同为本机 mac arm64。
2. **测量的是引擎差**：判决服务器与 torch 服务器共用 DSP 模块、VAD 区域
   策略、segment 构建与 punc 应用策略（常量逐个照抄），并把喂给 ONNX 的样本
   做了与 torch 侧相同的 PCM_16 量化往返——由 24 例单测钉住
   （`tests/python/test_funasr_server_onnx_ab.py`）。
3. **热词术语级判定**沿用 T3 口径（归一化后整词包含；部分修复按 still-wrong），
   故「修复率」这一热维对 `hw_jedediah` 的部分修复不敏感——CER 维才暴露了
   「英文热词 ONNX 不生效」这一行为差。
4. 语料本身的方法学边界（口音域为 TTS 模拟、noise/farfield 为受控增强等）见
   T3 基线文档同节，A/B（引擎间对比）有效性不受影响。
5. ORT session 用 funasr-onnx 默认 intra_op 线程数（4）；torch 基线用其自适应
   线程上限。线程数不改变策略，只可能带来可忽略的数值边缘（双跑已证稳定）。

## NO-GO 域回 #412 的下一步选项（不替 owner 拍板）

1. **量化敏感度定位**：对 `hw_jedediah` 单例做 bb 图 fp32 vs int8 对照（T1 导出
   管道可产 fp32 图），确认英文热词零效果是否为 int8 量化敏感（若是，评估
   bb 图保持 fp32 的体积/内存代价——eb 图已是 fp32 先例）。
2. **B 计划（spec #412 决议 6 回退）**：改用官方 iic contextual-paraformer 的
   现成 ONNX 产物，先用本 harness 对同一语料跑热词域对照（T1 的 marxyz 交叉
   验证已证非 onnx 文件字节一致、中文同输入同输出，英文热词行为未测）。
3. **门禁口径议决**：若产品判定「英文专名热词」非本版本目标（torch 侧该术语
   也从未修对，只是部分拉回），owner 可议决把英文热词用例从逐域 CER 门禁中
   单列/排除——这会直接翻转本判决为 GO，属口径决策而非工程决策。

## 产物清单

| 产物                                          | 路径                                                       |
| --------------------------------------------- | ---------------------------------------------------------- |
| ONNX A/B 判决服务器（本工具新增，24 单测）    | `scripts/onnx-ab/funasr_server_onnx_ab.py`                 |
| 单测                                          | `tests/python/test_funasr_server_onnx_ab.py`               |
| ONNX 全语料机器可读报告（torch 基线的对照面） | `docs/research/2026-10-01-onnx-ab-run.json`                |
| 四维门禁对比（机器可读）                      | `docs/research/2026-10-01-onnx-ab-compare.json`            |
| torch 基线（T3 产出）                         | `docs/research/2026-10-01-asr-ab-torch-baseline.{md,json}` |

## 议决记录（#412 owner 议决 2026-10-01 · #443 落地 2026-10-06）

> 本节为 #443 追加记录；上文原始 T4 判决（NO-GO）及其全部数字保持原样、未做任何改动。

**决策**：owner 于 [#412 评论（2026-10-01）](https://github.com/TeFuirnever/Murmur/issues/412#issuecomment-5930346248)议决「口径调整，判决翻 GO；并行启动根因诊断」：

- 热词域逐域 CER 门禁拆分为 **hotword-zh / hotword-en 子域**：zh（5 例）保留 **delta ≤ +2pp 硬门禁**；en（`hw_jedediah` 1 例）**降为观察项**（显示数字、不判 FAIL）。
- 热词**术语级修复率 ≥ torch 门禁保持全局不变**（T4 实测两侧 14.29% 一致——用户故事 9 的原始承诺指标本来就达标）。
- 已知限制如实记录：T10 ADR 与 release note 注明「英文专名热词偏置在 ONNX int8 上不生效」；根因诊断并行于 #444（fp32 vs int8 对照），若发现低成本可修的导出问题另开后续工单。

**依据**：修复率两侧一致 14.29%；torch 侧对 `hw_jedediah` 也从未修对（术语级两侧均 still-wrong），损失的是「部分拉回」而非「修好→修坏」；英文专名热词偏置非本版本目标。

**门禁落地（#443，分支 `agent/onnx-443`）**：

- 语料 domain 元数据标注语言：`scripts/asr-corpus/manifest.json` 的 hotword 域拆分为 `hotword-zh`（`language: "zh"`，5 例）/ `hotword-en`（`language: "en"`，1 例），生成器 `scripts/build-asr-corpus.py` 同步拆分；后续 run 原生按子域聚合。
- `scripts/asr-ab-harness.js --compare`：`hotword-en` 观察项、`hotword-zh` 及其余域硬门禁；T3/T4 旧 run.json（合并 `hotword` 域）由 compare 按逐例参考文本自动拆分子域（`hotwordCaseLanguage`）；旧报告缺逐例数据时保守回退为合并域硬门禁；修复率门禁仍为全局口径。

**用 T3/T4 已有 run.json 重跑 compare（总判决：GO / `VERDICT: PASS (all gates)`，exit 0）**：

```
node scripts/asr-ab-harness.js --compare docs/research/2026-10-01-asr-ab-torch-baseline.json \
  docs/research/2026-10-01-onnx-ab-run.json \
  --report docs/research/2026-10-06-onnx-ab-compare-t4a.json
```

热词 zh/en 分域数字表：

| 子域       | n   | torch mean | ONNX mean | delta    | 门禁与判定                                     |
| ---------- | --- | ---------- | --------- | -------- | ---------------------------------------------- |
| hotword-zh | 5   | 7.06%      | 7.06%     | 0.00pp   | PASS（≤ +2pp 硬门禁，与 owner 议决时实测一致） |
| hotword-en | 1   | 3.70%      | 22.22%    | +18.52pp | OBSERVE（观察项，不判 FAIL）                   |

其余 6 域与 T4 逐数字一致（无回归）：real-clean 0.00pp / accent 0.00pp / noise +1.19pp / farfield 0.00pp / codeswitch −0.60pp / timestamp 0.00pp；热词修复率 14.29% = 14.29%（全局门禁 PASS）；timestamp meanAbsDev +1ms、punc 插 5 / 删 11 两侧一致。

机器可读新产物：`docs/research/2026-10-06-onnx-ab-compare-t4a.json`（原始 T4 对比产物 `2026-10-01-onnx-ab-compare.json` 保留不动）。
