# Follow-ups（v3 反思后遗留事项）

> [20260725_Autopilot_T1.5] 本文档为时间快照，文中 `.js` 文件名引用是写作时（ADR-010 big-bang 之前）的状态。当前源码已全部迁移到 `.ts`（见 `docs/adr/010-backend-ts-migration-strategy.md`）。下文保留原始文件名作为决策时的快照。

## ~~P1：路径遍历防护~~ ✅ 已修复

原始 SHOW_ITEM / OPEN_LOG channel 已在重构中移除。当前路径遍历防护覆盖：

- `src/helpers/audioPathValidator.js` — `validateAudioPath()` 使用 `path.resolve()` + `startsWith()` 双重校验，限制在 homedir/tmpdir/Volumes 内（从 `transcriptionHandlers.js` 提取）
- `src/helpers/updateManager.js` — 安装路径同样校验，限制在 app temp 目录内

## ~~P2-B: useModelStatus 双订阅~~ ✅ 已修复

提取为 `ModelStatusProvider` React Context 单例，App.tsx 和 useRecording.ts 共享一个实例。实现在 `src/hooks/useModelStatus.tsx`。

## ~~P2-C: C.FUNASR.GET_LOGS 错位~~ ✅ 已移除

GET_LOGS 相关 channel 和 handler 已在重构中完全移除，不再存在。

## ~~P2-D: 19 个孤儿 ipcMain.handle~~ ✅ 已清理

commit `4fd799f`: 15 个真正孤儿的 handler 注册和 contract 常量已删除（ENVIRONMENT 2、PYTHON 3、FUNASR 3、CLIPBOARD 2、SYSTEM 5）。
4 个误判（TRANSCRIPTION.GET/SEARCH/STATS、WINDOW.CLOSE_APP）已从白名单移除，它们在 preload 中正常暴露。
同时清理了死代码 EVENT.PYTHON_INSTALL_PROGRESS 和 systemHandlers.js 中未使用的 `path` 导入。

测试守门：`tests/unit/ipc-contracts-orphans.test.js` 的 `KNOWN_ORPHANS` 白名单现在只剩 AUDIO_EXTENSIONS 数组索引（非 IPC channel）。

## CSP 增加 dashscope（v2 备注）

当前 AI 调用走主进程，无需添加。如未来 renderer 直连 dashscope，再补。

## sandbox 决策评估

v1 release 后写 ADR 评估 `sandbox: true` 的收益与维护成本。

## P3：内部代码区分 ASR vs AI 概念

UI 文案本轮已澄清（"语音识别"≠"AI 文本优化"），但内部仍混用 `model` 一词：

- `ipc-contracts.js` 的 `MODELS.*` 已在之前的重构中清理
- `useModelStatus` hook 仍泛指 ASR 状态 — 可改 `useASRModelStatus`
- 写 ADR 文档化两类模型的边界，新人 onboarding 看一眼就懂

破坏面较大，v1 发布后再统一重构。

## Dev 启动防护网（P1/P2 后续）

> 来源：`docs/research/electron-dev-startup-hardening.md`（2026-07-28 审计）。P0 已落地于 commit `f5c7f3f`（dev:main 运行时 smoke + better-sqlite3 ABI preflight）。下列为剩余项。

### P2.1 — 消除 dev/prod 加载不对称 ✅ 已落地（commit 2e93278，PR #117）

dev:main 改用 `build:main && electron .`，dev/e2e/prod 加载同一 artifact（dist-main/main.js）。tsx-direct 路径整个消失，silent-hang 温床根除。采用一次性 build（非 --watch）：architect 确认更优（electron 主进程无 HMR，改 main.ts 反正重启）。

### P1.1 — canary 提升为 E2E 强断言 ⏸ 受阻（2026-07-28 试过）

目标：electron-launch.ts 缓冲 main 输出，firstWindow 后断言 `[main:canary]`。试过发现两个阻塞：

1. **canary 时序**：canary（`main.ts:12`）在 electron 启动早期触发，而 `mainOutputBuf` 在 `electron.launch()` 返回后才 attach → 错过早期 canary，gate 可能断言不到。需重想捕获方式（main 写文件 / gate 用晚期信号）。
2. **e2e 环境**：worktree firstWindow timeout（主 repo 同 e2e diag 过、worktree 不通，疑 embedded python/资源差异）；CI e2e 也 non-blocking（ADR-014 firstWindow 至今未解决）。

价值依赖 e2e 转 blocking（未来）；当前不急，#116 smoke 已是 blocking 兜底。

### P2.2 — 治本 dev/test ABI 互斥 ⏸ A 不可行（2026-07-28 试过）

- **Option A（`ELECTRON_RUN_AS_NODE` vitest）已证不可行**：试跑全 test → 84 fail / 79 files。Murmur test suite 不兼容 electron node runtime（electron-stub mock / 系统 node 模块行为差异，如 `preload-loadable.test.ts` 的 `requireCJS.cache["electron-stub"]`）。修 84 test 不值得。
- **当前最优 = #116**：rebuild（CI test 前）+ pretest probe（本地 dev/test 切换提示），已 merged。
- Option B（ADR 文档化排除契约）价值有限（#116 注释已解释 ABI split），按需。

## ~~README 平台徽章承诺了未发布的 Linux（2026-08-19 视景评审 H-5）~~ ✅ 已处理（2026-08-19）

维护者裁决：暂不支持 Linux，标注"暂无官方安装包，待社区投入"。已执行：平台徽章改为 macOS | Windows；中英文安装段各加 Linux 说明（欢迎社区贡献打包与维护方案）。完整记录见 `docs/vision-answers.md` H-5。

## 维护者手动项（Spec #299 交付后，2026-09-07）

- **录制 10 秒 demo GIF**（说话 → 文字出现 → AI 润色 → 自动粘贴），用于 README hero 区；原 [20260731_README_RewriteHero] 注释 TODO 已随 T4 移除，本条为唯一跟踪位置。当前 hero 使用静态截图 docs/promotion/screenshots/screenshot-xhs-mode.jpg。
- **按 Fox rebrand（2026-07-29）后版式重截产品截图**：docs/promotion/screenshots/ 现有三张摄于 2026-07-20，icon 为旧版；重截前 hero 沿用现有素材（已在 README 内注记）。

## 设置页整治（Epic #392）登记的范围外发现（2026-09-26）

实现过程中识别、超出当票边界、需要后续单独处理的项：

1. **主进程硬编码中文错误串**（spec E3 范围控制保留）：aiHandlers.ts:1013「请先在设置页面配置AI API密钥」等设置页可见路径已可直达 UI；funasrServer.ts 深水区（:454,470,547,565,573,583,620,633 等）未动（FunASR 子进程高风险区）。后续策略：error code + renderer 翻译，主进程不持 UI 文案。
2. **clipboard.ts 渲染层硬编码中文权限文案**（#401 顺手发现，L62/L259/L273-277）：权限页已清，剪贴板路径残留。
3. **OpenRouter `:free` 模型条目未刷新**（#397 遗留）：免费模型 ID 轮换快、无官方稳定清单可核实，建议用 openrouter.ai/models 实拉清单单独修。
4. ~~**settings-page.test.tsx「applies the persisted language on mount」30ms 时序窗口**~~ ✅ 已落地（2026-09-26，bd28318）：settings-page.test.tsx 已改用 `waitFor` 轮询替代固定 30ms sleep，flake 根除。
5. **主题 system 模式 OS 深浅切换实时跟随**（#395 票外既有缺口）：主窗有 matchMedia 监听，设置/历史窗只在 apply 时刻快照。
6. **权限徽章为查询快照**（#396 风险登记）：用户在系统设置授权后需重进设置页或点测试才刷新；后续可在窗口 focus 时重查。
7. **影子内置模式的下拉标签**（#399 已知边界）：自定义模板覆盖内置模式时下拉显示内置 i18n 标签；精确标签需扩展 IPC 契约。
8. **e2e 启动器 userData 未隔离**（PR #411 test 步发现）：`tests/e2e/helpers/electron-launch.ts` 以 `MURMUR_DB_PATH=:memory:` 启动不隔离 fileSync——setSetting('theme'/'language') 会写穿到真实 `~/Library/Application Support/murmur/murmur.json`。pipeline 验证 run 后已手工还原；根治需在启动 helper 里重定向 userData。
9. **auto_start 的 SMAppService「requires-approval」态无 UI 反馈**（#404 遗留）：macOS 13+ 若登录项在系统设置中未获批准，开关显示开但登录项未生效，启动同步每 boot 仅记 info 日志。后续可在开关侧显示批准引导（System Settings → General → Login Items 链接）。
