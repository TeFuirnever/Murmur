import { test, expect } from "@playwright/test";

test.describe("Navigation and Routing", () => {
  test("English homepage loads with Hero", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("h1")).toBeVisible();
    await expect(page.locator("h1")).toContainText("Open Source");
  });

  test("Chinese homepage loads with Chinese content", async ({ page }) => {
    await page.goto("/zh/");
    await expect(page.locator("h1")).toBeVisible();
    await expect(page.locator("h1")).toContainText("开源");
  });

  test("404 page shows for non-existent routes", async ({ page }) => {
    await page.goto("/nonexistent-page/");
    // Static hosting may return 404 page with 200 status
    await expect(page.locator("text=404")).toBeVisible();
  });

  test("nav anchor links scroll to sections", async ({ page }) => {
    await page.goto("/");
    const featuresLink = page.locator('a[href="#features"]').first();
    await expect(featuresLink).toBeVisible();
    await featuresLink.click();
    await page.waitForTimeout(500);
    const featuresSection = page.locator("#features");
    await expect(featuresSection).toBeInViewport();
  });

  test("download button links to GitHub releases", async ({ page }) => {
    await page.goto("/");
    const downloadBtn = page
      .locator('a[href*="github.com/TeFuirnever/Murmur/releases"]')
      .first();
    await expect(downloadBtn).toBeVisible();
    expect(await downloadBtn.getAttribute("href")).toContain("releases");
  });

  test("GitHub link opens in new tab", async ({ page }) => {
    await page.goto("/");
    const githubLink = page
      .locator('a[href="https://github.com/TeFuirnever/Murmur"]')
      .first();
    await expect(githubLink).toBeVisible();
    expect(await githubLink.getAttribute("target")).toBe("_blank");
    expect(await githubLink.getAttribute("rel")).toContain("noopener");
  });
});
