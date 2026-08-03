// [20260803_Feature_WebsiteRedesign] New e2e coverage for the redesigned
// site: StatsStrip presence, Bento no horizontal overflow across viewports,
// Hero single-h1 + a11y-hidden animation card, and reduced-motion behavior.
// Guards tickets #144/#145/#146.
// [20260803_Feature_WebsiteRedesign] END
import { test, expect } from "@playwright/test";

test.describe("Visual redesign", () => {
  test("StatsStrip renders with non-empty stat values (EN)", async ({
    page,
  }) => {
    await page.goto("/");
    const statsSection = page.locator('section[aria-label="stats"]');
    await expect(statsSection).toBeVisible();
    // Four stat cells, each with non-empty text.
    const cells = statsSection.locator(".stat-number");
    await expect(cells).toHaveCount(4);
    for (let i = 0; i < 4; i++) {
      const text = (await cells.nth(i).textContent())?.trim();
      expect(text && text.length > 0).toBe(true);
    }
  });

  test("StatsStrip renders with non-empty stat values (ZH)", async ({
    page,
  }) => {
    await page.goto("/zh/");
    const statsSection = page.locator('section[aria-label="stats"]');
    await expect(statsSection).toBeVisible();
    const cells = statsSection.locator(".stat-number");
    await expect(cells).toHaveCount(4);
    // ZH first cell should contain Chinese (e.g. "模型" or a digit).
    const first = (await cells.nth(0).textContent())?.trim();
    expect(first && first.length > 0).toBe(true);
  });

  // Horizontal-overflow guard for the Bento grid at three viewports.
  for (const [name, width, height] of [
    ["mobile", 375, 812],
    ["tablet", 768, 1024],
    ["desktop", 1280, 800],
  ] as const) {
    test(`Bento features grid has no horizontal overflow at ${name} (${width}px)`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await page.goto("/");
      const features = page.locator("#features");
      await features.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      const overflow = await page.evaluate(() => ({
        doc: document.documentElement.scrollWidth,
        body: document.body.scrollWidth,
        vw: window.innerWidth,
      }));
      expect(
        overflow.doc,
        `doc scrollWidth ${overflow.doc} > ${overflow.vw}`,
      ).toBeLessThanOrEqual(overflow.vw);
      expect(
        overflow.body,
        `body scrollWidth ${overflow.body} > ${overflow.vw}`,
      ).toBeLessThanOrEqual(overflow.vw);
    });
  }

  test("Hero has exactly one h1 containing the tagline", async ({ page }) => {
    await page.goto("/");
    const h1Count = await page.locator("h1").count();
    expect(h1Count).toBe(1);
    const h1Text = (await page.locator("h1").textContent()) ?? "";
    expect(h1Text).toContain("Open Source");
  });

  // [20260803_Feature_WebsiteRedesign] Updated: the Hero card now exposes the
  // raw→polished demo as a labelled region (role="img" + aria-label) instead of
  // hiding the whole block, so the meaningful transcript text is reachable.
  // Asserts: it has an accessible name (aria-label) and contains no <img>.
  test("Hero animation card has an accessible label and no img", async ({
    page,
  }) => {
    await page.goto("/");
    const heroVisual = page.locator(".hero-visual");
    await expect(heroVisual).toHaveCount(1);
    await expect(heroVisual).toHaveAttribute("role", "img");
    const label = await heroVisual.getAttribute("aria-label");
    expect(label && label.trim().length > 0).toBe(true);
    // No <img> inside the CSS/SVG animation card.
    const imgCount = await heroVisual.locator("img").count();
    expect(imgCount).toBe(0);
  });
  // [20260803_Feature_WebsiteRedesign] END

  test("reduced-motion disables orb animation", async ({ browser }) => {
    const context = await browser.newContext({
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    await page.goto("/");
    const orb = page.locator(".orb").first();
    await expect(orb).toHaveCount(1);
    // Under reduced-motion, the animation-name should resolve to "none".
    const animationName = await orb.evaluate((el) => {
      const cs = window.getComputedStyle(el);
      // animationName may be a list; reduce-motion block sets `animation: none !important`.
      return cs.animationName || cs.getPropertyValue("animation-name");
    });
    expect(animationName).toBe("none");
    // [20260803_Feature_WebsiteRedesign] Also guard the NEW animations added by
    // this redesign (waveform + typing cursor) — these are the ones most likely
    // to be dropped from the reduced-motion block in a future edit without anyone
    // noticing. If the minifier or a future change strips them, this fails.
    const waveName = await page
      .locator(".waveform-bar")
      .first()
      .evaluate((el) => {
        const cs = window.getComputedStyle(el);
        return cs.animationName || cs.getPropertyValue("animation-name");
      });
    expect(
      waveName,
      "waveform-bar animation should stop under reduced-motion",
    ).toBe("none");
    const cursorName = await page
      .locator(".typing-cursor")
      .first()
      .evaluate((el) => {
        const cs = window.getComputedStyle(el);
        return cs.animationName || cs.getPropertyValue("animation-name");
      });
    expect(
      cursorName,
      "typing-cursor animation should stop under reduced-motion",
    ).toBe("none");
    // [20260803_Feature_WebsiteRedesign] END
    await context.close();
  });
});
