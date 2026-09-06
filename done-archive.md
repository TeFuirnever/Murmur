## Archived 2026-09-07

- [x] e2e-repair-pack - 修复 e2e 19 个败例:11 条 mock 基建断裂(ipc-mock.ts 的 eval require,ADR-010 bundle 化所致)+ 4 条断言漂移(1.5 测已删路由/4.1 热键符号/8.1 参数签名/2.4 payload)+ 3 条时序 + 1 条 pasteText 契约。证据:docs/research/2026-08-20-scout-full-audit.md §5.3/§6-9 https://github.com/TeFuirnever/Murmur/pull/213 (repo: murmur) (kind: ship) (merged 2026-08-20)
