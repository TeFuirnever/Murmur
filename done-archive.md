## Archived 2026-09-07

- [x] e2e-repair-pack - 修复 e2e 19 个败例:11 条 mock 基建断裂(ipc-mock.ts 的 eval require,ADR-010 bundle 化所致)+ 4 条断言漂移(1.5 测已删路由/4.1 热键符号/8.1 参数签名/2.4 payload)+ 3 条时序 + 1 条 pasteText 契约。证据:docs/research/2026-08-20-scout-full-audit.md §5.3/§6-9 https://github.com/TeFuirnever/Murmur/pull/213 (repo: murmur) (kind: ship) (merged 2026-08-20)

## Archived 2026-09-07

- [x] download-timeout-bytes - 模型下载 10 分钟硬超时改造:modelManager.downloadModels 的固定超对慢网 >1.2GB 模型会撞线被杀(#212 症状链之一就是超时后结束下载)。方向:超时改按字节增长推导(N 分钟无字节增长才算真超时)或可配置;被超时杀死时 UI 明确提示已保留部分、重试续传。GitHub issue #254,遗留自 #243 code review MINOR (repo: murmur) (kind: ship) (priority: 0) (done 2026-09-05)
      GitHub issue #254。遗留自 #243 code review(MINOR,follow-up)。modelManager.downloadModels 有 10 分钟硬超时(414 行附近)。#212 的症状链之一是『超时后结束下载』:慢网络下 >1.2GB 的模型会撞线被杀。snapshot_download 支持断点续传,重试能恢复,但体验是反复『下载→到点→重来』。方向:(1) 超时改为按已下载字节推导(如 N 分钟无字节增长才算真超时)或可配置;(2) 下载被超时杀死时 UI 明确提示『已保留已下载部分,重试将续传』;(3) timer 清理已随 #243 修复(close/error 时 clearTimeout)。涉及 modelManager.ts(热路径)+ 主进程 IPC,改前先补测试锁定现有超时行为(TDD)。

## Archived 2026-10-01

- [x] repo-ready-vocab-glob - 修复 _repo_ready vocab* 通配误判:funasr_server.py 用 vocab* 通配判就绪,modelscope 下载中分片(vocab.txt_0_167772159)也能匹配,服务器下载中途重启可能误判就绪→AutoModel 加载失败且报错难懂。方向:排除 \*\_0\_\_ 分片或要求核心文件精确存在。GitHub issue #255,遗留自 #243 code review open question (repo: murmur) (kind: ship) (priority: 0) (done 2026-09-06)
      GitHub issue #255。来源:#243 code review open question(既有宽松行为,非新引入)。funasr_server.py 的 \_repo_ready 用 vocab_ 通配判断模型就绪——modelscope 下载中的分片文件名形如 vocab.txt*0_167772159,也能匹配。若服务器恰在下载中途(重)启动,门槛可能误判就绪后 AutoModel 加载失败(报错信息更难懂)。方向:就绪判定排除 \*\_0*\* 分片模式,或要求 model.pt/config.yaml 等核心文件精确存在。低概率,单独立项避免丢失。funasr Python 子系统属高风险区,改判定逻辑需配测试。

## Archived 2026-10-06

- [x] funasr-output-swallow - 修复 funasr_server 协议输出被吞:\_output_worker 用 sys.stdout 动态查找,落入 suppress_stdout 窗口时 reload 进度消息被静默丢弃(#207 只修了崩溃形态)。方向:写协议输出改用启动时捕获的专用流引用;补协议测试(队列消息在抑制窗口不丢)。GitHub issue #208,关联 #197 follow-ups。证据:issue #208(源自 #207 code review 既有缺口) (repo: murmur) (kind: ship) (priority: 0) (done 2026-09-06)
      GitHub issue #208。\_output_worker 从 response_queue 取消息后 print() 到 sys.stdout;当模型加载器处于 suppress_stdout() 窗口(reload_models → \_do_reload 入队进度后 initialize() 进加载器),output worker 若此时出队,消息写入抑制 sink 被静默丢弃,宿主丢失进度事件。修复方向:\_output_worker 写协议输出时使用启动时捕获的专用流引用,使协议通道对抑制窗口免疫。必须同步补协议测试:队列消息在抑制窗口期间不丢。遵循 MUST DO #3:先写失败测试再修。
