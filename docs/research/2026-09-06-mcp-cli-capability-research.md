# Murmur MCP / CLI 能力规划研究

> 日期:2026-09-06 | 方法:①代码级摸底(本文所有 Murmur 侧结论以仓库源码为准,标注 `file:line`);②两个并行研究代理对一手资料(官方规范/官方仓库源码/产品官方文档)做行业调研,结论落在两份卫星文档:
>
> - MCP 生态与工具设计最佳实践 → `docs/research/2026-09-06-mcp-landscape-and-best-practices.md`(下称 **[MCP调研]**)
> - 桌面应用 CLI 伴侣工程模式 → `docs/research/2026-09-06-desktop-cli-companion-patterns.md`(下称 **[CLI调研]**)
>
> 调研问题:Murmur 如何通过 MCP 和 CLI 与 AI 时代接轨?选什么架构、分几步走、业界怎么做的。

## TL;DR

1. **推荐形态:CLI 与 MCP server 同核**——同一个 `murmur` 二进制,`murmur mcp` 子命令启动 MCP server(superwhisper 实证同款);混合架构:**本地子命令直连文件**(config/history,VS Code `code` 实证模式)+ **转写/AI 走本地 socket 桥接运行中的桌面应用**(1Password/Docker Desktop 实证模式)。分四阶段:地基 → CLI → MCP → 生态(§5)。
2. **"CLI + MCP 双出口"已被业界盖章**[MCP调研]:Playwright(微软官方)建议 coding agent 用 CLI+SKILLS(省 token)、MCP 留给长时自治工作流;GitHub/Stripe/Cloudflare/Docker/superwhisper 全部双出口。Murmur 两者都要,共享同一内核。
3. **生态位是空白**[MCP调研]:现有语音 MCP 生态中,中文转写 + 说话人分离的本地 MCP server 不存在;桌面听写产品只有 superwhisper(英文)有本地 CLI+MCP。Murmur 的本地优先中文定位 + diarization 是差异化切口。
4. **三个改变设计的工程硬事实**[CLI调研]:①Electron `second-instance` 是 fire-and-forget,**不能承载 `murmur transcribe` 的结果返回**,必须自建 socket 请求-响应 IPC(VS Code 正是这么做的);②`ELECTRON_RUN_AS_NODE` 壳脚本 = 零依赖 CLI 分发(VS Code `code` 同款);③**Windows named pipe 默认 DACL 对 Everyone 开放读**,且 Node `net` 模块不暴露 ACL 设置——开工前必须 PoC。
5. **MCP 规范 2026-07-28 大重置**[MCP调研]:协议无状态化、旧 HTTP+SSE 废弃,stdio + Streamable HTTP 是仅存标准传输且 stdio 是官方推荐的本地暴露方式;TS SDK v1(`@modelcontextprotocol/sdk` 1.30.0)维护至 ≥2027-01,与 v2 API 同形,起步成本与迁移成本都低。
6. **旧战略决策应反转**:2026-05-24 战略快照的"先做私有本地 HTTP API、MCP 降级"写在 MCP 生态成熟之前;2026-09 的证据是私有 HTTP API 没有现成消费者,而 MCP(stdio)+ agent 友好 CLI 是即插即用的公共接口。本地 socket 降级为内部管道,不再是对外 API。
7. **Murmur 侧现状**:ADR-004(murmur.json)与 ADR-003(引擎抽象)已把前置铺完;转写/AI/历史全是纯主进程逻辑,可低成本服务化;唯一硬缺口是 `main.ts` 无单实例锁(§2)。

## 1. 战略沿革:这件事在仓库里已有的位置

Murmur 对 CLI/MCP 并非从零开始,已有三层存量:

1. **战略层**(`docs/strategic-plan-gap-analysis.md`,2026-05-24 快照,已冻结):曾规划 C1(CLI 模式)、C2(MCP Server)、T3-1(CLI + 本地 HTTP API),依赖链 B4 文件配置 → C1 CLI → C2 MCP,当时决策"MCP 降低优先级,先做本地 HTTP API"。**该决策写于 MCP 生态爆发前,本文 §5 按新证据反转**(TL;DR 第 6 条)。
2. **前置依赖层(已实现)**:
   - ADR-004 文件配置:`{userData}/murmur.json`,白名单键(`FILE_CONFIGURABLE_KEYS`),`DB > 文件 > 默认值` 三级优先链(`src/helpers/fileConfig.ts:10-59`)。敏感键(`ai_api_key`)永远留在 safeStorage 加密的 SQLite。
   - ADR-003 ASR 引擎抽象:`ASREngine` 接口 + 注册表(`src/helpers/engines/asrEngine.ts:10-33`),当前单实现(FunASR)。
   - 分发渠道雏形:`docs/homebrew/murmur.rb`(cask)+ `docs/winget/Murmur.yaml`。
   - README 路线图明确列有"CLI 模式"。
3. **旧规划的 blocker 已失效**:战略文档认为 C1 需要"先提取核心逻辑为独立 npm 包;Electron ~200MB 打包是重量级方案"。代码摸底显示该假设过时——转写核心逻辑在 Python 子进程(`funasr_server.py`,stdin/stdout JSON 协议),TS 侧只是编排;且 [CLI调研] 的 `ELECTRON_RUN_AS_NODE` 模式让 CLI 直接随 app bundle 分发,零额外依赖、无需提取 npm 包。

## 2. Murmur 能力盘点:什么能被程序化暴露

| 能力               | 实现位置                                                                                   | 纯主进程?   | 脱离 Electron 可用?                                                                                   | 约束                           |
| ------------------ | ------------------------------------------------------------------------------------------ | ----------- | ----------------------------------------------------------------------------------------------------- | ------------------------------ |
| 文件转写           | `FunASRManager.transcribeFile` → `funasr_server.py`(stdin/stdout JSON)                     | ✅          | ✅ 直接 spawn Python                                                                                  | 单线程推理;模型 ~1GB 常驻      |
| 说话人分离         | `funasrManager.diarizeAudio`,`funasr_server.py:943` 懒加载 CAM++                           | ✅          | ✅                                                                                                    | 首次调用加载慢                 |
| AI 润色/摘要       | `src/helpers/ipc/aiHandlers.ts` HTTP 调 OpenAI-compatible                                  | ✅          | ⚠️ **密钥不可用**:`ai_api_key` 经 safeStorage 加密存 SQLite(`aiHandlers.ts:264`),仅 Electron 进程可解 | headless 需 env var 密钥或桥接 |
| 历史查询/删除/导出 | `src/helpers/database.ts`(`node:sqlite`,transcriptions 表)                                 | ✅          | ⚠️ 并发写有锁风险;明文字段可读                                                                        | 单写者原则见 §4                |
| 设置读写           | `murmur.json` 白名单 + DB                                                                  | ✅          | ✅(白名单键)                                                                                          | 敏感键仅 DB                    |
| 音频路径校验       | `audioPathValidator.ts` 纯函数(UNC 拒绝、win32 系统树黑名单)                               | ✅          | ✅ 直接复用                                                                                           | —                              |
| 按住说话听写       | renderer `getUserMedia` + 全局热键                                                         | ❌ 依赖 GUI | ❌                                                                                                    | 超出本规划范围(依赖流式路线图) |
| 进程/模型状态      | `FunASRManager.checkStatus`、空闲卸载(`IDLE_UNLOAD`,10s~24h 可配,`funasrManager.ts:14-33`) | ✅          | 部分                                                                                                  | —                              |

**结构性事实(决定架构)**:

- FunASR 是**独立 Python 子进程**,stdin/stdout JSON 协议(`funasrServer.ts:416` 的 `{action:"exit"}`),Python 侧与 Electron 完全解耦。
- `transcribeFile` 主流程是纯主进程逻辑:校验 → 热词注入 → 子进程(`transcriptionHandlers.ts:295-315`),进度事件(`event.sender.send`)是唯一 GUI 耦合,且可缺省。
- **`main.ts` 无 `requestSingleInstanceLock`**(grep 计数 0):双开会抢 FunASR 子进程和 SQLite。这是硬前置缺口。
- 应用已有常驻托盘(`main.ts:145,263`)+ 空闲模型卸载,天然适合"应用即守护进程"。
- 配置已文件化(ADR-004),CLI 无需 Electron 即可读取白名单配置。

## 3. 架构:混合模式(业界实证组合)

```
                    ┌─ 本地子命令(直连文件,app 无需运行)─ VS Code 模式
murmur CLI ─┐       │   murmur config get/set      → murmur.json (ADR-004)
            │       │   murmur history list --json → SQLite 只读
            ├───────┤
MCP server ─┤       │   murmur transcribe/diarize/polish/status
(murmur mcp)┘       │        ↓ UDS(macOS/Linux, 0600) / named pipe(Windows, 见安全节)
                    │        ↓ token 握手(0600 token 文件, userData 内)
                    └→ Electron 主进程本地服务层
                         ├→ FunASR Python(单实例,复用已加载模型)
                         ├→ AI 润色(safeStorage 密钥在进程内解密,永不出进程)
                         └→ SQLite(单写者)
```

**为什么不是另外两个极端**:

- **纯独立模式(whisper.cpp 式,CLI 自己 spawn Python)**:与 GUI 并存时双份 ~1GB 模型内存 + SQLite 双写 + AI 密钥不可用。降级为 Phase 3 的可选增强(服务器场景),不进 MVP。
- **纯私有 HTTP API(旧战略)**:2026-09 无现成消费者;MCP(stdio)与 CLI 才是即插即用的公共接口 [MCP调研]。socket 层退化为内部管道。

**关键机制选型(全部有业界实证,[CLI调研])**:

1. **不用 `second-instance` 承载 CLI**:它是单向上抛(fire-and-forget,argv 被 Chromium 污染,32MB 上限),CLI 拿不到转写结果。单实例锁仍要补(防 GUI 双开),但 CLI ↔ app 走自建请求-响应 IPC:确定性路径派生自 userData 的 UDS/named pipe,`EADDRINUSE` 时以客户端身份收敛,陈旧 socket 自愈(VS Code `src/vs/code/electron-main/main.ts` 同款)。
2. **CLI 分发用 `ELECTRON_RUN_AS_NODE` 壳脚本**:app bundle 内 `bin/murmur` 壳脚本用应用自带 Electron 二进制当 Node 运行 CLI JS,零外部依赖(VS Code `code` 同款)。
3. **MCP server 宿主在 CLI 进程**(`murmur mcp` 子命令):stdio transport 是 MCP 官方推荐的本地暴露方式 [MCP调研];server 作为 socket 客户端桥接 app,与 1Password 的"桌面应用授权、密钥永不明文出进程"安全模型一致。
4. **SDK 选 `@modelcontextprotocol/sdk` v1(1.30.0)**:维护至 ≥2027-01,`McpServer + registerTool(zod) + StdioServerTransport` 与 v2 API 同形,后续迁移只改 import [MCP调研 §2]。

## 4. 安全设计(开工前定型)

1. **路径校验复用**:所有程序化转写入口必须过 `validateAudioPath`(UNC 拒绝、win32 系统树黑名单、allowed roots,`audioPathValidator.ts:31-211`)——MCP 工具的路径参数是 agent 可控输入,不校验等于开放任意文件读取。
2. **本地 socket 认证**:macOS/Linux 用 UDS 权限位 0600(ssh-agent 同款);**Windows named pipe 默认 DACL 对 Everyone 开放读,且 Node `net` 不暴露 ACL API**[CLI调研 §4]——补偿控制:管道名含不可猜随机段 + userData 内 0600 token 文件握手 + 短 TTL 会话(1Password 模式)。**Phase 0 必须先做 named pipe PoC**(枚举/读取攻击面验证),PoC 不过则 Windows 上退回"仅 token 握手 + 本地回环 TCP"。
3. **MCP 输入处理**:工具描述与 annotations 视为不可信输入;server 校验所有输入、限速、消毒输出;**日志一律写 stderr(stdout 是协议通道)**[MCP调研 §6]。
4. **annotations 如实标注**[MCP调研]:默认值悲观(`destructiveHint` 默认 true),读类工具显式 `readOnlyHint: true`;`transcribe_file` 设计为默认不写历史(显式 `save` 参数才写),使其可如实标 read-only;`delete_transcription` 标 `destructiveHint: true` 且 GUI 侧确认。
5. **密钥不出进程**:AI 润色只在 Electron 主进程内解密 `ai_api_key`;MCP/CLI 经桥接调用,明文密钥永不跨进程(1Password `1password-mcp` 实证模型)。headless 独立模式如做,密钥只能经 env var(0600 profile),不得进 `murmur.json`(维持 ADR-004 白名单不变)。
6. **单写者原则**:历史写仅经运行中的 app(SQLite 单写者);CLI 本地子命令只读;MCP 写操作经桥接。

## 5. 分阶段规划

> 每阶段附验收标准。所有主进程改动落在 AGENTS.md 高风险区(`main.ts` 边界、`helpers/ipc/`),沿用 TDD(先测试锁行为再动)与独立 code-review 约束。

### Phase 0 — 地基(GUI 行为不变)

| 项  | 内容                                                                                                                                 | 验收                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| 0.1 | 单实例锁:`requestSingleInstanceLock` + `second-instance` 唤起已有窗口(仅此用途,不承载 CLI)                                           | 双开 app 不再抢 FunASR 子进程/SQLite                 |
| 0.2 | 主进程 service 层:把 `transcribeFile`/`diarize`/AI 处理/历史查询从 ipc handler 收拢为不依赖 `event.sender` 的服务函数,handler 变薄壳 | 现有 IPC 行为不变(测试全绿);service 可被无窗口调用   |
| 0.3 | 本地 IPC 服务:UDS/named pipe + token 握手 + 陈旧 socket 自愈;**Windows named pipe DACL PoC 前置**                                    | 经 socket 发 JSON 请求完成一次真实文件转写并拿到结果 |

### Phase 1 — CLI(`murmur` 命令)

| 项  | 内容                                                                                                                                                | 验收                                            |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| 1.1 | 壳脚本:app bundle 内 `bin/murmur`(`ELECTRON_RUN_AS_NODE`)                                                                                           | `murmur --version` 在无 Node 环境的机器上工作   |
| 1.2 | 本地子命令:`murmur config get/set`(murmur.json)、`murmur history list [--json]`(SQLite 只读)                                                        | app 未运行时可用                                |
| 1.3 | 桥接子命令:`murmur status`、`murmur transcribe <file> [--diarize] [--save] [--json]`、`murmur polish`                                               | app 运行时全功能;未运行时明确退出码 + 提示      |
| 1.4 | agent 友好面:`--json`、稳定退出码(参照 gh:0 成功/1 常规错/2 用法错/4 未运行)、stderr 日志、无 TTY 行为                                              | `murmur transcribe demo.m4a --json \| jq .text` |
| 1.5 | 分发:macOS cask 加 `binary` stanza(一行,[CLI调研 §2.1] VS Code cask 实证);Windows NSIS 把 `{app}\bin` 写入 HKCU Path(winget `Scope: user` 正好对应) | brew/winget 安装后 `murmur` 在 PATH             |

### Phase 2 — MCP server(与 CLI 同核)

| 项  | 内容                                                                                                                                                                                                                                                                                    | 验收                                                       |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 2.1 | server 骨架:`murmur mcp` 子命令,`@modelcontextprotocol/sdk` v1 + `StdioServerTransport`,复用 CLI 的桥接内核                                                                                                                                                                             | `claude mcp add murmur -- murmur mcp` 后工具可枚举         |
| 2.2 | 工具面(少量高影响):`transcribe_file(path, diarize?, save?)` / `polish_text(text, mode?)` / `list_transcriptions(query?, limit?)` / `get_transcription(id)` / `delete_transcription(id)`〔destructive〕/ `get_murmur_status()`;`structuredContent` + `outputSchema`,annotations 如实标注 | agent 转写文件拿到结构化结果;错误经 `isError` 返回可自纠错 |
| 2.3 | 接入体验:`murmur mcp install` 写 Claude Code(`.mcp.json`)/ Cursor(`.cursor/mcp.json`)/ VS Code(`.vscode/mcp.json`,顶层键是 `servers` 不是 `mcpServers`[MCP调研 §4])                                                                                                                     | 三客户端零手改配置接入                                     |

### Phase 3 — 生态位与深化(按需排期)

- **3.1 生态发布**:README MCP 章节 + 仓库 AGENTS.md(Agentic AI Foundation 约定,60k+ 项目采用 [CLI调研 §3.4])+ MCP Registry(`server.json`,preview 阶段 [MCP调研 §1.5])。
- **3.2 独立降级模式**:app 未运行时 CLI 直接 spawn `funasr_server.py`(服务器/CI 场景;注意双模型内存与"不写主库"约束)。
- **3.3 双出口分工对齐 Playwright 共识**:coding agent 场景在 AGENTS.md 引导走 CLI(省 token),自治工作流走 MCP。
- **3.4 流式听写 MCP 化**:依赖实时流式路线图(200ms 目标),远期。

## 6. 风险清单

| 风险                                                | 等级                 | 缓解                                                                             |
| --------------------------------------------------- | -------------------- | -------------------------------------------------------------------------------- |
| Windows named pipe 默认 DACL 开放 + Node 无 ACL API | **High**             | Phase 0 PoC 前置;补偿控制(随机管道名 + token 握手 + 短 TTL);PoC 不过退回回环 TCP |
| FunASR 单线程推理,CLI/MCP 并发请求排队              | High(战略文档已标注) | 队列 + 请求方超时语义;长期经引擎抽象引入多 worker                                |
| 主进程 service 层重构波及现有 IPC handler           | High                 | 高风险区流程:先补测试锁行为,TDD + 独立 code-review                               |
| MCP 规范快速演进(2026-07-28 大重置)                 | Medium               | v1 SDK 维护窗口 ≥2027-01;官方兼容矩阵保证旧 stdio server 可用;不实现私有协议扩展 |
| safeStorage 密钥使 headless AI 润色不可用           | Medium               | 桥接模式进程内解密;独立模式用 env var;密钥永不落明文文件                         |
| SQLite 多进程写锁                                   | Medium               | 单写者原则:写仅经 app;CLI 本地子命令只读                                         |
| socket 服务引入新的本地攻击面                       | Medium               | §4 全套(token/权限位/限速/消毒输出);`ci:check` 之外补 socket 层渗透用例          |

## 7. 与旧战略快照的差异对照

| 旧决策(2026-05-24)                                          | 新结论(2026-09-06)                                      | 依据                                            |
| ----------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------- |
| 先做私有本地 HTTP API,MCP 降级                              | CLI + MCP(stdio)双出口优先;socket 为内部管道            | [MCP调研]:stdio 是官方推荐本地形态;双出口是主流 |
| C1 CLI 需先提取核心逻辑为 npm 包(Electron 200MB 是 blocker) | `ELECTRON_RUN_AS_NODE` 壳随 app 分发,零依赖             | [CLI调研 §1.2]:VS Code `code` 实证              |
| C2 MCP 依赖 C1 基础设施                                     | 保持(同核依赖),但 C1 缩水为"壳 + 桥接内核",MCP 提前可行 | 本文 §5                                         |
| 未识别 named pipe 安全问题                                  | 升为 Phase 0 硬前置 PoC                                 | [CLI调研 §4.2]                                  |

---

_Murmur 侧结论以 2026-09-06 的 `autopilot/p1p2p3` 分支源码为准;行业结论见两份卫星文档,其内所有"未验证"标注项在开工前需复核。_
