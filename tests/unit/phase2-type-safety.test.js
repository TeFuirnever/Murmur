import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import path from "path";

const rootDir = path.resolve(__dirname, "../../");

describe("Phase 2: Type safety gradual enhancement", () => {
  describe("tsconfig.json for renderer process", () => {
    let tsconfig;

    beforeAll(() => {
      const content = fs.readFileSync(
        path.join(rootDir, "tsconfig.json"),
        "utf8",
      );
      tsconfig = JSON.parse(content);
    });

    it("should exist and be valid JSON", () => {
      expect(tsconfig).toBeDefined();
    });

    it("should have allowJs enabled", () => {
      expect(tsconfig.compilerOptions.allowJs).toBe(true);
    });

    it("should not have checkJs enabled (gradual migration)", () => {
      expect(tsconfig.compilerOptions.checkJs).toBeFalsy();
    });

    it("should have strict mode enabled for full type safety", () => {
      expect(tsconfig.compilerOptions.strict).toBe(true);
    });

    it("should target ESNext modules for Vite compatibility", () => {
      expect(tsconfig.compilerOptions.module).toMatch(/ESNext|esnext/i);
    });

    it("should have jsx set to react-jsx", () => {
      expect(tsconfig.compilerOptions.jsx).toBe("react-jsx");
    });

    it("should include src directory", () => {
      const includes = Array.isArray(tsconfig.include)
        ? tsconfig.include
        : [tsconfig.include];
      expect(includes.some((i) => i.includes("src"))).toBe(true);
    });

    it("should exclude node_modules", () => {
      const excludes = tsconfig.exclude || [];
      expect(excludes.some((e) => e.includes("node_modules"))).toBe(true);
    });
  });

  describe("jsconfig.json for main process (JSDoc + checkJs)", () => {
    let jsconfig;

    beforeAll(() => {
      const content = fs.readFileSync(
        path.join(rootDir, "jsconfig.json"),
        "utf8",
      );
      jsconfig = JSON.parse(content);
    });

    it("should exist", () => {
      expect(jsconfig).toBeDefined();
    });

    it("should have checkJs enabled for type checking JS files", () => {
      expect(jsconfig.compilerOptions.checkJs).toBe(true);
    });
  });

  describe("electronAPI.d.ts type declarations", () => {
    let typeFile;

    beforeAll(() => {
      const typePath = path.join(rootDir, "src", "electronAPI.d.ts");
      if (fs.existsSync(typePath)) {
        typeFile = fs.readFileSync(typePath, "utf8");
      }
    });

    it("should exist", () => {
      expect(typeFile).toBeDefined();
      expect(typeFile.length).toBeGreaterThan(0);
    });

    it("should declare electronAPI on window", () => {
      expect(typeFile).toContain("electronAPI");
      expect(typeFile).toContain("Window");
    });

    it("should type getSetting and setSetting", () => {
      expect(typeFile).toMatch(/getSetting/);
      expect(typeFile).toMatch(/setSetting/);
    });

    it("should type checkModelFiles", () => {
      expect(typeFile).toMatch(/checkModelFiles/);
    });

    it("should type processText", () => {
      expect(typeFile).toMatch(/processText/);
    });
  });

  describe("ipc-contracts.js type annotations", () => {
    let contracts;

    beforeAll(() => {
      contracts = fs.readFileSync(
        path.join(rootDir, "src/helpers/ipc-contracts.js"),
        "utf8",
      );
    });

    it("should have @type or @typedef JSDoc annotations", () => {
      // Should have at least one JSDoc type annotation
      expect(contracts).toMatch(/@(type|typedef|const)/);
    });

    it("should NOT use const enum (incompatible with esbuild)", () => {
      expect(contracts).not.toContain("const enum");
    });
  });

  describe("Vite config supports TS", () => {
    let viteConfig;

    beforeAll(() => {
      viteConfig = fs.readFileSync(
        path.join(rootDir, "src/vite.config.js"),
        "utf8",
      );
    });

    it("should exist", () => {
      expect(viteConfig).toBeDefined();
    });

    it("should have react plugin configured", () => {
      expect(viteConfig).toMatch(/react/);
    });
  });
});
