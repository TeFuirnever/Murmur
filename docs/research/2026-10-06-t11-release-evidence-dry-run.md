# T11 发布证据链 dry-run 演练报告(#424 / spec #412 决议 13)

> 2026-10-06,分支 `agent/onnx-424`(HEAD `a623097`)。演练=在不打 tag 的
> 前提下,把 tag 发布要走的完整链条(workflow_dispatch 触发 Build
> Installers 全部 job,release 除外)真跑一遍并全绿。本文只记录证据;是否
> 以此放行某个真实版本由 owner 决定。

## 一句话结论

**Dry-run 全链一次全绿**(run [37419511392](https://github.com/TeFuirnever/Murmur/actions/runs/37419511392):test / build-mac / build-win / evidence-checklist 四 job 全 success,release 按非 tag 预期 skip);双平台打包后 ONNX 真推理断言成立(mac/win 均 327 字转写、VAD 1 区、punc 非空);证据链 checklist 五项全绿(T8 预算内:dmg 225.4MB / setup exe 195.1MB)。

## 演练范围:链条地图

| 项               | 工单      | 引用产物                                                                                                                                                                         | 验证位置                                 |
| ---------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| T2 win x64 spike | #415      | `docs/research/2026-10-01-onnx-win-x64-spike.md`(`WIN-SPIKE: PASS`)+ onnx-win-spike.yml 绿色 run                                                                                 | checklist job(run 36794807094 @ 30ae52f) |
| T4 A/B 判决      | #416+#443 | 判决书含「议决记录」+`PASS (all gates)`;`2026-10-06-onnx-ab-compare-t4a.json` GO 且热词 zh=hard/en=观察项;`2026-10-01-onnx-ab-run.json`;asr-ab.yml 绿色 run                      | checklist job(run 36786537761)           |
| T7 资源门禁      | #421      | 测量环境澄清文档(`RESOURCE-GATE: PASS`)+ onnx-resource-gate.yml 绿色 run(run success 即双平台腿全绿)                                                                             | checklist job(run 37368971999)           |
| T8 打包          | #422      | 本次 build mac/win job 硬前置(含 import gate + 打包后推理 smoke);`installer-sizes.json` 主安装包预算 mac ≤260MB / win ≤270MB;wheel sha256 lock 在库                              | `needs` + checklist job 读工件           |
| T9 迁移 UX       | #420      | MigrationDialog / modelDownloader / onnxMigration / useModelStatus + 三份回归锁(migration-dialog / onnx-migration-resume / modelManager-torch-fallback);测试本体在 test job 执行 | test job + checklist 存在性钉            |

缺项即红:任何一项产物缺失/口径漂移/checklist 无法确认绿 run,`evidence-checklist` 失败并阻断 `release`(`needs: [build-mac, build-win, evidence-checklist]`)。

## CI dry-run 结果(run 37419511392)

| job                | 结论       | 关键证据                                                            |
| ------------------ | ---------- | ------------------------------------------------------------------- |
| test               | ✅         | 常规单测套(含 #424 新增 22 例 release-evidence-chain.test.ts)       |
| build-mac          | ✅         | 打包门禁 + boot smoke + **打包后 ONNX 真推理** + installer 尺寸工件 |
| build-win          | ✅         | 同上(NSIS 安装路径)                                                 |
| evidence-checklist | ✅         | `release-evidence-chain-report.json`:`passed: true`,五项全 green    |
| release            | ⏭ skipped | dry-run 非 tag,符合预期                                             |

## 打包后 ONNX 真推理证据(新闸,S3 缝)

安装产物内的嵌入式解释器(app 同款 `PYTHONHOME`/`PYTHONPATH` 隔离环境)经
`scripts/embedded-python/import_gate.py` full 模式,对提交的 40s fixture
(先转 FLAC 走非 wav 解码路径)完成 ASR+VAD+Punc 真转写:

| 平台           | run                        | 判决   | VAD  | ASR 字数 | punc 字数 | 转写开头                                        |
| -------------- | -------------------------- | ------ | ---- | -------- | --------- | ----------------------------------------------- |
| mac(DMG 安装)  | 37418367379 与 37419511392 | passed | 1 区 | 327      | 175       | 「语音识别技术把人类说话的声学信号转换成文字…」 |
| win(NSIS 安装) | 37419511392                | passed | 1 区 | 327      | 176       | 同上,全文正确                                   |

工件:`packaged-inference-smoke-macos` / `packaged-inference-smoke-windows`
(判决 JSON 随 run 上传留档)。门禁模型字节缺失时 smoke 内硬拉取(T1 自导出
镜像 + sha256 pin),镜像故障即构建红——推理证据不可跳过。

## checklist job 明细(evidence-checklist,run 37419511392)

- **T2-win-spike green**:win spike 文档 PASS 标记 + 绿 run 36794807094。
- **T4-ab-verdict green**:议决记录 + GO 口径标记;compare-t4a `passed=true`
  且 hotwordSubdomains zh=hard / en=observation-only(#443 翻 GO 后口径);
  onnx-ab run.json 在库;asr-ab 绿 run 36786537761。
- **T7-resource-gates green**:澄清文档 PASS 标记 + 绿 run 37368971999。
- **T8-packaging green**:requirements.lock 在库;
  `Murmur-1.5.2-arm64.dmg` = 236,333,015 bytes(225.4MB ≤ 260MB);
  `Murmur Setup 1.5.2.exe` = 204,595,107 bytes(195.1MB ≤ 270MB);
  zip 为自动更新伴随产物,记录但不做预算门禁(预算语义=用户安装的主安装包)。
- **T9-migration-ux green**:4 模块 + 3 回归锁全部在库。

报告工件:`release-evidence-chain-report`(机器可读,随 run 留档)。

## 本地验证(同一求值器,本地 dry-run)

- `node scripts/release-evidence/check-evidence-chain.js` 对仓库现状:
  T2/T4/T7/T9 全绿;T8 红(mac/win 无 installer-sizes.json 工件)——正确行为,
  本地没有打包产物,缺项即红;CI dry-run 中该工件由 build job 产出后转绿。
- `pnpm exec vitest run tests/unit/release-evidence-chain.test.ts`:22 例全过
  (求值器判定 16 例 + build.yml 接线 6 例),红先于绿(TDD:模块缺失→21 例红
  →实现→绿;编码回归 pin 后 22 例)。
- `pnpm lint`(exit 0)、`pnpm run typecheck:tests`(干净)、
  `pnpm run check:debt-markers`(无标记)、prettier 全格式化。

## 第一次 run 的失败与修复(如实记录)

run [37418367379](https://github.com/TeFuirnever/Murmur/actions/runs/37418367379)
build-win 的打包后推理 smoke 失败:**推理门禁本身已通过**,但
`import_gate.py` 打印成功判决 JSON 时,内嵌中文文本在 Windows 默认 console
codec(cp1252)上 `UnicodeEncodeError` 崩掉步骤。修复:双平台推理段补
`PYTHONIOENCODING=utf-8`(与 `prepare-embedded-python.js` 的 `pythonEnv` 同名
设置对齐),`tests/unit/release-evidence-chain.test.ts` 加回归 pin。退出码断言
按设计把这次崩溃变成了红——门禁语义正确,根因在打印编码。修复后第二次 run
全绿。

## 语义边界与观察(不替 owner 拍板)

1. **录得证据链,非 tag 重跑**:checklist 断言「链条存在且全绿」(heavy 证据
   workflow 为 dispatch-only,模型栈 ~700MB 不进常规 CI);是否在 release
   candidate 上重跑 heavy workflow 由 owner 按发布节奏决定(已写入
   CONTRIBUTING 门 8 注)。
2. **分发预案已入 CONTRIBUTING**:证据缺项时 mac 先发 N、win 随 N+1;判定
   边界归 owner(checklist 只判齐绿与否)。
3. **既有文档陈旧观察(未动,非本工单范围)**:CONTRIBUTING 门 3 仍写
   「真实 import numpy/soundfile/funasr」、门 4 仍写 Python 自检「跑
   `import funasr`」——#422 已把 import 门换成 `import_gate.py`
   (--check-only:funasr_onnx 栈 + marker 一致性)。建议后续 docs 工单订正。
4. dry-run 的 release job 被 skip 属预期(非 tag);真实 tag 时 release 额外
   受 `needs` 链保护,checklist 红则 release 不可能运行。

## 复现命令

```bash
# 本地求值器(需要网络读 GitHub runs API;可选 GH_TOKEN)
GH_TOKEN=$(gh auth token) node scripts/release-evidence/check-evidence-chain.js --out /tmp/report.json

# CI dry-run(不打 tag 的全链演练)
gh workflow run build.yml --ref agent/onnx-424
gh run watch <run-id> --exit-status

# 单测
pnpm exec vitest run tests/unit/release-evidence-chain.test.ts
```
