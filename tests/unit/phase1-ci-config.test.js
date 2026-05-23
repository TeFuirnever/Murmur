import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const rootDir = path.resolve(__dirname, "../../");

describe("Phase 1: CI/CD configuration", () => {
  describe("dependabot.yml", () => {
    it("should exist", () => {
      expect(fs.existsSync(path.join(rootDir, ".github/dependabot.yml"))).toBe(true);
    });

    it("should configure npm ecosystem", () => {
      const content = fs.readFileSync(path.join(rootDir, ".github/dependabot.yml"), "utf8");
      expect(content).toContain("package-ecosystem: npm");
    });

    it("should configure github-actions ecosystem", () => {
      const content = fs.readFileSync(path.join(rootDir, ".github/dependabot.yml"), "utf8");
      expect(content).toContain("package-ecosystem: github-actions");
    });

    it("should use weekly schedule", () => {
      const content = fs.readFileSync(path.join(rootDir, ".github/dependabot.yml"), "utf8");
      expect(content).toContain("interval: weekly");
    });
  });

  describe("ci.yml", () => {
    it("should use Node 22 consistently", () => {
      const content = fs.readFileSync(path.join(rootDir, ".github/workflows/ci.yml"), "utf8");
      expect(content).toContain("node-version: 22");
      // Should NOT contain node-version: 24
      expect(content).not.toContain("node-version: 24");
    });

    it("should have pnpm cache enabled", () => {
      const content = fs.readFileSync(path.join(rootDir, ".github/workflows/ci.yml"), "utf8");
      expect(content).toContain("cache: pnpm");
    });

    it("should have security audit step", () => {
      const content = fs.readFileSync(path.join(rootDir, ".github/workflows/ci.yml"), "utf8");
      expect(content).toContain("pnpm audit");
    });
  });

  describe("build.yml", () => {
    let content;

    beforeAll(() => {
      content = fs.readFileSync(path.join(rootDir, ".github/workflows/build.yml"), "utf8");
    });

    it("should use Node 22 for all jobs", () => {
      const nodeVersions = [...content.matchAll(/node-version:\s*(\d+)/g)].map(m => m[1]);
      expect(nodeVersions.length).toBeGreaterThanOrEqual(3);
      for (const v of nodeVersions) {
        expect(v).toBe("22");
      }
    });

    it("should generate SHA256 checksums for macOS", () => {
      expect(content).toContain("shasum -a 256");
    });

    it("should generate SHA256 checksums for Windows", () => {
      expect(content).toContain("Get-FileHash");
    });

    it("should upload checksum files as artifacts", () => {
      expect(content).toContain("checksums-sha256.txt");
    });

    it("should include checksums in GitHub Release", () => {
      expect(content).toMatch(/checksums-sha256\.txt/);
      expect(content).toContain("Verify download integrity");
    });

    it("should have CSC_IDENTITY_AUTO_DISCOVERY=false for macOS", () => {
      expect(content).toContain("CSC_IDENTITY_AUTO_DISCOVERY=false pnpm electron-builder --mac");
    });

    it("should have CSC_IDENTITY_AUTO_DISCOVERY=false for Windows", () => {
      expect(content).toContain("CSC_IDENTITY_AUTO_DISCOVERY=false pnpm electron-builder --win");
    });

    it("should have pnpm cache in all jobs", () => {
      const cacheCount = (content.match(/cache: pnpm/g) || []).length;
      expect(cacheCount).toBeGreaterThanOrEqual(3);
    });
  });
});
