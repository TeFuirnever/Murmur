// [20260906_Test_SettingsSchemaInvariants] Spec #266 T12 (#289): meta-test
// pinning the repo's four-place settings rule (MUST DO #6 in AGENTS.md):
// adding a setting requires touching SettingsState + DEFAULT_SETTINGS + the
// loadSettings builder + (transitively) the saveSettings loop, and every key
// must be inside the main-process ALLOWED_SETTING_KEYS. Text-level source
// parsing, same style as coverage-meta.test.ts / ci-config.test.ts.
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const useSettingsSrc = fs.readFileSync(
  path.resolve(__dirname, "../../src/settings/useSettings.ts"),
  "utf8",
);
const settingsHandlersSrc = fs.readFileSync(
  path.resolve(__dirname, "../../src/helpers/ipc/settingsHandlers.ts"),
  "utf8",
);

/** Lines between a start marker and an end marker. */
function extractBlock(src: string, start: string, end: string): string {
  const from = src.indexOf(start);
  expect(from, `marker not found: ${start}`).toBeGreaterThanOrEqual(0);
  const to = src.indexOf(end, from);
  expect(to, `end marker not found: ${end}`).toBeGreaterThan(from);
  return src.slice(from, to);
}

function settingKeys(block: string): string[] {
  return [...block.matchAll(/^ +([a-z_]+):/gm)].map((m) => m[1]!);
}

const stateBlock = extractBlock(
  useSettingsSrc,
  "export interface SettingsState {",
  "\n}",
);
const defaultsBlock = extractBlock(
  useSettingsSrc,
  "export const DEFAULT_SETTINGS: SettingsState = {",
  "\n};",
);
const loadBlock = extractBlock(
  useSettingsSrc,
  "const loadedSettings: SettingsState = {",
  "\n        };",
);
const allowedBlock = extractBlock(
  settingsHandlersSrc,
  "const ALLOWED_SETTING_KEYS = new Set<string>([",
  "]);",
);
const allowedKeys = new Set(
  [...allowedBlock.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]!),
);

describe("[20260906_Test_SettingsSchemaInvariants] four-place rule", () => {
  it("SettingsState keys are identical to DEFAULT_SETTINGS keys", () => {
    expect(settingKeys(defaultsBlock).sort()).toEqual(
      settingKeys(stateBlock).sort(),
    );
  });

  it("SettingsState keys are identical to the loadSettings builder keys", () => {
    expect(settingKeys(loadBlock).sort()).toEqual(
      settingKeys(stateBlock).sort(),
    );
  });

  it("every settings key is inside ALLOWED_SETTING_KEYS", () => {
    const missing = settingKeys(stateBlock).filter((k) => !allowedKeys.has(k));
    expect(
      missing,
      `Settings keys missing from ALLOWED_SETTING_KEYS — the main process would silently drop them:\n${missing.join("\n")}`,
    ).toEqual([]);
  });

  it("saveSettings persists the whole settings object (loop, not a hand list)", () => {
    // The save path was deliberately converted to a loop over the state
    // object so new keys are included automatically; reverting to a hand
    // list would silently drop future settings (ADR-015 follow-up).
    expect(useSettingsSrc).toContain(
      "for (const key of Object.keys(settings))",
    );
  });
});
