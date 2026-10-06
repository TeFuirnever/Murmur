# Backlog

## In flight

- [ ] followup-ci-cache-poison - CI: gate-models 软降级 + python 缓存固化复合故障——镜像 500 时未裁剪环境入库，同 key 重跑永久红；建议下载失败 attempt 不保存 python 缓存或改硬失败 (since 2026-10-06)

## Queued

- [ ] followup-flaky-userecording - test: useRecording.test.tsx:1737 flaky——waitFor 超时 error 停留 null（v1.6.0 tag run attempt2 实证，同 commit 3 绿 1 红） (since 2026-10-06)

## Done

- [x] t422 - T8 打包瘦身 + gate 换血:安装包 ≤260MB 兑现 (#422) (done 2026-10-06)

- [x] 414 - T3 A/B 真实语料 harness + torch 基线 (done 2026-10-01)

- [x] research-docs-triage - 决定两份未跟踪研究文档的去留:ai-polish-capability-research.md 与 spec-193-adversarial-review.md(提交/并入 follow-ups/丢弃) (repo: murmur) (kind: docs) (priority: 4) (done 2026-09-07)

- [x] ci-e2e-structural-fix - CI e2e 结构性修复:e2e 前加 npx @electron/rebuild -f -w better-sqlite3;摘 boot-health 的 continue-on-error 观察两周再议全量转阻塞。当前 CI e2e 因 ABI 顺序从未绿过。证据:审计报告 §4.3-1/§5.2/§6-1 blocked-by: e2e-repair-pack (repo: murmur) (kind: ship) (priority: 3) (done 2026-09-07)
      CI e2e 结构性修复:e2e 前加 npx @electron/rebuild -f -w better-sqlite3;摘 boot-health 的 continue-on-error 观察两周再议全量转阻塞。当前 CI e2e 因 ABI 顺序从未绿过。证据:审计报告 §4.3-1/§5.2/§6-1

  【2026-09-05 补】dev smoke 同源盲区:只轮询 renderer :5173,主进程 sqlite 崩溃不挡它。实际发生过——predev 裸 electron-rebuild 静默跳过,系统 ABI 残留导致 pnpm dev 启动即崩,smoke 却全绿;predev 已修(0f2c617,加 -f -w better-sqlite3,附回归测试 predev-force-rebuild.test.ts)。建议本任务一并把 dev smoke 健康判据升级为主进程心跳/IPC 探测,而非仅端口可达。

  【2026-09-05 二补·前提已变】spec #226 落地后 better-sqlite3 已从代码库移除(node:sqlite 内置):本机 pnpm test:e2e:boot 7/7、全套 pnpm test:e2e 46/46 首次全绿,无任何 rebuild 步骤——"e2e 前加 rebuild"的处方已作废。剩余有效工作:(1) CI 侧验证 e2e job 在无 ABI 后能否转绿并按原计划摘 continue-on-error;(2) dev smoke 判据升级(同上文)。predev-force-rebuild.test.ts 已随迁移反转为"禁止再引入原生重建"的钉子。

- [x] dead-channel-cleanup - 死通道清理:PROCESSING_UPDATE(有监听无发送)、TRANSCRIPTION_UPDATE/ERROR(双端死)、FUNASR_INSTALL_PROGRESS+FUNASR.INSTALL(双孤儿)、半孤儿 handler 批(WINDOW.SHOW 等 6 个)。沿 20260816_Refactor_DeadChannels 先例。证据:§3 A-E/§6-3 (repo: murmur) (kind: ship) (priority: 3) (done 2026-09-07)
- [x] orphans-test-renderer-dim - 测试网补盲:ipc-contracts-orphans.test 增加 renderer-caller 维度(扫 src/ electronAPI.X 调用,无 caller 即黄名单),让死通道自动现形。证据:§3 注/§6-7 (repo: murmur) (kind: ship) (priority: 3) (done 2026-09-07)
      测试网补盲(新增维度):平台条件分支覆盖差——覆盖率门禁修复(345722e)后首次在 Windows 腿真实测量,branch 91.53% vs macOS 92.19%,差值集中在 win32/darwin 双臂(audioPathValidator、funasrServer taskkill/SIGKILL、pythonEnvironment 布局、windowManager 等):每条平台只覆盖自己一侧。已做:阈值强制收敛到 authored 平台 macOS(ci.yml + vitest.config 注释),Windows 腿跑全量测试不卡阈值,未降阈值。可做:为平台臂写对侧单测(mocks process.platform)拉平两条腿,或引入 os-agnostic 分层使双臂同测。证据:run 33942345594 windows-latest "Coverage for branches (91.53%) does not meet global threshold (92%)"。

- [x] default-mode-cleanup - default_mode 死设置:读端在(useRecording/useFileTranscription)写端无(不在 ALLOWED_SETTING_KEYS)。补 UI+allowlist 或删读端。证据:§3-G/§6-5 (repo: murmur) (kind: ship) (priority: 1) (done 2026-09-06)
- [x] history-clear-export - 历史窗补齐:清空全部按钮(CLEAR 链路全在,带确认)+ 导出全部支持多格式(UI 从硬编码 txt 改格式选择,handler 已支持)。证据:§1.4 缺口①②/§6-4 (repo: murmur) (kind: ship) (priority: 1) (done 2026-09-06)
- [x] i18n-main-history-windows - i18n 补接:主窗 App.tsx 与历史窗 history.tsx 完全未接 useTranslation,切英文仅设置窗生效。证据:§3-H/§6-6 (repo: murmur) (kind: ship) (priority: 1) (done 2026-09-06)
- [x] hotkey-settings-ui - 热键自定义断裂:App.tsx:289 toast 指向不存在的设置项。基础设施全就位(hotkey 键在 allowlist+fileConfig、HOTKEY.REGISTER IPC 在),补设置 UI+useHotkey 读设置;或先改文案。证据:§3-F/§6-2 (repo: murmur) (kind: ship) (priority: 1) (done 2026-09-06)
