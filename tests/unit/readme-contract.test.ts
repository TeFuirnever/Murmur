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
    // [20260912_Docs_299_ReadmeP0] Since the bilingual split (T3) each
    // language front door states the version facts independently, so a stale
    // claim in either file must turn CI red — the pins now run per file
    // instead of against README.md alone (ticket #299 batch 1).
    const pinnedVersionFiles = ["README.md", "README.zh-CN.md"];

    for (const file of pinnedVersionFiles) {
      it(`${file}: every Electron major mentioned matches package.json`, () => {
        const pkg = readPackageJson();
        const electronRange =
          pkg.devDependencies?.electron ?? pkg.dependencies?.electron;
        expect(
          electronRange,
          "electron must be declared in package.json",
        ).toBeDefined();
        const expected = `Electron ${majorOf(electronRange ?? "")}`;

        const readme = readRenderedRootFile(file);
        const mentions = readme.match(/Electron\s+\d+(?:\.\d+)*/g) ?? [];
        expect(
          mentions.length,
          "README tech-stack table must mention Electron",
        ).toBeGreaterThan(0);
        for (const mention of mentions) {
          expect(
            mention,
            `stale Electron version in ${file} (package.json says ${electronRange})`,
          ).toBe(expected);
        }
      });

      it(`${file}: Node.js floor stated matches package.json engines`, () => {
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
        const readme = readRenderedRootFile(file);
        const mentions =
          readme.match(/\*\*Node\.js\*\* \d+(?:\.\d+)*\+/g) ?? [];
        expect(
          mentions.length,
          "README must state its Node.js floor at least once",
        ).toBeGreaterThan(0);
        for (const mention of mentions) {
          expect(
            mention,
            `stale Node.js floor in ${file} (engines.node = ${enginesNode})`,
          ).toBe(`**Node.js** ${floor}+`);
        }
      });
    }
  });

  describe("link integrity (T2, Spec #299)", () => {
    // T3 extended this list with README.zh-CN.md after the bilingual split.
    // [20260912_Docs_299_ReadmeP0] CONTRIBUTING.md added per ticket #299
    // batch 1: its relative links (e.g. CODE_OF_CONDUCT.md) belong to the
    // same in-repo link contract as the READMEs.
    const readmeFiles = ["README.md", "README.zh-CN.md", "CONTRIBUTING.md"];

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

  // [20261006_Docs_IntroVideoContract] Ticket #449: the 15s intro video is
  // delivered as an inline GitHub user-attachments player (the asset is
  // hosted by issue #449 itself) plus an in-repo archive under
  // docs/promotion/intro-video/. Nothing else pins that delivery: a URL
  // swap in one language file, or a vanished archive file, would otherwise
  // ship silently. Same pin-not-scan philosophy as the Spec #299 pins
  // above — assertions are added incrementally per ticket.
  describe("intro video delivery (ticket #449)", () => {
    // Source of record for the inline player: the user-attachments asset
    // uploaded to issue #449. If a re-upload ever changes this UUID, the
    // pin going red is the signal to update BOTH language files in one
    // commit — never let them point at two different uploads.
    const INTRO_VIDEO_ASSET_URL =
      "https://github.com/user-attachments/assets/5c6f1292-9494-4188-b419-083dc0e463da";
    const introVideoReadmeFiles = ["README.md", "README.zh-CN.md"];

    // Rendered standalone-paragraph URLs only (HTML comments stripped by
    // readRenderedRootFile, so the prose mention inside the change-tag
    // comment cannot double-count).
    function embeddedIntroVideoUrls(markdown: string): string[] {
      const rendered = stripHtmlComments(markdown);
      return [
        ...rendered.matchAll(
          /^https:\/\/github\.com\/user-attachments\/\S+$/gm,
        ),
      ].map((match) => match[0] ?? "");
    }

    for (const file of introVideoReadmeFiles) {
      it(`${file}: embeds exactly the pinned issue-#449 player URL`, () => {
        const urls = embeddedIntroVideoUrls(readRenderedRootFile(file));
        expect(
          urls,
          `${file} must embed the intro video player URL exactly once`,
        ).toEqual([INTRO_VIDEO_ASSET_URL]);
      });
    }

    // The archive folder's declared deliverables must exist on disk. The
    // two MP4 links in the root READMEs are already covered by the
    // link-integrity contract; this pin adds the poster, which is declared
    // only in the archive README (in backticks, invisible to link
    // extraction), and keeps the declared trio from silently shrinking.
    // Deliberately NOT scanned: path-like backtick strings in the archive
    // README (e.g. the Remotion production project) — that project is
    // intentionally maintainer-local, excluded by .gitignore's
    // `productions/` entry, so it is not an in-repo contract.
    const introVideoArchiveDir = path.join("docs", "promotion", "intro-video");
    const introVideoArchiveFiles = [
      "murmur-intro-15s.mp4",
      "murmur-intro-15s-nobgm.mp4",
      "murmur-intro-15s-poster.jpg",
    ];

    it("archive README declares every archived deliverable", () => {
      const archiveReadme = readRootFile(
        path.join(introVideoArchiveDir, "README.md"),
      );
      for (const fileName of introVideoArchiveFiles) {
        expect(
          archiveReadme.includes(fileName),
          `archive README must declare ${fileName}`,
        ).toBe(true);
      }
    });

    it("every declared archive deliverable exists on disk", () => {
      const missing = introVideoArchiveFiles.filter(
        (fileName) => !fs.existsSync(path.join(introVideoArchiveDir, fileName)),
      );
      expect(
        missing,
        `archived intro-video deliverables missing from ${introVideoArchiveDir}: ${missing.join(", ")}`,
      ).toEqual([]);
    });
  });
  // [20261006_Docs_IntroVideoContract] END

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
