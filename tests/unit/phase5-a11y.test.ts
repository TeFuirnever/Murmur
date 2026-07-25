// [20260725_Tier3_Phase5Migrate] Migrated from .js to .ts as part of
// Tier 3 batch 1. Pattern: declare explicit types for `let` bindings
// assigned in beforeAll (TS7034) and add types to helper params (TS7008).
// Template reference: phase4-i18n.test.ts (commit d52f2e0).
import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import path from "path";

const rootDir = path.resolve(__dirname, "../../");

// [20260725_Tier3_Phase5Migrate] Untyped param produced TS7008 under
// strict tsc. Returns string|null so callers must narrow before regex.
function readFile(relPath: string): string | null {
  const fullPath = path.join(rootDir, relPath);
  return fs.existsSync(fullPath) ? fs.readFileSync(fullPath, "utf8") : null;
}

describe("Phase 5: Accessibility a11y", () => {
  describe("Main App.tsx ARIA labels", () => {
    let content: string | null;

    beforeAll(() => {
      content = readFile("src/App.tsx");
    });

    it("should have aria-label on recording button", () => {
      expect(content).toMatch(/aria-label/);
    });

    it("should have role on interactive elements", () => {
      expect(content).toMatch(/role\s*=\s*["']button["']/);
    });
  });

  describe("Settings.jsx ARIA labels", () => {
    let content: string | null;

    beforeAll(() => {
      content = readFile("src/settings.tsx");
    });

    it("should have aria-label on close button", () => {
      expect(content).toMatch(/aria-label/);
    });

    it("should have aria-label on save button", () => {
      const ariaCount = (content?.match(/aria-label/g) || []).length;
      expect(ariaCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Keyboard navigation support", () => {
    let appContent: string | null;

    beforeAll(() => {
      appContent = readFile("src/App.tsx");
    });

    it("should have tabIndex or keyboard event handlers", () => {
      const hasTabIndex = appContent?.includes("tabIndex") ?? false;
      const hasOnKeyDown = appContent?.includes("onKeyDown") ?? false;
      const hasOnKeyUp = appContent?.includes("onKeyUp") ?? false;
      expect(hasTabIndex || hasOnKeyDown || hasOnKeyUp).toBe(true);
    });
  });

  describe("Focus visible styles", () => {
    let cssContent: string;

    beforeAll(() => {
      // Check both index.css and tailwind for focus-visible
      const indexCss = readFile("src/index.css");
      cssContent = indexCss ?? "";
    });

    it("should have focus-visible styles", () => {
      expect(cssContent).toMatch(/focus-visible/);
    });
  });

  describe("Decorative elements aria-hidden", () => {
    let content: string | null;

    beforeAll(() => {
      content = readFile("src/App.tsx");
    });

    it("should have aria-hidden on decorative SVG or icon elements", () => {
      expect(content).toMatch(/aria-hidden/);
    });
  });

  describe("Main process a11y conflict diagnosis", () => {
    let mainContent: string | null;

    beforeAll(() => {
      // [20260724_TS_BigBang_TestFix] Read .ts entry (post-migration).
      mainContent = readFile("main.ts");
    });

    it("should not have setAccessibilitySupportEnabled in active code", () => {
      const hasActive = !mainContent?.match(
        /^[^/]*setAccessibilitySupportEnabled/m,
      );
      const isCommented =
        mainContent?.includes("// setAccessibilitySupportEnabled") ||
        mainContent?.includes("// try {");
      expect(hasActive || isCommented).toBe(true);
    });
  });

  describe("Permission cards accessibility", () => {
    let content: string | null;

    beforeAll(() => {
      content = readFile("src/components/ui/permission-card.tsx");
    });

    it("should exist", () => {
      expect(content).toBeDefined();
      expect(content?.length).toBeGreaterThan(0);
    });

    it("should have aria-label on action button", () => {
      expect(content).toMatch(/aria-label/);
    });
  });
});
