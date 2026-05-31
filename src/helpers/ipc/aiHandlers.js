const path = require("path");
const C = require("../ipc-contracts");
const { buildPrompt, loadCustomTemplates } = require("../aiPrompts");
const { getProviderPresets } = require("../providerPresets");
const { detectLocalModels } = require("../detectLocalModels");

const BUILT_IN_MODES = [
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
let templateCache = { dir: null, time: 0, templates: [] };

function getCachedTemplates(templatesDir) {
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

function getAIModes(templatesDir) {
  const custom = getCachedTemplates(templatesDir);
  const customNames = new Set(custom.map((t) => t.name));
  const builtIn = BUILT_IN_MODES.filter((m) => !customNames.has(m.name));
  return [
    ...builtIn,
    ...custom.map((t) => ({
      name: t.name,
      label: t.label,
      description: t.description || "",
    })),
  ];
}

function isLocalhost(host) {
  if (!host) return false;
  host = host.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "0.0.0.0" || host === "::1" || host === "[::1]") return true;
  if (/^127\./.test(host)) return true;
  return false;
}

function isPrivateNetwork(host) {
  if (!host) return false;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  if (/^169\.254\./.test(host)) return true;
  return false;
}

// Validate that the configured AI base URL is safe.
// When allowLocalhost is true (for local models like Ollama/LM Studio),
// localhost/loopback addresses and http protocol are allowed.
function validateAIBaseUrl(baseUrl, { allowLocalhost = false } = {}) {
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

async function processTextWithAI(
  text,
  mode,
  databaseManager,
  logger,
  options = {},
) {
  try {
    const apiKey = await databaseManager.getSetting("ai_api_key");
    const baseUrl =
      (await databaseManager.getSetting("ai_base_url")) ||
      "https://api.openai.com/v1";
    let isLocal = false;
    try {
      isLocal = isLocalhost(new URL(baseUrl).hostname);
    } catch {
      isLocal = false;
    }

    if (!apiKey && !isLocal) {
      return {
        success: false,
        error: "请先在设置页面配置AI API密钥",
      };
    }

    const model =
      (await databaseManager.getSetting("ai_model")) || "gpt-3.5-turbo";
    const temperature =
      parseFloat(await databaseManager.getSetting("ai_temperature")) || 0.3;
    const maxTokens =
      parseInt(await databaseManager.getSetting("ai_max_tokens"), 10) || 2000;

    if (!validateAIBaseUrl(baseUrl, { allowLocalhost: isLocal })) {
      return {
        success: false,
        error: "请填写有效的 https API 地址（不支持 http 或内网地址）",
      };
    }

    let system, user;
    if (options.systemPrompt && options.userPrompt) {
      system = options.systemPrompt;
      user = options.userPrompt;
    } else {
      const customTemplates = options.templatesDir
        ? getCachedTemplates(options.templatesDir)
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

    logger.info("AI文本处理请求:", {
      baseUrl,
      model,
      mode,
      inputLength: text.length,
    });

    const headers = { "Content-Type": "application/json" };
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60_000);

    let response;
    try {
      response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(requestData),
        signal: controller.signal,
      });
    } catch (fetchError) {
      clearTimeout(timeoutId);
      if (fetchError.name === "AbortError") {
        throw Object.assign(
          new Error("AI请求超时（60秒），请尝试缩短文本或检查网络"),
          { code: "TIMEOUT" },
        );
      }
      throw fetchError;
    }
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      let errorData = { error: response.statusText };
      try {
        errorData = JSON.parse(errorText);
      } catch {
        logger.warn(
          "AI错误响应非JSON格式:",
          (errorText || "").substring(0, 200),
        );
        errorData = { error: errorText || response.statusText };
      }
      throw new Error(
        errorData.error?.message ||
          errorData.error ||
          `AI服务请求失败 (${response.status})`,
      );
    }

    const data = await response.json();

    logger.info("AI文本处理响应:", {
      status: response.status,
      outputLength: data.choices?.[0]?.message?.content?.length || 0,
      usage: data.usage,
    });

    if (data.choices && data.choices.length > 0) {
      const result = {
        success: true,
        text: data.choices[0].message.content.trim(),
        usage: data.usage,
        model: model,
      };

      logger.info("AI文本处理结果:", {
        inputLength: text.length,
        outputLength: result.text.length,
        usage: result.usage,
      });

      return result;
    } else {
      logger.error("AI API返回数据格式错误:", response.data);
      return { success: false, error: "AI API返回数据格式错误" };
    }
  } catch (error) {
    logger.error("AI文本处理失败:", error);

    let errorMessage = "文本处理失败";
    if (error.code === "TIMEOUT" || error.name === "AbortError") {
      errorMessage = error.message || "请求超时，请检查网络连接";
    } else if (error.code === "ECONNABORTED") {
      errorMessage = "请求超时，请检查网络连接";
    } else if (error.code === "ENOTFOUND") {
      errorMessage = "无法连接到AI服务器，请检查网络";
    } else {
      errorMessage = error.message || "未知错误";
    }

    return { success: false, error: errorMessage };
  }
}

async function checkAIStatus(testConfig, databaseManager, logger) {
  try {
    logger.info(
      "开始测试AI配置...",
      testConfig ? "使用临时配置" : "使用已保存配置",
    );

    let apiKey, baseUrl, model;

    if (testConfig) {
      apiKey = testConfig.ai_api_key;
      baseUrl = testConfig.ai_base_url || "https://api.openai.com/v1";
      model = testConfig.ai_model || "gpt-3.5-turbo";
      logger.info("使用临时测试配置:", { baseUrl, model });
    } else {
      apiKey = await databaseManager.getSetting("ai_api_key");
      baseUrl =
        (await databaseManager.getSetting("ai_base_url")) ||
        "https://api.openai.com/v1";
      model = (await databaseManager.getSetting("ai_model")) || "gpt-3.5-turbo";
      logger.info("使用已保存配置:", { baseUrl, model });
    }

    let isLocal = false;
    try {
      isLocal = isLocalhost(new URL(baseUrl).hostname);
    } catch {
      isLocal = false;
    }

    if (!apiKey && !isLocal) {
      logger.warn("AI测试失败: 未配置API密钥");
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

    logger.info("AI配置信息:", { baseUrl, model });

    const requestData = {
      model: model,
      messages: [
        { role: "user", content: '请回复"测试成功"来确认AI服务正常工作' },
      ],
      max_tokens: 50,
      temperature: 0.1,
    };

    logger.info("发送AI测试请求:", requestData);

    const headers = { "Content-Type": "application/json" };
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15_000);

    let response;
    try {
      response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(requestData),
        signal: controller.signal,
      });
    } catch (fetchError) {
      clearTimeout(timeoutId);
      if (fetchError.name === "AbortError") {
        throw Object.assign(new Error("请求超时，请检查网络连接"), {
          code: "TIMEOUT",
        });
      }
      throw fetchError;
    }
    clearTimeout(timeoutId);

    logger.info("AI API响应状态:", response.status);

    if (!response.ok) {
      const errorText = await response.text();
      logger.error("AI API错误响应:", errorText);

      let errorData = { error: response.statusText };
      try {
        errorData = JSON.parse(errorText);
      } catch {
        errorData = { error: errorText || response.statusText };
      }

      let errorMessage =
        errorData.error?.message ||
        errorData.error ||
        `HTTP ${response.status}`;
      if (response.status === 401) errorMessage = "API密钥无效或已过期";
      else if (response.status === 403) errorMessage = "API密钥权限不足";
      else if (response.status === 429) errorMessage = "API调用频率超限";
      else if (response.status === 500) errorMessage = "AI服务器内部错误";

      throw new Error(errorMessage);
    }

    const data = await response.json();
    logger.info("AI API成功响应:", data);

    if (!data.choices || data.choices.length === 0) {
      throw new Error("AI API返回格式异常：缺少choices字段");
    }

    const aiResponse = data.choices[0].message?.content || "";
    logger.info("AI回复内容:", aiResponse);

    return {
      available: true,
      model: model,
      status: "connected",
      response: aiResponse,
      usage: data.usage,
      details: `成功连接到 ${model}，响应时间正常`,
    };
  } catch (error) {
    logger.error("AI配置测试失败:", error);

    let errorMessage = "连接失败";
    if (error.code === "TIMEOUT") errorMessage = error.message;
    else if (error.message.includes("401")) errorMessage = "API密钥无效";
    else if (error.message.includes("403")) errorMessage = "API密钥权限不足";
    else if (error.message.includes("429")) errorMessage = "API调用频率超限";
    else if (error.message.includes("ENOTFOUND"))
      errorMessage = "无法连接到AI服务器，请检查网络和Base URL";
    else if (error.message.includes("ECONNREFUSED"))
      errorMessage = "连接被拒绝，请检查Base URL是否正确";
    else if (error.message.includes("timeout"))
      errorMessage = "请求超时，请检查网络连接";
    else errorMessage = error.message || "未知错误";

    return {
      available: false,
      error: errorMessage,
      details: `测试失败原因: ${error.message}`,
    };
  }
}

function register(ipcMain, managers) {
  const { databaseManager, logger } = managers;
  const templatesDir =
    managers.templatesDir ||
    (() => {
      const { app } = require("electron");
      return path.join(app.getPath("userData"), "templates");
    })();

  ipcMain.handle(C.AI.PROCESS, async (event, text, mode = "optimize") => {
    return await processTextWithAI(text, mode, databaseManager, logger, {
      templatesDir,
    });
  });

  ipcMain.handle(C.AI.CHECK_STATUS, async (event, testConfig = null) => {
    return await checkAIStatus(testConfig, databaseManager, logger);
  });

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

module.exports = {
  register,
  processTextWithAI,
  checkAIStatus,
  validateAIBaseUrl,
  getAIModes,
};
