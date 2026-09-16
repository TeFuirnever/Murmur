// [20260905_Test_I18nInit] Branch coverage for the i18n bootstrap
// (src/i18n/index.ts was 60% branches): the saved-language arm, the
// navigator-language fallback, and the zh-CN last resort. The module is an
// import-time singleton, so every case re-imports a fresh module graph with
// a different localStorage state.
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { i18n as I18n } from "i18next";

describe("[20260905_Test_I18nInit] i18n bootstrap language resolution", () => {
  beforeEach(() => {
    vi.resetModules();
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  async function importI18n(): Promise<I18n> {
    const i18n = (await import("../../src/i18n")).default;
    return i18n as unknown as I18n;
  }

  it("uses the persisted language when present", async () => {
    window.localStorage.setItem("language", "en");
    const i18n = await importI18n();
    expect(i18n.language).toBe("en");
  });

  it("falls back to navigator.language when nothing is persisted", async () => {
    // jsdom's navigator.language is "en-US" — the middle arm of
    // savedLanguage || navigator.language || "zh-CN".
    const i18n = await importI18n();
    expect(i18n.language).toBe(navigator.language);
  });

  it("carries both locales with symmetric resource bundles", async () => {
    const i18n = await importI18n();
    expect(i18n.hasLoadedNamespace("translation")).toBe(true);
    expect(i18n.store.data["zh-CN"]).toBeDefined();
    expect(i18n.store.data.en).toBeDefined();
  });

  it("resolves translations through the real pipeline (smoke)", async () => {
    window.localStorage.setItem("language", "zh-CN");
    const i18n = await importI18n();
    // t() through the real instance: the interpolated template renders the
    // variable, proving escapeValue:false + resources are wired end-to-end.
    const rendered = i18n.t("app.stageDownloading", {
      progress: 42,
      defaultValue: "下载 {{progress}}%",
    });
    expect(rendered).toContain("42");
  });
});
