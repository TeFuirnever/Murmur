## Archived 2026-09-05

- [ ] ci-e2e-structural-fix - CI e2e 结构性修复:e2e 前加 npx @electron/rebuild -f -w better-sqlite3;摘 boot-health 的 continue-on-error 观察两周再议全量转阻塞。当前 CI e2e 因 ABI 顺序从未绿过。证据:审计报告 §4.3-1/§5.2/§6-1 blocked-by: e2e-repair-pack (repo: murmur) (kind: ship) (since 2026-08-20)
      CI e2e 结构性修复:e2e 前加 npx @electron/rebuild -f -w better-sqlite3;摘 boot-health 的 continue-on-error 观察两周再议全量转阻塞。当前 CI e2e 因 ABI 顺序从未绿过。证据:审计报告 §4.3-1/§5.2/§6-1

  【2026-09-05 补】dev smoke 同源盲区:只轮询 renderer :5173,主进程 sqlite 崩溃不挡它。实际发生过——predev 裸 electron-rebuild 静默跳过,系统 ABI 残留导致 pnpm dev 启动即崩,smoke 却全绿;predev 已修(0f2c617,加 -f -w better-sqlite3,附回归测试 predev-force-rebuild.test.ts)。建议本任务一并把 dev smoke 健康判据升级为主进程心跳/IPC 探测,而非仅端口可达。
