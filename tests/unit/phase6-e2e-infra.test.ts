// [20260725_Tier3_Phase6Migrate] Migrated from .js to .ts as part of
// Tier 3 batch 1. Pattern: declare explicit types for `let` bindings
// assigned in beforeAll (TS7034). `pkg` is JSON-parsed so it's typed
// as the structural subset this test reads (scripts + devDependencies).
// Template reference: phase4-i18n.test.ts (commit d52f2e0).
import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import path from "path";

const rootDir = path.resolve(__dirname, "../../");

describe("Phase 6: E2E testing infrastructure", () => {
  describe("Playwright dependency", () => {
    // [20260725_Tier3_Phase6Migrate] Structural type covers only what
    // this test reads; avoids `any` (forbidden by backend-type-safety).
    let pkg: {
      devDependencies?: Record<string, string>;
      scripts?: Record<string, string>;
    };

    beforeAll(() => {
      pkg = JSON.parse(
        fs.readFileSync(path.join(rootDir, "package.json"), "utf8"),
      );
    });

    it("should have playwright-core as dev dependency", () => {
      const devDeps = pkg.devDependencies || {};
      expect(devDeps).toHaveProperty("playwright-core");
    });
  });

  describe("E2E test files", () => {
    it("should have e2e test directory", () => {
      const e2eDir = path.join(rootDir, "tests/e2e");
      expect(fs.existsSync(e2eDir)).toBe(true);
    });

    it("should have e2e suite directory", () => {
      const suitesDir = path.join(rootDir, "tests/e2e/suites");
      expect(fs.existsSync(suitesDir)).toBe(true);
    });

    it("should have lifecycle test suite", () => {
      const files = fs.readdirSync(path.join(rootDir, "tests/e2e/suites"));
      const hasLifecycle = files.some((f) => f.includes("lifecycle"));
      expect(hasLifecycle).toBe(true);
    });

    it("should have settings test suite", () => {
      const files = fs.readdirSync(path.join(rootDir, "tests/e2e/suites"));
      const hasSettings = files.some((f) => f.includes("settings"));
      expect(hasSettings).toBe(true);
    });

    it("should have IPC-level test suites", () => {
      const files = fs.readdirSync(path.join(rootDir, "tests/e2e/suites"));
      const hasRecording = files.some((f) => f.includes("recording"));
      const hasErrors = files.some((f) => f.includes("error"));
      expect(hasRecording || hasErrors).toBe(true);
    });
  });

  describe("E2E test configuration", () => {
    it("should have playwright config", () => {
      // [20260726_Tier43_E2EHelpers] Renamed playwright.config.js → .ts
      // (Tier 4.3 e2e migration). Accept either extension for compat.
      const configJs = path.join(rootDir, "playwright.config.js");
      const configTs = path.join(rootDir, "playwright.config.ts");
      expect(fs.existsSync(configJs) || fs.existsSync(configTs)).toBe(true);
    });

    let configContent: string;

    beforeAll(() => {
      // [20260726_Tier43_E2EHelpers] Try .ts first (post-migration), fall
      // back to .js for pre-migration compatibility.
      const configTs = path.join(rootDir, "playwright.config.ts");
      const configJs = path.join(rootDir, "playwright.config.js");
      if (fs.existsSync(configTs)) {
        configContent = fs.readFileSync(configTs, "utf8");
      } else if (fs.existsSync(configJs)) {
        configContent = fs.readFileSync(configJs, "utf8");
      }
    });

    it("should configure timeout for Electron startup", () => {
      expect(configContent).toMatch(/timeout/);
    });
  });

  describe("Lifecycle test content", () => {
    let content: string;

    beforeAll(() => {
      const suitesDir = path.join(rootDir, "tests/e2e/suites");
      const files = fs.readdirSync(suitesDir);
      const lifecycleFile = files.find((f) => f.includes("lifecycle"));
      if (lifecycleFile) {
        content = fs.readFileSync(path.join(suitesDir, lifecycleFile), "utf8");
      }
    });

    it("should exist", () => {
      expect(content).toBeDefined();
    });

    it("should use launchElectronApp helper", () => {
      expect(content).toMatch(/launchElectronApp/);
    });

    it("should verify window is visible", () => {
      expect(content).toMatch(/isVisible|Window|window/);
    });
  });

  describe("E2E test script in package.json", () => {
    let pkg: { scripts?: Record<string, string> };

    beforeAll(() => {
      pkg = JSON.parse(
        fs.readFileSync(path.join(rootDir, "package.json"), "utf8"),
      );
    });

    it("should have test:e2e script", () => {
      expect(pkg.scripts).toHaveProperty("test:e2e");
    });
  });

  describe("CI integration", () => {
    let ciContent: string;

    beforeAll(() => {
      const ciPath = path.join(rootDir, ".github/workflows/ci.yml");
      if (fs.existsSync(ciPath)) {
        ciContent = fs.readFileSync(ciPath, "utf8");
      }
    });

    it("should reference e2e in CI", () => {
      expect(ciContent).toMatch(/e2e|test:e2e|playwright/);
    });
  });
});
