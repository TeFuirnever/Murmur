# Murmur MCP / CLI 能力规划研究

> 日期:2026-09-06 | 方法:①代码级摸底(本文所有 Murmur 侧结论以仓库源码为准,标注 `file:line`);②两个并行研究代理对一手资料(官方规范/官方仓库/产品官方文档)做行业调研,结论落在两份卫星文档:
>
> - MCP 生态与工具设计最佳实践 → `docs/research/2026-09-06-mcp-landscape-and-best-practices.md`
> - 桌面应用 CLI 伴侣工程模式 → `docs/research/2026-09-06-desktop-cli-companion-patterns.md`
>
> 调研问题:Murmur 如何通过 MCP 和 CLI 与 AI 时代接轨?选什么架构、分几步走、业界怎么做的。

## TL;DR

<!-- 在两个研究代理返回后完成 -->

## 1. 战略沿革:这件事在仓库里已有的位置

Murmur 对 CLI/MCP 并非从零开始,已有三层存量:

1. **战略层**(`docs/strategic-plan-gap-analysis.md`,2026-05-24 快照,已冻结):曾规划 C1(CLI 模式)、C2(MCP Server)、T3-1(CLI + 本地 HTTP API),并给出依赖链:B4 文件配置 → C1 CLI → C2 MCP。当时的决策是"MCP 降低优先级,先做本地 HTTP API"(理由:LobeChat 为 MCP 市场投入了整个团队)。**该决策写在 MCP 生态爆发之前,本文建议重新评估**(见 §5)。
2. **前置依赖层(已实现)**:
   - ADR-004 文件配置:`{userData}/murmur.json`,白名单键(`FILE_CONFIGURABLE_KEYS`),`DB > 文件 > 默认值` 三级优先链(`src/helpers/fileConfig.ts:10-59`)。敏感键(`ai_api_key`)永远留在 safeStorage 加密的 SQLite。
   - ADR-003 ASR 引擎抽象:`ASREngine` 接口 + 注册表(`src/helpers/engines/asrEngine.ts:10-33`),当前单实现(FunASR)。
   - 分发渠道雏形:`docs/homebrew/murmur.rb`(cask)+ `docs/winget/Murmur.yaml`。
   - README 路线图明确列有"CLI 模式"。
3. **旧规划的 blocker 已部分失效**:战略文档认为 C1 需要"先提取核心逻辑为独立 npm 包;Electron ~200MB 打包是重量级方案"。**代码摸底显示这个假设过时了**——转写核心逻辑在 Python 子进程(`funasr_server.py`,stdin/stdout JSON 协议),TS 侧只是编排;历史库是 `node:sqlite`(Node ≥22.5 内建);CLI 理论上可以是一个不含 Electron 的薄 Node 程序(见 §3)。

## 2. Murmur 能力盘点:什么能被程序化暴露

| 能力               | 实现位置                                                                                   | 纯主进程?   | 脱离 Electron 可用?                                                                                   | 约束                            |
| ------------------ | ------------------------------------------------------------------------------------------ | ----------- | ----------------------------------------------------------------------------------------------------- | ------------------------------- |
| 文件转写           | `FunASRManager.transcribeFile` → `funasr_server.py`(stdin/stdout JSON)                     | ✅          | ✅ 直接 spawn Python                                                                                  | 单线程推理;模型 ~1GB 常驻       |
| 说话人分离         | `funasrManager.diarizeAudio`,`funasr_server.py:943` 懒加载 CAM++                           | ✅          | ✅                                                                                                    | 首次调用加载慢                  |
| AI 润色/摘要       | `src/helpers/ipc/aiHandlers.ts` HTTP 调 OpenAI-compatible                                  | ✅          | ⚠️ **密钥不可用**:`ai_api_key` 经 safeStorage 加密存 SQLite(`aiHandlers.ts:264`),仅 Electron 进程可解 | headless 需 env var 密钥或桥接  |
| 历史查询/删除/导出 | `src/helpers/database.ts`(`node:sqlite`,transcriptions 表)                                 | ✅          | ⚠️ 多进程并发写有锁风险;明文字段可读                                                                  | 单写者原则见 §5                 |
| 设置读写           | `murmur.json` 白名单 + DB                                                                  | ✅          | ✅(白名单键)                                                                                          | 敏感键仅 DB                     |
| 音频路径校验       | `audioPathValidator.ts` 纯函数(UNC 拒绝、win32 系统树黑名单)                               | ✅          | ✅ 直接复用                                                                                           | —                               |
| 按住说话听写       | renderer `getUserMedia` + 全局热键                                                         | ❌ 依赖 GUI | ❌                                                                                                    | 超出 CLI/MCP 范围(除非未来流式) |
| 进程/模型状态      | `FunASRManager.checkStatus`、空闲卸载(`IDLE_UNLOAD`,10s~24h 可配,`funasrManager.ts:14-33`) | ✅          | 部分                                                                                                  | —                               |

**结构性事实(决定架构)**:

- FunASR 是**独立 Python 子进程**,stdin/stdout JSON 协议(`funasrServer.ts:416` 的 `{action:"exit"}`),Python 侧与 Electron 完全解耦——CLI 可以自己 spawn 它,不需要"提取 TS 核心逻辑"。
- `transcribeFile` 主流程是纯主进程逻辑:校验 → 热词注入 → 子进程(`transcriptionHandlers.ts:295-315`),进度事件(`event.sender.send`)是唯一 GUI 耦合,且可缺省。
- **`main.ts` 无 `requestSingleInstanceLock`**(grep 计数 0):双开会抢 FunASR 子进程和 SQLite。任何"CLI 桥接运行中实例"的方案,这是硬前置。
- 应用已有常驻托盘(`main.ts:145,263`)+ 空闲模型卸载,天然适合"应用即守护进程"。
- 配置已文件化(ADR-004),CLI 无需 Electron 即可读取白名单配置。

## 3. 架构选项

### 选项 A:桥接模式(VS Code `code` / 1Password `op` / Docker Desktop 模式)

Electron 主进程增加本地 IPC 服务层(macOS/Linux 用 Unix domain socket,Windows 用 named pipe),CLI 与 MCP server 都是这个服务的薄客户端。

```
murmur CLI ─┐
            ├─ UDS/named pipe + token ─→ Electron 主进程 ─→ FunASR Python(单实例)
MCP server ─┘                            ├→ AI 润色(safeStorage 密钥可用)
                                         └→ SQLite(单写者)
```

- 优点:Python/模型单实例(不双吃 1GB 内存);AI 密钥可用;历史单写者;GUI 状态(模型已加载)直接复用。
- 缺点:要求 app 在跑(未跑则拉起,冷启动慢);必须先补单实例锁 + 本地服务层;Electron 主进程成为单点。
- 前置工程:①`requestSingleInstanceLock` + `second-instance`;②主进程 service 层重构(把 `ipc/` handler 背后的能力收拢为不依赖 `event.sender` 的服务函数);③socket + token 握手(token 文件 0600 权限存 userData)。

### 选项 B:独立模式(whisper.cpp 模式)

CLI 不依赖 GUI,自己 spawn `python funasr_server.py`(app bundle 内已带 Python 运行时 + 模型)。

- 优点:零 GUI 依赖,服务器/CI 场景可用;实现最薄。
- 缺点:与 GUI 并存时**双份模型内存**(~1GB×2);历史库双写竞争;AI 密钥不可用(safeStorage);与 GUI 抢 GPU。
- 适用:headless 服务器转写是独立需求时。

### 选项 C:混合模式(推荐评估)

CLI 启动时探测运行中的 app(socket 存活 + token 握手):在跑 → 桥接(全能力);没跑 → 降级为直接 spawn Python 的独立转写(仅转写/diarize,无 AI 润色、不写历史或用独立 DB)。

- 优点:两种场景都覆盖,体验最像 Docker Desktop(`docker` CLI 在 Desktop 未跑时可拉起 daemon)。
- 缺点:两条路径都要测试;状态一致性复杂。

**MCP server 与 CLI 同核**:无论选哪个选项,MCP server(stdio transport)与 CLI 复用同一个"客户端核心"(连接/降级逻辑 + 参数校验),只是输入面不同(工具调用 vs argv)。这是"CLI-MCP parity"的业界趋势(详见卫星文档)。

## 4. 安全约束(必须在设计中前置)

1. **路径校验复用**:所有程序化转写入口必须过 `validateAudioPath`(UNC 拒绝、win32 系统树黑名单、allowed roots)——MCP 工具的路径参数是 agent 可控输入,不校验等于开放任意文件读取(`audioPathValidator.ts:31-211`)。
2. **本地 socket 认证**:UDS 文件权限 0600 + 随机 token 握手(named pipe 在 Windows 用 ACL + token),防止同机其他用户进程直连。
3. **MCP stdio 信任模型**:MCP 工具描述与参数即模型可见输入,存在提示注入面;工具命名/描述要克制,不提供"执行任意命令"类工具(详见 MCP 卫星文档安全节)。
4. **密钥不落明文**:headless 模式的 AI 密钥只能经 env var/文件权限 0600,不得写进 `murmur.json`(维持 ADR-004 白名单不变)。
5. **写操作分级**:历史删除/清空在 MCP 侧标注 `destructiveHint`,CLI 侧默认交互确认 + `--yes` 逃生门。

## 5. 分阶段规划(草案,待行业调研结论校准)

<!-- 阶段划分与优先级在研究代理返回后定稿。骨架:Phase 0 前置(单实例锁 + service 层 + 本地 socket);Phase 1 CLI;Phase 2 MCP server;Phase 3 分发与客户端接入(murmur mcp install / homebrew / winget)。 -->

## 6. 风险清单(初始)

| 风险                                         | 等级                 | 缓解                                               |
| -------------------------------------------- | -------------------- | -------------------------------------------------- |
| FunASR 单线程推理,CLI/MCP 并发请求排队体验差 | High(战略文档已标注) | 队列 + 请求方超时语义;长期:引擎抽象下引入多 worker |
| 双实例内存爆(独立模式与 GUI 并存)            | High                 | 选项 C 默认桥接;独立模式提示用户                   |
| SQLite 多进程写锁                            | Medium               | 单写者原则:历史写仅经 app;CLI 独立模式不写主库     |
| safeStorage 密钥使 headless AI 润色不可用    | Medium               | env var 密钥;或文档明确"AI 功能需 app 在跑"        |
| 主进程 service 层重构波及现有 IPC handler    | Medium               | 高风险区清单(AGENTS.md)适用;先补测试锁行为再动     |
| MCP 生态变化快(规范/SDK 演进)                | Medium               | 跟随官方 SDK;不锁定私有协议                        |

---

_Murmur 侧结论均以 2026-09-06 的 `autopilot/p1p2p3` 分支源码为准。_
