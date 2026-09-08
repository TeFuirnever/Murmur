# T5 流式可行性 Spike 结论文档(Spec #193, ticket #232)

日期:2026-09-08 | 执行环境:macOS arm64,Electron 39.8.10(仓库依赖),Ollama 本机 + qwen3.5-2b-ov-vision / ov_intent_analysis_sft
状态:**研究完成,不改任何 src/ 生产代码**(spike 脚本均在 /tmp,证据逐项内联)

| #   | 项                                       | 结论                                                          |
| --- | ---------------------------------------- | ------------------------------------------------------------- |
| ①   | Electron 主进程 fetch 流式               | **VERIFIED**                                                  |
| ②   | 本地 LLM(Ollama/LM Studio)流式/取消/降级 | **Ollama VERIFIED(含重要警告)/ LM Studio UNVERIFIED(未安装)** |
| ③   | diff 库选型                              | **VERIFIED — 选定 diff-match-patch 主端口 + 薄封装适配层**    |
| ④   | eventsource-parser v3 ESM 打包           | **VERIFIED**                                                  |
| ⑤   | 国内中转网关失败形态采样                 | **PARTIAL(2 家已采样,方法可复用)**                            |

---

## ① Electron 主进程 fetch 流式读取 — VERIFIED

实测(Electron 39.8.10 主进程,`/tmp/t5-spike/electron-main-spike.js`,对 Ollama SSE):

- `response.body.getReader()` 可用(`function`),`body.locked=true` 符合预期;
- **增量读取为真**:568 次 read / 136KB / 首字节 163ms(qwen 流式,think 关闭)——不是一次性缓冲;
- AbortSignal 取消:88ms 内 read 以 AbortError 中断,`signal.aborted=true`。

**T8 依据**:主进程可直接用 `getReader()` 逐块解析 SSE,无需额外依赖(eventsource-parser 仅做帧解析,见 ④)。

## ② 本地 LLM 流式/取消/降级 — Ollama VERIFIED(含设计级警告)

OpenAI 兼容端点 `http://localhost:11434/v1/chat/completions`:

- **流式**:标准 SSE(`data: {chunk}\n\n`,终止帧 `[DONE]`);首字节 110–163ms;增量速率 ~15 块/秒。
- **取消**:`AbortController.abort()` 中断 read,74–118ms 生效;Ollama 服务端同步停止生成。
- **降级**:`stream:false` 返回标准 completion JSON,可直接作为非流式回退。
- **⚠️ 思考模型警告(T8/T12 设计输入)**:qwen3.5-2b(思考模型)在 OpenAI 兼容端点先发 `delta.reasoning`——实测 400/400 与 2000/2000 token 预算全部被 reasoning 消耗,`delta.content` 始终为空(内容饿死)。**解法已实测**:Ollama 原生 `/api/chat` 传 `think:false` 后 content 从 82ms 增量流出、730ms 完成。T8 必须二选一:(a) 本地 Ollama 走原生 API 并默认 `think:false`;(b) 兼容端点解析 `delta.reasoning` 并与 `delta.content` 分离呈现,且 max_tokens 预算需为 reasoning 留量。
- 另一非思考模型(ov_intent_analysis_sft)直接 content 流式正常(29 块/首 content 2015ms)。
- **LM Studio:UNVERIFIED**(本机未安装);其服务端同为 OpenAI 兼容形态,风险主要在思考模型语义,与 ② 的警告同源。

## ③ diff 库选型 — VERIFIED(选定 + 理由)

| 库                  | 版本  | 许可       | 维护        | 关键能力                                                                                           |
| ------------------- | ----- | ---------- | ----------- | -------------------------------------------------------------------------------------------------- |
| diff-match-patch    | 1.0.5 | Apache-2.0 | ~4 年未发布 | `Diff_Timeout` 超时旋钮、行模式(`diff_linesToChars_`/`diff_charsToLines_`)、`diff_cleanupSemantic` |
| diff-match-patch-es | 2.0.1 | Apache-2.0 | 活跃        | 函数式重写(diff/diffCharsToLines/diffCleanupSemantic),ESM                                          |
| diff-match-patch-ts | 2.0.0 | MIT        | —           | 类型化移植                                                                                         |
| fast-diff           | 1.3.0 | Apache-2.0 | 活跃        | 仅字符级 diff,无 semantic/超时/行模式 → **不满足 S4a 硬需求,排除**                                 |

**中文最小修改基准**(填充词删除/错字修正,500/1K/5K/20K 字符,毫秒):
dmp 2/1/10/86;fast-diff 1/1/6/71。**真实润色文本量级(≤2 万字符)两者均远低于预算,性能不是选型因子。**

**选型定论:diff-match-patch 主端口 + 仓库内薄封装适配层**(单文件暴露 diffMain/cleanupSemantic/timeout/line-mode 四能力)。理由:S4a 硬需求(超时显式设置、行模式前置、语义合并)只有 dmp 系完整提供;fast-diff 缺三能力排除;"4 年未发布"风险以锁版 + 薄封装缓解(适配层是唯一触点,必要时内部换 -es 的函数式实现零扩散)。API 混乱实勘:行模式返回 `{chars1, chars2, lineArray}` 且 `diff_charsToLines_` 需显式传 `lineArray`(文档未载,实测所得)。

## ④ eventsource-parser v3 ESM 打包 — VERIFIED

eventsource-parser@3.1.1(ESM-only,`type: module`)在 CommonJS 工程经 `esbuild --bundle --platform=node` 打包成功,产物以 `require("eventsource-parser")` 使用 `createParser` 解析 SSE 帧正确。**T8 可安全引入**。注:最新已到 4.1.0;建议锁 3.x 最新或评估 4.x breaking。

## ⑤ 国内中转网关失败形态采样 — PARTIAL

已采样两家(无 key,stream:true):

- AiHubMix(new-api 系):`HTTP 401` + JSON `{"error":{"message":"no key provided (tid:…)","type":"Aihubmix_api_error"}}`;
- OpenKey(one-api 系):`HTTP 401` + JSON `{"error":{"message":"未提供令牌 (request id:…)","type":"one_api_error"}}`。

**结论(降级判定设计输入)**:鉴权/配置类失败在**流开始前**以普通 JSON + 401 到达(即使请求带 stream:true)——T8/T10 的降级探测应以「非 200 或非 text/event-stream 响应头」为主信号,而不是解析 SSE 错误帧。更多网关与"流中途失败"形态需真实 key,标记待补样本。

## 供 T8/T12 的直接输入汇总

1. 主进程 fetch 流式与取消机制可用(①),取消通道经 AbortSignal 贯通(②)。
2. 思考模型 reasoning 洪流必须有产品级对策(②警告),且 max_tokens 预算核算含 reasoning。
3. diff 选型定论:dmp + 薄封装(③),超时旋钮与行模式能力已实测存在。
4. SSE 帧解析引入 eventsource-parser 无打包障碍(④)。
5. 降级判定信号:非 200 / 非 `text/event-stream` 响应头(⑤)。
