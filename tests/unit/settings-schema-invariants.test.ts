// [20260906_Test_SettingsSchemaInvariants] Spec #266 T12 (#289): meta-test
// that used to pin the four-place settings rule (SettingsState +
// DEFAULT_SETTINGS + loadSettings builder + saveSettings body + the
// ALLOWED_SETTING_KEYS allowlist). [20260926_Refactor_403_SettingsSchema]
// Issue #403 replaced the discipline with structure: src/settings/
// settingsSchema.ts is the single source of truth and every derived site
// imports from it. This meta-test now pins THAT structure — the old
// hand-maintained declarations must not come back, because a revived hand
// list silently drifts from the schema. Text-level source parsing, same
// style as coverage-meta.test.ts / ci-config.test.ts.
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
// [20260926_Refactor_403_SettingsSchema] Behavioral cross-checks use the
// real derived artifacts (not source text) so the allowlist/state/allow
// relationships are verified on the shipping code paths.
import { validateSetting } from "../../src/helpers/ipc/settingsHandlers";
import {
  SETTING_DEFINITIONS,
  DEFAULT_SETTINGS,
  ALLOWED_SETTING_KEYS,
} from "../../src/settings/settingsSchema";

const schemaSrc = fs.readFileSync(
  path.resolve(__dirname, "../../src/settings/settingsSchema.ts"),
  "utf8",
);
const useSettingsSrc = fs.readFileSync(
  path.resolve(__dirname, "../../src/settings/useSettings.ts"),
  "utf8",
);
const settingsHandlersSrc = fs.readFileSync(
  path.resolve(__dirname, "../../src/helpers/ipc/settingsHandlers.ts"),
  "utf8",
);
const fileConfigSrc = fs.readFileSync(
  path.resolve(__dirname, "../../src/helpers/fileConfig.ts"),
  "utf8",
);
const textWriteSchedulerSrc = fs.readFileSync(
  path.resolve(__dirname, "../../src/settings/textWriteScheduler.ts"),
  "utf8",
);

describe("[20260926_Refactor_403_SettingsSchema] schema single-source structure", () => {
  it("useSettings re-exports the schema-derived SettingsState/DEFAULT_SETTINGS instead of declaring them", () => {
    // The hand declarations are gone…
    expect(useSettingsSrc).not.toContain("export interface SettingsState {");
    expect(useSettingsSrc).not.toContain(
      "export const DEFAULT_SETTINGS: SettingsState = {",
    );
    // …and the schema module is the import source.
    expect(useSettingsSrc).toMatch(/from "\.\/settingsSchema"/);
  });

  it("useSettings loads through the schema (no per-key hand builder)", () => {
    expect(useSettingsSrc).not.toContain(
      "const loadedSettings: SettingsState = {",
    );
    expect(useSettingsSrc).toContain("loadSettingsState");
  });

  it("settingsHandlers derives the allowlist from the schema (no hand Set)", () => {
    expect(settingsHandlersSrc).not.toContain("new Set<string>([");
    expect(settingsHandlersSrc).toMatch(
      /ALLOWED_SETTING_KEYS[\s\S]*from "\.\.\/\.\.\/settings\/settingsSchema"|from "\.\.\/\.\.\/settings\/settingsSchema"[\s\S]*ALLOWED_SETTING_KEYS/,
    );
  });

  it("fileConfig derives the murmur.json key filter from the schema (no hand array)", () => {
    expect(fileConfigSrc).not.toContain("const FILE_CONFIGURABLE_KEYS");
    expect(fileConfigSrc).toMatch(/from "\.\.\/settings\/settingsSchema"/);
  });

  it("textWriteScheduler derives the debounce key set from the schema (no hand array)", () => {
    // The #402 key list used to be a hand-written Set literal here.
    expect(textWriteSchedulerSrc).not.toContain(
      "export const TEXT_INPUT_SETTING_KEYS: ReadonlySet<string> = new Set([",
    );
    expect(textWriteSchedulerSrc).toMatch(/from "\.\/settingsSchema"/);
  });

  it("every schema entry declares key, type, default, and scope (structural completeness)", () => {
    for (const def of SETTING_DEFINITIONS) {
      expect(def.key, "schema entry key").toBeTruthy();
      expect(["string", "number", "boolean"]).toContain(def.type);
      expect(["settings-state", "persisted-only"]).toContain(def.scope);
      expect(typeof def.default, `default of ${def.key}`).toBe(def.type);
    }
  });
});

describe("[20260926_Refactor_403_SettingsSchema] schema -> boundary relationships (behavioral)", () => {
  it("every settings key is inside ALLOWED_SETTING_KEYS", () => {
    const missing = SETTING_DEFINITIONS.map((d) => d.key).filter(
      (k) => !ALLOWED_SETTING_KEYS.has(k),
    );
    expect(
      missing,
      `Settings keys missing from ALLOWED_SETTING_KEYS — the main process would silently drop them:\n${missing.join("\n")}`,
    ).toEqual([]);
  });

  it("every settings-state key passes the IPC validateSetting gate", () => {
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      expect(
        validateSetting(key, "probe"),
        `${key} must be writable through SETTINGS.SET`,
      ).toBe(true);
    }
  });

  it("every settings-state entry carries a load coercion", () => {
    for (const def of SETTING_DEFINITIONS) {
      if (def.scope !== "settings-state") continue;
      expect(typeof def.load, `load of ${def.key}`).toBe("function");
    }
  });

  it("the schema declares the migration-critical keys with their legacy semantics", () => {
    // default_mode MUST keep migrating off the legacy enable_ai_optimization
    // boolean (a blind "auto" default silently re-enables AI for users who
    // turned it off) — pin that the load arm reads the second argument.
    const loadSrc = schemaSrc;
    expect(loadSrc).toContain("default_mode");
    expect(loadSrc).toContain("enable_ai_optimization === false");
  });

  it("saveSettings persists the whole settings object (loop, not a hand list)", () => {
    // The save path was deliberately converted to a loop over the state
    // object so new schema keys are included automatically; reverting to a
    // hand list would silently drop future settings (ADR-015 follow-up).
    expect(useSettingsSrc).toContain(
      "for (const key of Object.keys(settings))",
    );
  });

  it("the schema object is the only place a setting key string is declared (no key literals in the derived modules)", () => {
    // The old mirrors each hardcoded the full key list; the schema-driven
    // modules must reference schema exports instead. Spot-check a key that
    // used to appear in every hand list.
    expect(settingsHandlersSrc).not.toContain('"window_always_on_top"');
    expect(fileConfigSrc).not.toContain('"minimize_to_tray"');
  });
});
