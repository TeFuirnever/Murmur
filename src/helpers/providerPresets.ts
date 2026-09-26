// [20260724_TS_Migration_ProviderPresets] Migrated from .js to .ts as part
// of backend TypeScript migration (ADR-010). Pure data module — no require()
// dependencies, making it the safest file to migrate first.
// [20260712_Fix_RegistrationGuideI18n] Removed `guide` text from registration
// objects — guide text now lives in i18n locale files under
// `settings.providers.<name>.guide` so it can be translated. Only locale-neutral
// fields (url, recommended) remain here.

/** Registration metadata for a provider preset. */
interface ProviderRegistration {
  url: string;
  recommended?: boolean;
}

/** A single AI provider preset entry. */
export interface ProviderPresetData {
  name: string;
  label: string;
  base_url: string;
  models: string[];
  requires_api_key: boolean;
  // [20260926_Fix_398_ProviderLabelI18n] Locale-bound suffixes ("(本地)")
  // must not live in this locale-neutral data — the suffix is composed at
  // the label resolution point via settings.providers.localSuffix. Same
  // policy as registration.guide (see file header).
  is_local?: boolean;
  registration?: ProviderRegistration;
}

const PROVIDER_PRESETS: ProviderPresetData[] = [
  {
    name: "openai",
    label: "OpenAI",
    // developers.openai.com/api/docs/models documents the GPT-6 family
    // (gpt-6-sol / gpt-6-luna / gpt-6-astra); the gpt-4 generation is
    // retired / shutting down through fall 2026.
    base_url: "https://api.openai.com/v1",
    models: ["gpt-6-sol", "gpt-6-astra", "gpt-6-luna"],
    requires_api_key: true,
    registration: {
      url: "https://platform.openai.com/signup",
    },
  },
  {
    name: "anthropic",
    label: "Anthropic",
    // platform.claude.com OpenAI-SDK compatibility layer: Bearer auth +
    // POST /v1/chat/completions, matching Murmur's plain OpenAI-compatible
    // client. Current lineup: Fable 5.1 / Opus 5.5 / Sonnet 5 / Haiku 4.5.
    base_url: "https://api.anthropic.com/v1",
    models: ["claude-sonnet-5", "claude-opus-5-5", "claude-haiku-4-5"],
    requires_api_key: true,
    registration: {
      url: "https://console.anthropic.com",
    },
  },
  {
    name: "deepseek",
    label: "DeepSeek",
    // api-docs.deepseek.com documents the OpenAI-format base as the bare
    // domain; deepseek-chat/reasoner are gone, replaced by the V4 generation.
    base_url: "https://api.deepseek.com",
    models: ["deepseek-flash", "deepseek-v4-pro"],
    requires_api_key: true,
    registration: {
      url: "https://platform.deepseek.com/sign_up",
      recommended: true,
    },
  },
  {
    name: "qwen",
    label: "通义千问",
    base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    // Qwen3.8-Max went GA 2026-09 (the preview name 404s since then).
    models: ["qwen3.8-max", "qwen3.5-plus", "qwen3.5-flash"],
    requires_api_key: true,
    registration: {
      url: "https://dashscope.console.aliyun.com/",
    },
  },
  {
    name: "glm",
    label: "智谱 GLM",
    base_url: "https://open.bigmodel.cn/api/paas/v4",
    // GLM-5.3 (2026-08 flagship) and the lightweight GLM-5.3-Flash.
    models: ["glm-5.3", "glm-5.3-flash"],
    requires_api_key: true,
    registration: {
      url: "https://open.bigmodel.cn/usercenter/apikeys",
    },
  },
  {
    name: "siliconflow",
    label: "硅基流动",
    base_url: "https://api.siliconflow.cn/v1",
    // Docs examples: deepseek-ai/DeepSeek-V4-Flash; "Pro/" is the premium
    // deployment tier of the same open-source model.
    models: ["deepseek-ai/DeepSeek-V4-Flash", "Pro/deepseek-ai/DeepSeek-V4"],
    requires_api_key: true,
    registration: {
      url: "https://cloud.siliconflow.cn",
      recommended: true,
    },
  },
  {
    name: "groq",
    label: "Groq",
    base_url: "https://api.groq.com/openai/v1",
    // console.groq.com/docs/models production tier; mixtral-8x7b-32768
    // retired.
    models: [
      "openai/gpt-oss-120b",
      "llama-3.3-70b-versatile",
      "llama-3.1-8b-instant",
    ],
    requires_api_key: true,
    registration: {
      url: "https://console.groq.com",
    },
  },
  {
    name: "moonshot",
    label: "Moonshot",
    base_url: "https://api.moonshot.cn/v1",
    // platform.kimi.com docs: the moonshot-v1-* series is gone; current IDs
    // are kimi-k3 (flagship) and kimi-k2.6.
    models: ["kimi-k3", "kimi-k2.6"],
    requires_api_key: true,
    registration: {
      url: "https://platform.moonshot.cn/",
    },
  },
  {
    name: "openrouter",
    label: "OpenRouter",
    base_url: "https://openrouter.ai/api/v1",
    models: [
      "deepseek/deepseek-chat-v3-0324:free",
      "google/gemma-3-1b-it:free",
    ],
    requires_api_key: true,
    registration: {
      url: "https://openrouter.ai",
    },
  },
  {
    name: "minimax",
    label: "MiniMax",
    base_url: "https://api.minimaxi.com/v1",
    // platform.minimax.io docs: M3 is the latest M-series; Text-01 is retired.
    models: ["MiniMax-M3", "MiniMax-M2.5"],
    requires_api_key: true,
  },
  {
    name: "ollama",
    label: "Ollama",
    base_url: "http://localhost:11434/v1",
    // ollama.com/library top-pulled tags, 2026-09. Detection (detectLocalModels)
    // replaces these suggestions whenever a local runtime answers.
    models: ["qwen3:8b", "gemma3:4b", "llama3.1:8b"],
    requires_api_key: false,
    is_local: true,
  },
  {
    name: "lmstudio",
    label: "LM Studio",
    base_url: "http://localhost:1234/v1",
    models: ["loaded-model"],
    requires_api_key: false,
    is_local: true,
  },
];

function getProviderPresets(): ProviderPresetData[] {
  return PROVIDER_PRESETS;
}

function getProviderByName(name: string): ProviderPresetData | undefined {
  return PROVIDER_PRESETS.find((p) => p.name === name);
}

export { getProviderPresets, getProviderByName };
