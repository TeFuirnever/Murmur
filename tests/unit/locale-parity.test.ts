// [20260905_Fix_249_ReviewNit] zh-CN.json and en.json must stay structurally
// aligned: every namespace/key path present in one locale must exist in the
// other (a missing key silently renders the Chinese fallback or the raw key
// in English UI). Spec #193 will add many keys — this pins the parity.
import { describe, it, expect } from "vitest";
import zhCN from "../../src/i18n/locales/zh-CN.json";
import en from "../../src/i18n/locales/en.json";

function flattenPaths(obj: Record<string, unknown>, prefix = ""): Set<string> {
  const out = new Set<string>();
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object") {
      for (const child of flattenPaths(v as Record<string, unknown>, key)) {
        out.add(child);
      }
    } else {
      out.add(key);
    }
  }
  return out;
}

describe("[20260905_Fix_249_ReviewNit] locale parity", () => {
  it("has identical key sets in zh-CN and en", () => {
    const zh = flattenPaths(zhCN as Record<string, unknown>);
    const enSet = flattenPaths(en as Record<string, unknown>);
    const missingInEn = [...zh].filter((k) => !enSet.has(k));
    const extraInEn = [...enSet].filter((k) => !zh.has(k));
    expect(missingInEn).toEqual([]);
    expect(extraInEn).toEqual([]);
  });

  it("has no empty translation values", () => {
    for (const [name, locale] of [
      ["zh-CN", zhCN as Record<string, unknown>],
      ["en", en as Record<string, unknown>],
    ] as const) {
      const flat = flattenPaths(locale);
      for (const key of flat) {
        let value: unknown = locale;
        for (const part of key.split(".")) {
          value = (value as Record<string, unknown>)[part];
        }
        expect(
          typeof value === "string" && value.trim().length > 0,
          `${name}: ${key} is empty`,
        ).toBe(true);
      }
    }
  });
});
