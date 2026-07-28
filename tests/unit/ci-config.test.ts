// [20260725_Tier3_CiConfigMigrate] Migrated from .js to .ts as part of
// Tier 3 batch 1. No `let` bindings — pure JSON.parse + fs reads, so
// type annotations are inferred. Renamed for consistency with the
// TS migration goal (Tier 3.1 in ts-migration-audit-and-evolution.md §5).
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("CI/CD configuration", () => {
  const root = path.resolve(__dirname, "../..");

  describe("lint-staged config", () => {
    it("has lint-staged config in package.json", () => {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(root, "package.json"), "utf8"),
      );
      expect(pkg["lint-staged"]).toBeDefined();
    });

    it("lint-staged runs eslint --fix on JS/TS files", () => {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(root, "package.json"), "utf8"),
      );
      const config = pkg["lint-staged"];
      const jsPattern = "*.{js,jsx,ts,tsx}";
      expect(config[jsPattern]).toBeDefined();
      const commands = Array.isArray(config[jsPattern])
        ? config[jsPattern]
        : [config[jsPattern]];
      const hasEslint = commands.some(
        (cmd) => typeof cmd === "string" && cmd.includes("eslint"),
      );
      expect(hasEslint).toBe(true);
    });

    it("lint-staged runs prettier --write on JS/TS files", () => {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(root, "package.json"), "utf8"),
      );
      const config = pkg["lint-staged"];
      const jsPattern = "*.{js,jsx,ts,tsx}";
      const commands = Array.isArray(config[jsPattern])
        ? config[jsPattern]
        : [config[jsPattern]];
      const hasPrettier = commands.some(
        (cmd) => typeof cmd === "string" && cmd.includes("prettier"),
      );
      expect(hasPrettier).toBe(true);
    });

    it("lint-staged runs prettier --write on other file types", () => {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(root, "package.json"), "utf8"),
      );
      const config = pkg["lint-staged"];
      const otherPattern = "*.{json,md,yml,css}";
      expect(config[otherPattern]).toBeDefined();
    });
  });

  describe("husky setup", () => {
    it("husky is a devDependency", () => {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(root, "package.json"), "utf8"),
      );
      expect(pkg.devDependencies.husky).toBeDefined();
    });

    it("lint-staged is a devDependency", () => {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(root, "package.json"), "utf8"),
      );
      expect(pkg.devDependencies["lint-staged"]).toBeDefined();
    });

    it("package.json has prepare script for husky", () => {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(root, "package.json"), "utf8"),
      );
      expect(pkg.scripts.prepare).toBe("husky");
    });

    it(".husky/pre-commit hook exists and runs lint-staged", () => {
      const hookPath = path.join(root, ".husky", "pre-commit");
      expect(fs.existsSync(hookPath)).toBe(true);
      const content = fs.readFileSync(hookPath, "utf8");
      expect(content).toContain("lint-staged");
    });
  });

  describe("Dependabot config", () => {
    it(".github/dependabot.yml exists", () => {
      expect(fs.existsSync(path.join(root, ".github", "dependabot.yml"))).toBe(
        true,
      );
    });

    it("configures npm ecosystem with weekly schedule", () => {
      const content = fs.readFileSync(
        path.join(root, ".github", "dependabot.yml"),
        "utf8",
      );
      expect(content).toContain("npm");
      expect(content).toContain("weekly");
    });
  });

  describe("GitHub Actions Node 24 readiness", () => {
    it("ci.yml sets FORCE_JAVASCRIPT_ACTIONS_TO_NODE24", () => {
      const ci = fs.readFileSync(
        path.join(root, ".github", "workflows", "ci.yml"),
        "utf8",
      );
      expect(ci).toContain("FORCE_JAVASCRIPT_ACTIONS_TO_NODE24");
    });

    it("build.yml sets FORCE_JAVASCRIPT_ACTIONS_TO_NODE24", () => {
      const build = fs.readFileSync(
        path.join(root, ".github", "workflows", "build.yml"),
        "utf8",
      );
      expect(build).toContain("FORCE_JAVASCRIPT_ACTIONS_TO_NODE24");
    });
  });

  // [20260724_Fix_DevModeTsxLoader] Regression guard: Electron 36 loads .ts
  // entry files via the ESM loader. --require tsx/cjs only patches CJS
  // Module._extensions, which the ESM loader ignores, causing
  // ERR_UNKNOWN_FILE_EXTENSION. --import tsx/esm registers an ESM loader hook.
  describe("dev mode entry point loading", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(root, "package.json"), "utf8"),
    );

    it("dev:main registers tsx via NODE_OPTIONS (CLI --import is swallowed by Electron)", () => {
      const devMain = pkg.scripts["dev:main"];
      // Electron 36 does not forward a CLI --import to its internal Node ESM
      // loader: `electron --import tsx/esm main.ts` treats tsx/esm as the app
      // path (silent hang) and never loads main.ts. tsx must be registered via
      // NODE_OPTIONS so Electron's own Node picks up the loader hook.
      expect(devMain).toMatch(/NODE_OPTIONS=['"]?.*--import tsx( |['"]|$)/);
      expect(devMain).not.toContain("--require tsx/cjs");
    });

    it("prestart builds main bundle before electron . (which reads package.json main)", () => {
      const prestart = pkg.scripts.prestart;
      expect(prestart).toContain("build:main");
    });
  });
  // [20260724_Fix_DevModeTsxLoader] END
});
