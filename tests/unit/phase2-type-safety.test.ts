// [20260725_Tier3_Phase2Migrate] Migrated from .js to .ts as part of
// Tier 3 batch 1. Pattern: declare explicit types for `let` bindings
// assigned in beforeAll (TS7034). tsconfig + typeFile are JSON-parsed /
// string-read so they're typed structurally (only fields this test reads).
// Template reference: phase4-i18n.test.ts (commit d52f2e0).
import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import path from "path";

const rootDir = path.resolve(__dirname, "../../");

describe("Phase 2: Type safety gradual enhancement", () => {
  describe("tsconfig.json for renderer process", () => {
    // [20260725_Tier3_Phase2Migrate] Structural subset of tsconfig.json
    // — only the fields this test reads. Avoids `any`.
    let tsconfig: {
      compilerOptions?: {
        allowJs?: boolean;
        checkJs?: boolean;
        strict?: boolean;
        module?: string;
        jsx?: string;
      };
      include?: string[] | string;
      exclude?: string[];
    };

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
      expect(tsconfig.compilerOptions?.allowJs).toBe(true);
    });

    it("should not have checkJs enabled (gradual migration)", () => {
      expect(tsconfig.compilerOptions?.checkJs).toBeFalsy();
    });

    it("should have strict mode enabled for full type safety", () => {
      expect(tsconfig.compilerOptions?.strict).toBe(true);
    });

    it("should target ESNext modules for Vite compatibility", () => {
      expect(tsconfig.compilerOptions?.module).toMatch(/ESNext|esnext/i);
    });

    it("should have jsx set to react-jsx", () => {
      expect(tsconfig.compilerOptions?.jsx).toBe("react-jsx");
    });

    it("should include src directory", () => {
      const includes = Array.isArray(tsconfig.include)
        ? tsconfig.include
        : [tsconfig.include ?? ""];
      expect(includes.some((i) => i.includes("src"))).toBe(true);
    });

    it("should exclude node_modules", () => {
      const excludes = tsconfig.exclude || [];
      expect(excludes.some((e) => e.includes("node_modules"))).toBe(true);
    });
  });

  // [20260725_Autopilot_T1.1] Retired the jsconfig.json describe block.
  // jsconfig.json was deleted because it referenced dead main.js/preload.js
  // after the ADR-010 big-bang migration. The whole rationale (checkJs for
  // untyped .js main process) no longer applies — main is now main.ts and
  // covered by tsconfig.json strict mode directly.
  // Original block asserted: jsconfig exists + checkJs === true.

  describe("electronAPI.d.ts type declarations", () => {
    let typeFile: string;

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

  describe("ipc-contracts type annotations", () => {
    let contracts: string;

    beforeAll(() => {
      // [20260724_TS_Migration_IpcContracts] Now reads from .ts source of truth
      contracts = fs.readFileSync(
        path.join(rootDir, "src/helpers/ipc-contracts.ts"),
        "utf8",
      );
    });

    it("should use TypeScript 'as const' for type safety", () => {
      expect(contracts).toMatch(/as\s+const/);
    });

    it("should NOT use const enum (incompatible with esbuild)", () => {
      expect(contracts).not.toContain("const enum");
    });
  });

  describe("Vite config supports TS", () => {
    let viteConfig: string;

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
