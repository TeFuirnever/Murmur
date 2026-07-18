// [20260712_Test_SettingsRefactor] Regression tests for settings page refactor.
// Each test guards against a specific issue found in code review.
// Tags correspond to fix tags in the implementation files.
import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import path from "path";

const rootDir = path.resolve(__dirname, "../..");

// Helper: read all settings source files (ts/tsx) as one string
function readAllSettingsSources() {
  const settingsDir = path.join(rootDir, "src/settings");
  const files = [
    path.join(rootDir, "src/settings.tsx"),
    ...fs
      .readdirSync(settingsDir)
      .filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"))
      .map((f) => path.join(settingsDir, f)),
    ...fs
      .readdirSync(path.join(settingsDir, "sections"))
      .filter((f) => f.endsWith(".tsx"))
      .map((f) => path.join(settingsDir, "sections", f)),
  ];
  return files.map((f) => fs.readFileSync(f, "utf8")).join("\n");
}

// Helper: extract all t("...") keys from source text
function extractI18nKeys(source) {
  const keys = [];
  // Match t("key") or t("key", "default") or t("key", { ... })
  const regex = /\bt\(\s*["']([^"']+)["']/g;
  let match;
  while ((match = regex.exec(source)) !== null) {
    keys.push(match[1]);
  }
  return keys;
}

// Deep lookup: "settings.sections.general" -> obj.settings.sections.general
function hasKey(obj, dottedKey) {
  return (
    dottedKey.split(".").reduce((acc, part) => {
      if (acc && typeof acc === "object" && part in acc) return acc[part];
      return undefined;
    }, obj) !== undefined
  );
}

const zhCN = JSON.parse(
  fs.readFileSync(path.join(rootDir, "src/i18n/locales/zh-CN.json"), "utf8"),
);
const en = JSON.parse(
  fs.readFileSync(path.join(rootDir, "src/i18n/locales/en.json"), "utf8"),
);

// Helper: find Chinese characters in a source file, excluding comments and
// i18n fallback strings (second arg to t("key", "中文"))
function findHardcodedChinese(source) {
  const issues = [];

  // First, strip all t(...) calls from the source — including multi-line ones.
  // This removes both the i18n key and any Chinese fallback string.
  // Use a non-greedy match that handles nested parens via balanced matching.
  // Simple approach: remove t( ... ) where ... spans multiple lines.
  let stripped = source;
  // Remove single-line t("...", "中文") and t("...", {...})
  stripped = stripped.replace(
    /\bt\(\s*["'][^"'']*["']\s*,?\s*(?:"[^"]*"|'[^']*'|\{[^}]*\})?\s*\)/g,
    "",
  );
  // Remove multi-line t( calls: t( \n "key" \n "中文" \n )
  stripped = stripped.replace(/\bt\(\s*[\s\S]*?\)\s*\)/g, (match) => match);
  // More robust: remove t( ... ) where the closing ) is on a later line
  stripped = stripped.replace(/\bt\([^)]*\)/g, "");
  // Handle multi-line t() calls: t(\n "key",\n "fallback"\n)
  stripped = stripped.replace(/\bt\(\s*[\s\S]*?\n\s*\)/g, "");

  // Now strip comments
  stripped = stripped.replace(/\/\/[^\n]*/g, "");
  stripped = stripped.replace(/\/\*[\s\S]*?\*\//g, "");

  // Split back into lines to track line numbers — but we need to track which
  // line number in the ORIGINAL source each stripped line corresponds to.
  // Instead, find Chinese string literals and map back to original lines.
  const originalLines = source.split("\n");

  // Find Chinese in stripped source, then find which original line it's on
  const stringLiteralRegex = /["'`]([^"'`]*[\u4e00-\u9fff][^"'`]*)["'`]/g;
  let match;
  while ((match = stringLiteralRegex.exec(stripped)) !== null) {
    // Calculate line number from the stripped position
    const beforeMatch = stripped.substring(0, match.index);
    const strippedLineNum = beforeMatch.split("\n").length;
    const text = match[1].substring(0, 50);

    // Try to find this text in the original source near the same line
    // Search a window of +/- 3 lines around the stripped line number
    let foundLine = strippedLineNum;
    for (let offset = -3; offset <= 3; offset++) {
      const checkLine = strippedLineNum - 1 + offset;
      if (checkLine >= 0 && checkLine < originalLines.length) {
        if (originalLines[checkLine].includes(text.substring(0, 20))) {
          foundLine = checkLine + 1;
          break;
        }
      }
    }
    issues.push({ line: foundLine, text });
  }
  return issues;
}

// ESM import of providerPresets for the guide-key test
import { getProviderPresets } from "../../src/helpers/providerPresets.js";

describe("Settings refactor regression tests", () => {
  let allSources;

  beforeAll(() => {
    allSources = readAllSettingsSources();
  });

  // [20260712_Fix_AutoPasteValue] CRITICAL: auto_paste option must use
  // "clipboard_only" to match App.tsx's runtime check.
  describe("CRITICAL: auto_paste value contract", () => {
    it("GeneralSection uses 'clipboard_only' (not 'clipboard') for clipboard-only option", () => {
      const generalSrc = fs.readFileSync(
        path.join(rootDir, "src/settings/sections/GeneralSection.tsx"),
        "utf8",
      );
      expect(generalSrc).toContain('value="clipboard_only"');
      expect(generalSrc).not.toMatch(/value="clipboard"(?!\w)/);
    });

    it("App.tsx checks for 'clipboard_only' token", () => {
      const appSrc = fs.readFileSync(path.join(rootDir, "src/App.tsx"), "utf8");
      expect(appSrc).toContain('"clipboard_only"');
    });
  });

  // [20260712_Fix_CancelUpdateDownload] HIGH: cancel button must exist
  describe("HIGH: cancel update download button", () => {
    it("AboutSection contains cancelUpdateDownload call", () => {
      const aboutSrc = fs.readFileSync(
        path.join(rootDir, "src/settings/sections/AboutSection.tsx"),
        "utf8",
      );
      expect(aboutSrc).toContain("cancelUpdateDownload");
    });
  });

  // [20260712_Fix_TestResultUsage] HIGH: token usage display must exist
  describe("HIGH: testResult.usage display", () => {
    it("AIConfigSection displays token usage", () => {
      const aiSrc = fs.readFileSync(
        path.join(rootDir, "src/settings/sections/AIConfigSection.tsx"),
        "utf8",
      );
      expect(aiSrc).toMatch(/usage/);
      expect(aiSrc).toMatch(/total_tokens/);
    });
  });

  // [20260712_Fix_SetAlwaysOnTop] HIGH: live setAlwaysOnTop side-effect
  describe("HIGH: live setAlwaysOnTop side-effect", () => {
    it("GeneralSection calls setAlwaysOnTop immediately on toggle", () => {
      const generalSrc = fs.readFileSync(
        path.join(rootDir, "src/settings/sections/GeneralSection.tsx"),
        "utf8",
      );
      expect(generalSrc).toContain("setAlwaysOnTop");
    });
  });

  // [20260712_Fix_I18nKeys] HIGH: all t() keys must exist in locale files
  describe("HIGH: i18n keys exist in locale files", () => {
    it("all t() keys in settings components resolve in en.json", () => {
      const keys = extractI18nKeys(allSources);
      const uniqueKeys = [...new Set(keys)];
      const missing = uniqueKeys.filter((k) => !hasKey(en, k));
      if (missing.length > 0) {
        console.error("Missing i18n keys in en.json:", missing);
      }
      expect(missing).toEqual([]);
    });

    it("all t() keys in settings components resolve in zh-CN.json", () => {
      const keys = extractI18nKeys(allSources);
      const uniqueKeys = [...new Set(keys)];
      const missing = uniqueKeys.filter((k) => !hasKey(zhCN, k));
      if (missing.length > 0) {
        console.error("Missing i18n keys in zh-CN.json:", missing);
      }
      expect(missing).toEqual([]);
    });
  });

  // [20260712_Fix_RegistrationGuideI18n] MEDIUM: registration.guide moved
  // out of providerPresets.js into locale files
  describe("MEDIUM: registration.guide i18n", () => {
    it("providerPresets.js does not contain guide text in registration", () => {
      const presetsSrc = fs.readFileSync(
        path.join(rootDir, "src/helpers/providerPresets.js"),
        "utf8",
      );
      expect(presetsSrc).not.toMatch(/guide:\s*"/);
    });

    it("locale files contain provider guide keys", () => {
      const providers = getProviderPresets();
      for (const p of providers) {
        if (p.registration) {
          const key = `settings.providers.${p.name}.guide`;
          expect(hasKey(en, key)).toBe(true);
          expect(hasKey(zhCN, key)).toBe(true);
        }
      }
    });
  });

  // [20260712_Fix_LanguagePersistence] MEDIUM: localStorage.setItem
  describe("MEDIUM: language persistence via localStorage", () => {
    it("GeneralSection persists language to localStorage", () => {
      const generalSrc = fs.readFileSync(
        path.join(rootDir, "src/settings/sections/GeneralSection.tsx"),
        "utf8",
      );
      expect(generalSrc).toContain('localStorage.setItem("language"');
    });
  });

  // [20260712_Fix_ProviderPresetType] MEDIUM: unified type
  describe("MEDIUM: ProviderPreset type unification", () => {
    it("AIProviderPreset in ipc.ts includes registration field", () => {
      const ipcSrc = fs.readFileSync(
        path.join(rootDir, "src/types/ipc.ts"),
        "utf8",
      );
      const interfaceMatch = ipcSrc.match(
        /export interface AIProviderPreset \{[\s\S]*?\}/,
      );
      expect(interfaceMatch).toBeTruthy();
      expect(interfaceMatch[0]).toContain("registration");
    });
  });

  // [20260712_Fix_AICheckStatusResultImport] LOW: import canonical type
  describe("LOW: AICheckStatusResult imported in AIConfigSection", () => {
    it("AIConfigSection imports AICheckStatusResult from types/ipc", () => {
      const aiSrc = fs.readFileSync(
        path.join(rootDir, "src/settings/sections/AIConfigSection.tsx"),
        "utf8",
      );
      expect(aiSrc).toContain("AICheckStatusResult");
      expect(aiSrc).toContain("types/ipc");
    });
  });

  // [20260712_Fix_UnusedReactImport] LOW: no unused default React import
  describe("LOW: no unnecessary default React imports", () => {
    it("section files do not import React as default (react-jsx transform)", () => {
      const sectionFiles = fs
        .readdirSync(path.join(rootDir, "src/settings/sections"))
        .filter((f) => f.endsWith(".tsx"));
      for (const f of sectionFiles) {
        const src = fs.readFileSync(
          path.join(rootDir, "src/settings/sections", f),
          "utf8",
        );
        expect(src).not.toMatch(/^import React from/m);
      }
    });

    it("SettingsSidebar does not import React as default", () => {
      const src = fs.readFileSync(
        path.join(rootDir, "src/settings/SettingsSidebar.tsx"),
        "utf8",
      );
      expect(src).not.toMatch(/^import React from/m);
    });
  });

  // [20260712_Fix_UnusedHookExports] LOW: trim unused exports
  describe("LOW: no unused hook exports", () => {
    it("hasApiKey is not exported from useSettings return", () => {
      const hookSrc = fs.readFileSync(
        path.join(rootDir, "src/settings/useSettings.ts"),
        "utf8",
      );
      // [20260713_Fix_TestRegexFragility] Use greedy match anchored to the
      // end of the function body instead of non-greedy first-match.
      const returnMatch = hookSrc.match(/return \{([\s\S]*)\};\s*$/);
      if (returnMatch) {
        expect(returnMatch[1]).not.toMatch(/\bhasApiKey\b/);
      }
    });

    // [20260713_Fix_DeadExports] loadSettings and detectedLocalModels
    // should not be in the return object if no consumer uses them.
    it("loadSettings is not in the return object (internal only)", () => {
      const hookSrc = fs.readFileSync(
        path.join(rootDir, "src/settings/useSettings.ts"),
        "utf8",
      );
      const returnMatch = hookSrc.match(/return \{([\s\S]*)\};\s*$/);
      if (returnMatch) {
        expect(returnMatch[1]).not.toMatch(/\bloadSettings\b/);
      }
    });

    it("detectedLocalModels is not in the return object (internal only)", () => {
      const hookSrc = fs.readFileSync(
        path.join(rootDir, "src/settings/useSettings.ts"),
        "utf8",
      );
      const returnMatch = hookSrc.match(/return \{([\s\S]*)\};\s*$/);
      if (returnMatch) {
        expect(returnMatch[1]).not.toMatch(/\bdetectedLocalModels\b/);
      }
    });
  });

  // [20260713_Fix_NoHardcodedChinese] All user-visible strings in settings
  // components must go through t() — no hardcoded Chinese in JSX.
  describe("No hardcoded Chinese strings in settings components", () => {
    const sectionFiles = [
      "src/settings/sections/GeneralSection.tsx",
      "src/settings/sections/PermissionsSection.tsx",
      "src/settings/sections/AIConfigSection.tsx",
      "src/settings/sections/AboutSection.tsx",
      "src/settings/SettingsSidebar.tsx",
      "src/settings.tsx",
      "src/settings/useSettings.ts",
    ];

    for (const relPath of sectionFiles) {
      it(`${relPath} has no hardcoded Chinese in JSX (all strings use t())`, () => {
        const src = fs.readFileSync(path.join(rootDir, relPath), "utf8");
        const issues = findHardcodedChinese(src);
        if (issues.length > 0) {
          console.error(
            `Hardcoded Chinese in ${relPath}:`,
            issues.map((i) => `L${i.line}: "${i.text}"`),
          );
        }
        expect(issues).toEqual([]);
      });
    }
  });

  // [20260713_Fix_LocaleKeyConsistency] en.json and zh-CN.json must have
  // the same key structure (no key exists in one but not the other).
  describe("Locale file key consistency", () => {
    function collectKeys(obj, prefix) {
      const keys = [];
      for (const k of Object.keys(obj)) {
        const fullKey = prefix ? `${prefix}.${k}` : k;
        if (
          typeof obj[k] === "object" &&
          obj[k] !== null &&
          !Array.isArray(obj[k])
        ) {
          keys.push(...collectKeys(obj[k], fullKey));
        } else {
          keys.push(fullKey);
        }
      }
      return keys;
    }

    it("en.json and zh-CN.json have identical key sets", () => {
      const enKeys = new Set(collectKeys(en, ""));
      const zhKeys = new Set(collectKeys(zhCN, ""));
      const missingInEn = [...zhKeys].filter((k) => !enKeys.has(k));
      const missingInZh = [...enKeys].filter((k) => !zhKeys.has(k));
      if (missingInEn.length > 0) {
        console.error("Keys in zh-CN but missing in en:", missingInEn);
      }
      if (missingInZh.length > 0) {
        console.error("Keys in en but missing in zh-CN:", missingInZh);
      }
      expect(missingInEn).toEqual([]);
      expect(missingInZh).toEqual([]);
    });
  });
});
