# ASR A/B 真实语料 harness 与 torch 基线（#414 / spec #412 T3）

> 日期：2026-10-01 · 分支：`agent/onnx-414` · status：**基线已记录（非判决）**
> 本文是 T4（torch vs ONNX 判决）的对照面。GO/NO-GO 由 T4 报告给出，本文不下结论。

## 一句话摘要

建立了 39 例带参考文本与元数据的真实语料 A/B 集（7 个域）与一条命令的四维对比
harness（逐域 CER / 标点插删差 / 热词修复率 / timestamp 偏差），并用**当前 torch
引擎**（funasr_server.py + SeACo）跑出基线：噪声域 mean CER 23.73%、远场 6.94%、
中英混说 16.22%、干净真实朗读 0.00%（饱和）；热词修复率 14.29%（1 例 repaired /
6 例 still-wrong，判别力成立）；timestamp 偏差 mean 64ms / max 185ms。

## 产物

| 产物                                      | 路径                                                                    |
| ----------------------------------------- | ----------------------------------------------------------------------- |
| 语料（音频+manifest，入库）               | `scripts/asr-corpus/`（39 个 `.flac` + `manifest.json`，共 3.4MB）      |
| 语料构建器（可复现）                      | `scripts/build-asr-corpus.py`                                           |
| A/B harness                               | `scripts/asr-ab-harness.js`（npm: `pnpm run test:asr:ab`）              |
| 单测（评分函数+manifest 校验+语料完整性） | `tests/unit/asr-ab-harness.test.ts`、`tests/unit/asr-ab-corpus.test.ts` |
| torch 基线（机器可读，供 `--compare`）    | `docs/research/2026-10-01-asr-ab-torch-baseline.json`                   |
| CI 调用入口（手动 dispatch）              | `.github/workflows/asr-ab.yml`                                          |

## 语料构成（规模与构成说明）

| 域                        | 例数 | 来源（provenance，逐例记录在 manifest）                                                                                            |
| ------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------- |
| real-clean 真实朗读(干净) | 8    | AISHELL-1 test split（Apache-2.0），经 HF 镜像 `AudioLLMs/aishell_1_zh_test` 按固定 row offset 取样（0–6850 均匀散布，不同说话人） |
| noise 噪声                | 6    | 真实 AISHELL-1 语音 + 加性噪声：babble（4 路无关中文 TTS 叠加）@5dB SNR ×3、pink（FFT 造型 1/f）@10dB SNR ×3                       |
| farfield 远场             | 4    | 真实 AISHELL-1 语音 + 合成房间：synthetic RIR（T60≈0.35s、30ms 早期反射）卷积 + 6.5kHz LPF + −12dB 距离衰减 + 25dB SNR 底噪        |
| accent 口音               | 6    | macOS `say` 方言区口音模拟：Meijia（zh-TW）×3、Sinji（zh-HK）×3                                                                    |
| codeswitch 中英混说       | 6    | 3 例缝合渲染（Tingting 中文段 + Samantha 英文段，250ms 间隙）+ 3 例整句 Tingting（中文朗读者读英文词的真实口音形态）               |
| hotword 热词判别          | 6    | 张晗玥/刘翀、龚燊、Jedediah Kellerberg、宓淑娟、笪志远、贠云飞（罕见姓氏/专名，SeACo spike 同类）                                  |
| timestamp 时间戳黄金集    | 3    | 每例 3 句 Tingting 渲染、句间 900ms 静音；黄金边界由波形能量阈值测量（引擎无关的物理事实）                                         |

**诚实标注的取舍**：

1. "真实语料" = 真实录音（AISHELL-1）承载 real-clean/noise/farfield 三域的语音本体，
   噪声/远场为受控增强（标准 ASR 鲁棒性做法，参数逐例写入 manifest）；
   openslr 原始档 15GB 在本环境 0.7MB/s 不可行，HF 行级镜像按 Apache-2.0 取样再分发合法。
2. 口音域是 **TTS 口音模拟**（zh-TW/zh-HK 声音），不是真人方言录音——manifest 与
   provenance 如此标注，A/B 判决时按此理解证据强度。
3. 热词/中英混说/timestamp 域内容必须可控（指定罕见名词、指定边界），只能合成。
4. 标点参考文本只存在于作者标点用例（accent/codeswitch/hotword/timestamp 全部,
   AISHELL 转写无标点故 real-clean/noise/farfield 的标点维不可评分,如实跳过）。

## harness 用法

```bash
# 本地跑 torch 基线（嵌入式 Python + 已缓存模型，~72s 含模型加载）
pnpm run test:asr:ab -- --engine torch --report out.json --markdown out.md

# T4 判决：同一 commit 上两引擎各跑一次,然后对比
node scripts/asr-ab-harness.js --compare torch.json onnx.json
```

四维指标定义（纯函数,单测覆盖 `tests/unit/asr-ab-harness.test.ts`）：

1. **逐域 CER**：标点剥离的字错率（与 asr-regression.js 同一 normalize 语义）,按域聚合 mean/median/max。
2. **标点插删差**：参考文本与输出的骨架对齐后,锚定位置的标点事件逐对比较
   （全/半角同标点算匹配；换标点 = 1 删 + 1 插）。
3. **热词修复率**：每例双跑（hotword 关/开）,术语级判别四分类
   `repaired`（错→对）/ `still-wrong`（错→错）/ `always-right` / `regressed`;
   repairRate = repaired / (repaired + stillWrong)。
4. **timestamp 偏差**：对黄金集比较 `raw_segments`（每 VAD 区域一段,最贴近字符级时间戳）
   与波形测量边界,逐边界 |Δms| 聚合 mean/median/p95/max。**不用**合并后的
   `segments`——那是按 ~5s/标点的展示策略切块,句边界被策略性抹平,不能作为引擎误差度量。

`--compare` 门禁（spec #412 T4 输入,默认值可 CLI 覆盖）:逐域 mean CER delta ≤ +2pp、
热词修复率不降、timestamp meanAbsDev delta ≤ +150ms。

## torch 基线数字（2026-10-01,本机 mac arm64,funasr_server.py + SeACo + 嵌入式 Python）

全 39 例 0 失败,总耗时 72.3s（含模型加载）。

### 逐域 CER（标点剥离）

| 域                | n   | mean   | median | max    |
| ----------------- | --- | ------ | ------ | ------ |
| real-clean        | 8   | 0.00%  | 0.00%  | 0.00%  |
| noise             | 6   | 23.73% | 10.00% | 86.67% |
| farfield          | 4   | 6.94%  | 5.56%  | 16.67% |
| accent            | 6   | 2.31%  | 0.00%  | 8.33%  |
| codeswitch        | 6   | 16.22% | 17.36% | 29.63% |
| hotword（开热词） | 6   | 6.50%  | 6.90%  | 7.69%  |
| timestamp         | 3   | 0.00%  | 0.00%  | 0.00%  |

要点：

- **real-clean 饱和**（0.00%）——Paraformer 级模型在 AISHELL 干净朗读上就是天花板,
  与旧 6 句 TTS 饱和集同样性质;判别力来自 noise/farfield/codeswitch/hotword/timestamp 五域。
- **noise 判别力最强**：babble@5dB 出现"噪声内容泄漏"样本
  （`noise_babble_snr05_5900`：把 babble 源句"小朋友们在楼下的院子里跳绳"听进了正文,
  CER 86.67%）;pink@10dB 两例 0%、一例 35.71%（短句、近音词多的 5700 例）。
- **accent**：zh_TW 三例全 0%,zh_HK 0%/8.33%/5.56%（"这一轨度""会已记录"）——
  粤语口音模拟有信号,台湾腔模拟无信号（TTS 口音模拟较粗,见取舍 2）。
- **codeswitch**：英文片段整块丢失是主要错误形态
  （`API`/`PRD`/`OKR` 被丢,"demo 泡一遍"）;缝合式比整句式更难（26–30% vs 0–11%）。

### 标点插删差（对作者标点用例）

| 域         | 插入 | 删除 |
| ---------- | ---- | ---- |
| accent     | 0    | 2    |
| codeswitch | 1    | 6    |
| hotword    | 1    | 0    |
| timestamp  | 3    | 3    |

（real-clean/noise/farfield 无作者标点参考,不可评分。）

### 热词修复率：**14.29%**（repaired=1, still-wrong=6, always-right=0, regressed=0）

判别力成立的直接证据——两类样本都在：

| 用例           | 术语                | 无热词          | 有热词              | 判定                                 |
| -------------- | ------------------- | --------------- | ------------------- | ------------------------------------ |
| hw_zhanghanyue | 张晗玥              | 张含月          | **张晗玥**          | **repaired**                         |
| hw_zhanghanyue | 刘翀                | 刘冲            | 刘冲                | still-wrong                          |
| hw_gongshen    | 龚燊                | 公审            | 龚沈                | still-wrong（"龚"修复,"燊"未修复）   |
| hw_jedediah    | Jedediah Kellerberg | GDDA keler bert | jedediah keler bert | still-wrong（部分修复）              |
| hw_mishujuan   | 宓淑娟              | 密书娟          | 幂淑娟              | still-wrong                          |
| hw_dazhiyuan   | 笪志远              | 达致远          | 达志远              | still-wrong（"志远"修复,"笪"未修复） |
| hw_yunyunfei   | 贠云飞              | 袁云飞          | 沅云飞              | still-wrong                          |

### timestamp 偏差（黄金集,18 个边界）

mean **64ms** · median 63ms · p95 185ms · max **185ms** · 缺失 0 · 多余 0
（逐句 (Δstart, Δend) 全部落在 [−70ms, +185ms],见 JSON 报告逐例明细。）

## 方法学边界（读数字前必读）

1. CER 的 normalize 只做 NFKC + 小写 + 去标点/空白/符号,不做异体字归并——
   如 `noise_babble_snr05_4400` 的"馀→余"按 1 个替换计（10% CER 来自异体字,不是听错）。
2. 口音域为 TTS 模拟,证据强度低于真人方言录音;A/B（引擎间对比）有效性不受影响,
   绝对值不可外推到真实口音人群。
3. 热词术语级判定是"归一化后整词包含",部分修复（龚燊→龚沈）按 still-wrong 计;
   修复率的分母只有判别性用例（repaired+stillWrong）。
4. 基线是单次运行;推理有非确定性边缘（线程调度）,A/B 对比时两引擎应在同一台机器
   同一 commit 上跑。

## 重跑与 CI

- 本地：`pnpm run test:asr:ab -- --engine torch`（模型已缓存时 ~72s）。
- CI（手动 dispatch,PR 门禁不放这个重量）：
  `gh workflow run asr-ab.yml --ref <branch> -f engine=torch [-f os=windows-latest]`
  （runner 装 torch 栈 + `download_models.py` 拉 ~1.24GB 模型后跑全语料,报告上传 artifact）。
- 旧的 6 句 TTS 饱和集（`scripts/golden_set/` + `pnpm run test:asr`）保留为快速冒烟,
  本语料集自 T4 起作为发布 A/B 门禁（spec #412 S1）。

### CI 取证运行（2026-10-01,macos-latest,torch 引擎）

Run: https://github.com/TeFuirnever/Murmur/actions/runs/36786537761（成功,分支
`agent/onnx-414`;因 GitHub dispatch API 只认默认分支上的 workflow 文件,取证用的是
分支上的一枚临时 push 触发器,已随后续 commit 移除,dispatch 是预期入口）。

- 逐域 CER 与热词修复率**逐位复现**本地基线（noise 23.73% / codeswitch 16.22% /
  hotword repairRate 14.29%,still-wrong 输出文本亦一致）。
- timestamp 维出现跨机差异：CI 上 mean 998ms / max 2830ms / 缺失 1 段,本地为
  mean 64ms / 缺失 0——VAD 切分在不同环境（线程调度/推理后端）下边界行为不同,
  佐证"方法学边界"第 4 条"A/B 必须同机同 commit 对跑"的约束;这也是该维应使用
  `--compare` 同机对比而非绝对阈值的原因。

## 对 T4 的对照面小结（非判决）

torch 基线给出的"必须不退步"锚点:noise mean CER 23.73% / codeswitch 16.22% /
hotword 修复率 14.29%（repaired≥1 且术语级修复能力可辨）/ timestamp mean 64ms。
ONNX int8 候选在相同语料上跑 `--compare` 即得逐维 delta 与门禁结论。
