// [20260926_Refactor_403_SettingsSchema] The predefined AI-model catalogue
// moved out of useSettings.ts (which imports React) into this React-free
// module so the settings schema (settingsSchema.ts, imported by the main
// process) can reference DEFAULT_MODEL without dragging renderer
// dependencies across the process boundary. useSettings.ts re-exports all
// three constants, so existing importers are unchanged.

// [20260926_Fix_397_ModelCatalog] Refreshed 2026-09: the previous list still
// advertised the gpt-3.5/gpt-4 generation that every provider has retired or
// is sunsetting through fall 2026. Current mainstream picks: GPT-6 family
// (developers.openai.com), Qwen3.8-Max (Bailian) and DeepSeek-V4.1-Flash
// (api-docs.deepseek.com). Custom-model input remains the escape hatch.
export const PREDEFINED_MODELS = [
  "gpt-6-sol",
  "gpt-6-luna",
  "gpt-6-astra",
  "qwen3.8-max",
  "deepseek-flash",
] as const;

export const DEFAULT_MODEL = "gpt-6-sol";

// [20260815_Refactor_ModelListDedup] Display labels for PREDEFINED_MODELS.
// AIConfigSection used to hardcode the same models a second time as <option>
// tags — two copies that silently drift. The DEFAULT_MODEL entry gets the
// localized "(推荐)" suffix at the usage site
// (settings.ai.modelRecommended), so its label here is a fallback.
export const MODEL_LABELS: Record<string, string> = {
  "gpt-6-sol": "GPT-6 Sol",
  "gpt-6-luna": "GPT-6 Luna",
  "gpt-6-astra": "GPT-6 Astra",
  "qwen3.8-max": "Qwen3.8-Max",
  "deepseek-flash": "DeepSeek Flash",
};
