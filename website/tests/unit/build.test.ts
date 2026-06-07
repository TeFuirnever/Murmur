import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import path from "path";

const distDir = path.resolve(__dirname, "../../dist");

describe("build output", () => {
  beforeAll(() => {
    if (!fs.existsSync(distDir)) {
      throw new Error(
        "dist/ directory not found. Run `npm run build` before tests.",
      );
    }
  });

  it("dist directory exists and is non-empty", () => {
    const files = fs.readdirSync(distDir);
    expect(files.length).toBeGreaterThan(0);
  });

  it("required HTML pages exist", () => {
    expect(fs.existsSync(path.join(distDir, "index.html"))).toBe(true);
    expect(fs.existsSync(path.join(distDir, "zh", "index.html"))).toBe(true);
    expect(fs.existsSync(path.join(distDir, "404.html"))).toBe(true);
  });

  it("static assets exist", () => {
    expect(fs.existsSync(path.join(distDir, "favicon.svg"))).toBe(true);
    expect(fs.existsSync(path.join(distDir, "robots.txt"))).toBe(true);
  });

  it("sitemap is generated", () => {
    const sitemap = path.join(distDir, "sitemap-index.xml");
    expect(fs.existsSync(sitemap)).toBe(true);
    const content = fs.readFileSync(sitemap, "utf-8");
    expect(content).toContain("tefuirnever.github.io/Murmur");
  });

  it("CSS bundle is generated", () => {
    const astroDir = path.join(distDir, "_astro");
    expect(fs.existsSync(astroDir)).toBe(true);
    const cssFiles = fs.readdirSync(astroDir).filter((f) => f.endsWith(".css"));
    expect(cssFiles.length).toBeGreaterThan(0);
  });

  it("HTML files are valid (DOCTYPE + closing tag)", () => {
    const htmlFiles = [
      path.join(distDir, "index.html"),
      path.join(distDir, "zh", "index.html"),
      path.join(distDir, "404.html"),
    ];
    for (const file of htmlFiles) {
      const content = fs.readFileSync(file, "utf-8");
      expect(content, `${file}: missing DOCTYPE`).toContain("<!DOCTYPE html");
      expect(content, `${file}: missing closing tag`).toContain("</html>");
    }
  });

  // C1: React dead weight removed — no large JS client bundle
  it("no large React client bundle is shipped", () => {
    const astroDir = path.join(distDir, "_astro");
    if (!fs.existsSync(astroDir)) return;
    const jsFiles = fs.readdirSync(astroDir).filter((f) => f.endsWith(".js"));
    for (const jsFile of jsFiles) {
      const filePath = path.join(astroDir, jsFile);
      const size = fs.statSync(filePath).size;
      // React runtime is ~195KB; without React, all JS should be < 50KB
      expect(
        size,
        `${jsFile} is ${Math.round(size / 1024)}KB — possible React runtime leak`,
      ).toBeLessThan(50 * 1024);
    }
  });

  // H2: Chinese 404 page exists
  it("Chinese 404 page exists at zh/404/", () => {
    expect(fs.existsSync(path.join(distDir, "zh", "404", "index.html"))).toBe(
      true,
    );
    const content = fs.readFileSync(
      path.join(distDir, "zh", "404", "index.html"),
      "utf-8",
    );
    expect(content).toContain('lang="zh"');
    expect(content).toContain("404");
  });
});
