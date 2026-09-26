// [20260926_Refactor_403_SettingsSchema] Issue #403: the settings schema
// (src/settings/settingsSchema.ts) is the single source of truth for every
// persisted setting key. This file pins the migration equivalence contract:
//
//   1. DEFAULT_SETTINGS derived from the schema is deep-equal to the
//      pre-refactor hand-maintained literal (plus show_notifications, folded
//      in by this ticket) — no default silently changes.
//   2. ALLOWED_SETTING_KEYS / FILE_CONFIGURABLE_KEYS / TEXT_INPUT_SETTING_KEYS
//      derived from the schema have exactly the pre-refactor membership —
//      no key silently drops out of the IPC allowlist, the murmur.json sync
//      filter, or the #402 debounce set.
//   3. The per-key load coercions reproduce the OLD loadSettings arms
//      value-for-value, including the historical quirks (falsy-number
//      fallbacks, `!== false` booleans, the default_mode legacy migration).
//      Old stored SQLite/murmur.json values must read back unchanged.
//   4. Adding a key to the schema is the ONLY change needed: defaults, the
//      allowlist, and the state type follow automatically (verified through
//      the production derivation helpers against an extended test schema).
//
// Pure module — node environment, no DOM.
import { describe, it, expect } from "vitest";
import {
  SETTINGS_SCHEMA,
  SETTING_DEFINITIONS,
  collectAllowedKeys,
  collectDefaultSettings,
  loadSettingsState,
  DEFAULT_SETTINGS,
  ALLOWED_SETTING_KEYS,
  FILE_CONFIGURABLE_KEYS,
  TEXT_INPUT_SETTING_KEYS,
  type SettingDefinition,
  type SettingsState,
  type SettingsStateOf,
} from "../../src/settings/settingsSchema";
import { DEFAULT_HOTKEY } from "../../src/settings/hotkeyRecorder";
// Parity locks: fileConfig and textWriteScheduler re-export the schema-derived
// lists, so their consumers see the same membership without importing schema
// internals directly.
import { FILE_CONFIGURABLE_KEYS as FILE_KEYS_VIA_FILECONFIG } from "../../src/helpers/fileConfig";
import { TEXT_INPUT_SETTING_KEYS as TEXT_KEYS_VIA_SCHEDULER } from "../../src/settings/textWriteScheduler";
import zhCN from "../../src/i18n/locales/zh-CN.json";
import en from "../../src/i18n/locales/en.json";

// [20260926_Refactor_403_SettingsSchema] The pre-refactor DEFAULT_SETTINGS
// literal from useSettings.ts, copied verbatim as the equivalence oracle
// (issue #403 requirement 5). show_notifications: true is the one sanctioned
// addition (#400 shipped the key with an on default; #403 folds it in).
const PRE_REFACTOR_DEFAULTS = {
  ai_api_key: "",
  ai_base_url: "https://api.openai.com/v1",
  ai_model: "gpt-6-sol",
  ai_temperature: 0.3,
  ai_max_tokens: 8192,
  enable_ai_optimization: true,
  default_mode: "auto",
  window_always_on_top: true,
  auto_paste: "paste",
  close_behavior: "hide",
  theme: "system",
  hotkey: "CommandOrControl+Shift+Space",
  hotwords: "",
  bot_shape: "circle",
  bot_color: "auto",
  bot_expression: "neutral",
  show_notifications: true,
  // [20260926_Issue404] auto_start moves from persisted-only into
  // SettingsState (the #404 General-tab switch) — a sanctioned addition,
  // like show_notifications above. Default stays false.
  auto_start: false,
  // [20260926_Issue405] minimize_to_tray moves from persisted-only into
  // SettingsState (the #405 General-tab switch, Windows-only). Default
  // stays false — the strict `=== true` load arm keeps absent/odd stored
  // values reading as off.
  minimize_to_tray: false,
};

// [20260926_Refactor_403_SettingsSchema] The pre-refactor ALLOWED_SETTING_KEYS
// literal from settingsHandlers.ts (21 keys) as the allowlist oracle.
const PRE_REFACTOR_ALLOWED_KEYS = [
  "ai_api_key",
  "ai_base_url",
  "ai_model",
  "ai_temperature",
  "ai_max_tokens",
  "enable_ai_optimization",
  "default_mode",
  "window_always_on_top",
  "auto_paste",
  "close_behavior",
  "theme",
  "hotkey",
  "language",
  "auto_start",
  "minimize_to_tray",
  "show_notifications",
  "model_download_path",
  "hotwords",
  "bot_shape",
  "bot_color",
  "bot_expression",
];

// [20260926_Refactor_403_SettingsSchema] The pre-refactor murmur.json sync
// filter from fileConfig.ts (11 keys — secret keys deliberately absent).
const PRE_REFACTOR_FILE_KEYS = [
  "ai_base_url",
  "ai_model",
  "ai_temperature",
  "ai_max_tokens",
  "hotkey",
  "language",
  "theme",
  "auto_paste",
  "auto_start",
  "minimize_to_tray",
  "show_notifications",
];

// [20260926_Refactor_403_SettingsSchema] The pre-refactor #402 debounce set
// from textWriteScheduler.ts (4 text-like keys).
const PRE_REFACTOR_TEXT_INPUT_KEYS = [
  "ai_api_key",
  "ai_base_url",
  "ai_model",
  "hotwords",
];

describe("[20260926_Refactor_403_SettingsSchema] schema-derived defaults", () => {
  it("DEFAULT_SETTINGS is deep-equal to the pre-refactor literal (every key, every value)", () => {
    expect(DEFAULT_SETTINGS).toEqual(PRE_REFACTOR_DEFAULTS);
  });

  it("DEFAULT_SETTINGS keys are exactly the settings-state schema keys", () => {
    const stateKeys = SETTING_DEFINITIONS.filter(
      (d) => d.scope === "settings-state",
    )
      .map((d) => d.key)
      .sort();
    expect(Object.keys(DEFAULT_SETTINGS).sort()).toEqual(stateKeys);
  });

  it("the schema itself has no duplicate key (object literal guarantees it) and covers all 21 persisted keys", () => {
    expect(SETTING_DEFINITIONS).toHaveLength(PRE_REFACTOR_ALLOWED_KEYS.length);
  });
});

describe("[20260926_Refactor_403_SettingsSchema] schema-derived key lists", () => {
  it("ALLOWED_SETTING_KEYS membership equals the pre-refactor allowlist (both directions)", () => {
    expect([...ALLOWED_SETTING_KEYS].sort()).toEqual(
      [...PRE_REFACTOR_ALLOWED_KEYS].sort(),
    );
  });

  it("FILE_CONFIGURABLE_KEYS membership equals the pre-refactor murmur.json filter", () => {
    expect([...FILE_CONFIGURABLE_KEYS].sort()).toEqual(
      [...PRE_REFACTOR_FILE_KEYS].sort(),
    );
    // fileConfig re-exports the same derived list — same object identity
    // means a schema change can never leave the mirror behind.
    expect(FILE_KEYS_VIA_FILECONFIG).toBe(FILE_CONFIGURABLE_KEYS);
  });

  it("TEXT_INPUT_SETTING_KEYS membership equals the pre-refactor #402 debounce set", () => {
    expect([...TEXT_INPUT_SETTING_KEYS].sort()).toEqual(
      [...PRE_REFACTOR_TEXT_INPUT_KEYS].sort(),
    );
    // textWriteScheduler re-exports the derived set for the same reason.
    expect(TEXT_KEYS_VIA_SCHEDULER).toBe(TEXT_INPUT_SETTING_KEYS);
  });

  it("every text-like and file-synced key is a legal IPC settings key", () => {
    for (const key of TEXT_INPUT_SETTING_KEYS) {
      expect(ALLOWED_SETTING_KEYS.has(key)).toBe(true);
    }
    for (const key of FILE_CONFIGURABLE_KEYS) {
      expect(ALLOWED_SETTING_KEYS.has(key)).toBe(true);
    }
  });

  it("never marks the secret ai_api_key as file-synced (plaintext murmur.json hygiene)", () => {
    expect(FILE_CONFIGURABLE_KEYS).not.toContain("ai_api_key");
    expect(FILE_CONFIGURABLE_KEYS).not.toContain("hotwords");
  });
});

// [20260926_Refactor_403_SettingsSchema] Migration equivalence: for every
// settings-state key, the schema load coercion must return exactly what the
// pre-refactor loadSettings arm returned for the same raw stored value
// (issue #403 requirement 5: existing SQLite/murmur.json values are read
// back unchanged). Rows include the historical quirks on purpose — they are
// the old behavior, and "surgical" means replicating it, not improving it.
describe("[20260926_Refactor_403_SettingsSchema] migration equivalence (old stored value -> new schema read)", () => {
  type Row = {
    key: keyof SettingsState;
    raw: Record<string, unknown>;
    expected: unknown;
  };
  const cases: Row[] = [
    // ai_api_key: `raw || ""` — masked values pass through untouched.
    { key: "ai_api_key", raw: { ai_api_key: "sk-live" }, expected: "sk-live" },
    {
      key: "ai_api_key",
      raw: { ai_api_key: "****abcd" },
      expected: "****abcd",
    },
    { key: "ai_api_key", raw: {}, expected: "" },
    { key: "ai_api_key", raw: { ai_api_key: "" }, expected: "" },
    // ai_base_url: falsy falls back to the OpenAI default URL.
    {
      key: "ai_base_url",
      raw: { ai_base_url: "https://api.deepseek.com/v1" },
      expected: "https://api.deepseek.com/v1",
    },
    {
      key: "ai_base_url",
      raw: { ai_base_url: "" },
      expected: "https://api.openai.com/v1",
    },
    {
      key: "ai_base_url",
      raw: {},
      expected: "https://api.openai.com/v1",
    },
    // ai_model: falsy falls back to DEFAULT_MODEL (gpt-6-sol since #397).
    {
      key: "ai_model",
      raw: { ai_model: "qwen3.8-max" },
      expected: "qwen3.8-max",
    },
    { key: "ai_model", raw: {}, expected: "gpt-6-sol" },
    { key: "ai_model", raw: { ai_model: "" }, expected: "gpt-6-sol" },
    // ai_temperature: parseFloat(...) || 0.3 — 0 is falsy, legacy quirk.
    { key: "ai_temperature", raw: { ai_temperature: 0.7 }, expected: 0.7 },
    { key: "ai_temperature", raw: { ai_temperature: "0.5" }, expected: 0.5 },
    {
      key: "ai_temperature",
      raw: { ai_temperature: "not-a-number" },
      expected: 0.3,
    },
    { key: "ai_temperature", raw: { ai_temperature: 0 }, expected: 0.3 },
    { key: "ai_temperature", raw: {}, expected: 0.3 },
    // ai_max_tokens: parseInt(..., 10) || 8192.
    { key: "ai_max_tokens", raw: { ai_max_tokens: 1000 }, expected: 1000 },
    { key: "ai_max_tokens", raw: { ai_max_tokens: "2048" }, expected: 2048 },
    { key: "ai_max_tokens", raw: { ai_max_tokens: "xyz" }, expected: 8192 },
    { key: "ai_max_tokens", raw: {}, expected: 8192 },
    // Booleans: strict `!== false` — anything but literal false reads as on.
    {
      key: "enable_ai_optimization",
      raw: { enable_ai_optimization: false },
      expected: false,
    },
    {
      key: "enable_ai_optimization",
      raw: { enable_ai_optimization: true },
      expected: true,
    },
    { key: "enable_ai_optimization", raw: {}, expected: true },
    {
      key: "enable_ai_optimization",
      raw: { enable_ai_optimization: "false" },
      expected: true,
    },
    // default_mode: MIGRATE off the legacy boolean when unset/empty/non-string
    // (a blind "auto" would silently re-enable AI for opted-out users).
    {
      key: "default_mode",
      raw: { default_mode: "correct" },
      expected: "correct",
    },
    {
      key: "default_mode",
      raw: { default_mode: "", enable_ai_optimization: false },
      expected: "off",
    },
    {
      key: "default_mode",
      raw: { enable_ai_optimization: false },
      expected: "off",
    },
    {
      key: "default_mode",
      raw: { enable_ai_optimization: true },
      expected: "auto",
    },
    { key: "default_mode", raw: {}, expected: "auto" },
    {
      key: "default_mode",
      raw: { default_mode: 42, enable_ai_optimization: false },
      expected: "off",
    },
    // window_always_on_top: `!== false` (main.ts boot read uses the same gate).
    {
      key: "window_always_on_top",
      raw: { window_always_on_top: false },
      expected: false,
    },
    { key: "window_always_on_top", raw: {}, expected: true },
    {
      key: "window_always_on_top",
      raw: { window_always_on_top: "false" },
      expected: true,
    },
    // String selects: falsy falls back to the built-in default.
    { key: "auto_paste", raw: { auto_paste: "none" }, expected: "none" },
    { key: "auto_paste", raw: { auto_paste: "" }, expected: "paste" },
    { key: "close_behavior", raw: {}, expected: "hide" },
    { key: "theme", raw: { theme: "dark" }, expected: "dark" },
    { key: "theme", raw: { theme: "" }, expected: "system" },
    // hotkey: non-empty-string check — a non-string stored value (e.g. a
    // legacy number) must NOT leak into the accelerator string.
    { key: "hotkey", raw: { hotkey: "Alt+Space" }, expected: "Alt+Space" },
    { key: "hotkey", raw: { hotkey: "" }, expected: DEFAULT_HOTKEY },
    { key: "hotkey", raw: { hotkey: 42 }, expected: DEFAULT_HOTKEY },
    { key: "hotkey", raw: {}, expected: DEFAULT_HOTKEY },
    // hotwords: type-checked string passthrough — an EMPTY string is a valid
    // stored value (cleared list) and must stay "" (not fall back).
    {
      key: "hotwords",
      raw: { hotwords: "张晗玥\n张晗月" },
      expected: "张晗玥\n张晗月",
    },
    { key: "hotwords", raw: { hotwords: "" }, expected: "" },
    { key: "hotwords", raw: { hotwords: 42 }, expected: "" },
    // Bot mascot catalogue keys: `|| default`.
    { key: "bot_shape", raw: { bot_shape: "droplet" }, expected: "droplet" },
    { key: "bot_shape", raw: {}, expected: "circle" },
    { key: "bot_color", raw: { bot_color: "blue" }, expected: "blue" },
    { key: "bot_color", raw: {}, expected: "auto" },
    {
      key: "bot_expression",
      raw: { bot_expression: "happy" },
      expected: "happy",
    },
    { key: "bot_expression", raw: {}, expected: "neutral" },
    // show_notifications: same `!== false` gate the #400 read path and the
    // main-process updateManager gate use.
    {
      key: "show_notifications",
      raw: { show_notifications: false },
      expected: false,
    },
    {
      key: "show_notifications",
      raw: { show_notifications: true },
      expected: true,
    },
    { key: "show_notifications", raw: {}, expected: true },
    {
      key: "show_notifications",
      raw: { show_notifications: "false" },
      expected: true,
    },
    // [20260926_Issue404] auto_start: `raw === true` — the historical
    // default is FALSE, so absent/odd stored values must read as off (the
    // mirror image of the `!== false` gates above whose defaults are on).
    { key: "auto_start", raw: { auto_start: true }, expected: true },
    { key: "auto_start", raw: { auto_start: false }, expected: false },
    { key: "auto_start", raw: {}, expected: false },
    { key: "auto_start", raw: { auto_start: "true" }, expected: false },
    // [20260926_Issue405] minimize_to_tray joins SettingsState with the
    // same strict default-false gate as auto_start: only a persisted
    // boolean true reads as on.
    {
      key: "minimize_to_tray",
      raw: { minimize_to_tray: true },
      expected: true,
    },
    {
      key: "minimize_to_tray",
      raw: { minimize_to_tray: false },
      expected: false,
    },
    { key: "minimize_to_tray", raw: {}, expected: false },
    {
      key: "minimize_to_tray",
      raw: { minimize_to_tray: "true" },
      expected: false,
    },
  ];

  it("reads every legacy stored value back unchanged", () => {
    for (const { key, raw, expected } of cases) {
      const loaded = loadSettingsState(raw);
      expect(
        loaded[key],
        `loadSettingsState(${JSON.stringify(raw)})[${key}]`,
      ).toEqual(expected);
    }
  });

  it("returns defaults for a completely empty store", () => {
    const loaded = loadSettingsState({});
    for (const key of Object.keys(
      PRE_REFACTOR_DEFAULTS,
    ) as (keyof SettingsState)[]) {
      expect(loaded[key]).toEqual(PRE_REFACTOR_DEFAULTS[key]);
    }
  });

  it("keeps persisted-only keys (language et al.) OUT of the loaded state", () => {
    const loaded = loadSettingsState({
      language: "en",
      model_download_path: "/tmp",
    });
    expect(Object.keys(loaded)).not.toContain("language");
    expect(Object.keys(loaded)).not.toContain("model_download_path");
  });

  // [20260926_Issue404] auto_start joins SettingsState (#404 General-tab
  // switch): a stored boolean (or its absence) must surface in the loaded
  // state through the schema load arm.
  it("auto_start loads into the state with the strict `=== true` arm", () => {
    expect(loadSettingsState({ auto_start: true }).auto_start).toBe(true);
    expect(loadSettingsState({}).auto_start).toBe(false);
  });

  // [20260926_Issue405] minimize_to_tray joins SettingsState (#405
  // General-tab switch, Windows-only): a stored boolean (or its absence)
  // must surface in the loaded state through the schema load arm.
  it("minimize_to_tray loads into the state with the strict `=== true` arm", () => {
    expect(loadSettingsState({ minimize_to_tray: true }).minimize_to_tray).toBe(
      true,
    );
    expect(loadSettingsState({}).minimize_to_tray).toBe(false);
  });
});

// [20260926_Refactor_403_SettingsSchema] Issue #403 acceptance: adding a
// setting must require ONE schema entry — defaults, the allowlist, and the
// state TYPE all follow through the production derivation helpers (no
// second hand list left to forget). The extended schema below is test-only.
describe("[20260926_Refactor_403_SettingsSchema] single-declaration acceptance (new key = one schema entry)", () => {
  const EXTENDED_SCHEMA = {
    ...SETTINGS_SCHEMA,
    __unit_test_demo_flag: {
      type: "boolean",
      scope: "settings-state",
      default: false,
      load: (raw: unknown): boolean => raw === true,
    },
    __unit_test_persisted: {
      type: "string",
      scope: "persisted-only",
      default: "",
    },
  } as const satisfies Record<string, SettingDefinition>;

  it("collectDefaultSettings picks the new key's default up automatically", () => {
    const defaults = collectDefaultSettings(EXTENDED_SCHEMA);
    expect(defaults.__unit_test_demo_flag).toBe(false);
    // persisted-only additions still stay out of the state defaults.
    expect("__unit_test_persisted" in defaults).toBe(false);
  });

  it("collectAllowedKeys whitelists the new keys automatically (both scopes)", () => {
    const allowed = collectAllowedKeys(EXTENDED_SCHEMA);
    expect(allowed.has("__unit_test_demo_flag")).toBe(true);
    expect(allowed.has("__unit_test_persisted")).toBe(true);
  });

  it("the mapped state type includes the new key with its declared type (compile-level)", () => {
    type ExtendedState = SettingsStateOf<typeof EXTENDED_SCHEMA>;
    // Compiles only when the derived type carries __unit_test_demo_flag:
    // boolean — the type followed the schema entry automatically.
    const probe: ExtendedState = {
      ...collectDefaultSettings(EXTENDED_SCHEMA),
      __unit_test_demo_flag: true,
    };
    expect(probe.__unit_test_demo_flag).toBe(true);
    // @ts-expect-error — the derived type must REJECT a wrong value type,
    // proving the entry's `type: "boolean"` drives the state type. This
    // error is verified by `pnpm typecheck:tests` (vitest itself does not
    // typecheck); the assignment is harmless at runtime.
    probe.__unit_test_demo_flag = "not-a-boolean";
    expect(probe).toBeTruthy();
  });
});

// [20260926_Refactor_403_SettingsSchema] descriptionKey anti-rot lock: every
// populated descriptionKey must resolve in BOTH shipped locales, so the
// schema cannot reference an i18n key the UI deleted.
describe("[20260926_Refactor_403_SettingsSchema] schema descriptionKeys resolve in both locales", () => {
  function flatten(
    obj: Record<string, unknown>,
    prefix = "",
    out = new Set<string>(),
  ): Set<string> {
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (v !== null && typeof v === "object") {
        flatten(v as Record<string, unknown>, key, out);
      } else {
        out.add(key);
      }
    }
    return out;
  }

  it("every descriptionKey exists in zh-CN.json and en.json", () => {
    const zhKeys = flatten(zhCN as Record<string, unknown>);
    const enKeys = flatten(en as Record<string, unknown>);
    for (const def of SETTING_DEFINITIONS) {
      if (!def.descriptionKey) continue;
      expect(
        zhKeys.has(def.descriptionKey),
        `descriptionKey missing from zh-CN.json: ${def.descriptionKey}`,
      ).toBe(true);
      expect(
        enKeys.has(def.descriptionKey),
        `descriptionKey missing from en.json: ${def.descriptionKey}`,
      ).toBe(true);
    }
  });
});
