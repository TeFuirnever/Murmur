import { test, expect } from "@playwright/test";

test.describe("Interactive Components", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("FAQ accordion expands on click", async ({ page }) => {
    const firstDetails = page.locator("details").first();
    await expect(firstDetails).toBeVisible();
    // Initially closed
    expect(await firstDetails.getAttribute("open")).toBeNull();
    // Click to open
    await firstDetails.locator("summary").click();
    expect(await firstDetails.getAttribute("open")).not.toBeNull();
    // Answer should be visible
    const answer = firstDetails.locator(".faq-answer, p").last();
    await expect(answer).toBeVisible();
  });

  test("FAQ accordion collapses on second click", async ({ page }) => {
    const firstDetails = page.locator("details").first();
    // Open
    await firstDetails.locator("summary").click();
    expect(await firstDetails.getAttribute("open")).not.toBeNull();
    // Close
    await firstDetails.locator("summary").click();
    expect(await firstDetails.getAttribute("open")).toBeNull();
  });

  test("mobile menu opens on hamburger click", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const menuBtn = page.locator("#mobile-menu-btn");
    await expect(menuBtn).toBeVisible();
    await menuBtn.click();
    const mobileMenu = page.locator("#mobile-menu");
    await expect(mobileMenu).toBeVisible();
  });

  test("mobile menu closes when link is clicked", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const menuBtn = page.locator("#mobile-menu-btn");
    await expect(menuBtn).toBeVisible();
    await menuBtn.click();
    const mobileMenu = page.locator("#mobile-menu");
    await expect(mobileMenu).toBeVisible();
    // Click a link inside
    const firstLink = mobileMenu.locator("a").first();
    await firstLink.click();
    await expect(mobileMenu).toBeHidden();
  });

  test("scroll reveal animations trigger on scroll", async ({ page }) => {
    // Scroll to bottom
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1000);
    // Check that reveal elements have visible class
    const visibleElements = await page
      .locator(".reveal-up.visible, .reveal-scale.visible")
      .count();
    expect(visibleElements).toBeGreaterThan(0);
  });

  test("glass cards have hover effect (card-lift class)", async ({ page }) => {
    const cards = page.locator(".card-lift");
    const count = await cards.count();
    expect(count).toBeGreaterThan(0);
  });
});
