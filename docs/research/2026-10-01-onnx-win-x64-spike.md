# Windows x64 ONNX spike——发布证据链第一环（#415 / spec #412 T2）

> 日期：2026-10-01 · 分支：`agent/onnx-415` · status：**Windows 项证据已采集，spike 门禁全绿（非最终 GO 判决）**
> CI 取证运行：https://github.com/TeFuirnever/Murmur/actions/runs/36794807094 （windows-latest，conclusion: success）
> 本文只记录证据；tag 前证据链的完整判定（win spike + 真实语料 A/B）由 spec #412 决议 13 统一裁决，本文不替 owner 拍板路线。

## 一句话摘要

在 CI windows-latest（win x64, 4 vCPU）上用 **T1 自导出产物**（release `models-onnx-int8-1`，逐文件 sha256 严格校验后）完成四模型加载与 40s wav 推理：转写文本非空（164 字）、与参考文本 char similarity **0.9213——与 mac arm64 基线完全一致**（同一字节确定性复现）；安装体积（funasr-onnx 全栈 pip env，无 torch）519.3 MB；推理峰值 RSS **910.6 MB**（mac 同条件 1915 MB）；冷启动（新进程→四模型→首次 40s 转写）5 次采样 min/median/max = **7.92 / 8.11 / 8.97 s**。RTF best 0.0476（CI 慢速 4 核）。

## 产物

| 产物                                    | 路径                                                                                             |
| --------------------------------------- | ------------------------------------------------------------------------------------------------ |
| spike 运行器（可复用脚本）              | `scripts/onnx-spike/win_spike.py`（verify → 安装体积 → 冷启动×N → 测量 → 门禁）                  |
| 运行环境 pin（与 T1 导出链对齐）        | `scripts/onnx-spike/requirements-runtime.txt`（36 个 wheel，win/mac 同版本解析）                 |
| 40s wav 输入（入库，字节级同 T1 smoke） | `scripts/onnx-spike/fixtures/onnx-spike-40s.wav`（16k mono s16, 40.83s）                         |
| CI 入口（可重复运行）                   | `.github/workflows/onnx-win-spike.yml`（workflow_dispatch + push 触发）                          |
| 单测                                    | `tests/python/test_onnx_win_spike.py`（31 例，stdlib-only）、`tests/unit/onnx-win-spike.test.ts` |
| CI 证据产物（machine-readable + 报告）  | workflow artifact `onnx-win-spike-evidence`（run 36794807094）                                   |
| 使用说明                                | `scripts/onnx-spike/README.md`                                                                   |

## 信任链（spike 用的字节从哪来）

两道校验，全部指向 T1 自导出产物，**不接触社区仓**：

1. **下载即校验**：CI 先跑 `scripts/onnx-export/verify_artifacts.py --from-release`——从本仓 release `models-onnx-int8-1` 逐 asset 下载（大图分片 partNN 重组），并按 `scripts/onnx-export/model-pin.json` 的全文件 sha256 清单做严格集合校验（缺失/篡改/多余文件均 fail）。
2. **推理前再校验**：`win_spike.py run` 在任何推理发生前对四个模型目录重跑同一 `check_manifest` 严格校验——spike 拒绝在任何未过 pin 的字节上出数。

模型清单（pin 记录）：ASR `asr-seaco-paraformer`、VAD `vad-fsmn`、Punc `punc-ct-transformer-272727`、说话人 `speaker-campplus`，checkpoint commit 40 位 SHA 与逐文件 sha256 见 `model-pin.json`。

## 环境与执行位置

| 项                | 值                                                                                                                                                                                                                                                   |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| runner            | `windows-latest`（Windows-10-10.0.26100-SP0, AMD64, 4 vCPU）                                                                                                                                                                                         |
| python            | 3.11.9（setup-python）                                                                                                                                                                                                                               |
| onnxruntime       | 1.30.0（与 T1 导出 pin 同版本）                                                                                                                                                                                                                      |
| funasr-onnx       | 0.4.3（T1 运行时文件契约的 source-verified 版本）                                                                                                                                                                                                    |
| 实际执行 provider | `CPUExecutionProvider`——funasr-onnx 组 session 时只可能前置 CUDA EP，恒定追加 CPU EP（`funasr_onnx/utils/utils.py` EP_list 构造），CI 无 GPU；CAMPPlus session 由 spike 显式指定 CPU EP。可用列表中的 `AzureExecutionProvider` 未被任何 session 使用 |
| 依赖树            | 36 个 wheel，无 torch/torchaudio/torchvision；win x64 与 mac arm64 本地 venv 解析出**完全相同的 36 个版本**（pip freeze 逐行一致，记录在结果 JSON）                                                                                                  |

## 测量一：安装体积（安装 funasr-onnx 环境）

pip 环境 site-packages 总量 **519.3 MB**（win x64，`sysconfig` purelib 递归求和），前五名：

| 包           | 体积     | 说明                                                                 |
| ------------ | -------- | -------------------------------------------------------------------- |
| llvmlite     | 116.3 MB | librosa→numba 传递依赖，spec 决议 3 的打包期裁剪目标（裁后 −144 MB） |
| scipy        | 112.7 MB | 含 `scipy.libs` 19.3 MB 另计                                         |
| onnxruntime  | 44.1 MB  | 推理本体                                                             |
| scikit-learn | 42.0 MB  | librosa 传递依赖                                                     |
| jieba        | 41.1 MB  | funasr-onnx 模块级硬依赖（spec 已知项）                              |

**对照（诚实标注平台差异）**：当前 mac arm64 嵌入式 torch 环境 site-packages 共 824 MB（本机实测，`python/lib/python3.11/site-packages`），其中 torch 系（torch 271 + torchaudio 14 + torchvision 6 + torchgen 2）≈ 293 MB。ONNX 栈结构性事实：torch 系 293 MB 整体消失，替换为 onnxruntime 44 MB；numba/llvmlite 144 MB 按 spec 决议 3 在打包期裁剪后预期 ≈375 MB。注意 824 MB 是 mac 嵌入式环境的数、519.3 MB 是 win CI 的数，两平台 wheel 体积不可直接相减，结论只取"torch 系消失 + ORT 44 MB"这一平台无关结构。

## 测量二：冷启动时间（5 次采样，多次采样要求）

定义（对齐 spec 决议 12/18 的"首次转写冷启动"）：**新进程 spawn → import 全栈 → 四模型加载完成 → 40s wav 首次转写返回**。每次采样都是全新子进程（父进程 `subprocess` 逐个拉起），无 warm 复用。

| 采样         | 1     | 2     | 3     | 4     | 5     |
| ------------ | ----- | ----- | ----- | ----- | ----- |
| 总冷启动 (s) | 8.106 | 7.948 | 7.915 | 8.575 | 8.968 |

**min / median / max = 7.92 / 8.11 / 8.97 s**。分解（采样 1）：import 0.30 s + 模型加载 5.19 s（ASR 3.71 s 占大头：345 MB int8 图从冷盘读入；VAD 0.03 s、Punc 0.44 s、CAMPPlus 1.02 s）+ 首次 40s 推理 2.47 s。

边界：CI runner 是 4 vCPU 共享机器且首启无文件缓存，真实用户机（含杀毒首载）波动更大；spec 决议 12 已把看门狗判活改为进程心跳以容忍这类离群。

## 测量三：推理 RSS

psutil 进程内采样：加载后快照 + 推理窗口 50 ms 轮询峰值（Windows 无 `getrusage` 的 ru_maxrss 等价物，轮询峰值为诚实下界采样）。

| 节点                        | RSS (MB)  |
| --------------------------- | --------- |
| 加载前（解释器+音频已读入） | 39.0      |
| 四模型加载完成              | 847.9     |
| **ASR 推理窗口峰值**        | **910.6** |
| 结束时                      | 860.9     |

**mac arm64 对照（同字节、同 40s wav、同脚本，本机 10 核）**：加载后 ~1810 MB、推理峰值 1900 MB——win x64 比 mac 低约 52%。spec 的 ≤1.7GB 目标（用户故事 6）在 win x64 上余量充足（910 MB vs 1700 上限）；mac 侧数值与 T1 spike 观察一致（1891 MB），差异主要来自两平台 ORT 内存竞技场/页缓存行为，非代码差异。ORT 竞技场不向 OS 归还（spec 已知残余风险），长音频峰值仍需 T 系列长音频测试单独覆盖——本 spike 是 40s 单句证据，不替代 ≥10 分钟峰值测试。

## 40s wav 推理结果（四模型）

| 模型             | 结果                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------- |
| ASR SeACo (int8) | 转写 **164 字非空**，与参考文本 char similarity **0.9213**（门禁 ≥0.60；与 mac 基线逐位一致），timestamp 存在 |
| ASR 热词路径     | 传入热词表（语音识别 端到端模型 热词 隐私）执行成功返回（SeACo 位置参数路径）                                 |
| VAD fsmn         | 1 段，40.81 s 语音（全段检出）                                                                                |
| Punc ct-trans    | 标点恢复执行成功（输出带标点文本）                                                                            |
| 说话人 CAM++     | int8 图在 win x64 ORT 上加载并执行成功（80 维 fbank 输入 → 192 维 embedding，数值全有限）                     |

转写文本（前 120 字）：`语音识别技术把人类说话的声学信号转换成文字是很多人日常工作中离不开的工具端到端模型把整条链路合并成一个神经网络直接从音频输出文字训练更简单识别更准确我们的应用程序在本地完成全部识别过程音频不会上传到任何服务器保护用户隐私接下来还要支持热词功能…`

RTF（3 次 warm 运行 best）：**0.0476**（CI 4 vCPU；mac 本机 0.0125；两者均远低于 0.1 目标）。

**win x64 与 mac arm64 输出逐位一致（similarity 均为 0.9213、文本同 164 字）**——同一 int8 图在两平台 ORT 1.30.0 上数值行为收敛，这是量化引擎跨平台稳定性的直接证据。

## 门禁（ticket #415 验收断言）

`WIN-SPIKE: PASS`（run 36794807094 exit 0）。断言内容：文本非空（ticket 主断言）+ 结构健全性 pin 常量（≥30 字、similarity ≥0.60、VAD ≥1 段、CAMPPlus 图执行）+ 推理前 pin 校验通过。阈值以常量固化在 `win_spike.py`（MIN_TEXT_CHARS=30 / MIN_SIMILARITY=0.60 / MIN_VAD_SEGMENTS=1），由单测钉死，CI 证据不可悄悄放松。

## 方法学边界（读数字前必读）

1. **CI runner ≠ 用户机**：4 vCPU 共享 Azure 机器，冷启动/RTF 偏慢方向失真；RSS 受 ORT 竞技场策略影响，绝对值仅供参考、相对差（win vs mac 同字节同脚本）更有意义。
2. **CAMPPlus 是图执行证明，不是说话人精度证据**：funasr-onnx 0.4.3 无说话人加载器（T1 已验证），spike 用合成 80 维 fbank 驱动 int8 图证明加载+执行+输出有限；说话人精度归 T 系列 diarize A/B。
3. **安装体积含未裁剪的 librosa→numba/llvmlite（144 MB）**：spec 决议 3 的打包期裁剪由后续工单执行，裁后才是最终安装包贡献值。
4. **本 spike 不含长音频（≥10 min）与并发场景**：RSS 竞技场峰值需长音频测试单独取证（spec 用户故事 7）。
5. 冷启动 5 次采样来自同一 runner 实例的同一作业内串行进程，磁盘缓存随采样变热；min 7.92 s 是"热盘冷进程"下界，真实冷盘更接近 max。

## 重跑（可重复运行）

```bash
# 任意带此文件的分支（merge 后任意分支/ref）：
gh workflow run onnx-win-spike.yml --ref <branch> -f samples=5
# 或本地任意平台：
python -m venv .venv && .venv/bin/python -m pip install -r scripts/onnx-spike/requirements-runtime.txt
.venv/bin/python scripts/onnx-export/verify_artifacts.py --from-release --download-dir work/models
.venv/bin/python scripts/onnx-spike/win_spike.py run --models-dir work/models --samples 5
```

本地（mac arm64）同脚本验证 run：PASS，similarity 0.9213 / 峰值 RSS 1900 MB / RTF 0.0125 / 冷启动 ~1.8 s（3 采样）。

## 对证据链的位置（非判决）

spec #412 决议 13 的 tag 前证据链两项：①win x64 ONNX spike（本文，**绿**）+ ②真实语料 A/B（#414 已建 harness 与 torch 基线，ONNX 侧待 T4 判决运行）。本文只交 Windows 项证据，GO/NO-GO 与发布顺序（决议 13 的 mac 先发 N、win N+1 回退路径）由 owner 依据 ①+② 汇总裁决。
