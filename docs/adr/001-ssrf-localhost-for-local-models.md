# ADR 001: SSRF 防护支持本地模型

**状态**: 已采纳 (2026-05-23)

## 上下文

Murmur 的 AI 文本润色功能通过 `validateAIBaseUrl` 阻止所有 localhost/内网地址，防止 SSRF 攻击。但用户希望连接本地运行的模型（Ollama `localhost:11434`、LM Studio `localhost:1234`）进行离线 AI 处理。

## 决策

将 SSRF 防护分为两种模式：
- **云端模式**（默认）：严格阻止 localhost、RFC1918、loopback 地址，仅允许 HTTPS
- **本地模式**：允许 localhost/loopback + HTTP，仍阻止 RFC1918 私有网络

当 `processTextWithAI` 或 `checkAIStatus` 检测到 base URL 为 localhost 时，自动切换为本地模式，同时：
- API key 变为可选（本地模型通常不需要认证）
- Authorization header 条件化（无 key 时不发送）

## 理由

安全防护的目标是防止渲染进程被利用来攻击内网服务。localhost 上的模型是用户自己运行的，攻击 localhost 没有安全意义。但 10.x/192.168.x/172.16-31.x 等私有网络地址可能指向内网其他服务，仍需阻止。

## 影响

- `src/helpers/ipc/aiHandlers.js` — 新增 `isLocalhost()`/`isPrivateNetwork()` 辅助函数，`validateAIBaseUrl` 新增 `allowLocalhost` 选项
- 两个函数（`processTextWithAI`、`checkAIStatus`）自动检测 localhost 并使用本地模式
- 无需用户手动选择模式 — 由 URL 自动判断
