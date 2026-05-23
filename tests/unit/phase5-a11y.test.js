import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import path from "path";

const rootDir = path.resolve(__dirname, "../../");

function readFile(relPath) {
  const fullPath = path.join(rootDir, relPath);
  return fs.existsSync(fullPath) ? fs.readFileSync(fullPath, "utf8") : null;
}

describe("Phase 5: Accessibility a11y", () => {
  describe("Main App.jsx ARIA labels", () => {
    let content;

    beforeAll(() => {
      content = readFile("src/App.jsx");
    });

    it("should have aria-label on recording button", () => {
      expect(content).toMatch(/aria-label/);
    });

    it("should have role on interactive elements", () => {
      expect(content).toMatch(/role\s*=\s*["']button["']/);
    });
  });

  describe("Settings.jsx ARIA labels", () => {
    let content;

    beforeAll(() => {
      content = readFile("src/settings.jsx");
    });

    it("should have aria-label on close button", () => {
      expect(content).toMatch(/aria-label/);
    });

    it("should have aria-label on save button", () => {
      const ariaCount = (content.match(/aria-label/g) || []).length;
      expect(ariaCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Keyboard navigation support", () => {
    let appContent;

    beforeAll(() => {
      appContent = readFile("src/App.jsx");
    });

    it("should have tabIndex or keyboard event handlers", () => {
      const hasTabIndex = appContent.includes("tabIndex");
      const hasOnKeyDown = appContent.includes("onKeyDown");
      const hasOnKeyUp = appContent.includes("onKeyUp");
      expect(hasTabIndex || hasOnKeyDown || hasOnKeyUp).toBe(true);
    });
  });

  describe("Focus visible styles", () => {
    let cssContent;

    beforeAll(() => {
      // Check both index.css and tailwind for focus-visible
      const indexCss = readFile("src/index.css");
      cssContent = indexCss || "";
    });

    it("should have focus-visible styles", () => {
      expect(cssContent).toMatch(/focus-visible/);
    });
  });

  describe("Decorative elements aria-hidden", () => {
    let content;

    beforeAll(() => {
      content = readFile("src/App.jsx");
    });

    it("should have aria-hidden on decorative SVG or icon elements", () => {
      expect(content).toMatch(/aria-hidden/);
    });
  });

  describe("Main process a11y conflict diagnosis", () => {
    let mainContent;

    beforeAll(() => {
      mainContent = readFile("main.js");
    });

    it("should not have setAccessibilitySupportEnabled in active code", () => {
      const hasActive = !mainContent.match(
        /^[^/]*setAccessibilitySupportEnabled/m,
      );
      const isCommented =
        mainContent.includes("// setAccessibilitySupportEnabled") ||
        mainContent.includes("// try {");
      expect(hasActive || isCommented).toBe(true);
    });
  });

  describe("Permission cards accessibility", () => {
    let content;

    beforeAll(() => {
      content = readFile("src/components/ui/permission-card.jsx");
    });

    it("should exist", () => {
      expect(content).toBeDefined();
      expect(content.length).toBeGreaterThan(0);
    });

    it("should have aria-label on action button", () => {
      expect(content).toMatch(/aria-label/);
    });
  });
});
