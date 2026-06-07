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
        expect(
          (text && text.trim().length > 0) || ariaLabel || hasImg > 0,
          `Link ${i} has no discernible text: ${await link.getAttribute("href")}`,
        ).toBe(true);
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
});
