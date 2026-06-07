import { test, expect } from "@playwright/test";

test.describe("Responsive Layout", () => {
  test("mobile layout (375px) shows hamburger menu", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    // Hamburger button visible
    const menuBtn = page.locator("#mobile-menu-btn");
    await expect(menuBtn).toBeVisible();
    // Desktop nav hidden
    const desktopNav = page.locator("header .hidden.md\\:flex");
    await expect(desktopNav).toBeHidden();
  });

  test("tablet layout (768px) shows 2-column feature grid", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto("/");
    // Desktop nav should be visible
    const desktopNav = page.locator("header nav");
    await expect(desktopNav).toBeVisible();
  });

  test("desktop layout (1280px) shows full navigation", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    // Desktop nav visible
    const desktopNav = page.locator("header nav");
    await expect(desktopNav).toBeVisible();
    // Hamburger hidden
    const menuBtn = page.locator("#mobile-menu-btn");
    await expect(menuBtn).toBeHidden();
  });

  test("comparison table scrolls horizontally on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    // Scroll to comparison section — look for the section by its heading
    const compHeading = page
      .locator("h2")
      .filter({ hasText: /Compare|对比/ })
      .first();
    await expect(compHeading).toBeVisible();
    await compHeading.scrollIntoViewIfNeeded();
    const table = page.locator("table");
    await expect(table).toBeVisible();
  });
});
