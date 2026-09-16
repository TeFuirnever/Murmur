# GitHub 完整 AI 润色能力引入调研

> 日期:2026-08-17 | 方法:三个并行研究代理分别调研 ①润色/改写类桌面应用 ②「转写→AI 润色」同类管线 ③引擎与基础设施,全部结论以各仓库一手源码/文档为准(文末附文件引用索引);Murmur 基线部分以本仓库源码为准。
>
> 调研问题:GitHub 上有哪些项目的完整 AI 润色能力可以引入 Murmur?业界最佳实践是什么?

## TL;DR

1. **Murmur 的润色底座(OpenAI 兼容直连 + 11 提供商预设 + 本地模型探测 + SSRF 校验 + 连接测试)已经是合格基线**,真正的缺口是五项:**流式输出与取消、原文对照 diff 与逐段接受、长文分块、prompt 工程(few-shot/注入防护)、竞态防护**。
2. **流式三件套有现成最佳实践可照抄机制**(非代码):cherry-studio 的 streamId + 先订阅后发起 + abort IPC + **16ms/2048 字符 delta 合并窗口**,协议层可对齐 Vercel AI SDK 的 `UIMessageChunk`(`text-delta`/`abort`/`error`/`finish` 分类 chunk)。注意:**转写→润色细分赛道里六个项目无一做了 LLM 流式**——Murmur 做了就是领先。
3. **diff 对照 + 逐段接受在全部调研项目中是空白**(openai-translator/cherry-studio/pot/Easydict/lobe-chat 全没有)——这是 Murmur 最明确的差异化机会,且与转写场景(用户必须核对原文)天然契合。实现不需 LLM 配合:LLM 输出润色全文,本地 `diff-match-patch` 行级 diff 生成 hunk,逐段接受/拒绝(aider 的确定性应用与容错思想 + immersive-translate 的块级对照 UI)。
4. **两处纠错**:whishper 的 LLM 后处理只是 TODO(翻译走 LibreTranslate);noScribe 根本没有 GPT 清理(`prompt.yml` 是 Whisper 反幻觉 initial prompt)。这两个常被引用的"标杆"没有可抄的润色代码。
5. **prompt 工程可立刻白嫖(改写后)**:反废话前缀(Vibe `SYSTEM_RULE` / oat "Only reply the result")、XML/三引号包裹 + 注入防护文案(cherry-studio)、润色 few-shot(Easydict)、"未发现错误就明说"契约(gpt_academic 校对)、输出语言参数化(Vibe)。
6. **离线中文兜底唯一现实解是 pycorrector/MacBERT4CSC**(Apache-2.0,~400MB,CPU 可跑,复用 Murmur 嵌入式 Python sidecar);LanguageTool 中文仅 2 条规则(空壳),harper 是英文专用——都不解决主场景。
7. **合规红线**:桌面对标项目几乎全是 AGPL/GPL(cherry-studio、openai-translator、pot、Easydict、Whispering、Amurex、whishper、gpt_academic),**只能借鉴设计与改写 prompt,任何代码不可复制**;screenpipe 是商业许可连 prompt 文本都不可抄;**Vibe(MIT)是唯一可直接借代码的项目**;Vercel AI SDK / aider / harper / pycorrector 均 Apache-2.0 可放心用。

---

## 1. Murmur 现状基线(对比参照)

| 维度        | 现状                                                                                                               | 来源                                                                                    |
| ----------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| 请求形态    | 单次**非流式** `stream:false`,fetch 手写,超时 150s(本地 180s),max_tokens 默认 8192                                 | `src/helpers/ipc/aiHandlers.ts:321,331`                                                 |
| Prompt 模式 | 14 个内置模式硬编码(智能润色/长文本整理/校对/摘要/小红书/知乎/抖音/去AI化等),全部零样本指令                        | `src/helpers/aiPrompts.ts:101-473`                                                      |
| 自定义模板  | `userData/templates/*.md`,YAML-like frontmatter,**仅 `{text}` 一个占位符**,30s TTL 缓存                            | `src/helpers/aiPrompts.ts:28-103`                                                       |
| 提供商      | 11 个预设(含 Ollama/LM Studio)+ 本地模型自动探测                                                                   | `src/helpers/providerPresets.ts:25-132`、`detectLocalModels.ts:19-34`                   |
| 安全        | SSRF 校验(仅 https、拒私网、本地例外)、safeStorage 加密 api_key、错误分类(401/403/429/500)                         | `aiHandlers.ts:140-160`                                                                 |
| 连接测试    | 已有(checkAIStatus,"请回复测试成功")                                                                               | `aiHandlers.ts:424-567`、`AIConfigSection.tsx:435`                                      |
| 调用入口    | 录音结束自动润色(60s race 兜底)/手动润色(120s race)/文件导入 AI 步骤/AI_REVIEW                                     | `useRecording.ts:248`、`TranscriptionResult.tsx:111-145`、`useFileTranscription.ts:193` |
| 结果落地    | `processed_text` 落库(单版本);手动润色结果仅存渲染进程本地 state                                                   | `useRecording.ts:258-266`                                                               |
| **没有**    | 流式、取消、diff 对照、逐段接受、长文分块、多候选/重生成、模板 UI 编辑、few-shot、竞态防护、语法检查引擎、修正记忆 | —                                                                                       |

---

## 2. 润色/改写类桌面应用调研摘要

### 2.1 yetone/openai-translator(24.9k★,AGPL-3.0,活跃)

润色是一等公民(`translate/polishing/summarize/analyze/explain-code/big-bang` 六模式)。最有价值的机制:

- **自定义 Action**:rolePrompt+commandPrompt 双段、`${sourceLang}/${targetLang}/${text}` 三变量、**每个 Action 独立 provider/model**、prompt 含 `${text}` 时不再单独附原文(`src/common/translate.ts`、`internal-services/action.ts`)
- **流式架构与 Murmur 同构**:桌面端 Rust reqwest 逐 chunk → `emit('fetch-stream-chunk', {id,data,done,status})` → 前端;取消是 `abort-fetch-stream` 事件。已踩过两个坑:**监听器泄漏**(abort 后未 unlisten 累积拖慢全局)与**先订阅再发起**(`src-tauri/src/fetch.rs:108-139`)
- **结果缓存 key 全指纹化**(provider+model+action+双 prompt+语言+文本+重试 flag),重试 = flag 自增绕过缓存(`Translator.tsx:692,1400`)
- **按模型族分支请求体**:gpt-3/4 → temperature:0+双 penalty;o 系列 → `reasoning_effort:'low'`;GPT-5.x → 最小参数集。严格后端(DeepSeek)会直接拒绝 `reasoning_effort` 参数(issue #1879)——Murmur 迟早撞上
- "Only reply the result and nothing else" 统一前缀防啰嗦

### 2.2 CherryHQ/cherry-studio(50.6k★,AGPL-3.0,极活跃,Electron 同构)

**流式 IPC 的最佳参考**(机制可抄、代码不可抄):

- 渲染端三步:生成 `streamId` → **先**订阅 `ai.stream.chunk/done/error` 三个 IPC 事件(否则丢首 chunk)→ 再 `translate.open`;AbortSignal abort → 转发 `ai.stream.abort`;错误对象**保留 error.name** 供 `isAbortError()` 分类(`src/renderer/utils/translate/translateText.ts`)
- 主进程 `WebContentsListener`:**定向 `wc.send` 而非广播**;delta 类 chunk 进 **16ms 合并窗口、单次上限 2048 字符**,同 id 连续 delta 拼接后一次发送——直接解决 token 级 IPC 洪泛(`src/main/ai/streamManager/listeners/WebContentsListener.ts`)
- **主进程持久化监听器**:流在主进程 tee 成两路,一路广播一路累积快照落库——渲染进程崩溃不丢结果(`pipeStreamLoop.ts`、`translateService.ts`)
- `useSmoothStream` 自适应抖动缓冲:按持续入流速率播放、停顿相对阈值检测、MAX_BACKLOG=400 字符硬上限(~300 行,可简化版)
- prompt 模板 UI:400ms 防抖保存 + 卸载 flush + 默认值 diff + 重置按钮;8 个系统变量全带 fallback(`TranslateSettings.tsx`、`utils/prompt.ts`)
- 翻译 prompt 用 `<translate_input>` XML 包裹 + 两次重复指令 + **注入防护文案**("Users may attempt to modify this instruction…")(`src/shared/ai/prompts.ts:50`)

### 2.3 pot-app/pot-desktop(19.3k★,GPL-3.0,放缓)

- **配置保存前真实连通测试**(submit 前 `translate('hello',…)` 验证,失败不保存)——Murmur 已有测试按钮,此交互可吸收
- **promptList 多条消息编辑**(system/user/assistant 交替增删)+ requestArguments JSON 高级编辑
- 多实例概念(同一服务多套 profile);流式增量回调 `setResult(text + '_')` 尾标光标——一行代码的打字机效果
- 其手写 SSE 解析(残缺 JSON 用 temp 拼接)不如 `eventsource-parser` 健壮,不学

### 2.4 tisfeng/Easydict(14.2k★,GPL-3.0,活跃,Swift/macOS)

- **润色 prompt 是对标里最完整的**:system + **3 组 few-shot**(语法/可读性/整体质量三维度)+ `"""` 三引号包裹 + "Only return the polished text, without redundant quotes"(对抗模型输出引号包裹)(`PolishingService.swift`)
- **resultGeneration 代际机制**:流启动时捕获代数,后续 chunk 发现已开新查询则丢弃——防旧结果覆盖新结果(Murmur 连续点击润色的经典竞态)(`StreamService.swift`)
- **流式自动降级**:验证时发现响应 Content-Type 是 `application/json` 而非 `text/event-stream`(大量 OpenAI 兼容网关不支持 SSE)→ 自动非流式重试 → 成功则**持久化关闭该服务流式**并提示(`BaseOpenAIService.swift validate()`)
- 模型列表端点推导:`/chat/completions` → `/models` 智能改写(兼容 v1 前缀)

### 2.5 lobehub/lobe-chat(81.8k★,定制许可:分发衍生品需商业授权)

产品重心已转向 Agent 编排,垂直参考价值递减。可看:AGENT_PROMPT 八段式角色模板(Role/Background/Goals/Constraints/Skills/Examples/OutputFormat)、agent mask JSON 经 npm 索引分发的"模板市场"模式(若 Murmur 未来做润色模板市场)。**许可最严,只可远观设计。**

---

## 3. 「转写 → AI 润色」同类管线调研摘要

> 先纠错:**whishper 无已实现 LLM 后处理**(main 分支翻译走 LibreTranslate,v4 分支 `SummarizeText` 是 TODO 空壳);**noScribe 无 GPT 清理**(`prompt.yml` 是 Whisper 反幻觉 initial prompt,内容是口语语气词例句)。两者均无可抄的润色代码。

### 3.1 mediar-ai/screenpipe meeting pipe(21k★,商业许可非 OSI,极活跃)——本组含金量最高

- **清洗与润色合一**的 system prompt(设计参考,文本不可抄):"improving speech-to-text transcription quality… preserving the original meaning… return only the improved text without any quotation marks"
- **「不添加原文没有的信息」的三重工程钳制**:语义保持指令 + 只输出结果指令 + `max_tokens = text.length * 2`(输出长度跟随输入)
- **vocabulary 修正表**:用户每次手动改词记为 `{original, corrected, timestamp}`,持久化(上限 1000 条),注入后续所有改进请求("Previous corrections: …")——**跨会话个性化纠错记忆**,与 Murmur 的说话人/专名修正场景天然适配(`storage-vocabulary.ts`)
- **润色可审计**:改进结果与原文做 `diffWords` 词级 diff,UI 高亮 AI 改动 + 原文可回退(`handle-new-chunk.ts`)
- **用户手动编辑过的块永不被自动改进**;只改进倒数第二个合并块(避免仍在增长的尾块)
- 说话人上下文以 `[speaker]: text` 行注入(与 Vibe、meetily 一致,是事实惯例)
- 基础设施纪律:`pThrottle` 全局 2 req/2s;429 指数退避、503 重试、401/400 不重试;失败静默回退原文

### 3.2 Amurex(2.9k★,AGPL,停滞一年)——增量 refine 长文策略

- 送 LLM 前**说话人分组合并预处理**(相邻同 speaker+message 去重 → 同说话人消息合并 → `speaker (timestamp)\nmessage` 格式化)
- 长文 = **增量 refine 累积链**(非 map-reduce):≤20000 词单次;超限按词切块,每块注入 "Notes so far: …",约束 _"Dont remove any points… Only add new points"_,输出 `{edited: true/false, notes}` 仅 edited 才更新(`amurex-backend/index.py`)
- 反面教材:prompt 里 JSON 混 HTML 脆弱(专门处理 `failed_generation` 异常)

### 3.3 Epicenter/Whispering(4.8k★,应用层 AGRL/工具层 MIT)——转换步骤链 + 运行历史

- Transformation = **有序步骤链**,步骤仅两类:`find_replace`(纯文本/正则)与 `prompt_transform`(LLM),**确定性清洗在前、LLM 在后**,每步输出是下一步输入
- **每次运行持久化**:`TransformationRun` + 每步 `RunStep`(input/output/error),UI 有 Runs 历史 + Test 试跑面板——"润色历史版本 + 可回溯中间产物"的最小可行设计
- 这是 Murmur「单次请求 + {text} 模板」最自然的升级路径

### 3.4 thewh1teagle/vibe(7.1k★,MIT,活跃)——唯一可直接借代码的项目

- 所有模板共享反废话前缀 `SYSTEM_RULE = 'Output only the requested content. No introductions, explanations, or commentary.'`
- 4 个内置模板按 `${lang}`(当前 UI 语言)参数化;模板 UI 可编辑,校验必须含 `%s` 占位符(与 Murmur `{text}` 校验同思路)
- segments → `[Speaker N] text` 行格式化 → 单次调用;统一 `Llm` 接口(Ollama/Claude/OpenAI 兼容)

### 3.5 长文处理三流派(横向结论)

| 流派                | 代表            | 机制                                      | 适用                        |
| ------------------- | --------------- | ----------------------------------------- | --------------------------- |
| map-reduce          | meetily(已调研) | 词边界切块 + overlap=100 → 逐块 → combine | 摘要类                      |
| 增量 refine 累积    | Amurex          | "so far" 注入 + 只增不减                  | 纪要/整理类,省 token 保前文 |
| 滚动缓冲 + 分层压缩 | screenpipe      | 50 词短笔记 → 500 词分析 → 100 词 → 50 词 | 实时场景                    |

Murmur 的「长文本整理」适合 Amurex 式累积或 meetily 式 map-reduce;**没有任何项目做严格的「先洗幻觉→再润色」两步链**,若做是差异化特性(可与已调研的 meetily 幻觉清洗器 `clean_repetitive_text()` 串联)。

---

## 4. 引擎与基础设施调研摘要

### 4.1 离线语法/文风引擎

| 引擎               | 中文支持                                                                                                 | 体量                                                            | 许可                | 结论                                                                 |
| ------------------ | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------- | -------------------------------------------------------------------- |
| LanguageTool       | **几乎为零**:仅 2 条规则(重复标点/连续空格),无 grammar.xml、无中文词典、标注器空实现;rephrase 仅云端付费 | JVM sidecar,仓库 >1.5GB                                         | LGPL-2.1+(词典另算) | **不引入**                                                           |
| harper(Automattic) | 无(有意设计,`IsolateEnglish` 把中文 mask 掉)                                                             | 二进制 8-14MB / wasm 74MB,内存约 LT 的 1/50                     | Apache-2.0          | 暂缓,仅英文兜底可选(harper.js 可直嵌渲染进程)                        |
| pycorrector        | **原生**(音似/形似错字、专名)                                                                            | MacBERT4CSC ~400MB,CPU 可跑(生产推荐);KenLM 需 2.8GB 不适合桌面 | Apache-2.0(模型同)  | **推荐试点**:复用嵌入式 Python sidecar,注意 HF 国内下载源(hf-mirror) |

定位必须是"无 LLM 时的错字兜底",不是润色——CSC 只纠错不改文风。

### 4.2 流式协议与 Electron 落地

- **Vercel AI SDK(Apache-2.0)的 `UIMessageChunk` 是现成协议标准**:tagged union——`start` → `text-start/delta/end`(id 支持多文本块)→ `finish(finishReason)`;**abort 与 error 是独立 chunk 类型**(区分用户取消与失败);`useChat` 传输层可替换(自定义 `ChatTransport`),即"主进程把上游 SSE 解析成 chunk 序列经 IPC 转发,渲染端适配回 chunk 流"全套 UI 逻辑可复用。Murmur 可直接采用该协议,或仅借鉴协议自实现(~200 行,更轻)
- cherry-studio 主进程侧三件套(见 2.2):streamId / 先订阅后 open / 16ms+2048 delta 合并;abort 只取消广播 reader、accumulator 自然排空(避免与上游 close 竞态)
- 反例 chatbox(GPL):LLM 请求在渲染进程直连(为支持 Web 版)——与 Murmur"SSRF 校验必须在主进程"冲突,不适用

### 4.3 diff 应用与部分接受

- **aider(Apache-2.0)的启示——但润色场景不需要让 LLM 输出 SEARCH/REPLACE**:LLM 直接输出润色全文,本地 `diff-match-patch`(aider 同款算法的 npm 版)做**行级 diff** 生成逐段 hunk,每段作为最小接受单元。可迁移三点:①段落级 hunk 粒度;②确定性应用 + 级联容错(空白/缩进差异容忍——中文转写文本同样常见);③失败回喂重试循环(reflection,上限 3)
- **immersive-translate(闭源)的对照 UI 模式**(CSS 类名考古):块级 wrapper(译文作为新块插入原文后)+ 行内两种粒度;对照样式多主题可切换;每段独立 loading/error 状态,失败不阻塞全文

### 4.4 学术润色 prompt(gpt_academic,71.2k★,GPL-3.0)

- **"润色结果 + markdown 修改表"双输出结构**(先更正版本,再表格列修改与理由)——可对齐 Murmur 的 diff+理由 UI
- 校对 prompt 的 **few-shot 输出契约**:"Do not try to polish the text, if no mistake is found, tell me this paragraph is good"——明确"未发现错误"路径,避免无错硬改(对转写校对场景重要)
- "Do not modify any latex command…"式**保护非 prose 标记**指令 → 迁移为保护转写文本中的标点/格式约定
- 长文分块:按 token 上限、**双空行优先 → 换行 → 暴力切**,按序拼回,**写新文件不覆盖原文**
- GPL-3.0:prompt 逐字照抄有许可争议,需改写

---

## 5. 引入建议(按优先级)

### P0 — prompt 与管线补强(当前架构内,低成本高收益)

| #   | 建议                                                                                                                                                                                                                                                             | 来源                                     | 说明                                                                                           |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 1   | **Prompt 工程补强包**:全部内置模式加统一反废话前缀(Vibe `SYSTEM_RULE` 式);optimize/correct 加 2-3 组中文 few-shot(Easydict 式);correct 加"未发现错误就明说"契约(gpt_academic);转写文本用 XML 标签包裹 + 注入防护文案(cherry-studio;转写内容可能含"忽略以上指令") | Vibe/Easydict/cherry-studio/gpt_academic | 纯 prompt 文本改写(注意 GPL 来源需改写不可照抄),`aiPrompts.ts` 单文件改动,TDD 覆盖 buildPrompt |
| 2   | **竞态防护 + 取消语义**:连续润色请求的 generation 代际失效(Easydict);AbortError 静默不算错误(oat/Easydict)                                                                                                                                                       | Easydict/oat                             | 配合流式做;即使非流式也可先做代际                                                              |
| 3   | **max_tokens 跟随输入长度钳制**:optimize/correct 类最小修改模式按 `输入长度×系数` 封顶,防止重写失控                                                                                                                                                              | screenpipe                               | 一行公式;重写类模式(xiaohongshu 等)不适用                                                      |
| 4   | **模型列表端点推导**:base_url → `/models` 智能改写,设置页模型下拉自动填充(Easydict)                                                                                                                                                                              | Easydict                                 | 泛化现有 detectLocalModels;已有 checkAIStatus 测试按钮是现成基础                               |
| 5   | **说话人上下文注入**:diarize 后的转写以 `[说话人N]: text` 行格式送润色 prompt(Vibe/screenpipe/meetily 事实惯例)                                                                                                                                                  | Vibe/screenpipe                          | Murmur 已有 CAM++ 分离结果,数据现成只差拼装                                                    |

### P1 — 流式输出 + diff 对照(核心体验升级,差异化)

| #   | 建议                                                                                                                                                                                                                                             | 来源                                                                            | 说明                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 6   | **流式三件套**:主进程解析上游 SSE → `UIMessageChunk` 式分类 chunk(text-delta/abort/error/finish)经定向 `webContents.send` 转发;渲染端**先订阅再发起**;abort IPC;**16ms/2048 字符 delta 合并窗口**防 IPC 洪泛;主进程 tee 一路持久化(渲染崩溃不丢) | cherry-studio 机制 + Vercel AI SDK 协议(Apache-2.0)                             | 新 IPC 常量进 `ipc-contracts.ts`,新 handler 注册进 `ipc/index.ts`;协议可自实现或引入 ai 包 |
| 7   | **流式能力探测与自动降级**:对用户配置的 base_url 先探测 SSE 支持(非 `text/event-stream` 即回退非流式并持久化该偏好 + 提示)                                                                                                                       | Easydict                                                                        | Murmur 用户大量用国内中转网关,此问题是高频现实                                             |
| 8   | **diff 对照 + 逐段接受(差异化核心)**:LLM 输出润色全文 → 本地 `diff-match-patch` 行级 diff → 块级 wrapper UI(原文段落后插入润色段,高亮改动,每段接受/拒绝,多主题样式,每段独立状态)                                                                 | aider 算法(Apache-2.0)+ immersive-translate UI 模式 + screenpipe diffWords 审计 | **全部调研项目无一做到**;与转写场景(必须核对原文)天然契合;失败/截断带错误回喂重试(上限 3)  |
| 9   | **vocabulary 修正表**:用户在 diff 界面拒绝/修改的地方记为 `{original→corrected}`,持久化注入后续 prompt("Previous corrections: …")                                                                                                                | screenpipe(设计参考,文本自写)                                                   | 与 #8 联动后自然产生数据;上限条数 + 按项目隔离                                             |
| 10  | **用户编辑过的段落不再自动润色**                                                                                                                                                                                                                 | screenpipe                                                                      | 防止自动润色覆盖人工修正,信任感关键                                                        |
| 11  | **长文分块**:「长文本整理/摘要」模式超过阈值(参考 2 万词)时按段落边界优先切块;整理类用"so far 只增不减"累积链,摘要类用 map-reduce                                                                                                                | Amurex + gpt_academic + meetily(已调研)                                         | 消除长转写 max_tokens 截断问题(现有 8192 默认值的根治方案)                                 |
| 12  | **模板系统升级**:占位符扩到 `{text}/{lang}/{speakers}` 等;prompt 内含 `{text}` 时不重复附原文(oat);设置页 UI 编辑(400ms 防抖 + 默认值重置 + 多条消息 promptList)                                                                                 | oat/cherry-studio/pot                                                           | 现有 `templates/*.md` 向后兼容;注意设置 4 处规则与 ALLOWED_SETTING_KEYS                    |

### P2 — 扩展能力

| #   | 建议                                                                                                                                              | 来源                              | 说明                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ---------------------------------------------------- |
| 13  | **pycorrector MacBERT4CSC 中文错字兜底**:复用嵌入式 Python sidecar(与 FunASR 共享进程管理),~400MB 模型按需下载(hf-mirror),无 LLM/离线时的校对兜底 | pycorrector(Apache-2.0)           | 定位是兜底不是润色;CPU 推理对逐句够用                |
| 14  | **结果缓存 + 重新生成**:全指纹缓存 key(provider+model+模式+文本),重复润色零成本;重试/重生成绕过缓存                                               | oat                               | 与 token 统计(现有 usage 字段已采集)联动可做成本展示 |
| 15  | **转换步骤链 + 运行历史**:正则清洗在前、LLM 在后的步骤链;每次运行含每步 input/output 落库,Runs 历史 + 试跑面板                                    | Whispering/Epicenter(AGPL,仅借鉴) | 模板系统的终态;配合 #12 分阶段演进                   |
| 16  | **harper.js 英文兜底**:渲染进程 WASM 直嵌,无 sidecar;对中英混排文本的英文片段做检查                                                               | harper(Apache-2.0)                | 优先级低,仅英文场景有价值                            |
| 17  | **润色模板市场**:mask JSON + npm 索引分发的安装模式                                                                                               | lobe-chat(仅模式参考)             | 远期;社区生态方向                                    |

### 明确不建议引入

| 项                             | 理由                                                                                                                             |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| LanguageTool 嵌入              | 中文仅 2 条规则(空壳),JVM sidecar + 1.5GB 仓库 + LGPL/词典多重合规,零收益高成本                                                  |
| 渲染进程直连 LLM(chatbox 模式) | 与 Murmur SSRF 校验必须在主进程的架构冲突                                                                                        |
| Vercel AI SDK 整包强绑         | 可用其协议(Apache-2.0),但 ai@6+patch 的维护成本对 Murmur 单一场景过重;自实现 chunk 协议 ~200 行更符合"本地优先最小依赖"          |
| 复制任何 AGPL/GPL 项目代码     | cherry-studio/openai-translator/pot/Easydict/Whispering/Amurex/whishper/gpt_academic 全部强传染;prompt 逐字照抄亦有争议,一律改写 |
| screenpipe 任何文本(含 prompt) | 商业许可非 OSI,连 prompt 照抄都有风险                                                                                            |
| VibeASR/whisper 类换引擎路线   | 与本调研正交,见已归档的 VibeVoice/meetily 调研结论(中文 Paraformer 领先,不换)                                                    |

---

## 6. 许可风险备忘

| 项目                                                                             | 许可                                        | 可借鉴范围                                      |
| -------------------------------------------------------------------------------- | ------------------------------------------- | ----------------------------------------------- |
| vibe(thewh1teagle)                                                               | **MIT**                                     | **唯一可直接复制代码的项目**                    |
| vercel/ai、aider、harper、pycorrector                                            | Apache-2.0                                  | 代码/算法/协议可放心采用与改造                  |
| openai-translator、cherry-studio、Whispering/Epicenter(应用层)、Amurex、whishper | AGPL-3.0                                    | 仅架构模式与交互设计,prompt 文案改写,零代码复制 |
| pot-desktop、Easydict、noScribe、gpt_academic                                    | GPL-3.0                                     | 同上                                            |
| screenpipe                                                                       | 商业许可(个人/非商业免费)                   | 仅设计参考,任何文本不抄                         |
| lobe-chat                                                                        | Apache-2.0 + 附加商业条款(分发衍生品需授权) | 仅远观设计                                      |
| immersive-translate                                                              | 闭源                                        | 仅公开 CSS 类名结构思路                         |

---

## 附录:关键文件引用索引

**Murmur 基线**

- `src/helpers/aiPrompts.ts:28-103,101-473` — 模板解析、14 内置模式
- `src/helpers/ipc/aiHandlers.ts:191-225,256-422,424-567` — postChatCompletion、processTextWithAI、checkAIStatus
- `src/helpers/providerPresets.ts:25-132`、`src/helpers/detectLocalModels.ts:19-34` — 提供商预设与本地探测
- `src/components/TranscriptionResult.tsx:111-145`、`src/hooks/useRecording.ts:230-270` — 手动/自动润色调用与 race 超时
- `src/settings/sections/AIConfigSection.tsx:435` — 连接测试 UI

**openai-translator**(yetone/openai-translator)

- `src/common/translate.ts`(prompt 全集与变量逻辑)、`src/common/engines/abstract-openai.ts` + `interfaces.ts`(引擎抽象与模型族分支)、`src/common/utils.ts:405`(fetchSSE/eventsource-parser)、`src-tauri/src/fetch.rs:54-139`(流式转发与 abort)、`src/common/internal-services/action.ts`(自定义 Action)

**cherry-studio**(CherryHQ/cherry-studio)

- `src/renderer/utils/translate/translateText.ts`(先订阅后 open/abort IPC)、`src/main/services/translate/translateService.ts`(主进程持久化)、`src/main/ai/streamManager/{AiStreamManager,pipeStreamLoop}.ts`、`src/main/ai/streamManager/listeners/WebContentsListener.ts`(16ms/2048 合并)、`src/renderer/hooks/useSmoothStream.ts`(抖动缓冲)、`src/renderer/pages/translate/TranslateSettings.tsx`(模板 UI)、`src/shared/ai/prompts.ts:50`(XML 包裹 + 注入防护)

**pot-desktop**(pot-app/pot-desktop)

- `src/services/translate/openai/index.jsx`(SSE 手动解析/尾标光标)、`src/services/translate/openai/Config.jsx`(promptList/保存即测试)

**Easydict**(tisfeng/Easydict)

- `Easydict/Swift/Service/AITool/PolishingService.swift`(润色 few-shot)、`Easydict/Swift/Service/OpenAI/StreamService.swift`(代际/优雅取消)、`BaseOpenAIService.swift`(流式降级/模型列表推导)

**转写管线组**

- screenpipe `pipes/meeting/src/components/live-transcription/hooks/{ai-improve-chunk-transcription,handle-new-chunk,ai-create-note-based-on-chunk,ai-meeting-summary,ai-client,storage-vocabulary}.ts`
- Amurex `amurex-backend/index.py`(增量 refine 链)、`extension/sidepanels/sidepanel.js`(说话人合并预处理)
- Whispering `apps/whispering/src/lib/query/transformer.ts`、`services/db/models/transformations.ts`(步骤链与运行历史)
- vibe `desktop/src/lib/{prompt-templates,llm/,transcript.ts}`、`desktop/src/pages/home/hooks/use-summarization.ts`
- noScribe `prompt.yml` / `prompt_nd.yml`(Whisper 反幻觉 initial prompt、口语词开关)

**引擎与基础设施**

- LanguageTool `languagetool-language-modules/zh/src/main/java/org/languagetool/language/Chinese.java`(仅 2 规则)
- harper `harper-ls/src/backend.rs`、`harper-wasm/src/lib.rs`
- pycorrector `pycorrector/macbert/macbert_corrector.py`
- vercel/ai `packages/ai/src/ui-message-stream/ui-message-chunks.ts`(UIMessageChunk 协议)
- aider `aider/coders/{editblock_prompts,search_replace}.py`(block 格式、flexible 匹配级联)、`aider/coders/base_coder.py`(reflection)
- gpt_academic `core_functional.py`(润色/校对 prompt)、`crazy_functions/pdf_fns/breakdown_txt.py`(分块)
