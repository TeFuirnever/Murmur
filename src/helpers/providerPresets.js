const PROVIDER_PRESETS = [
  {
    name: "openai",
    label: "OpenAI",
    base_url: "https://api.openai.com/v1",
    models: ["gpt-4o-mini", "gpt-4o", "gpt-3.5-turbo"],
    requires_api_key: true,
  },
  {
    name: "deepseek",
    label: "DeepSeek",
    base_url: "https://api.deepseek.com/v1",
    models: ["deepseek-chat", "deepseek-reasoner"],
    requires_api_key: true,
  },
  {
    name: "qwen",
    label: "通义千问",
    base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    models: ["qwen-turbo", "qwen-plus", "qwen-max"],
    requires_api_key: true,
  },
  {
    name: "glm",
    label: "智谱 GLM",
    base_url: "https://open.bigmodel.cn/api/paas/v4",
    models: ["glm-4-flash", "glm-4-plus", "glm-4"],
    requires_api_key: true,
  },
  {
    name: "siliconflow",
    label: "硅基流动",
    base_url: "https://api.siliconflow.cn/v1",
    models: ["Qwen/Qwen2.5-7B-Instruct", "deepseek-ai/DeepSeek-V2.5"],
    requires_api_key: true,
  },
  {
    name: "groq",
    label: "Groq",
    base_url: "https://api.groq.com/openai/v1",
    models: ["llama-3.3-70b-versatile", "mixtral-8x7b-32768"],
    requires_api_key: true,
  },
  {
    name: "ollama",
    label: "Ollama (本地)",
    base_url: "http://localhost:11434/v1",
    models: ["qwen2.5:7b", "gemma2:9b", "llama3.1:8b"],
    requires_api_key: false,
  },
  {
    name: "lmstudio",
    label: "LM Studio (本地)",
    base_url: "http://localhost:1234/v1",
    models: ["loaded-model"],
    requires_api_key: false,
  },
];

function getProviderPresets() {
  return PROVIDER_PRESETS;
}

function getProviderByName(name) {
  return PROVIDER_PRESETS.find((p) => p.name === name);
}

module.exports = { getProviderPresets, getProviderByName };
