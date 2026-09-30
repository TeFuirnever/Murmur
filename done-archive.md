## Archived 2026-09-07

- [x] e2e-repair-pack - 修复 e2e 19 个败例:11 条 mock 基建断裂(ipc-mock.ts 的 eval require,ADR-010 bundle 化所致)+ 4 条断言漂移(1.5 测已删路由/4.1 热键符号/8.1 参数签名/2.4 payload)+ 3 条时序 + 1 条 pasteText 契约。证据:docs/research/2026-08-20-scout-full-audit.md §5.3/§6-9 https://github.com/TeFuirnever/Murmur/pull/213 (repo: murmur) (kind: ship) (merged 2026-08-20)

## Archived 2026-09-07

- [x] download-timeout-bytes - 模型下载 10 分钟硬超时改造:modelManager.downloadModels 的固定超对慢网 >1.2GB 模型会撞线被杀(#212 症状链之一就是超时后结束下载)。方向:超时改按字节增长推导(N 分钟无字节增长才算真超时)或可配置;被超时杀死时 UI 明确提示已保留部分、重试续传。GitHub issue #254,遗留自 #243 code review MINOR (repo: murmur) (kind: ship) (priority: 0) (done 2026-09-05)
      GitHub issue #254。遗留自 #243 code review(MINOR,follow-up)。modelManager.downloadModels 有 10 分钟硬超时(414 行附近)。#212 的症状链之一是『超时后结束下载』:慢网络下 >1.2GB 的模型会撞线被杀。snapshot_download 支持断点续传,重试能恢复,但体验是反复『下载→到点→重来』。方向:(1) 超时改为按已下载字节推导(如 N 分钟无字节增长才算真超时)或可配置;(2) 下载被超时杀死时 UI 明确提示『已保留已下载部分,重试将续传』;(3) timer 清理已随 #243 修复(close/error 时 clearTimeout)。涉及 modelManager.ts(热路径)+ 主进程 IPC,改前先补测试锁定现有超时行为(TDD)。

## Archived 2026-10-01

- [x] repo-ready-vocab-glob - 修复 _repo_ready vocab* 通配误判:funasr_server.py 用 vocab* 通配判就绪,modelscope 下载中分片(vocab.txt_0_167772159)也能匹配,服务器下载中途重启可能误判就绪→AutoModel 加载失败且报错难懂。方向:排除 \*\_0\_\_ 分片或要求核心文件精确存在。GitHub issue #255,遗留自 #243 code review open question (repo: murmur) (kind: ship) (priority: 0) (done 2026-09-06)
      GitHub issue #255。来源:#243 code review open question(既有宽松行为,非新引入)。funasr_server.py 的 \_repo_ready 用 vocab_ 通配判断模型就绪——modelscope 下载中的分片文件名形如 vocab.txt*0_167772159,也能匹配。若服务器恰在下载中途(重)启动,门槛可能误判就绪后 AutoModel 加载失败(报错信息更难懂)。方向:就绪判定排除 \*\_0*\* 分片模式,或要求 model.pt/config.yaml 等核心文件精确存在。低概率,单独立项避免丢失。funasr Python 子系统属高风险区,改判定逻辑需配测试。
