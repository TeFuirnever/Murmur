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

      // All-mentions check (same design as the Electron pin): a stale floor
      // anywhere in the document must fail, not just a missing correct one.
      const readme = readRenderedRootFile("README.md");
      const mentions = readme.match(/\*\*Node\.js\*\* \d+(?:\.\d+)*\+/g) ?? [];
      expect(
        mentions.length,
        "README must state its Node.js floor at least once",
      ).toBeGreaterThan(0);
      for (const mention of mentions) {
        expect(
          mention,
          `stale Node.js floor in README (engines.node = ${enginesNode})`,
        ).toBe(`**Node.js** ${floor}+`);
      }
    });
  });

  describe("link integrity (T2, Spec #299)", () => {
    // T3 extended this list with README.zh-CN.md after the bilingual split.
    const readmeFiles = ["README.md", "README.zh-CN.md"];

    function internalLinkTargets(markdown: string): string[] {
      const rendered = stripHtmlComments(markdown);
      // Strip image syntax first so a badge link's OUTER href becomes the
      // remaining [text](href) match; otherwise `[![alt](img)](href)` makes
      // the extractor capture only the img src and silently drop the href.
      const withoutImages = rendered.replace(/!\[[^\]]*\]\([^)\s]*\)/g, "");
      const linkPattern = /\[[^\]]*\]\(([^)\s]+)\)/g;
      const targets = [...withoutImages.matchAll(linkPattern)].map(
        (match) => match[1] ?? "",
      );
      // GitHub renders raw <img> tags too (the README logo); their src
      // points at repo assets the same contract must cover.
      const imgPattern = /<img\s[^>]*src="([^"]+)"/g;
      for (const match of rendered.matchAll(imgPattern)) {
        targets.push(match[1] ?? "");
      }
      return targets;
    }

    for (const file of readmeFiles) {
      it(`${file}: every internal link/asset path resolves on disk`, () => {
        const targets = internalLinkTargets(readRootFile(file));
        expect(
          targets.length,
          "link extractor must find the README's links",
        ).toBeGreaterThan(0);

        const broken: string[] = [];
        for (const target of targets) {
          // External URLs are out of contract scope (CI network flakiness;
          // industry link checkers exclude them the same way).
          if (/^(https?:)?\/\//.test(target) || target.startsWith("mailto:")) {
            continue;
          }
          const withoutAnchor = target.split("#")[0] ?? "";
          if (withoutAnchor === "") continue; // pure in-page anchor
          let decoded: string;
          try {
            decoded = decodeURIComponent(withoutAnchor);
          } catch {
            broken.push(target); // malformed percent-encoding IS broken
            continue;
          }
          if (!fs.existsSync(path.join(ROOT, decoded))) {
            broken.push(target);
          }
        }
        expect(broken, `broken internal links: ${broken.join(", ")}`).toEqual(
          [],
        );
      });
    }
  });

  // [20260907_Spec299_HeadingsParity] T3: the single bilingual file drifted
  // (the en half lagged zh by 9 items) because nothing detected structural
  // divergence. After the split, both files must keep a 1:1 section
  // sequence: same heading count, same heading-level order. Wording may
  // differ per language; structure may not. Scope note: this pin covers the
  // structure class (sections added/removed); wording-level drift inside a
  // section remains the PR review's job.
  describe("bilingual parity (T3, Spec #299)", () => {
    function headingLevels(markdownPath: string): number[] {
      const rendered = stripHtmlComments(readRootFile(markdownPath));
      const levels: number[] = [];
      let insideFence = false;
      let fenceCount = 0;
      for (const line of rendered.split("\n")) {
        if (line.trimStart().startsWith("```")) {
          insideFence = !insideFence; // bash `# comments` are not headings
          fenceCount += 1;
          continue;
        }
        if (insideFence) continue;
        const match = /^(#{1,6}) /.exec(line);
        if (match) levels.push((match[1] ?? "").length);
      }
      // An unbalanced fence would silently swallow every heading after it
      // and fake a parity mismatch (or hide one) — pin balance itself.
      expect(fenceCount % 2, `unbalanced code fences in ${markdownPath}`).toBe(
        0,
      );
      return levels;
    }

    it("zh and en READMEs have 1:1 section sequences", () => {
      const en = headingLevels("README.md");
      const zh = headingLevels("README.zh-CN.md");
      expect(en.length, "en/zh heading count diverged").toBe(zh.length);
      for (const [index, level] of en.entries()) {
        expect(
          level,
          `heading #${index + 1} level diverged between en and zh`,
        ).toBe(zh[index]);
      }
    });
  });
  // [20260907_Spec299_HeadingsParity] END
});
