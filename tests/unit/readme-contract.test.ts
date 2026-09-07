// [20260907_Spec299_DocsContract] Docs contract test: pins README factual
// claims to their sources of truth so drift turns CI red instead of
// surfacing in a manual audit (Spec #299, audit report
// docs/research/readme-end-to-end-audit-2026-09-07.md). Assertions are
// added incrementally per ticket and must land green: version pins (T1),
// link integrity (T2), zh/en heading parity after the bilingual split (T3).
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  engines?: { node?: string };
}

const ROOT = path.resolve(__dirname, "../..");

function readRootFile(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function readPackageJson(): PackageJson {
  return JSON.parse(readRootFile("package.json")) as PackageJson;
}

function majorOf(versionRange: string): string {
  const digits = versionRange.replace(/[^0-9.]/g, "");
  return digits.split(".")[0] ?? "";
}

// Contract assertions must evaluate the RENDERED document: HTML comments
// (change-tag annotations, commented-out placeholders) are invisible to
// readers and must not be pinned or scanned.
function stripHtmlComments(markdown: string): string {
  return markdown.replace(/<!--[\s\S]*?-->/g, "");
}

function readRenderedRootFile(relativePath: string): string {
  return stripHtmlComments(readRootFile(relativePath));
}

describe("README contract", () => {
  describe("version pins (T1, Spec #299)", () => {
    it("every Electron major mentioned in README matches package.json", () => {
      const pkg = readPackageJson();
      const electronRange =
        pkg.devDependencies?.electron ?? pkg.dependencies?.electron;
      expect(
        electronRange,
        "electron must be declared in package.json",
      ).toBeDefined();
      const expected = `Electron ${majorOf(electronRange ?? "")}`;

      const readme = readRenderedRootFile("README.md");
      const mentions = readme.match(/Electron\s+\d+(?:\.\d+)*/g) ?? [];
      expect(
        mentions.length,
        "README tech-stack table must mention Electron",
      ).toBeGreaterThan(0);
      for (const mention of mentions) {
        expect(
          mention,
          `stale Electron version in README (package.json says ${electronRange})`,
        ).toBe(expected);
      }
    });

    it("Node.js floor stated in README matches package.json engines", () => {
      const pkg = readPackageJson();
      const enginesNode = pkg.engines?.node;
      expect(
        enginesNode,
        "engines.node must be declared in package.json",
      ).toBeDefined();
      // engines ">=22.5" -> README states the same floor as "**Node.js** 22.5+"
      const floor = enginesNode?.replace(/^>=?/, "") ?? "";

      const readme = readRenderedRootFile("README.md");
      expect(
        readme.includes(`**Node.js** ${floor}+`),
        `README Node.js floor must equal engines.node (${enginesNode})`,
      ).toBe(true);
    });
  });
});
