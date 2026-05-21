const C = require("../ipc-contracts");
const { buildPrompt } = require("../aiPrompts");

const ALLOWED_AI_DOMAINS = [
  "api.openai.com",
  "dashscope.aliyuncs.com",
  "api.bigmodel.cn",
  "open.bigmodel.cn",
];

function validateAIBaseUrl(baseUrl) {
  try {
    const url = new URL(baseUrl);
    return ALLOWED_AI_DOMAINS.some(
      (d) => url.hostname === d || url.hostname.endsWith(`.${d}`),
    );
  } catch {
    return false;
  }
}

async function processTextWithAI(text, mode, databaseManager, logger) {
  try {
    const apiKey = await databaseManager.getSetting("ai_api_key");
    if (!apiKey) {
      return {
        success: false,
        error: "请先在设置页面配置AI API密钥",
      };
    }

    const baseUrl =
      (await databaseManager.getSetting("ai_base_url")) ||
      "https://api.openai.com/v1";
    const model =
      (await databaseManager.getSetting("ai_model")) || "gpt-3.5-turbo";

    if (!validateAIBaseUrl(baseUrl)) {
      return { success: false, error: "不支持的API地址" };
    }

    const prompt = buildPrompt(mode, text);

    const requestData = {
      model: model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 2000,
      stream: false,
    };

    logger.info("AI文本处理请求:", {
      baseUrl,
      model,
      mode,
      inputText: text.substring(0, 100) + (text.length > 100 ? "..." : ""),
      requestData,
    });

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestData),
    });

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
      data: data,
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
        originalText:
          text.substring(0, 100) + (text.length > 100 ? "..." : ""),
        optimizedText:
          result.text.substring(0, 100) +
          (result.text.length > 100 ? "..." : ""),
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
    if (error.code === "ECONNABORTED") {
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
      model =
        (await databaseManager.getSetting("ai_model")) || "gpt-3.5-turbo";
      logger.info("使用已保存配置:", { baseUrl, model });
    }

    if (!apiKey) {
      logger.warn("AI测试失败: 未配置API密钥");
      return {
        available: false,
        error: "未配置API密钥",
        details: "请输入AI API密钥",
      };
    }

    if (!validateAIBaseUrl(baseUrl)) {
      return {
        available: false,
        error: "不支持的API地址",
        details: "仅支持 OpenAI、阿里云百炼、智谱 BigModel",
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

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestData),
    });

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
    if (error.message.includes("401")) errorMessage = "API密钥无效";
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

  ipcMain.handle(C.AI.PROCESS, async (event, text, mode = "optimize") => {
    return await processTextWithAI(text, mode, databaseManager, logger);
  });

  ipcMain.handle(C.AI.CHECK_STATUS, async (event, testConfig = null) => {
    return await checkAIStatus(testConfig, databaseManager, logger);
  });
}

module.exports = { register, processTextWithAI, checkAIStatus };
