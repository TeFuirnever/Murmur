import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import path from "path";

const rootDir = path.resolve(__dirname, "../../");

describe("Phase 6: E2E testing infrastructure", () => {
  describe("Playwright dependency", () => {
    let pkg;

    beforeAll(() => {
      pkg = JSON.parse(
        fs.readFileSync(path.join(rootDir, "package.json"), "utf8")
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

    it("should have launch test file", () => {
      const files = fs.readdirSync(path.join(rootDir, "tests/e2e"));
      const hasLaunch = files.some((f) => f.includes("launch"));
      expect(hasLaunch).toBe(true);
    });

    it("should have settings test file", () => {
      const files = fs.readdirSync(path.join(rootDir, "tests/e2e"));
      const hasSettings = files.some((f) => f.includes("settings"));
      expect(hasSettings).toBe(true);
    });

    it("should have IPC test file", () => {
      const files = fs.readdirSync(path.join(rootDir, "tests/e2e"));
      const hasIPC = files.some((f) => f.includes("ipc"));
      expect(hasIPC).toBe(true);
    });
  });

  describe("E2E test configuration", () => {
    it("should have playwright config", () => {
      const configPath = path.join(rootDir, "playwright.config.js");
      expect(fs.existsSync(configPath)).toBe(true);
    });

    let configContent;

    beforeAll(() => {
      const configPath = path.join(rootDir, "playwright.config.js");
      if (fs.existsSync(configPath)) {
        configContent = fs.readFileSync(configPath, "utf8");
      }
    });

    it("should configure timeout for Electron startup", () => {
      expect(configContent).toMatch(/timeout/);
    });
  });

  describe("Launch test content", () => {
    let content;

    beforeAll(() => {
      const e2eDir = path.join(rootDir, "tests/e2e");
      const files = fs.readdirSync(e2eDir);
      const launchFile = files.find((f) => f.includes("launch"));
      if (launchFile) {
        content = fs.readFileSync(path.join(e2eDir, launchFile), "utf8");
      }
    });

    it("should exist", () => {
      expect(content).toBeDefined();
    });

    it("should use electron.launch", () => {
      expect(content).toMatch(/electron.*launch|_electron.*launch/);
    });

    it("should verify window is visible", () => {
      expect(content).toMatch(/isVisible|Window|window/);
    });
  });

  describe("E2E test script in package.json", () => {
    let pkg;

    beforeAll(() => {
      pkg = JSON.parse(
        fs.readFileSync(path.join(rootDir, "package.json"), "utf8")
      );
    });

    it("should have test:e2e script", () => {
      expect(pkg.scripts).toHaveProperty("test:e2e");
    });
  });

  describe("CI integration", () => {
    let ciContent;

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
