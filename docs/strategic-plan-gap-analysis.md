# Murmur GAP 分析：对标业界顶级开源项目

## Context

不是简单罗列 Murmur 缺什么功能，而是分析 OpenClaw（250K stars）、OpenCode、oh-my-opencode 等**凭什么成为顶级开源项目**，提炼出可学习的模式，再对标 Murmur 的差距。

---

## 一、顶级开源项目凭什么优秀？

### 1. OpenClaw — 为什么能到 250K stars？

**核心公式：个人 AI 助手 + 全渠道覆盖 + 技能生态 + 本地优先**

| 优秀特质 | 具体做法 | 为什么有效 |
|----------|---------|-----------|
| **生态倍增器：Skills 系统** | `~/.openclaw/workspace/skills/<skill>/SKILL.md`，用户可创建、共享技能；ClawHub 作为技能市场 | 不靠核心团队写所有功能，让社区自发扩展。5400+ skills 是指数级增长的结果 |
| **全渠道统一体验** | 22+ 消息平台（WhatsApp/Telegram/Slack/Discord/微信/QQ/飞书/Signal/iMessage 等）统一接入 | 用户不用迁移习惯，在任何已有工具中就能用。覆盖面 = 用户基数 |
| **本地优先 + 隐私** | Gateway 跑在用户自己设备上，数据不出门 | 隐私敏感用户的首选，"personal" 定位精准 |
| **多 Agent 路由** | 不同渠道/账户/对话人路由到隔离的 Agent | 一个实例服务多个场景，不是简单的 1:1 |
| **语音能力** | macOS/iOS wake word + Android continuous voice + ElevenLabs TTS | 语音交互是 AI 助手的杀手级体验 |
| **Live Canvas (A2UI)** | Agent 驱动的可视化工作区 | 超越纯文字对话，可视化操作 |
| **极致的 Onboarding** | `openclaw onboard` 一步步引导用户设置 Gateway、workspace、channels、skills | 降低首次使用门槛，5 分钟上手 |
| **安全模型成熟** | DM pairing + sandbox + allowlist + `openclaw doctor` 检测风险配置 | 连接到真实消息平台必须有安全边界，做得好才能让人信任 |
| **多平台伴侣应用** | macOS menu bar app + iOS node + Android node | 覆盖全设备，但 Gateway 是核心，app 可选 |
| **开发频道体系** | stable / beta / dev 三频道 + `openclaw update --channel` | 不同用户选择不同稳定性，降低发布压力 |
| **Sponsors 阵容** | OpenAI / GitHub / NVIDIA / Vercel / Blacksmith / Convex | 企业级赞助背书，增加可信度 |
| **660+ Contributors** | 巨大的贡献者墙，社区参与感强 | Skills 生态的自然结果，贡献门槛低 |
| **pnpm workspace monorepo** | 核心包 + extensions/* 插件，开发时直接加载本地插件 | 架构支持生态扩展 |
| **贡献者友好** | README 明确写 "AI/vibe-coded PRs welcome! 🤖" | 降低贡献心理门槛，拥抱 AI 辅助贡献 |

### 2. OpenCode — 为什么能成为顶级 AI Coding Agent？

**核心公式：终端原生 + 多模型 + 工具集成 + 可编程**

| 优秀特质 | 具体做法 | 为什么有效 |
|----------|---------|-----------|
| **Client/Server 架构** | 后端服务 + TUI 前端分离 | 可替换前端、可编程调用、非交互模式 |
| **Dual Agent 设计** | coder（代码）+ task（任务）+ title（标题）三个 Agent 各司其职 | 不同任务用不同策略和模型，不是一刀切 |
| **Auto-Compact** | 自动检测上下文接近上限时压缩对话 | 解决长对话痛点，不需要用户手动管理 |
| **75+ AI 模型支持** | OpenAI/Anthropic/Gemini/Bedrock/Groq/Azure/Copilot/本地模型 | 不绑定任何一家，用户选自己信任的 |
| **MCP (Model Context Protocol)** | 支持 stdio/SSE 两种 MCP server 接入 | 标准化工具扩展协议，任何 MCP server 都能用 |
| **LSP 集成** | 接入语言服务器获得诊断、补全、定义跳转 | AI 理解代码不再靠猜，有真实的语言智能 |
| **自定义命令系统** | Markdown 文件即命令，支持命名参数 `$NAME` | 用户可以把常用操作封装成命令，项目级/用户级 |
| **非交互模式** | `opencode -p "question"` 直接输出结果 | 可用于脚本、CI、自动化流程 |
| **权限系统** | 每次工具调用前需用户确认，支持 session 级别授权 | 安全性和效率的平衡 |
| **安装方式多样化** | curl 脚本 / Homebrew / AUR / go install | 覆盖所有主流安装偏好 |
| **配置层级** | `$HOME` → `$XDG_CONFIG_HOME` → `./.opencode.json` | 全局 + 项目级配置，灵活又安全 |
| **Modular 内部架构** | cmd / app / config / db / llm / tui / logging / session / lsp 分层清晰 | 贡献者容易定位和修改 |

### 3. oh-my-opencode — 插件框架的价值

| 优秀特质 | 具体做法 | 为什么有效 |
|----------|---------|-----------|
| **Plugin Framework** | 为 OpenCode 提供插件化扩展层 | 让 OpenCode 从工具变平台 |
| **Subagent 编排** | Sisyphus orchestrator 等专业化子 Agent | 复杂任务分解为专业化流程 |
| **Dual-publish** | 同时发布为 OpenCode 插件和独立 npm 包 | 用户可以选择集成深度 |
| **SKILL.md 规范化** | 每个技能有标准化的描述文件 | 技能可发现、可组合、可审计 |

### 4. 跨项目共性 — 顶级开源项目的共同基因

从上面三个项目提炼出**可复制的成功模式**：

| 成功基因 | 含义 |
|----------|------|
| **平台化思维** | 不是做一个功能，而是做一个让别人能做功能的平台 |
| **极致的 Onboarding** | 5 分钟内让用户体验到核心价值 |
| **多入口/多渠道** | 不限定使用方式，在哪都能用 |
| **标准化扩展协议** | Skills / MCP / Commands — 有标准的"插件接口" |
| **配置层级化** | 全局 → 项目 → 用户，尊重用户环境 |
| **贡献门槛低** | Markdown 写命令、SKILL.md 定义技能、PRs welcome |
| **安全默认值** | 默认安全，高级功能需要显式 opt-in |
| **安装方式多元** | brew / npm / curl / go install / AUR — 覆盖所有偏好 |
| **企业背书** | Sponsors / 大公司 contributor / Production-ready |
| **社区可见性** | 贡献者墙 / Discussions / Discord / Star History |

---

## 二、Murmur 对标差距分析

### Murmur 的定位优势

Murmur 是**中文语音输入工具**，核心场景不同于 OpenClaw（全渠道 AI 助手）和 OpenCode（AI coding agent）。但可以学习它们的**方法论**。

| 维度 | Murmur 现状 | 对标差距 |
|------|------------|---------|
| **平台化** | 所有功能内置，无扩展点 | OpenClaw 的 Skills/OpenCode 的 Commands 让社区参与；Murmur 无此能力 |
| **Onboarding** | 需手动安装 Node + Python + ffmpeg + 下载模型（~1GB） | OpenClaw 的 `onboard` 命令引导全流程；Murmur 的首次体验成本高 |
| **多入口** | 仅桌面 GUI | OpenClaw 覆盖 22+ 渠道；Murmur 只有一个入口 |
| **扩展协议** | AI 模型通过硬编码 API 适配 | OpenCode 支持 75+ 模型 + MCP + 本地模型；Murmur 仅 OpenAI-compatible |
| **配置层级** | 设置页存储，无文件配置 | OpenCode 支持全局/项目级 JSON 配置 |
| **贡献门槛** | 需要理解 Electron + React + FunASR + IPC 全栈 | OpenClaw 的 Skills 只需要写 Markdown |
| **安装方式** | Homebrew + Winget + DMG + EXE | 足够，但无 curl 一键安装或 Dev Container |
| **安全默认** | CSP + sandbox + safeStorage + SSRF（做得好） | 已达顶级水平 |
| **测试覆盖** | 97% 覆盖率（顶级） | 已达顶级水平 |
| **文档** | README 双语 + CONTRIBUTING + FAQ + troubleshooting | 缺少 API 文档、架构决策记录、交互式文档站 |
| **社区** | 仅 GitHub Issues | 无 Discussions / Discord / 贡献者墙 |
| **企业背书** | 无 Sponsors | 无 |
| **语音能力** | 本地 FunASR，延迟较高（非流式） | OpenClaw 有 wake word + continuous voice + TTS |

---

## 三、可学习的行动项（按影响力排序）

### 第一梯队：指数级增长潜力

| # | 学习自 | 行动项 | 预期效果 |
|---|--------|--------|---------|
| 1 | OpenClaw Skills | **建立插件/技能系统**：定义 AI processor plugin、export plugin、ASR engine plugin 接口 | 让社区可以贡献新 AI 模型适配、新导出格式、新语音引擎而不改核心代码 |
| 2 | OpenClaw onboard | **一键 Onboarding 命令**：`murmur setup` 自动检测环境、下载模型、配置 AI | 首次使用从 30 分钟降到 5 分钟 |
| 3 | OpenCode MCP | **支持 MCP 协议**：让 Murmur 的 AI 处理能力作为 MCP server 暴露 | Murmur 从工具变平台，其他 AI 工具可以调用 Murmur 的语音能力 |

### 第二梯队：用户基数扩展

| # | 学习自 | 行动项 | 预期效果 |
|---|--------|--------|---------|
| 4 | OpenClaw 多渠道 | **CLI 模式**：`murmur transcribe --file audio.wav --output text` 非交互式转录 | 覆盖自动化/批量处理场景，开发者友好 |
| 5 | OpenCode 多模型 | **扩展模型支持**：除 OpenAI-compatible 外，支持本地模型（Ollama/LM Studio） | 隐私敏感用户、离线场景、降低使用成本 |
| 6 | OpenCode Commands | **自定义 Prompt 模板系统**：Markdown 文件定义润色模板 | 用户可以创建和分享自己的 AI 润色风格 |
| 7 | OpenCode 自定义命令 | **自定义快捷工作流**：用户定义"选中文本 → AI 润色 → 自动粘贴"流程 | 高级用户可以定制自己的高效工作流 |

### 第三梯队：社区与生态

| # | 学习自 | 行动项 | 预期效果 |
|---|--------|--------|---------|
| 8 | OpenClaw 贡献者墙 | **Contributors 展示** + all-contributors bot | 贡献者获得认可，激励更多参与 |
| 9 | OpenClaw Discussions | **启用 GitHub Discussions** | 用户问答、功能讨论、使用展示 |
| 10 | OpenClaw "AI PRs welcome" | **降低贡献门槛**：插件只需写 JS + JSON manifest | 社区贡献不需要理解 Electron 全栈 |
| 11 | OpenCode Dev Container | **添加 .devcontainer** | 新贡献者 1 分钟开始开发 |
| 12 | OpenClaw Sponsors | **GitHub Sponsors + Open Collective** | 项目可持续维护 |

### 第四梯队：工程卓越

| # | 学习自 | 行动项 | 预期效果 |
|---|--------|--------|---------|
| 13 | OpenClaw 安全模型 | **Murmur 已达标** — CSP/sandbox/safeStorage/SSRF | 保持当前水平 |
| 14 | OpenCode 测试 | **Murmur 已超标** — 97% 覆盖率 | 修复 E2E continue-on-error 即可 |
| 15 | OpenClaw ADR | **建立 docs/adr/** — 记录关键架构决策 | 新贡献者理解设计意图 |
| 16 | OpenCode 配置层级 | **支持文件配置** — `~/.murmur.json` + `./.murmur.json` | 高级用户和自动化场景 |
| 17 | OpenClaw 开发频道 | **stable/beta/dev 发布频道** | 降低发布压力，用户自选稳定性 |

---

## 四、Murmur 的独特优势（不需要学别人的）

Murmur 有一些其他项目不具备的特质，应该坚持并发扬：

| 独特优势 | 为什么是护城河 |
|----------|---------------|
| **中文优化 FunASR** | OpenClaw/OpenCode 用通用模型，中文场景不如 Murmur 专精 |
| **完全本地语音识别** | 不依赖任何云服务，隐私保障更强 |
| **97% 测试覆盖率** | 工程质量超过大多数开源项目 |
| **桌面原生体验** | GUI 应用比 CLI 工具更容易被非技术用户接受 |
| **双语文档** | 中英双语覆盖比大多数中文项目好 |

---

## 五、关键文件

本计划为分析报告，无代码变更。如按计划执行，涉及：

- 插件系统设计：`src/helpers/` 新增 plugin loader
- CLI 模式：新增 `cli.js` 入口
- Onboarding：改造 `main.js` 启动流程
- MCP server：新增 `mcp-server.js`
- Prompt 模板：扩展 `src/helpers/aiPrompts.js` 为模板系统
- Dev Container：新增 `.devcontainer/devcontainer.json`
- ADR：新增 `docs/adr/` 目录
- 社区：GitHub 启用 Discussions + Sponsors

---

## 六、多轮 Review 综合报告

> 三位专项评审员（战略 / 技术 / 社区生态）独立评审后的综合结论。

### 评分汇总

| 评审维度 | 评分 | 核心判断 |
|----------|------|---------|
| 战略 | 6/10 | 方法论正确但深度不足——缺竞争分析、资源约束、用户画像 |
| 技术 | 7/10 | 方向对但低估 Electron 架构约束，未发现 SSRF 阻塞本地模型 |
| 社区/生态 | 5/10 | 社区策略照搬欧美模式，缺少中国市场定位和生态集成 |

### 三方共识（5 条高置信发现）

| # | 共识 | 影响 |
|---|------|------|
| 1 | **插件系统不应是第一优先级**——1 人团队做插件生态是过度工程化，且与 Electron sandbox 有结构性冲突 | #1 应从第一梯队下移 |
| 2 | **本地模型支持（#5）是最高 ROI 行动项**——改动量 ~50 行，但被 `validateAIBaseUrl` 的 SSRF 防护阻塞，需先重构 | 应上移为第一个执行项 |
| 3 | **竞争格局分析完全缺失**——计划未回答核心问题："用户为什么不用系统自带语音输入？" | 必须补充定位文档 |
| 4 | **社区策略需要完全重做**——Discord 在中国不可用，GitHub Discussions 对非技术用户门槛高，缺中国本土平台 | 社区行动全部需重新校准 |
| 5 | **17 项行动对 1 人团队不现实**——应缩减到 5-8 项核心行动，6 个月集中突破 | 需重排优先级 |

### 战略盲区（三位评审共同识别）

| 盲区 | 说明 | 建议行动 |
|------|------|---------|
| **竞争格局** | macOS 原生语音输入、讯飞、Whisper 生态正在侵蚀 Murmur 的差异化空间 | 写一份竞品差异化定位文档 |
| **用户画像未定义** | 5 类潜在用户（文字工作者/残障人士/隐私敏感/开发者/普通办公）需求完全不同 | 先定义核心用户画像再排优先级 |
| **时机窗口** | Apple Intelligence / Google Gemini Live 正在将语音输入深度集成到 OS | 3-6 个月内必须完成核心差异化特性 |
| **可持续性** | 1 人维护 + 无 Sponsor + 17 项行动 = 不可持续 | 考虑爱发电 + 微信赞赏（非 GitHub Sponsors） |
| **oh-my-opencode 分析过薄** | 仅 4 行，错失"生态层策略"讨论——Murmur 应该成为更大生态的语音组件 | 补充定位：独立工具 vs 生态组件 |

### 优先级重排（综合三方建议）

基于技术依赖链 + 1 人团队资源约束 + 用户价值，重新排列执行顺序：

**Phase A — 立即可做（0-1 月，无/低代码变更）：**

| # | 行动 | 来源 | 工作量 |
|---|------|------|--------|
| A1 | **启用 GitHub Discussions + all-contributors bot** | 原 #8/#9，社区评审建议立即执行 | 纯配置 |
| A2 | **建立中国社区触点**：即刻/V2EX 介绍帖、微信公众号、微信群 | 社区评审新增 | 内容运营 |
| A3 | **竞品差异化定位文档**：回答"为什么不用系统自带" | 战略评审新增 | 文档 |
| A4 | **B 站/少数派演示内容**：语音工具需要"看到效果" | 战略评审新增 | 内容 |
| A5 | **爱发电页面** | 社区评审新增，替代 GitHub Sponsors | 纯配置 |
| A6 | **建立 docs/adr/** | 原 #15，战略评审建议上移 | 文档 |

**Phase B — 短期高价值（1-3 月）：**

| # | 行动 | 来源 | 技术评审关键发现 |
|---|------|------|-----------------|
| B1 | **本地模型支持（Ollama/LM Studio）** | 原 #5 上移 | **阻塞点**：`validateAIBaseUrl` 拒绝 localhost，需重构 SSRF 逻辑；API key 改可选 |
| B2 | **自定义 Prompt 模板系统** | 原 #6 | `aiPrompts.js` 结构极规整，扩展为文件系统模板可行 |
| B3 | **Onboarding 优化（快速体验模式）** | 原 #2 调整 | 5 分钟不现实；改为先下载 VAD 模型(~100MB) + 在线 API 的"快速体验" |
| B4 | **文件配置 `~/.murmur.json`** | 原 #16 上移 | CLI/MCP 的前置依赖，加密字段仍用 SQLite |

**Phase C — 中期平台化（3-6 月）：**

| # | 行动 | 来源 | 技术评审关键发现 |
|---|------|------|-----------------|
| C1 | **CLI 模式** | 原 #4 | 需先提取核心逻辑为独立 npm 包；Electron ~200MB 打包是重量级方案 |
| C2 | **MCP Server** | 原 #3 下移 | 依赖 CLI 基础设施；需要 headless 模式重构 `main.js` 启动流程 |
| C3 | **数据驱动插件系统（最小方案）** | 原 #1 拆分 | 只做 Prompt 模板 + 导出格式插件（不执行任意代码），避免安全沙箱问题 |

**Phase D — 长期（6 月+，视社区情况决定）：**

| # | 行动 | 条件 |
|---|------|------|
| D1 | 完整插件系统（含安全沙箱） | 需 2-3 个外部贡献者后再启动 |
| D2 | 输入法生态集成（macOS Input Source / Windows TSF） | 社区评审识别的最大遗漏 |
| D3 | stable/beta/dev 发布频道 | 用户基数达到一定规模后 |
| D4 | 编辑器插件（Obsidian / VS Code） | 依赖 CLI 或 HTTP API 就绪 |

### 删除/合并的行动项

| 原编号 | 行动 | 处理 | 理由 |
|--------|------|------|------|
| #7 | 自定义快捷工作流 | **移除** | 与 #6 重叠，1 人团队不聚焦 |
| #10 | 降低贡献门槛（JS+JSON manifest） | **合并到 C3** | 插件系统的自然结果 |
| #11 | Dev Container | **降为可选** | 镜像 >5GB，ROI 不高 |
| #12 | GitHub Sponsors | **替换为爱发电** | 不适合中国市场 |
| #13 | 安全模型 | **保持现状** | 已达标 |
| #14 | 测试覆盖 | **保持现状，修复 E2E** | 已达标 |

### 技术风险（技术评审识别）

| 风险 | 严重度 | 缓解策略 |
|------|--------|---------|
| SSRF 防护阻塞本地模型 | High | 重构 `validateAIBaseUrl`，区分本地/云端场景 |
| 插件系统安全逃逸 | Critical | 只做数据驱动插件，不执行任意代码 |
| FunASR 单线程推理瓶颈 | High | CLI/MCP 场景需线程池化 |
| Headless 模式资源泄漏 | Medium | 独立进程管理器 + PID 文件 |
| IPC 通道膨胀（50+ → 100+） | Medium | 命名空间化注册 `plugin:{name}:{action}` |

### 中国市场策略（社区评审新增）

| 维度 | 建议 | 优先级 |
|------|------|--------|
| 社区平台 | 微信公众号 + 即刻 + V2EX + 飞书群/微信群 | P0-P1 |
| 内容 | 使用场景案例 + 竞品对比评测 + B 站视频 | P1-P2 |
| 赞助 | 爱发电 + 微信赞赏码 | P1 |
| 分发 | 国内模型镜像加速 + 少数派推荐 | P2 |
| 本地化深化 | 方言适配 + 中文口头禅定制 + 中文标点推断 | P2-P3 |
| 生态定位 | 朝系统级语音输入法演进（macOS Input Source / Windows TSF） | 长期 |

### 原独特优势修正

| 优势 | 评审修正 |
|------|---------|
| 中文优化 FunASR | FunASR 是阿里开源的，任何人可用；需加上"开箱即用的中文体验"才是真正差异化 |
| 完全本地语音识别 | 仅对隐私敏感用户有强价值，需量化这个群体 |
| 97% 测试覆盖率 | 不是用户可感知的护城河，但可转化为贡献者信任 |
| 桌面原生体验 | 双刃剑——非技术用户友好，但也限制了入口多样性 |
| 双语文档 | 在中文开源项目中是加分项，但非决定性 |

---

## 七、扩展对标：Murmur 领域内顶级项目分析

> 第二轮评审引入 12 个与 Murmur 技术定位更接近的项目，弥补初始对标（OpenClaw/OpenCode/oh-my-opencode 偏开发者工具）的偏差。

### 对标矩阵总览

| 项目 | Stars | 与 Murmur 的关系 | 核心成功模式 |
|------|-------|-----------------|-------------|
| **whisper.cpp** | 38K+ | 直接竞品（语音识别） | 零依赖 C/C++ + 全平台硬件加速 + 模型梯度（tiny→large） |
| **faster-whisper** | 14K+ | 技术参考（ASR 性能） | int8 量化 + batched 推理 = 4x 性能提升 |
| **RIME** | 5K+ | 生态对标（中文输入法） | YAML 配置驱动 + Scheme 社区共享 + 10 年 1 人维护 |
| **Bob** | 12K+ | UX 对标（macOS 中文工具） | 全局快捷键 + 插件系统 + AI 服务商赞助模式 |
| **Obsidian** | 非开源 | 商业模式参考 | 本地优先 + 2000+ 社区插件 + Bootstrapped $25M ARR |
| **Linear** | 非开源 | 产品哲学参考 | "速度即产品" + 键盘优先 + PLG 增长 |
| **ChatGPT-Next-Web** | 83K+ | 中国开源标杆 | 一键部署 + 隐私本地存储 + 极简 5MB 客户端 |
| **LobeChat** | 60K+ | 生态平台参考 | MCP 市场 + Agent 市场 + auto-i18n |
| **Dify** | 95K+ | 工作流参考 | 可视化 Workflow + 50+ 内置工具 + Docker 一键部署 |
| **Warp** | 22K+ | 桌面应用参考 | Rust + GPU 渲染 + AI 原生 + ARR $16M |
| **Zed** | 83K+ | 工程卓越参考 | Rust + CRDT 协作 + WASM 扩展 + 从开源贡献者中招聘 |
| **Hyper** | 22K+ | Electron 参考 | npm 包插件 + 主题系统（教训：Electron 性能上限） |

### 关键学习点（按 Murmur 相关度排序）

#### A. 语音/ASR 领域

| 学习点 | 来源 | 对 Murmur 的启示 |
|--------|------|-----------------|
| **模型梯度** | whisper.cpp（tiny 273MB → large 3.9GB） | Murmur 应提供"快速模型"（~100MB VAD-only）和"精确模型"（完整 Paraformer）两档选择 |
| **硬件加速** | whisper.cpp（Metal/CoreML/CUDA） | Murmur 的 `device="cpu"` 硬编码是性能天花板，应支持 GPU 推理 |
| **int8 量化** | faster-whisper | 模型量化可在低端设备上大幅降低内存和提升速度 |
| **实时流式** | whisper.cpp + faster-whisper | 两者都有流式识别示例，Murmur 的非流式架构是 UX 硬伤 |

#### B. 中文桌面工具

| 学习点 | 来源 | 对 Murmur 的启示 |
|--------|------|-----------------|
| **配置驱动** | RIME（YAML 配置文件） | Murmur 应支持文件配置（`~/.murmur.json`），而非仅 GUI 设置 |
| **社区共享方案** | RIME（oh-my-rime） | Murmur 可建立"转录配置预设"社区（会议模式/采访模式/字幕模式） |
| **1 人 10 年** | RIME（佛振） | 证明一个人可以长期维护一个生态系统，专注做一件事 |
| **全局快捷键 + 即时反馈** | Bob（⌥+D 划词翻译） | Murmur 已有 Cmd+Shift+Space，但反馈速度（非流式）不如 Bob |
| **AI 服务商赞助** | Bob（硅基流动、智谱免费推理） | Murmur 可与 ASR/LLM 服务商合作提供免费额度 |
| **App Store 付费** | Bob（从开源转闭源+付费） | 说明 macOS 原生精品可以实现商业化 |

#### C. 产品哲学

| 学习点 | 来源 | 对 Murmur 的启示 |
|--------|------|-----------------|
| **速度即产品** | Linear（ARR $100M+） | Murmur "从说话到文字出现"的延迟必须极致低 |
| **本地优先 + 隐私** | Obsidian（$25M ARR, 零融资） | Murmur 的本地 ASR 是真正的护城河，应大力宣传 |
| **插件生态 = 壁垒** | Obsidian（2000+ 插件） | 插件系统是长期方向，但不应是 v1.x 的核心 |
| **核心免费 + 服务付费** | Obsidian/Old/Linear | Murmur 可规划：基础转录免费 → 云同步/团队版付费 |
| **一键部署** | ChatGPT-Next-Web（83K stars） | Murmur 安装体验必须优化到零配置可用 |
| **极简客户端** | NextChat（~5MB） | Electron ~200MB 是痛点，应优化打包体积 |
| **Agent 市场** | LobeChat（505 个 Agent） | Murmur 可建立"转录后处理模板市场"（会议纪要/字幕/访谈） |
| **WASM 扩展** | Zed | Murmur 插件系统可考虑 WASM 沙箱（比 Node vm2 更安全） |

### 对初始对标的修正

| 初始判断 | 扩展对标后的修正 |
|----------|----------------|
| 插件系统是第一优先级 | **不是**——Bob 先做好核心体验再建插件；RIME 先做好引擎再开放方案 |
| 学习 OpenClaw 全渠道覆盖 | **不适用**——Murmur 是工具不是平台，应学 Bob 做精 macOS 单点 |
| 学习 OpenCode 的终端原生 | **方向相反**——Murmur 用户不是开发者，应学 Bob 的 GUI 优先 |
| MCP 协议是战略级 | **降低优先级**——LobeChat 做了 MCP 市场但投入了整个团队；Murmur 应先做本地 HTTP API |
| 社区 = GitHub | **错误**——ChatGPT-Next-Web/LobeChat/Dify 的中国社区在微博/即刻/V2EX |

---

## 八、Murmur 深度技术审计

> 对全部核心代码的逐文件审计，验证计划中的技术判断。

### 技术画像总评

| 维度 | 评分 | 核心判断 |
|------|------|---------|
| 架构成熟度 | **7/10** | 分层设计意图良好，Manager/IPC/Renderer 职责清晰，但 FunASR 硬耦合 |
| 代码质量 | **6.5/10** | 一致性中等偏上，错误处理中等，安全实践中等偏上 |
| 安全态势 | **8/10** | CSP/sandbox/safeStorage/SSRF/SHA256 全覆盖，缺 IPC rate limiting |
| 可扩展性 | **5/10** | AI 层灵活，但 ASR 引擎和流式识别是硬锁死 |

### 计划未识别的隐藏优势

| 优势 | 文件 | 为什么重要 |
|------|------|-----------|
| **ServerMessageRouter 是生产级 RPC 层** | `serverMessageRouter.js` | request_id 关联 + 超时 + 进度回调 + 过期清理，不是临时方案 |
| **FunASR 三层解耦** | PythonEnvironment → ModelManager → FunASRServer → FunASRManager | 每层职责单一，是正经的分层架构 |
| **多 AI Provider 零代码接入** | `aiHandlers.js` | SSRF 防护不依赖白名单，任何 OpenAI-compatible endpoint 直接可用 |
| **数据库加密迁移机制** | `database.js` | API key 明文→safeStorage 平滑迁移，有版本号追踪 |
| **模型并行加载** | `funasr_server.py` | 三个线程并行加载 ASR/VAD/Punc 模型，启动时间减半 |
| **音频处理管道** | `funasrServer.js` | 格式验证 → 大小限制 → ffmpeg 转换 → 转录 → 清理，完整管道 |

### 计划未识别的隐藏风险

| 风险 | 严重度 | 详情 |
|------|--------|------|
| **ASR 引擎 6 层硬耦合** | Critical | 无 `ASREngine` 抽象接口，替换需重写 ~2000 行代码（Python 服务 825 行 + Node 管理层 460 行 + 模型管理 287 行） |
| **前端零测试** | High | 67 个前端源文件无任何测试覆盖，UI 变更回归风险极高 |
| **CPU-only 硬编码** | High | `device="cpu"` 三处硬编码，无 GPU 加速选项，性能天花板 |
| **无流式识别** | Critical | 录音→音频 blob→临时文件→Python 批量推理，改为流式需全栈重构 |
| **零并发能力** | High | Python 单线程推理，大文件转录期间所有请求排队（含 status 查询） |
| **downloadModels 用硬编码 `python3`** | P0 Bug | `modelManager.js:208` 不用 `findPythonExecutable()`，嵌入式 Python 环境下必崩 |
| **Python 版本检测过宽** | P0 Bug | 只检查 `major === 3`，Python 3.6 通过但 FunASR 需要 3.8+ |

### 技术债务 Top 5（按严重度）

| # | 债务 | 严重度 | 影响 |
|---|------|--------|------|
| 1 | ASR 引擎无抽象接口（策略模式缺失） | Critical | 阻塞多引擎支持和 whisper.cpp 接入 |
| 2 | 非流式架构（录音→保存→批量推理） | Critical | UX 天花板，竞品（whisper.cpp）都有流式 |
| 3 | downloadModels 硬编码 `python3` | P0 | 嵌入式 Python 环境下模型下载失败 |
| 4 | 前端 App.jsx 900+ 行巨型组件 | P1 | 维护困难，5 个内联子组件应拆分 |
| 5 | IPC handler 横向依赖 | P1 | transcriptionHandlers 直接 require aiHandlers，违反分层原则 |

### FunASR 集成深度评估

集成涉及 6 层共 ~2000 行代码：

```
funasr_server.py (825行) → funasrServer.js (310行) → serverMessageRouter.js (172行)
→ pythonEnvironment.js (303行) → modelManager.js (287行) → transcriptionHandlers.js
```

- 替换 ASR 引擎（如接入 whisper.cpp）估算：2-3 个工作日
- 但缺少 `ASREngine` 抽象接口，需要先重构为策略模式
- `serverMessageRouter.js` 的 stdin/stdout JSON 协议可复用

### AI 处理灵活性评估

**AI 层是 Murmur 中设计最灵活的部分**：
- 使用标准 OpenAI Chat Completions API，任何兼容服务零代码接入
- `aiPrompts.js` 支持 6 种模式，扩展只需添加新 key
- **限制**：不支持流式响应（`stream: false` 硬编码）、不支持 function calling、`max_tokens: 2000` 和 `temperature: 0.3` 硬编码

### 性能瓶颈

| 瓶颈 | 影响 | 优化空间 |
|------|------|---------|
| Python 模型加载 1-2 分钟 | 首次使用等待 | 已异步不阻塞 UI，可接受 |
| 单线程推理串行 | 大文件转录期间 status 查询被阻塞 | 需 Python 多进程或线程池 |
| 非流式 AI 响应 | 长文本优化时用户等待 | 改为 SSE 流式响应 |
| `LIKE` 全文搜索 | 数据量大时全表扫描 | 考虑 SQLite FTS5 |
| 前端无虚拟滚动 | 历史记录多时 DOM 性能下降 | 引入虚拟列表 |

---

## 九、综合评审结论：最终行动建议

> 整合三轮评审（战略 + 技术 + 社区）、扩展对标（12 项目）、技术审计（全部核心代码）的最终结论。

### 核心战略问题（计划仍未回答）

| 问题 | 为什么必须回答 | 建议答案 |
|------|---------------|---------|
| 用户为什么不用系统自带语音输入？ | macOS/Windows 原生语音输入越来越强 | 中文精度更高 + 本地隐私 + AI 后处理 |
| Murmur 的核心用户是谁？ | 决定所有优先级 | **文字工作者**（记者/作家/研究者）——他们每天需要大量语音转文字 |
| 1 人团队 6 个月内能交付什么？ | 17 项变 8 项仍太多 | **4 项核心技术 + 4 项社区/运营** = 8 项 |

### 最终优先级（综合所有评审）

**Tier 0 — 技术止血（1-2 周）：**

| # | 行动 | 理由 |
|---|------|------|
| T0-1 | 修复 `downloadModels` 硬编码 `python3` bug | P0 级 bug，嵌入式 Python 下必崩 |
| T0-2 | 修复 Python 版本检测（需 3.8+） | P0 级 bug，3.6 通过但 FunASR 崩溃 |
| T0-3 | 重构 SSRF 防护支持本地模型 | 解锁 Ollama/LM Studio，最高 ROI |

**Tier 1 — 核心差异化（1-3 月）：**

| # | 行动 | 技术要点 | 对标灵感 |
|---|------|---------|---------|
| T1-1 | **扩展 AI 模型支持：本地 + 免费云端** | 详见下方 T1-1 子项 | OpenCode 75+ 模型 + 免费 tier |
#### T1-1 详细：扩展 AI 模型支持（本地 + 免费云端）

参考 OpenCode 支持 75+ 模型的策略，Murmur 的 AI 文本润色功能应从"用户必须自己找 API Key"进化为"开箱即用 + 按需扩展"。

**A. 本地模型支持（零成本、零隐私顾虑）：**

| 引擎 | 技术要点 | 用户价值 |
|------|---------|---------|
| **Ollama** | 放宽 localhost SSRF + API key 可选 + 自动检测 `localhost:11434` | 本地运行 qwen2.5/gemma 等模型，完全离线 |
| **LM Studio** | 同上，检测 `localhost:1234` | GUI 管理本地模型，非技术用户友好 |

**B. 免费云端模型预集成（参考 OpenCode 内置 provider 模式）：**

| Provider | 免费额度 | 接入方式 | 优先级 |
|----------|---------|---------|--------|
| **硅基流动 (SiliconFlow)** | 注册送 2000 万 token，部分模型免费 | OpenAI-compatible API (`api.siliconflow.cn`) | P0 — 中国用户首选 |
| **Google Gemini** | Flash 模型免费（15 RPM） | `generativelanguage.googleapis.com`，需适配非 OpenAI 格式 | P1 |
| **Cloudflare Workers AI** | 每日 10,000 neuron 免费 | OpenAI-compatible via gateway | P1 |
| **GitHub Models** | 免费额度（个人开发者） | OpenAI-compatible (`models.inference.ai.azure.com`) | P2 |
| **Groq** | 免费额度（超快推理） | OpenAI-compatible (`api.groq.com`) | P2 |
| **DeepSeek** | 极低成本（≈免费） | 已在 settings.jsx 有 preset | P0 — 已有基础 |
| **通义千问 (Qwen)** | DashScope 免费额度 | 已在 settings.jsx 有 preset | P0 — 已有基础 |
| **智谱 GLM** | 注册送 token | 已在 settings.jsx 有 preset | P0 — 已有基础 |

**C. 实现策略：**

1. **新增"免费体验"provider preset**：在 `settings.jsx` 中预配置硅基流动/DeepSeek/Groq 等免费端点，用户只需填入免费 API key 或无需 key 即可使用
2. **自动检测本地模型**：启动时检测 Ollama/LM Studio 是否在运行，自动在设置页提示"检测到本地模型，点击启用"
3. **SSRF 重构**：`validateAIBaseUrl` 区分"云端 API"（严格 SSRF）和"本地模型"（允许 localhost）两种模式
4. **API key 可选化**：`processTextWithAI` 中 `if (!apiKey)` 改为条件检查——本地模型和部分免费 provider 不需要 key
5. **Provider 分层 UI**：设置页 AI 模型区域分为"免费体验"（一键启用）、"本地模型"（自动检测）、"自定义 API"（高级用户）三个 tab

**D. 预期效果：**

- 用户安装 Murmur 后可立即使用 AI 文本润色，无需付费注册任何服务
- 隐私敏感用户可使用 Ollama 完全离线运行
- 降低 AI 功能的首次使用门槛，预计 AI 功能激活率从 <10% 提升到 >60%

| T1-2 | **自定义 Prompt 模板系统** | `aiPrompts.js` 扩展为 `~/.murmur/templates/` Markdown 文件 | RIME Scheme 社区 + OpenCode Commands |
| T1-3 | **"快速体验"模式** | VAD 模型(~100MB)先启动 + 在线 API 转录 → 完整模型后台下载 | ChatGPT-Next-Web 一键部署 |
| T1-4 | **ASR 引擎抽象接口** | 引入 `ASREngine` 策略模式，为接入 whisper.cpp 做准备 | whisper.cpp 多硬件加速 |

#### 架构决策：TypeScript 迁移

> **决策状态：推荐在 Tier 0/1 期间同步启动，与功能开发和 v1.0 正式发布准备并行。**
> v1.0 尚未正式发布（`package.json` version=1.0.0 但无 git tag 和 GitHub Release），TS 迁移此前被推迟。现在的选择是：先完成 v1.0 发布再迁移，还是先迁移再发布。建议两者并行——TS 基础设施（Phase 0-1）可在发布前完成，不影响发布时间线。

**为什么现在做：**

| 理由 | 说明 |
|------|------|
| 贡献者友好 | ChatGPT-Next-Web/LobeChat/Dify 全部使用 TS——TS 是中文 AI 开源项目的事实标准，贡献者期望 TS |
| IPC 类型安全 | 168 个 `window.electronAPI.*` 调用大部分返回 `Promise<unknown>`，三层 IPC（preload → handler → hooks）零类型对齐 |
| 已有基础极佳 | `tsconfig.json`（allowJs + strict: false）已存在、`electronAPI.d.ts` 已存在、`src/lib/utils.ts` 已经是 TS、Vitest 已支持 `.ts` |
| 防止新债积累 | 每次 feature 开发在 JS 上继续积累无类型代码，迁移成本随时间增长 |

**代码规模评估（15,272 行 / ~96 文件）：**

| 区域 | 文件数 | 行数 | 迁移难度 | 优先级 |
|------|--------|------|---------|--------|
| `src/helpers/`（后端核心） | 28 | 5,789 | 中-高 | Phase 2 |
| `src/` 页面（App/settings/history） | 3 | 2,226 | 中 | Phase 3 |
| `src/components/` | 17 | 1,554 | 低-中 | Phase 3 |
| `src/hooks/` | 6 | 1,187 | 中 | Phase 3 |
| `main.js` + `preload.js` | 2 | 501 | 高（Electron IPC） | Phase 2 |
| `tests/` | 38 | 3,926 | 低 | Phase 4 |
| `src/utils/` + `src/lib/` | 2 | 89 | **已完成** | ✓ |

**TS 能捕获的具体 bug（代码审计发现）：**

| Bug | 文件 | TS 如何防 |
|-----|------|---------|
| IPC handler 参数全是 `any` | 全部 9 个 handler 文件 | `strict` 模式强制类型声明 |
| `clipboard.readText()` 返回 `null` 导致 `.substring()` 崩溃 | `clipboard.js:91` | `strictNullChecks` |
| `database.getSetting` 返回类型不可预测 | `database.js:276` | 泛型 `getSetting<T>(key): T` |
| preload → handler 类型不对齐 | `preload.js` → `transcriptionHandlers.js` | 共享类型定义 |
| `useRecording` 中 `event` 不是 `MediaRecorderErrorEvent` | `useRecording.js:124` | 正确的事件类型 |

**4 阶段迁移策略（与功能开发并行）：**

**Phase 0 — 基础设施（1-2 天，零代码变更）：**
- 安装 TS 开发依赖（`typescript` 已有，加 `@types/node`, `@types/react` 等）
- 添加 `typecheck` script 到 `package.json` + CI
- 确认 `allowJs: true` + `strict: false` 不影响现有代码
- 添加 `// @ts-nocheck` 到暂不迁移的文件（确保 CI 通过）

**Phase 1 — IPC 类型定义（3-5 天，最高 ROI）：**
- 创建 `src/types/ipc.ts`：定义所有 IPC channel 的 request/response 类型
- 完善 `src/electronAPI.d.ts`：168 个 API 调用从 `Promise<unknown>` 变为精确类型
- 创建 `src/types/managers.ts`：Manager 接口定义
- **效果**：前端所有 `window.electronAPI` 调用立即获得类型安全和 IDE 补全

**Phase 2 — 后端迁移（2-3 周，与 Tier 1 功能并行）：**
- 按难度递增逐文件迁移：
  - 先迁移纯函数：`aiPrompts.js` → `aiPrompts.ts`、`exportFormatters.js` → `exportFormatters.ts`、`logManager.js` → `logManager.ts`
  - 再迁移管理器：`database.js`、`clipboard.js`、`environment.js`
  - 最后迁移复杂模块：`funasrServer.js`、`serverMessageRouter.js`、`funasrManager.js`
- 每个 PR 一个文件，不阻塞功能开发
- `main.js` → `main.ts` 和 `preload.js` → `preload.ts` 在此阶段末尾处理

**Phase 3 — 前端迁移（2-3 周）：**
- `.jsx` → `.tsx` 逐文件迁移
- 先 hooks（`useRecording.tsx` 等），再 components，最后 page 组件
- `App.jsx`（900+ 行）迁移时顺便拆分子组件

**Phase 4 — 收紧 strict 模式（1 周）：**
- `strictNullChecks: true` → `noImplicitAny: true` → `strict: true`
- 逐步移除 `@ts-nocheck`
- 测试文件迁移到 `.ts`

**总估算**：8-9 周兼职，或与功能开发并行 12 周。`allowJs: true` 确保零中断。

**与 Tier 1 功能的配合：**

| 功能开发 | TS 迁移配合 |
|----------|------------|
| T1-1 扩展 AI 模型支持 | 先迁移 `aiHandlers.js` → `aiHandlers.ts`，新 provider 用 TS 编写 |
| T1-2 Prompt 模板系统 | 先定义 `PromptTemplate` 类型，新功能直接用 TS |
| T1-3 快速体验模式 | 迁移 `modelManager.js` 时顺便重构 |
| T1-4 ASR 引擎抽象 | 先定义 `ASREngine` interface，再实现——TS 接口驱动设计 |

**风险与缓解：**

| 风险 | 缓解策略 |
|------|---------|
| 迁移拖慢功能开发 | 每个 PR 只改一个文件，不超过 30 分钟/文件 |
| 类型定义不准确 | 先用宽松类型，Phase 4 再收紧 |
| CI 构建变慢 | `typecheck` 与 `test` 并行运行 |
| Electron + TS 配置问题 | 参考 VS Code 和 Hyper 的 tsconfig |

**不做 TS 迁移的代价：**

- 每个新 feature 都在无类型基础上继续积累代码
- 贡献者门槛高于 LobeChat/ChatGPT-Next-Web（均用 TS）
- IPC 层的类型 bug 只能在运行时发现
- 随代码量增长，迁移成本线性上升

**Tier 2 — 增长基础（与 Tier 1 并行，运营为主）：**

| # | 行动 | 理由 | 对标灵感 |
|---|------|------|---------|
| T2-1 | **中国社区建设**（即刻/V2EX/微信公众号/微信群） | 社区评审：Discord 在中国不可用 | ChatGPT-Next-Web/LobeChat 的中国社区模式 |
| T2-2 | **竞品定位文档** + B 站/少数派演示 | 战略评审：缺竞争分析，语音工具需"看到效果" | Bob 的口碑传播 |
| T2-2.5 | **README 重写：对标顶级开源项目** | 当前 README 功能导向、信息密集但缺乏视觉冲击力，详见下方 | OpenClaw/LobeChat/ChatGPT-Next-Web/Dify |
| T2-3 | **爱发电 + 微信赞赏码** | 社区评审：GitHub Sponsors 在中国几乎无用 | Bob 的 AI 服务商赞助模式 |
| T2-4 | **docs/adr/ + CONTRIBUTING 改进** | 技术审计：贡献者需理解 6 层 FunASR 架构 | RIME 的长尾贡献者生态 |

**Tier 3 — 平台化（3-6 月，视 Tier 1 反馈决定）：**

#### T2-2.5 详细：README 重写——对标顶级开源项目

当前 README 的问题是"信息正确但不够亮"。顶级开源项目的 README 有明确的视觉节奏和转化漏斗设计。

**顶级项目 README 对标分析：**

| 项目 | Stars | README 亮点 | Murmur 可学 |
|------|-------|------------|------------|
| **OpenClaw** | 250K | Hero GIF 演示 + 22 渠道 logo 墙 + 一行安装命令 + 贡献者墙 + Sponsor logo | 产品演示 GIF、渠道/场景展示 |
| **ChatGPT-Next-Web** | 83K | 一键部署按钮（Deploy to Vercel）+ 功能截图网格 + 极简安装 + 多语言切换 | 一键安装命令、功能截图矩阵 |
| **LobeChat** | 60K | 产品截图（明暗主题）+ Agent 市场预览 + 特性图标网格 + 多部署方式 | 产品截图、特性图标化展示 |
| **Dify** | 95K | 产品 GIF + 特性 GIF 矩阵（每个特性配动画演示）+ 架构图 | 动态演示、架构可视化 |
| **whisper.cpp** | 38K | 性能 Benchmark 表格 + 多语言绑定矩阵 + 模型大小梯度表 | 性能数据可视化、模型对比表 |
| **Zed** | 83K | 极致简洁——一句定位 + 产品截图 + 三步上手 | 简洁即力量 |
| **Bob** | 12K | Apple 风格产品图 + 场景化功能展示 | macOS 原生美学 |

**README 结构模板（建议重写为以下结构）：**

```markdown
<!-- Hero: 一眼抓住注意力 -->
<div align="center">
  <img src="assets/icon.png" width="120" />
  <h1>Murmur</h1>
  <p><strong>开源 · 本地 · AI 语音输入</strong></p>
  <p>说话就能打字，音频秒转文字。基于 FunASR，数据不出你的电脑。</p>
  
  <!-- 核心操作按钮 -->
  [下载安装] [观看演示 ▶] [阅读文档]
  
  <!-- 产品截图/动图 —— 最重要的转化元素 -->
  <img src="assets/screenshot.gif" width="800" />
  <!-- 或: 一段 10 秒的录屏 GIF，展示：说话 → 文字出现 → AI 润色 → 自动粘贴 -->
</div>

<!-- 一句话价值主张 -->
> 为中文而生的 AI 语音输入工具。完全本地运行，无需联网，无需 API Key。

<!-- 核心特性：图标 + 短文字 -->
## ✨ 特性
| 🎤 高精度中文识别 | 🤖 AI 智能润色 | ⌨️ 全局热键 | 🔒 完全本地 |
| FunASR Paraformer | 去除口头禅、修正错话 | Cmd+Shift+Space | 零数据上传 |

<!-- 与竞品的对比表（这是最有说服力的部分） -->
## 🆚 为什么选择 Murmur？
| | Murmur | macOS 原生听写 | 讯飞语记 | Whisper Desktop |
|---|---|---|---|---|
| 中文精度 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |
| 本地运行 | ✅ | ✅ | ❌ | ✅ |
| AI 后处理 | ✅ | ❌ | ❌ | ❌ |
| 开源免费 | ✅ | ✅ | ❌ | ✅ |

<!-- 一行安装 -->
## 🚀 安装
brew install --cask murmur    # macOS
winget install TeFuirnever.Murmur  # Windows

<!-- 快速开始 -->
## ⚡ 30 秒上手
1. 启动 Murmur
2. 按 Cmd+Shift+Space
3. 开始说话 → 文字自动出现在光标处

<!-- 技术栈 -->
## 🛠 技术栈
Electron 36 · React 19 · FunASR · SQLite

<!-- 社区 & 贡献 -->
## 🤝 参与贡献
PRs welcome! 见 CONTRIBUTING.md

<!-- License -->
Apache License 2.0
```

**关键改进点：**

| 改进 | 当前状态 | 目标状态 | 灵感来源 |
|------|---------|---------|---------|
| **产品演示 GIF** | 无 | 10 秒录屏：说话→文字→AI润色→粘贴 | Dify 的产品 GIF |
| **竞品对比表** | 无 | 4 维度对比 4 个竞品 | whisper.cpp 的 Benchmark 表 |
| **一键安装** | 有（Homebrew/Winget） | 更突出、加 badge | ChatGPT-Next-Web 的 Deploy 按钮 |
| **特性展示** | 文字列表 | 图标 + 短文字网格 | LobeChat 的特性网格 |
| **视觉风格** | 普通 Markdown | Apple 风格 + emoji 点缀 | Bob 的产品美学 |
| **30 秒上手** | 多步说明 | 3 步极简 | Zed 的简洁哲学 |
| **Badge 墙** | 5 个（已有） | 保留+增加 Star History | OpenClaw 的 badge 矩阵 |
| **截图/主题预览** | 无 | 明暗主题对比图 | LobeChat 的双主题截图 |
| **Star History** | 无 | 嵌入 Star History 图表 | OpenClaw |
| **贡献者墙** | 无 | all-contributors 自动生成 | OpenClaw 660+ 贡献者 |

**执行步骤：**
1. 录制 10 秒产品演示 GIF（说话→文字→AI 润色→粘贴到文档）
2. 截取明暗主题产品截图
3. 按模板重写 README
4. 提交 PR，寻求社区反馈

| # | 行动 | 前置条件 |
|---|------|---------|
| T3-1 | CLI 模式 + 本地 HTTP API | T1-4（ASR 抽象）+ 核心逻辑提取为 npm 包 |
| T3-2 | 数据驱动插件系统（Prompt + 导出格式） | T1-2（Prompt 模板）验证用户需求 |
| T3-3 | MCP Server | T3-1（HTTP API）就绪后 |
| T3-4 | GPU 推理支持 | 去掉 `device="cpu"` 硬编码，检测 CUDA/Metal |

**Tier 4 — 长期愿景（6 月+）：**

| # | 行动 | 对标参考 |
|---|------|---------|
| T4-1 | 完整插件系统（WASM 沙箱） | Zed 的 WASM 扩展 |
| T4-2 | 系统级输入法集成（macOS Input Source / Windows TSF） | RIME 输入法框架 |
| T4-3 | 编辑器插件（Obsidian / VS Code） | Obsidian 的插件生态 |
| T4-4 | Freemium 商业模式 | Obsidian/Lin ear 的核心免费+服务付费 |
| T4-5 | 实时流式识别 | whisper.cpp 的流式示例（全栈重构） |

### 可量化的成功指标

| 指标 | 当前 | 3 月目标 | 6 月目标 |
|------|------|---------|---------|
| GitHub Stars | ~200 | 1,000 | 3,000 |
| 首次使用完成率 | 未知（估计 <30%） | 60%（快速体验模式） | 80% |
| AI 处理支持模型数 | 5（云端 OpenAI-compatible） | 10+（+本地 Ollama/LM Studio + 硅基流动/Groq/Gemini 等免费云端） | 15+ |
| 自定义 Prompt 模板 | 0（6 个内置） | 用户可自定义 | 社区共享模板 |
| 活跃社区成员 | ~0 | 微信群 50 人 | 微信群 200 人 + 即刻关注 500 |
| 赞助收入 | 0 | 爱发电 10 人/月 | 爱发电 50 人/月 |
| AI 功能激活率 | <10%（需自备 API Key） | 40%（免费云端一键启用） | 60%（本地模型 + 免费云端） |

---

## 十、验证方式

本计划为分析报告，无代码变更需验证。如执行各 Tier 行动项：

### Tier 0 验证
1. **T0-1**: 嵌入式 Python 环境下 `prepare:python:embedded` 成功下载模型
2. **T0-2**: Python 3.6 被拒绝，Python 3.8+ 通过
3. **T0-3**: 设置 `localhost:11434` 为 AI endpoint 时不再被 SSRF 拦截

### Tier 1 验证
4. **T1-1**: Ollama 运行后 Murmur 成功连接 localhost 完成文本润色；硅基流动免费 API 一键启用成功；设置页 AI 模型区域分为"免费体验/本地模型/自定义 API"三个 tab
5. **T1-2**: 用户放入 Markdown 模板文件后前端识别并可用
6. **T1-3**: 全新机器 10 分钟内完成首次转录（VAD + 在线 API）
7. **T1-4**: 新 ASR 引擎只需实现 `ASREngine` 接口即可接入

### Tier 2 验证
8. **T2-1**: 即刻/V2EX 帖子发布后有用户反馈
9. **T2-2**: 竞品对比文档完成，B 站视频有 100+ 播放

---

## 十一、执行进度（2026-05-23 更新）

### 已完成

| 编号 | 任务 | 完成日期 | 关键产出 |
|------|------|---------|---------|
| T0-1 | 修复 `downloadModels` 硬编码 `python3` | 2026-05-23 | `modelManager.js` 接受 pythonCmd 参数 |
| T0-2 | 修复 Python 版本检测（需 3.8+） | 2026-05-23 | `isPythonVersionSupported` + `!!()` 修复 |
| T0-3 | 重构 SSRF 防护支持本地模型 | 2026-05-23 | `validateAIBaseUrl` + `isLocalhost()` + `isPrivateNetwork()` + ADR 001 |
| T1-1a | 本地模型后端支持 | 2026-05-23 | `processTextWithAI`/`checkAIStatus` 自动检测 localhost |
| T1-1b | AI Provider Presets 注册表 | 2026-05-23 | 8 个预置 provider + `getAIProviderPresets` IPC |
| T1-1c | 本地模型自动检测 | 2026-05-23 | 探测 Ollama/LM Studio + `detectLocalModels` IPC |
| T1-1d | 设置页 Provider 预设 | 2026-05-23 | SiliconFlow/Groq/Ollama/LM Studio 预设按钮 + 本地模型跳过 API key |
| T1-2 | 自定义 Prompt 模板系统 | 2026-05-23 | `parseTemplateFile` + `loadCustomTemplates` + `getAIModes` IPC + ADR 002 |
| T1-4 | ASR 引擎抽象接口 | 2026-05-23 | `validateASREngine` + `createASREngineRegistry` + FunASRManager 验证 + ADR 003 |
| B4 | 文件配置 ~/.murmur.json | 2026-05-23 | `loadFileConfig` + `saveFileConfig` + DB fallback 链 + ADR 004 |
| TS-0 | TypeScript Phase 0 | 2026-05-23 | `typecheck` script + `@types/node` + CI step |
| TS-1 | TypeScript Phase 1 | 2026-05-23 | `src/types/ipc.ts` + 精确 `electronAPI.d.ts` |
| TS-2 | TypeScript Phase 2 | 2026-05-23 | JSDoc 类型注解 (aiPrompts, fileConfig, asrEngine) |
| Bug | clipboard.readText() null safety | 2026-05-23 | `|| ""` fallback |

### 待执行

| 编号 | 任务 | 优先级 | 状态 |
|------|------|--------|------|
| T1-3 | 快速体验模式 | P1 | 未开始 |
| T2-1 | 中国社区建设 | P1 | 未开始 |
| T2-2 | 竞品定位文档 + 演示 | P1 | 未开始 |
| T2-2.5 | README 重写 | P1 | 未开始 |
| T2-3 | 爱发电 + 微信赞赏 | P2 | 未开始 |
| T3-1 | CLI 模式 | P2 | 未开始 |
| TS-3 | 前端 TS 迁移 | P2 | 未开始 |

### 指标

| 指标 | 会话前 | 当前 |
|------|--------|------|
| 测试数量 | 335 | 399 |
| 测试文件 | 37 | 42 |
| typecheck | ✅ | ✅ |
| lint | ✅ | ✅ |
| renderer build | ✅ | ✅ |
| commits | ~80 | 97 |
