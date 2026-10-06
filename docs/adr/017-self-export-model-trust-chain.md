# ADR 017: 模型自导出信任链 — commit-SHA + 全文件 sha256 pin + 双源镜像

**状态**: 已采纳 (2026-10-06)

## 上下文

#412 红队评审的三个 blocker 全部落在供应链：迁移前模型来自 modelscope `snapshot_download` 隐式拉 HEAD（无任何 pin）；服务端就绪闸门用 `*.onnx` 通配锚；模型目录不解析时存在隐式拉网回退路径。社区转换仓（marxyz 等）无维护承诺、不可复现，不能作为分发源。

## 决策

1. **模型源 = 官方 iic Apache-2.0 torch checkpoint 自导出**：用 FunASR export 管道（`scripts/onnx-export/export_onnx_models.py`）从 pin 定的官方 checkpoint 导出并量化，产物发布到我们自己的 GitHub Release（source-of-record）。
2. **pin = `checkpoint_commit`（40 位）+ 全文件 sha256 清单**：funasr-onnx 会读取的每一个文件——config / tokens / seg_dict / am.mvn / 两个 onnx 图，而非仅权重——逐文件记录 sha256 与字节数，清单入库 `scripts/onnx-export/model-pin.json`；`scripts/onnx-export/verify_artifacts.py` 逐文件校验，测试 twin `tests/unit/onnx-model-pin.test.ts` 把运行时文件集钉死。
3. **config.yaml 安全加载**：进入推理前 safe_load 预校验 + 键集合断言（上游用不安全 yaml.Loader，属 RCE 面）。
4. **封死无 pin 回退**：模型目录不解析时禁止隐式 `snapshot_download` 拉 HEAD；服务端就绪闸门只认 pin 的精确文件名集合（精确锚，非通配），临时下载名双侧排除；缺文件 = 显式"模型损坏请重下"，绝不静默拉网。
5. **双源分发**：ModelScope 镜像仓（`murmur-asr/murmur-models-onnx-int8`，国内快）+ 自有 GitHub Release（同 sha256，逐字节一致）自动失败回退，不做 geo 检测；另备 `MURMUR_OSS_MIRROR_URL` 自有 OSS 桶为第三源。
6. **Apache-2.0 署名义务**：release 附上游许可文本（`LICENSE.upstream` asset）+ pin 内 `license` / `attribution` 声明，履行 Apache-2.0 §4。

## 理由

- 自导出让产物的每个字节都经过我们的导出管道与校验；社区仓只作交叉验证样本，永不作为下载源。
- 导出确定性已被证：重跑导出管道与 pinned 产物 sha256 逐字节一致（#444 诊断报告 §一）——这是"信任锚 = pin + 可复现性"的实证。
- B 计划保留：官方 iic contextual-paraformer ONNX，启用前需先验证热词行为（含大写英文热词用例，见 #444 教训）。
- **签名姿态（如实陈述）**：模型产物无 GPG / Sigstore 签名。完整性锚 = 仓库内 pin 清单（git 历史可审计）+ HTTPS 传输；ModelScope 不提供签名 release，故上游 checkpoint 的信任锚是 `checkpoint_commit` pin + 导出可复现性，而非上游供应商的密码学签名。公开声明见 `SECURITY.md` "Model Supply Chain" 章节。

## 影响

- **保证**：用户下载的字节与已验证导出产物逐字节一致；损坏 = 显式报错，绝不静默拉网。
- **不保证**：上游 checkpoint 本身有供应商签名（ModelScope 无签名 release，见上）。
- fp32 变体仅诊断专用，不进 pin、不进发布镜像（#444）；`verify_artifacts.py --manifest` 模式仅用于本地独立 manifest 校验，发布校验路径不变。
- 下载端实现：`src/helpers/modelDownloader.ts`（双源回退 + 一次性全清单校验 + commit-SHA pin 校验 + 断点续传，无 skip-hash-on-retry 分支）。
