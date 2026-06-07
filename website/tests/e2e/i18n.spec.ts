import { test, expect } from "@playwright/test";

test.describe("Internationalization", () => {
  test("English → Chinese language switch", async ({ page }) => {
    await page.goto("/");
    const zhLink = page.locator('a[href="/Murmur/zh/"]').first();
    await expect(zhLink).toBeVisible();
    await zhLink.click();
    await expect(page).toHaveURL(/\/zh\//);
    await expect(page.locator("h1")).toContainText("开源");
  });

  test("Chinese → English language switch", async ({ page }) => {
    await page.goto("/zh/");
    const enLink = page.locator('a[href="/Murmur/"]').first();
    await expect(enLink).toBeVisible();
    await enLink.click();
    await expect(page).toHaveURL(/\/Murmur\/?$/);
    await expect(page.locator("h1")).toContainText("Open Source");
  });

  test("Chinese page has correct overlines (no English overline leak)", async ({
    page,
  }) => {
    await page.goto("/zh/");
    const body = page.locator("body");
    const text = await body.textContent();
    // Section overlines should be in Chinese
    expect(text).toContain("为什么选择");
    expect(text).toContain("核心功能");
    expect(text).toContain("快速开始");
    expect(text).toContain("常见问题");
  });

  test("English page has correct overlines", async ({ page }) => {
    await page.goto("/");
    const body = page.locator("body");
    const text = await body.textContent();
    expect(text).toContain("Why Murmur");
    expect(text).toContain("Features");
    expect(text).toContain("Getting Started");
  });

  test("Chinese page title is correct", async ({ page }) => {
    await page.goto("/zh/");
    await expect(page).toHaveTitle(/开源本地 AI 语音输入/);
  });

  test("English page title is correct", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Open Source Local AI Voice Input/);
  });

  test("Chinese page has Chinese FAQ entries", async ({ page }) => {
    await page.goto("/zh/");
    const faqSection = page.locator("#faq");
    await expect(faqSection).toBeVisible();
    const faqText = await faqSection.textContent();
    expect(faqText).toContain("首次启动");
    expect(faqText).toContain("导出格式");
  });

  test("English page has English FAQ entries", async ({ page }) => {
    await page.goto("/");
    const faqSection = page.locator("#faq");
    await expect(faqSection).toBeVisible();
    const faqText = await faqSection.textContent();
    expect(faqText).toContain("First launch");
    expect(faqText).toContain("export formats");
  });
});
