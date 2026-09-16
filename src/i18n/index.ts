// [20260724_TS_BigBang_I18n] Migrated from .js to .ts (ADR-010).
// Already ESM (`export default`); renamed .js → .ts with no logic changes.
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import zhCN from "./locales/zh-CN.json";
import en from "./locales/en.json";

const savedLanguage =
  typeof localStorage !== "undefined" ? localStorage.getItem("language") : null;

i18n.use(initReactI18next).init({
  resources: {
    "zh-CN": { translation: zhCN },
    en: { translation: en },
  },
  lng: savedLanguage || navigator.language || "zh-CN",
  fallbackLng: "zh-CN",
  interpolation: {
    // [20260905_Fix_247_ReviewEscape] React already escapes rendered text —
    // i18next's own HTML-escaping double-escaped interpolated values (error
    // messages with quotes/apostrophes rendered literally as &#39;).
    escapeValue: false,
  },
});

export default i18n;
// [20260724_TS_BigBang_I18n] END
