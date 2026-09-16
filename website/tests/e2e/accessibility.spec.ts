import { test, expect } from "@playwright/test";

test.describe("Accessibility", () => {
  const pages = [
    { name: "English", path: "/" },
    { name: "Chinese", path: "/zh/" },
  ];

  for (const pageConfig of pages) {
    test(`${pageConfig.name} page has no auto-detectable a11y violations`, async ({
      page,
    }) => {
      await page.goto(pageConfig.path);

      // 1. Page has lang attribute
      const lang = await page.locator("html").getAttribute("lang");
      expect(lang).toBeTruthy();

      // 2. All images have alt text
      const images = page.locator("img");
      const imgCount = await images.count();
      for (let i = 0; i < imgCount; i++) {
        const alt = await images.nth(i).getAttribute("alt");
        expect(alt).not.toBeNull();
      }

      // 3. All links have discernible text
      const links = page.locator("a");
      const linkCount = await links.count();
      for (let i = 0; i < linkCount; i++) {
        const link = links.nth(i);
        const text = await link.textContent();
        const ariaLabel = await link.getAttribute("aria-label");
        const hasImg = await link.locator("img").count();
        // [20260803_Feature_WebsiteRedesign] Coerce to boolean: the previous
        // expression returned the truthy value itself (e.g. the aria-label
        // string), so .toBe(true) failed even when the link WAS accessible.
        // Boolean(...) makes the assertion correct for text / aria-label / img.
        expect(
          Boolean((text && text.trim().length > 0) || ariaLabel || hasImg > 0),
          `Link ${i} has no discernible text: ${await link.getAttribute("href")}`,
        ).toBe(true);
        // [20260803_Feature_WebsiteRedesign] END
      }

      // 4. FAQ details elements are keyboard accessible (have summary)
      const details = page.locator("details");
      const detailsCount = await details.count();
      for (let i = 0; i < detailsCount; i++) {
        const summary = details.nth(i).locator("summary");
        await expect(summary).toBeVisible();
      }
    });
  }

  test("color contrast meets minimum for primary text", async ({ page }) => {
    await page.goto("/");
    // Verify the page renders without errors
    const body = page.locator("body");
    await expect(body).toBeVisible();
    // Check that text-muted class elements exist (contrast is validated in CSS)
    const mutedText = page
      .locator(".text-text-secondary, .text-text-tertiary")
      .first();
    await expect(mutedText).toBeVisible();
  });

  test("all interactive elements are keyboard reachable", async ({ page }) => {
    await page.goto("/");
    // Tab through the first few elements
    const firstLink = page.locator("a").first();
    await firstLink.focus();
    await expect(firstLink).toBeFocused();
  });

  // [20260803_Feature_WebsiteRedesign] Real WCAG contrast check. The previous
  // "color contrast" test only asserted an element EXISTS; this one computes an
  // actual contrast ratio so a future palette change that drops below AA fails
  // the test instead of passing silently. Uses the WCAG 2.1 relative-luminance
  // formula; asserts body text >= 4.5:1 and secondary text >= 4.5:1 (AA for
  // normal text). Runs in dark color scheme (the site default).
  // [20260803_Feature_WebsiteRedesign] Real WCAG contrast check, run against
  // BOTH color schemes. Dark is the site default; light must also pass because
  // the redesign ships a light-mode token set (and fixed light tertiary from
  // 3.51:1 to 6.08:1). Without the light iteration, a future palette change
  // that breaks light-mode contrast would pass silently.
  for (const scheme of ["dark", "light"] as const) {
    test(`primary and secondary text meet WCAG AA contrast (${scheme})`, async ({
      page,
    }) => {
      await page.goto("/");
      await page.emulateMedia({ colorScheme: scheme });

      // Single self-contained evaluate: resolve fg/bg per element, compute ratio.
      const ratios = await page.evaluate(() => {
        const resolveBg = (el: Element): string => {
          let node: Element | null = el;
          while (node) {
            const bg = window.getComputedStyle(node).backgroundColor;
            if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent")
              return bg;
            node = node.parentElement;
          }
          return window.getComputedStyle(document.body).backgroundColor;
        };
        const parseRgb = (rgb: string): [number, number, number] | null => {
          const m = rgb.match(/rgba?\(([^)]+)\)/);
          if (!m) return null;
          const parts = m[1].split(",").map((s) => parseFloat(s.trim()));
          if (parts.length < 3) return null;
          return [parts[0], parts[1], parts[2]];
        };
        const luminance = (rgb: [number, number, number]): number => {
          const lin = (c: number) => {
            const s = c / 255;
            return s <= 0.03928
              ? s / 12.92
              : Math.pow((s + 0.055) / 1.055, 2.4);
          };
          const [r, g, b] = rgb.map(lin);
          return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        const ratioOf = (el: Element): number | null => {
          const fg = window.getComputedStyle(el).color;
          const bg = resolveBg(el);
          const f = parseRgb(fg);
          const b = parseRgb(bg);
          if (!f || !b) return null;
          const l1 = luminance(f);
          const l2 = luminance(b);
          return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
        };

        const bodyEl = document.body;
        const secEl = document.querySelector(".text-text-secondary");
        return {
          body: bodyEl ? ratioOf(bodyEl) : null,
          secondary: secEl ? ratioOf(secEl) : null,
        };
      });

      expect(
        ratios.body,
        `${scheme}: body text contrast not computable`,
      ).not.toBeNull();
      expect(
        ratios.body!,
        `${scheme}: body text contrast ${ratios.body}:1 < 4.5 (AA)`,
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        ratios.secondary,
        `${scheme}: secondary text contrast not computable`,
      ).not.toBeNull();
      expect(
        ratios.secondary!,
        `${scheme}: secondary text contrast ${ratios.secondary}:1 < 4.5 (AA)`,
      ).toBeGreaterThanOrEqual(4.5);
    });
  }
  // [20260803_Feature_WebsiteRedesign] END
});
