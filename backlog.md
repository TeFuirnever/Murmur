# Backlog

## In flight

## Queued

- [ ] research-docs-triage - 决定两份未跟踪研究文档的去留:ai-polish-capability-research.md 与 spec-193-adversarial-review.md(提交/并入 follow-ups/丢弃) (repo: murmur) (kind: docs) (priority: 4) (since 2026-08-20)

## Done

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
- [x] funasr-output-swallow - 修复 funasr_server 协议输出被吞:\_output_worker 用 sys.stdout 动态查找,落入 suppress_stdout 窗口时 reload 进度消息被静默丢弃(#207 只修了崩溃形态)。方向:写协议输出改用启动时捕获的专用流引用;补协议测试(队列消息在抑制窗口不丢)。GitHub issue #208,关联 #197 follow-ups。证据:issue #208(源自 #207 code review 既有缺口) (repo: murmur) (kind: ship) (priority: 0) (done 2026-09-06)
      GitHub issue #208。\_output_worker 从 response_queue 取消息后 print() 到 sys.stdout;当模型加载器处于 suppress_stdout() 窗口(reload_models → \_do_reload 入队进度后 initialize() 进加载器),output worker 若此时出队,消息写入抑制 sink 被静默丢弃,宿主丢失进度事件。修复方向:\_output_worker 写协议输出时使用启动时捕获的专用流引用,使协议通道对抑制窗口免疫。必须同步补协议测试:队列消息在抑制窗口期间不丢。遵循 MUST DO #3:先写失败测试再修。
- [x] repo-ready-vocab-glob - 修复 _repo_ready vocab* 通配误判:funasr_server.py 用 vocab* 通配判就绪,modelscope 下载中分片(vocab.txt_0_167772159)也能匹配,服务器下载中途重启可能误判就绪→AutoModel 加载失败且报错难懂。方向:排除 \*\_0\_\_ 分片或要求核心文件精确存在。GitHub issue #255,遗留自 #243 code review open question (repo: murmur) (kind: ship) (priority: 0) (done 2026-09-06)
      GitHub issue #255。来源:#243 code review open question(既有宽松行为,非新引入)。funasr_server.py 的 \_repo_ready 用 vocab_ 通配判断模型就绪——modelscope 下载中的分片文件名形如 vocab.txt*0_167772159,也能匹配。若服务器恰在下载中途(重)启动,门槛可能误判就绪后 AutoModel 加载失败(报错信息更难懂)。方向:就绪判定排除 \*\_0*\* 分片模式,或要求 model.pt/config.yaml 等核心文件精确存在。低概率,单独立项避免丢失。funasr Python 子系统属高风险区,改判定逻辑需配测试。
- [x] download-timeout-bytes - 模型下载 10 分钟硬超时改造:modelManager.downloadModels 的固定超对慢网 >1.2GB 模型会撞线被杀(#212 症状链之一就是超时后结束下载)。方向:超时改按字节增长推导(N 分钟无字节增长才算真超时)或可配置;被超时杀死时 UI 明确提示已保留部分、重试续传。GitHub issue #254,遗留自 #243 code review MINOR (repo: murmur) (kind: ship) (priority: 0) (done 2026-09-05)
      GitHub issue #254。遗留自 #243 code review(MINOR,follow-up)。modelManager.downloadModels 有 10 分钟硬超时(414 行附近)。#212 的症状链之一是『超时后结束下载』:慢网络下 >1.2GB 的模型会撞线被杀。snapshot_download 支持断点续传,重试能恢复,但体验是反复『下载→到点→重来』。方向:(1) 超时改为按已下载字节推导(如 N 分钟无字节增长才算真超时)或可配置;(2) 下载被超时杀死时 UI 明确提示『已保留已下载部分,重试将续传』;(3) timer 清理已随 #243 修复(close/error 时 clearTimeout)。涉及 modelManager.ts(热路径)+ 主进程 IPC,改前先补测试锁定现有超时行为(TDD)。
