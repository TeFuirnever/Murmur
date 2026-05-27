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
});
