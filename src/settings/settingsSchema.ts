// [20260926_Refactor_403_SettingsSchema] Issue #403: SINGLE SOURCE OF TRUTH
// for every persisted setting key. Before this module, adding a setting
// required hand-syncing five declarations (SettingsState type +
// DEFAULT_SETTINGS + the loadSettings builder + the saveSettings body in
// useSettings.ts, plus ALLOWED_SETTING_KEYS in settingsHandlers.ts) — miss
// one and persistence silently broke; CLAUDE.md rule 5 existed purely to
// police that discipline. Everything below is now DERIVED from this schema:
//
//   SettingsState (type) ......... mapped type over scope "settings-state"
//   DEFAULT_SETTINGS ............. collectDefaultSettings(SETTINGS_SCHEMA)
//   loadSettings builder ......... loadSettingsState(raw) — per-key load arms
//   ALLOWED_SETTING_KEYS ......... collectAllowedKeys(SETTINGS_SCHEMA)
//                                  (re-exported by settingsHandlers.ts)
//   FILE_CONFIGURABLE_KEYS ....... fileSync flags (re-exported by fileConfig.ts)
//   TEXT_INPUT_SETTING_KEYS ...... textLike flags (re-exported by
//                                  textWriteScheduler.ts, issue #402 debounce)
//
// PERSISTENCE COMPATIBILITY (hard gate): every load arm reproduces the old
// per-key loadSettings coercion EXACTLY — including the historical quirks
// (falsy-number fallbacks, `!== false` booleans, the default_mode legacy
// migration) — so existing SQLite / murmur.json values read back unchanged.
// tests/unit/settings-schema.test.ts pins that equivalence value-for-value.
//
// This module MUST stay importable from BOTH the main process and the
// renderer: no React, no DOM, no Electron imports (mirrors hotkeyRecorder's
// constraint). The CLI keeps its plain-.mjs mirror (cli/lib cannot import
// TypeScript at runtime); tests/unit/cli-config.test.ts locks the two lists
// to set equality so drift fails CI.

import { DEFAULT_HOTKEY } from "./hotkeyRecorder";
import { DEFAULT_MODEL } from "./modelCatalog";

/** Value types a setting can carry in storage. */
export type SettingTypeTag = "string" | "number" | "boolean";

/**
 * Where a setting lives in the renderer:
 * - "settings-state": loaded into SettingsState by loadSettingsState and
 *   edited through the settings page (the historical 16 keys +
 *   show_notifications).
 * - "persisted-only": a legal persisted key at the IPC boundary that never
 *   enters SettingsState. `language` writes through its own special channel
 *   (i18n.changeLanguage + localStorage + SETTINGS.SET broadcast);
 *   model_download_path has no current in-app editor (kept writable for the
 *   CLI / murmur.json pipeline). auto_start (#404) and minimize_to_tray
 *   (#405) graduated into settings-state with their General-tab switches.
 */
export type SettingScope = "settings-state" | "persisted-only";

interface SettingDefinitionBase {
  /** i18n key of the setting's description in the settings UI, when one
   *  exists (validated against both locales by settings-schema.test.ts). */
  descriptionKey?: string;
  /** True when a change only takes effect after an app reload (none of the
   *  current keys need one — every consumer re-applies on SETTINGS_UPDATE). */
  requiresRestart?: boolean;
  /** True when the key syncs to the plaintext ~/.murmur.json
   *  (FILE_CONFIGURABLE_KEYS). NEVER set on secrets — ai_api_key /
   *  hotwords must not land in a plaintext dotfile (fileConfig.ts header). */
  fileSync?: boolean;
  /** True when the renderer debounces the persistence write through
   *  textWriteScheduler's 400ms window (issue #402: text-like inputs). */
  textLike?: boolean;
}

/** A "settings-state" entry carries the load coercion for its value type. */
export type StateSettingDefinition =
  | (SettingDefinitionBase & {
      type: "string";
      scope: "settings-state";
      default: string;
      load: (raw: unknown, all: Record<string, unknown>) => string;
    })
  | (SettingDefinitionBase & {
      type: "number";
      scope: "settings-state";
      default: number;
      load: (raw: unknown, all: Record<string, unknown>) => number;
    })
  | (SettingDefinitionBase & {
      type: "boolean";
      scope: "settings-state";
      default: boolean;
      load: (raw: unknown, all: Record<string, unknown>) => boolean;
    });

/** A "persisted-only" entry needs no load arm (never enters SettingsState). */
export type PersistedOnlySettingDefinition = SettingDefinitionBase & {
  type: SettingTypeTag;
  scope: "persisted-only";
  default: string | number | boolean;
};

export type SettingDefinition =
  | StateSettingDefinition
  | PersistedOnlySettingDefinition;

/** Structural supertype of the schema record (for generic derivations). */
export type SchemaRecord = Record<string, SettingDefinition>;

// ---------------------------------------------------------------------------
// The schema — ONE declaration per key. Order matches the historical
// DEFAULT_SETTINGS order for readable diffs; show_notifications (folded in
// from #400's local-state special case) sits with the other General keys.
// ---------------------------------------------------------------------------
export const SETTINGS_SCHEMA = {
  ai_api_key: {
    type: "string",
    scope: "settings-state",
    default: "",
    // Secret: never file-synced, always text-debounced.
    textLike: true,
    load: (raw: unknown): string => (raw || "") as string,
  },
  ai_base_url: {
    type: "string",
    scope: "settings-state",
    default: "https://api.openai.com/v1",
    fileSync: true,
    textLike: true,
    load: (raw: unknown): string =>
      (raw || "https://api.openai.com/v1") as string,
  },
  ai_model: {
    type: "string",
    scope: "settings-state",
    default: DEFAULT_MODEL,
    descriptionKey: "settings.ai.modelDesc",
    fileSync: true,
    textLike: true,
    load: (raw: unknown): string => (raw || DEFAULT_MODEL) as string,
  },
  ai_temperature: {
    type: "number",
    scope: "settings-state",
    default: 0.3,
    fileSync: true,
    // Legacy arm: parseFloat(...) || 0.3 — 0 is falsy and falls back (quirk
    // kept verbatim from the pre-schema loadSettings; pinned by test).
    load: (raw: unknown): number => parseFloat(String(raw)) || 0.3,
  },
  ai_max_tokens: {
    type: "number",
    scope: "settings-state",
    // [20260815_Fix_AiMaxTokensDefault] 8192 (was 2000): reasoning models
    // count thinking tokens against max_tokens; 2000 let reasoning alone
    // exhaust the budget and return empty content.
    default: 8192,
    fileSync: true,
    load: (raw: unknown): number => parseInt(String(raw), 10) || 8192,
  },
  enable_ai_optimization: {
    type: "boolean",
    scope: "settings-state",
    default: true,
    // Legacy arm: `!== false` — only a literal false reads as off.
    load: (raw: unknown): boolean => raw !== false,
  },
  default_mode: {
    type: "string",
    scope: "settings-state",
    // [20260905_Fix_249_DefaultModeUi] Default AI processing mode ("auto"
    // picks by text length, "off" disables, else a built-in/template mode).
    // One knob with enable_ai_optimization — see useSettings'
    // handleInputChange for the paired-write logic.
    default: "auto",
    descriptionKey: "settings.general.defaultModeDesc",
    // [20260905_Fix_249_DefaultModeUi] MIGRATE, don't blindly default: when
    // default_mode was never written, derive it from the legacy
    // enable_ai_optimization boolean (same migration the read side in
    // useRecording/useFileTranscription applies). A blind "auto" would
    // auto-persist "auto" on any settings save and silently re-enable AI
    // for users who turned it off.
    load: (raw: unknown, all: Record<string, unknown>): string =>
      typeof raw === "string" && raw
        ? raw
        : all.enable_ai_optimization === false
          ? "off"
          : "auto",
  },
  window_always_on_top: {
    type: "boolean",
    scope: "settings-state",
    default: true,
    descriptionKey: "settings.general.alwaysOnTopDesc",
    load: (raw: unknown): boolean => raw !== false,
  },
  show_notifications: {
    type: "boolean",
    scope: "settings-state",
    // [20260926_Issue400] Gates the update-download system notification
    // (updateManager.ts). #400 shipped it as a GeneralSection local-state
    // special case; #403 folds it into the schema — same `!== false` gate
    // the main-process read uses.
    default: true,
    descriptionKey: "settings.general.showNotificationsDesc",
    fileSync: true,
    load: (raw: unknown): boolean => raw !== false,
  },
  // [20260926_Issue404] Launch-at-login (issue #404): the General-tab
  // switch persists through the standard pipeline; the main process applies
  // the value to app.setLoginItemSettings (SYSTEM.SET_LOGIN_ITEM) and
  // re-aligns the real login item at every boot (settings win). Load arm is
  // `raw === true` — NOT the legacy `!== false`: the historical default is
  // FALSE, so absent/odd stored values must read as off (mirror image of
  // the on-by-default booleans above).
  auto_start: {
    type: "boolean",
    scope: "settings-state",
    default: false,
    descriptionKey: "settings.general.autoStartDesc",
    fileSync: true,
    load: (raw: unknown): boolean => raw === true,
  },
  // [20260926_Issue405] Minimize-to-tray (issue #405): the General-tab
  // switch (Windows-only UI — macOS minimizes into the Dock by system
  // convention and stays out of scope; the main-process interception in
  // src/helpers/minimizeToTray.ts never attaches on darwin). Same strict
  // `raw === true` load arm as auto_start: the historical default is FALSE,
  // so absent/odd stored values must read as off. The main process reads
  // the persisted value at minimize time, so the toggle applies live.
  minimize_to_tray: {
    type: "boolean",
    scope: "settings-state",
    default: false,
    descriptionKey: "settings.general.minimizeToTrayDesc",
    fileSync: true,
    load: (raw: unknown): boolean => raw === true,
  },
  auto_paste: {
    type: "string",
    scope: "settings-state",
    default: "paste",
    descriptionKey: "settings.recognition.autoPasteDesc",
    fileSync: true,
    load: (raw: unknown): string => (raw || "paste") as string,
  },
  close_behavior: {
    type: "string",
    scope: "settings-state",
    default: "hide",
    descriptionKey: "settings.recognition.closeBehaviorDesc",
    load: (raw: unknown): string => (raw || "hide") as string,
  },
  theme: {
    type: "string",
    scope: "settings-state",
    // "system" | "light" | "dark"; applied live (#395).
    default: "system",
    fileSync: true,
    load: (raw: unknown): string => (raw || "system") as string,
  },
  // [20260905_Fix_246_HotkeySettingsUi] Global recording hotkey (Electron
  // accelerator); the main window re-registers on SETTINGS_UPDATE.
  hotkey: {
    type: "string",
    scope: "settings-state",
    default: DEFAULT_HOTKEY,
    descriptionKey: "settings.general.hotkeyDesc",
    fileSync: true,
    load: (raw: unknown): string =>
      typeof raw === "string" && raw ? raw : DEFAULT_HOTKEY,
  },
  // [20260820_T14_Hotwords] Hotword list, one entry per line; stored RAW —
  // full sanitization happens at the injection boundary
  // (src/helpers/hotwords.ts). Deliberately NOT file-synced (names must not
  // land in a plaintext dotfile). An EMPTY string is a valid stored value
  // (cleared list), so the load arm type-checks instead of `|| default`.
  hotwords: {
    type: "string",
    scope: "settings-state",
    default: "",
    descriptionKey: "settings.general.hotwordsDesc",
    textLike: true,
    load: (raw: unknown): string => (typeof raw === "string" ? raw : ""),
  },
  // [20260905_Feat_BloubSettings] bot mascot catalogue keys (spec #224
  // ticket 5); values validated at the mascot boundary (unknown ids fall
  // back to the defaults there).
  bot_shape: {
    type: "string",
    scope: "settings-state",
    default: "circle",
    load: (raw: unknown): string => (raw || "circle") as string,
  },
  bot_color: {
    type: "string",
    scope: "settings-state",
    // "auto" = theme-aware colour (light -> ink, dark -> cream).
    default: "auto",
    load: (raw: unknown): string => (raw || "auto") as string,
  },
  bot_expression: {
    type: "string",
    scope: "settings-state",
    default: "neutral",
    load: (raw: unknown): string => (raw || "neutral") as string,
  },

  // ---- persisted-only keys (legal at the IPC boundary, NOT in
  // SettingsState) -----------------------------------------------

  // [20260905_Fix_249_ReviewMinor] language writes through its own channel:
  // i18n.changeLanguage + localStorage + onInputChange("language") so the
  // main/history windows and the tray follow the switch live. Only the
  // persisted value and the settings-handler tray hook are schema-visible.
  language: {
    type: "string",
    scope: "persisted-only",
    default: "zh-CN",
    fileSync: true,
  },
  // model_download_path: legacy configurable key with no current in-app
  // editor — kept persisted (murmur.json sync + CLI whitelist) so existing
  // user files keep round-tripping. (auto_start left this group in #404 and
  // minimize_to_tray in #405 — both have General-tab editors now.)
  model_download_path: {
    type: "string",
    scope: "persisted-only",
    default: "",
  },
} as const satisfies SchemaRecord;

// ---------------------------------------------------------------------------
// Type derivations
// ---------------------------------------------------------------------------

/**
 * The renderer SettingsState for any schema record: the keys scoped
 * "settings-state", each typed by its declared `type`. Exported so tests
 * can prove a schema addition flows into the state TYPE automatically
 * (issue #403 acceptance: one schema entry = type + default + allowlist).
 */
/** Value type for one definition's declared `type` tag. */
type SettingValueOf<D extends SettingDefinition> = D extends { type: "string" }
  ? string
  : D extends { type: "number" }
    ? number
    : boolean;

export type SettingsStateOf<S extends SchemaRecord> = {
  [K in keyof S as S[K] extends { scope: "settings-state" }
    ? K
    : never]: SettingValueOf<S[K]>;
};

/** The app's settings state (was the hand-written interface in useSettings). */
export type SettingsState = SettingsStateOf<typeof SETTINGS_SCHEMA>;

/** Every persisted setting key, either scope. */
export type SettingKey = keyof typeof SETTINGS_SCHEMA;

// ---------------------------------------------------------------------------
// Runtime derivations (generic over the schema record so the single-
// declaration acceptance test can run the PRODUCTION helpers on an
// extended test schema)
// ---------------------------------------------------------------------------

/** Flat (key, definition) list in schema declaration order. */
export const SETTING_DEFINITIONS: ReadonlyArray<
  SettingDefinition & { readonly key: SettingKey }
> = Object.entries(SETTINGS_SCHEMA).map(([key, def]) => ({
  key: key as SettingKey,
  ...def,
}));

const STATE_DEFINITIONS: ReadonlyArray<
  StateSettingDefinition & { key: SettingKey }
> = SETTING_DEFINITIONS.filter(
  (d): d is StateSettingDefinition & { key: SettingKey } =>
    d.scope === "settings-state",
);

/** Defaults for the settings-state keys, derived from the schema. */
export function collectDefaultSettings<S extends SchemaRecord>(
  schema: S,
): SettingsStateOf<S> {
  const out: Record<string, unknown> = {};
  for (const [key, def] of Object.entries(schema)) {
    if (def.scope === "settings-state") out[key] = def.default;
  }
  return out as SettingsStateOf<S>;
}

/** The IPC allowlist (every schema key, either scope), derived. */
export function collectAllowedKeys<S extends SchemaRecord>(
  schema: S,
): Set<string> {
  return new Set(Object.keys(schema));
}

/** Settings-state defaults (re-exported by useSettings.ts). */
export const DEFAULT_SETTINGS: SettingsState =
  collectDefaultSettings(SETTINGS_SCHEMA);

/** ALLOWED_SETTING_KEYS (re-exported by settingsHandlers.ts — validateSetting
 *  gates every SETTINGS.SET write on this set). */
export const ALLOWED_SETTING_KEYS: ReadonlySet<string> =
  collectAllowedKeys(SETTINGS_SCHEMA);

/** Keys that sync to the plaintext ~/.murmur.json (re-exported by
 *  fileConfig.ts). Secrets are structurally absent (fileSync never set). */
export const FILE_CONFIGURABLE_KEYS: readonly string[] = Object.freeze(
  SETTING_DEFINITIONS.filter((d) => d.fileSync).map((d) => d.key),
);

/** Text-like keys whose persistence write is debounced 400ms (issue #402;
 *  re-exported by textWriteScheduler.ts). */
export const TEXT_INPUT_SETTING_KEYS: ReadonlySet<string> = new Set(
  SETTING_DEFINITIONS.filter((d) => d.textLike).map((d) => d.key),
);

/**
 * Build the SettingsState from a raw getAllSettings() record by running
 * each schema entry's load coercion. This replaces the hand-written
 * per-key builder in the old loadSettings — the arms (and their quirks)
 * moved verbatim into the schema entries above.
 */
export function loadSettingsState(raw: Record<string, unknown>): SettingsState {
  const out: Record<string, unknown> = {};
  for (const def of STATE_DEFINITIONS) {
    out[def.key] = def.load(raw[def.key], raw);
  }
  return out as SettingsState;
}
