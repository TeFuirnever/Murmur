// [20260724_TS_BigBang_AIHandlers] Migrated from .js to .ts (ADR-010).
// `module.exports = { register, processTextWithAI, ... }` (named) became
// named exports. Lazy require("electron") for templatesDir kept as require
// (import is hoisted; the lazy require defers electron load to call time).
import path from "path";
import * as C from "../ipc-contracts";
import { buildPrompt, loadCustomTemplates } from "../aiPrompts";
import type { PromptTemplate } from "../aiPrompts";
import { getProviderPresets } from "../providerPresets";
import { detectLocalModels } from "../detectLocalModels";

interface Logger {
  info?(message: string, ...args: unknown[]): void;
  warn?(message: string, ...args: unknown[]): void;
  error?(message: string, ...args: unknown[]): void;
}

interface DatabaseManager {
  getSetting(key: string): Promise<unknown>;
}

interface AIMode {
  name: string;
  label: string;
  description: string;
}

interface AIResult {
  success: boolean;
  text?: string;
  error?: string;
  usage?: unknown;
  model?: string;
}

const BUILT_IN_MODES: AIMode[] = [
  {
    name: "optimize",
    label: "智能润色",
    description: "优化文本流畅度和表达，适合日常录音",
  },
  {
    name: "optimize_long",
    label: "长文本整理",
    description: "结构化整理长文本，保留完整信息",
  },
  { name: "format", label: "格式化", description: "整理文本排版和段落结构" },
  { name: "correct", label: "校对纠错", description: "修正语法错误和拼写问题" },
  {
    name: "summarize",
    label: "摘要总结",
    description: "提取文本核心要点生成摘要",
  },
  {
    name: "enhance",
    label: "内容优化",
    description: "增强文本内容的深度和表现力",
  },
  {
    name: "xiaohongshu",
    label: "小红书风格",
    description: "转换为小红书笔记风格，emoji丰富、亲切分享、互动感强",
  },
  {
    name: "zhihu",
    label: "知乎风格",
    description: "转换为知乎深度回答风格，结构化论述、专业权威",
  },
  {
    name: "douyin",
    label: "抖音风格",
    description: "转换为抖音口播文案风格，短句节奏、勾子开头、口语化",
  },
  {
    name: "de-ai",
    label: "去AI化",
    description: "消除AI写作痕迹，让文本自然有人味，保留原意",
  },
];

const TEMPLATE_CACHE_TTL_MS = 30_000;
let templateCache: {
  dir: string | null;
  time: number;
  templates: PromptTemplate[];
} = {
  dir: null,
  time: 0,
  templates: [],
};

function getCachedTemplates(templatesDir: string): PromptTemplate[] {
  const now = Date.now();
  if (
    templateCache.dir === templatesDir &&
    now - templateCache.time < TEMPLATE_CACHE_TTL_MS
  ) {
    return templateCache.templates;
  }
  const templates = loadCustomTemplates(templatesDir);
  templateCache = { dir: templatesDir, time: now, templates };
  return templates;
}

export function getAIModes(templatesDir: string): AIMode[] {
  const custom = getCachedTemplates(templatesDir);
  const customNames = new Set(custom.map((t) => t.name));
  const builtIn = BUILT_IN_MODES.filter((m) => !customNames.has(m.name));
  return [
    ...builtIn,
    // [20260724_TS_BigBang_AIHandlers] PromptTemplate has no `description`
    // field in the type (only name/label/system/user). The .js referenced
    // t.description which was always undefined; map to "" to preserve shape.
    ...custom.map((t) => ({
      name: t.name,
      label: t.label,
      description: "",
    })),
  ];
}

function isLocalhost(host: string | null | undefined): boolean {
  if (!host) return false;
  host = host.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "0.0.0.0" || host === "::1" || host === "[::1]") return true;
  if (/^127\./.test(host)) return true;
  return false;
}

function isPrivateNetwork(host: string): boolean {
  if (!host) return false;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  if (/^169\.254\./.test(host)) return true;
  return false;
}

export function validateAIBaseUrl(
  baseUrl: string,
  { allowLocalhost = false }: { allowLocalhost?: boolean } = {},
): boolean {
  try {
    const url = new URL(baseUrl);
    const host = url.hostname.toLowerCase();
    if (!host) return false;

    if (allowLocalhost && isLocalhost(host)) {
      return url.protocol === "http:" || url.protocol === "https:";
    }

    if (url.protocol !== "https:") return false;
    if (isLocalhost(host)) return false;
    if (isPrivateNetwork(host)) return false;
    return true;
  } catch {
    return false;
  }
}

// [20260815_Refactor_AiFetchDedup] processTextWithAI and checkAIStatus used
// to hand-roll the same sequence: auth headers, AbortController + timeout,
// fetch, AbortError→TIMEOUT mapping, and non-OK error-body parsing. The three
// helpers below carry that shared plumbing so the callers only keep their
// genuinely different parts (request shape, response interpretation, and the
// user-facing error text).
// [20260815_Refactor_AiFetchDedup] END

function isLocalBaseUrl(baseUrl: string): boolean {
  try {
    return isLocalhost(new URL(baseUrl).hostname);
  } catch {
    return false;
  }
}

interface ChatCompletionMessage {
  role: string;
  content: string;
}

interface ChatCompletionRequest {
  model: string;
  messages: ChatCompletionMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

async function postChatCompletion(
  baseUrl: string,
  apiKey: string | undefined,
  body: ChatCompletionRequest,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (fetchError) {
    clearTimeout(timeoutId);
    if ((fetchError as Error).name === "AbortError") {
      throw Object.assign(new Error(timeoutMessage), { code: "TIMEOUT" });
    }
    throw fetchError;
  }
  clearTimeout(timeoutId);
  return response;
}

/**
 * Extract the human-readable message from an OpenAI-style error body.
 * Returns "" when the body has no usable message; the caller supplies its
 * own status-code fallback text.
 */
function extractAIErrorMessage(
  response: Response,
  errorText: string,
  logger?: Logger,
): string {
  let errorData: { error?: { message?: string } | string } = {
    error: response.statusText,
  };
  try {
    errorData = JSON.parse(errorText);
  } catch {
    logger?.warn?.(
      "AI错误响应非JSON格式:",
      (errorText || "").substring(0, 200),
    );
    errorData = { error: errorText || response.statusText };
  }
  return (
    (typeof errorData.error === "object"
      ? errorData.error?.message
      : errorData.error) || ""
  );
}

export async function processTextWithAI(
  text: string,
  mode: string,
  databaseManager: DatabaseManager,
  logger: Logger,
  options: Record<string, unknown> = {},
): Promise<AIResult> {
  try {
    const apiKey = (await databaseManager.getSetting("ai_api_key")) as
      | string
      | undefined;
    const baseUrl =
      ((await databaseManager.getSetting("ai_base_url")) as string) ||
      "https://api.openai.com/v1";
    const isLocal = isLocalBaseUrl(baseUrl);

    if (!apiKey && !isLocal) {
      return {
        success: false,
        error: "请先在设置页面配置AI API密钥",
      };
    }

    const model =
      ((await databaseManager.getSetting("ai_model")) as string) ||
      "gpt-3.5-turbo";
    const temperature =
      parseFloat(
        (await databaseManager.getSetting("ai_temperature")) as string,
      ) || 0.3;
    // [20260815_Fix_AiMaxTokensDefault] 8192 fallback matches the renderer
    // DEFAULT_SETTINGS — reasoning models count thinking tokens against
    // max_tokens; the old 2000 could be exhausted by reasoning alone.
    const maxTokens =
      parseInt(
        (await databaseManager.getSetting("ai_max_tokens")) as string,
        10,
      ) || 8192;

    if (!validateAIBaseUrl(baseUrl, { allowLocalhost: isLocal })) {
      return {
        success: false,
        error: "请填写有效的 https API 地址（不支持 http 或内网地址）",
      };
    }

    let system: string, user: string;
    if (options.systemPrompt && options.userPrompt) {
      system = options.systemPrompt as string;
      user = options.userPrompt as string;
    } else {
      const customTemplates = options.templatesDir
        ? getCachedTemplates(options.templatesDir as string)
        : [];
      ({ system, user } = buildPrompt(mode, text, { customTemplates }));
    }

    const requestData = {
      model: model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: temperature,
      max_tokens: maxTokens,
      stream: false,
    };

    logger.info?.("AI文本处理请求:", {
      baseUrl,
      model,
      mode,
      inputLength: text.length,
    });

    const timeoutMs =
      (options.timeout as number) || (isLocal ? 180_000 : 150_000);
    const response = await postChatCompletion(
      baseUrl,
      apiKey,
      requestData,
      timeoutMs,
      `AI请求超时（${Math.round(timeoutMs / 1000)}秒），请尝试缩短文本或检查网络`,
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        extractAIErrorMessage(response, errorText, logger) ||
          `AI服务请求失败 (${response.status})`,
      );
    }

    const data = (await response.json()) as {
      choices?: Array<{
        message?: { content?: string };
        finish_reason?: string;
      }>;
      usage?: unknown;
    };

    logger.info?.("AI文本处理响应:", {
      status: response.status,
      outputLength: data.choices?.[0]?.message?.content?.length || 0,
      usage: data.usage,
    });

    if (data.choices && data.choices.length > 0) {
      // [20260815_Fix_AiEmptyContent] Reasoning models (e.g. deepseek-v4-flash)
      // can spend the entire max_tokens budget on reasoning before emitting
      // any content: HTTP 200, choices present, message.content empty,
      // finish_reason "length" (production logs 2026-08-15: reasoning_tokens
      // 2000 == completion_tokens == max_tokens). Returning success with empty
      // text made the UI show a generic "AI处理失败，请重试" with no cause.
      const content = data.choices[0]?.message?.content?.trim() || "";
      if (!content) {
        const usage = data.usage as { completion_tokens?: number } | undefined;
        const tokenCapHit =
          data.choices[0]?.finish_reason === "length" ||
          (usage?.completion_tokens !== undefined &&
            usage.completion_tokens >= maxTokens);
        const error = tokenCapHit
          ? `AI输出为空：模型推理占满了 max_tokens（${maxTokens}）预算，请在设置中调大「AI 配置 → 最大输出长度」或换用非推理模型`
          : "AI返回了空内容，请重试或更换模型";
        logger.error?.("AI返回空内容:", {
          finish_reason: data.choices[0]?.finish_reason,
          usage: data.usage,
          maxTokens,
        });
        return { success: false, error };
      }
      const result: AIResult = {
        success: true,
        text: content,
        usage: data.usage,
        model: model,
      };

      logger.info?.("AI文本处理结果:", {
        inputLength: text.length,
        outputLength: result.text?.length || 0,
        usage: result.usage,
      });

      return result;
    } else {
      logger.error?.("AI API返回数据格式错误:", undefined);
      return { success: false, error: "AI API返回数据格式错误" };
    }
  } catch (error) {
    logger.error?.("AI文本处理失败:", error);

    const err = error as Error & { code?: string };
    let errorMessage = "文本处理失败";
    if (err.code === "TIMEOUT" || err.name === "AbortError") {
      errorMessage = err.message || "请求超时，请检查网络连接";
    } else if (err.code === "ENOTFOUND") {
      errorMessage = "无法连接到AI服务器，请检查网络";
    } else {
      errorMessage = err.message || "未知错误";
    }
    // [20260815_Refactor_AiFetchDedup] The ECONNABORTED branch was an axios
    // error code this fetch-based code path can never produce.

    return { success: false, error: errorMessage };
  }
}

export async function checkAIStatus(
  testConfig: {
    ai_api_key?: string;
    ai_base_url?: string;
    ai_model?: string;
  } | null,
  databaseManager: DatabaseManager,
  logger: Logger,
): Promise<{
  available: boolean;
  error?: string;
  details?: string;
  model?: string;
  status?: string;
  response?: string;
  usage?: unknown;
}> {
  try {
    logger.info?.(
      "开始测试AI配置...",
      testConfig ? "使用临时配置" : "使用已保存配置",
    );

    let apiKey: string | undefined, baseUrl: string, model: string;

    if (testConfig) {
      apiKey = testConfig.ai_api_key;
      baseUrl = testConfig.ai_base_url || "https://api.openai.com/v1";
      model = testConfig.ai_model || "gpt-3.5-turbo";
      logger.info?.("使用临时测试配置:", { baseUrl, model });
    } else {
      apiKey = (await databaseManager.getSetting("ai_api_key")) as
        | string
        | undefined;
      baseUrl =
        ((await databaseManager.getSetting("ai_base_url")) as string) ||
        "https://api.openai.com/v1";
      model =
        ((await databaseManager.getSetting("ai_model")) as string) ||
        "gpt-3.5-turbo";
      logger.info?.("使用已保存配置:", { baseUrl, model });
    }

    const isLocal = isLocalBaseUrl(baseUrl);

    if (!apiKey && !isLocal) {
      logger.warn?.("AI测试失败: 未配置API密钥");
      return {
        available: false,
        error: "未配置API密钥",
        details: "请输入AI API密钥",
      };
    }

    if (!validateAIBaseUrl(baseUrl, { allowLocalhost: isLocal })) {
      return {
        available: false,
        error: "请填写有效的 https API 地址（不支持 http 或内网地址）",
        details: "请确认 API 地址为有效的 https 端点",
      };
    }

    logger.info?.("AI配置信息:", { baseUrl, model });

    const requestData = {
      model: model,
      messages: [
        { role: "user", content: '请回复"测试成功"来确认AI服务正常工作' },
      ],
      max_tokens: 50,
      temperature: 0.1,
    };

    logger.info?.("发送AI测试请求:", requestData);

    const response = await postChatCompletion(
      baseUrl,
      apiKey,
      requestData,
      15_000,
      "请求超时，请检查网络连接",
    );

    logger.info?.("AI API响应状态:", response.status);

    if (!response.ok) {
      const errorText = await response.text();
      logger.error?.("AI API错误响应:", errorText);

      let errorMessage =
        extractAIErrorMessage(response, errorText) || `HTTP ${response.status}`;
      if (response.status === 401) errorMessage = "API密钥无效或已过期";
      else if (response.status === 403) errorMessage = "API密钥权限不足";
      else if (response.status === 429) errorMessage = "API调用频率超限";
      else if (response.status === 500) errorMessage = "AI服务器内部错误";

      throw new Error(errorMessage);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: unknown;
    };
    logger.info?.("AI API成功响应:", data);

    if (!data.choices || data.choices.length === 0) {
      throw new Error("AI API返回格式异常：缺少choices字段");
    }

    const aiResponse = data.choices[0]?.message?.content || "";
    logger.info?.("AI回复内容:", aiResponse);

    return {
      available: true,
      model: model,
      status: "connected",
      response: aiResponse,
      usage: data.usage,
      details: `成功连接到 ${model}，响应时间正常`,
    };
  } catch (error) {
    logger.error?.("AI配置测试失败:", error);

    const err = error as Error & { code?: string };
    let errorMessage = "连接失败";
    if (err.code === "TIMEOUT") errorMessage = err.message;
    else if (err.message.includes("401")) errorMessage = "API密钥无效";
    else if (err.message.includes("403")) errorMessage = "API密钥权限不足";
    else if (err.message.includes("429")) errorMessage = "API调用频率超限";
    else if (err.message.includes("ENOTFOUND"))
      errorMessage = "无法连接到AI服务器，请检查网络和Base URL";
    else if (err.message.includes("ECONNREFUSED"))
      errorMessage = "连接被拒绝，请检查Base URL是否正确";
    else if (err.message.includes("timeout"))
      errorMessage = "请求超时，请检查网络连接";
    else errorMessage = err.message || "未知错误";

    return {
      available: false,
      error: errorMessage,
      details: `测试失败原因: ${err.message}`,
    };
  }
}

interface Managers {
  databaseManager: DatabaseManager;
  logger: Logger;
  templatesDir?: string;
}

export function register(ipcMain: Electron.IpcMain, managers: Managers): void {
  const { databaseManager, logger } = managers;
  const templatesDir =
    managers.templatesDir ||
    (() => {
      // [20260724_TS_BigBang_LazyRequire] Lazy require("electron") — import is
      // hoisted and would load electron at module init, but this is only needed
      // when register() is called in the Electron main process.
      const { app } = require("electron");
      return path.join(app.getPath("userData"), "templates");
    })();
  // [20260724_TS_BigBang_LazyRequire] END

  ipcMain.handle(
    C.AI.PROCESS,
    async (_event, text: string, mode = "optimize", timeout?: number) => {
      return await processTextWithAI(text, mode, databaseManager, logger, {
        templatesDir,
        timeout,
      });
    },
  );

  ipcMain.handle(
    C.AI.CHECK_STATUS,
    async (
      _event,
      testConfig: {
        ai_api_key?: string;
        ai_base_url?: string;
        ai_model?: string;
      } | null = null,
    ) => {
      return await checkAIStatus(testConfig, databaseManager, logger);
    },
  );

  ipcMain.handle(C.AI.GET_MODES, async () => {
    return getAIModes(templatesDir);
  });

  ipcMain.handle(C.AI.GET_PROVIDER_PRESETS, async () => {
    return getProviderPresets();
  });

  ipcMain.handle(C.AI.DETECT_LOCAL_MODELS, async () => {
    return await detectLocalModels();
  });
}
// [20260724_TS_BigBang_AIHandlers] END
