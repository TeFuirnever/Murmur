import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import path from "path";

const distDir = path.resolve(__dirname, "../../dist");

function readPage(relativePath: string): string {
  return fs.readFileSync(path.join(distDir, relativePath), "utf-8");
}

function extractMetaContent(html: string, name: string): string | null {
  const match = html.match(
    new RegExp(`<meta[^>]*name=["']${name}["'][^>]*content=["']([^"']*)["']`),
  );
  return match ? match[1] : null;
}

function extractMetaProperty(html: string, prop: string): string | null {
  const match = html.match(
    new RegExp(
      `<meta[^>]*property=["']${prop}["'][^>]*content=["']([^"']*)["']`,
    ),
  );
  return match ? match[1] : null;
}

function extractJsonLd(html: string): Record<string, unknown> | null {
  const match = html.match(
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/,
  );
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

describe("SEO meta tags", () => {
  beforeAll(() => {
    if (!fs.existsSync(distDir)) {
      throw new Error("Run `npm run build` before tests.");
    }
  });

  const pages = [
    { path: "index.html", lang: "en", url: "/Murmur" },
    { path: "zh/index.html", lang: "zh", url: "/Murmur/zh/" },
  ];

  for (const page of pages) {
    describe(`${page.lang} page (${page.path})`, () => {
      let html: string;

      beforeAll(() => {
        html = readPage(page.path);
      });

      it(`has <html lang="${page.lang}">`, () => {
        expect(html).toContain(`lang="${page.lang}"`);
      });

      it("has title and meta description", () => {
        expect(html).toMatch(/<title>.+<\/title>/);
        const desc = extractMetaContent(html, "description");
        expect(desc).not.toBeNull();
        expect(desc!.length).toBeGreaterThan(10);
      });

      it("has complete OG tags", () => {
        expect(extractMetaProperty(html, "og:type")).toBeTruthy();
        expect(extractMetaProperty(html, "og:title")).toBeTruthy();
        expect(extractMetaProperty(html, "og:description")).toBeTruthy();
        expect(extractMetaProperty(html, "og:image")).toBeTruthy();
        expect(extractMetaProperty(html, "og:url")).toBeTruthy();
      });

      it("has Twitter Card tags", () => {
        const card = extractMetaContent(html, "twitter:card");
        expect(card).toBeTruthy();
        expect(extractMetaContent(html, "twitter:title")).toBeTruthy();
        expect(extractMetaContent(html, "twitter:description")).toBeTruthy();
      });

      it("has valid JSON-LD", () => {
        const jsonLd = extractJsonLd(html);
        expect(jsonLd).not.toBeNull();
        expect(jsonLd!["@type"]).toBe("SoftwareApplication");
        expect(jsonLd!["name"]).toBe("Murmur");
      });

      it("has canonical URL", () => {
        expect(html).toMatch(
          new RegExp(
            `<link[^>]*rel="canonical"[^>]*href="[^"]*${page.url.replace("/", "\\/")}"`,
          ),
        );
      });

      it("has favicon reference", () => {
        expect(html).toContain('rel="icon"');
        expect(html).toContain("favicon.svg");
      });

      it("has theme-color meta", () => {
        const themeColor = extractMetaContent(html, "theme-color");
        expect(themeColor).toBeTruthy();
      });
    });
  }
});
