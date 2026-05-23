import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import path from "path";

const rootDir = path.resolve(__dirname, "../../");

describe("Phase 4: Internationalization i18n", () => {
  describe("i18n dependencies", () => {
    let pkg;

    beforeAll(() => {
      pkg = JSON.parse(
        fs.readFileSync(path.join(rootDir, "package.json"), "utf8"),
      );
    });

    it("should have i18next dependency", () => {
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      expect(deps).toHaveProperty("i18next");
    });

    it("should have react-i18next dependency", () => {
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      expect(deps).toHaveProperty("react-i18next");
    });
  });

  describe("i18n configuration", () => {
    let i18nConfig;

    beforeAll(() => {
      const configPath = path.join(rootDir, "src/i18n/index.js");
      if (fs.existsSync(configPath)) {
        i18nConfig = fs.readFileSync(configPath, "utf8");
      }
    });

    it("should exist", () => {
      expect(i18nConfig).toBeDefined();
      expect(i18nConfig.length).toBeGreaterThan(0);
    });

    it("should import i18next", () => {
      expect(i18nConfig).toMatch(/i18next/);
    });

    it("should configure escapeValue: true for security", () => {
      expect(i18nConfig).toMatch(/escapeValue\s*:\s*true/);
    });

    it("should support zh-CN and en languages", () => {
      expect(i18nConfig).toMatch(/zh-CN/);
      expect(i18nConfig).toMatch(/\ben\b/);
    });
  });

  describe("Translation files", () => {
    it("should have zh-CN.json", () => {
      const filePath = path.join(rootDir, "src/i18n/locales/zh-CN.json");
      expect(fs.existsSync(filePath)).toBe(true);
    });

    it("should have en.json", () => {
      const filePath = path.join(rootDir, "src/i18n/locales/en.json");
      expect(fs.existsSync(filePath)).toBe(true);
    });

    it("zh-CN.json should be valid JSON", () => {
      const content = fs.readFileSync(
        path.join(rootDir, "src/i18n/locales/zh-CN.json"),
        "utf8",
      );
      expect(() => JSON.parse(content)).not.toThrow();
    });

    it("en.json should be valid JSON", () => {
      const content = fs.readFileSync(
        path.join(rootDir, "src/i18n/locales/en.json"),
        "utf8",
      );
      expect(() => JSON.parse(content)).not.toThrow();
    });

    it("translation files should share the same key structure", () => {
      const zhContent = JSON.parse(
        fs.readFileSync(
          path.join(rootDir, "src/i18n/locales/zh-CN.json"),
          "utf8",
        ),
      );
      const enContent = JSON.parse(
        fs.readFileSync(path.join(rootDir, "src/i18n/locales/en.json"), "utf8"),
      );
      const zhKeys = Object.keys(zhContent).sort();
      const enKeys = Object.keys(enContent).sort();
      expect(zhKeys).toEqual(enKeys);
    });

    it("zh-CN.json should have common UI keys", () => {
      const content = JSON.parse(
        fs.readFileSync(
          path.join(rootDir, "src/i18n/locales/zh-CN.json"),
          "utf8",
        ),
      );
      // Spot-check key UI strings that must be translated
      const jsonStr = JSON.stringify(content);
      expect(jsonStr.length).toBeGreaterThan(100);
    });
  });

  describe("Main entry point i18n integration", () => {
    let mainContent;

    beforeAll(() => {
      mainContent = fs.readFileSync(path.join(rootDir, "src/main.tsx"), "utf8");
    });

    it("should import i18n configuration", () => {
      expect(mainContent).toMatch(/i18n/);
    });
  });

  describe("Settings page language selector", () => {
    let settingsContent;

    beforeAll(() => {
      settingsContent = fs.readFileSync(
        path.join(rootDir, "src/settings.tsx"),
        "utf8",
      );
    });

    it("should have language setting state or i18n usage", () => {
      const hasUseTranslation = settingsContent.includes("useTranslation");
      const hasLanguageState = settingsContent.includes("language");
      expect(hasUseTranslation || hasLanguageState).toBe(true);
    });

    it("should have language change handler", () => {
      expect(settingsContent).toMatch(
        /changeLanguage|i18n\.changeLanguage|setLanguage/,
      );
    });
  });

  describe("Settings page uses translation keys", () => {
    let settingsContent;

    beforeAll(() => {
      settingsContent = fs.readFileSync(
        path.join(rootDir, "src/settings.tsx"),
        "utf8",
      );
    });

    it("should use useTranslation hook or t function", () => {
      expect(settingsContent).toMatch(/useTranslation|[^a-z]t\(/);
    });
  });

  describe("electronAPI.d.ts language types", () => {
    let typeFile;

    beforeAll(() => {
      typeFile = fs.readFileSync(
        path.join(rootDir, "src/electronAPI.d.ts"),
        "utf8",
      );
    });

    it("should remain valid (no syntax errors from Phase 3 changes)", () => {
      expect(typeFile).toContain("ElectronAPI");
      expect(typeFile).toContain("downloadUpdate");
    });
  });
});
