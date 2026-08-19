// [20260820_T14_Hotwords] Ticket #183 (spec #177 T14): hotword settings +
// main-process injection + dual-boundary validation. RED first.
// Boundary model (spec MJ-6): the settings save path and the injection
// path BOTH validate — UI-level limits alone cannot stop a corrupted DB
// or a renderer bug from feeding garbage to the model.
import { describe, it, expect } from "vitest";

import {
  sanitizeHotwordInput,
  MAX_HOTWORD_LINES,
  MAX_HOTWORD_LINE_CHARS,
  MAX_HOTWORD_TOTAL_CHARS,
} from "../../src/helpers/hotwords";
import { validateSetting } from "../../src/helpers/ipc/settingsHandlers";
import { FILE_CONFIGURABLE_KEYS } from "../../src/helpers/fileConfig";

describe("[20260820_T14_Hotwords] sanitizeHotwordInput", () => {
  it("joins non-empty lines with spaces (the format proven in the T13 spike)", () => {
    expect(sanitizeHotwordInput("张晗玥\n刘翀\n\n龚燊")).toBe(
      "张晗玥 刘翀 龚燊",
    );
  });

  it("strips control characters and lone surrogates", () => {
    expect(sanitizeHotwordInput("张\u0000晗\u007F玥")).toBe("张晗玥");
    // Lone surrogate (would crash Python's UTF-8 stdout encode).
    expect(sanitizeHotwordInput("abc\uD800def")).toBe("abcdef");
  });

  it("caps line count at MAX_HOTWORD_LINES (excess dropped deterministically)", () => {
    const many = Array.from(
      { length: MAX_HOTWORD_LINES + 50 },
      (_v, i) => `词${i}`,
    ).join("\n");
    const out = sanitizeHotwordInput(many);
    expect(out.split(" ")).toHaveLength(MAX_HOTWORD_LINES);
  });

  it("caps each line at MAX_HOTWORD_LINE_CHARS", () => {
    const longLine = "超".repeat(MAX_HOTWORD_LINE_CHARS + 10);
    const out = sanitizeHotwordInput(longLine);
    expect(out.length).toBe(MAX_HOTWORD_LINE_CHARS);
  });

  it("caps the total joined length at MAX_HOTWORD_TOTAL_CHARS", () => {
    const lines = Array.from({ length: 100 }, () => "词".repeat(32));
    const out = sanitizeHotwordInput(lines.join("\n"));
    expect(out.length).toBeLessThanOrEqual(MAX_HOTWORD_TOTAL_CHARS);
  });

  it("non-string input coerces to empty string", () => {
    expect(sanitizeHotwordInput(undefined)).toBe("");
    expect(sanitizeHotwordInput(12345 as unknown)).toBe("");
    expect(sanitizeHotwordInput({ lines: ["a"] } as unknown)).toBe("");
  });

  it("empty/whitespace input yields empty string (caller omits the field)", () => {
    expect(sanitizeHotwordInput("")).toBe("");
    expect(sanitizeHotwordInput("  \n\t ")).toBe("");
  });
});

describe("[20260820_T14_Hotwords] settings boundary", () => {
  it("hotwords is in the settings allowlist", () => {
    expect(validateSetting("hotwords", "张晗玥 刘翀")).toBe(true);
  });

  it("oversized hotword value is rejected by the generic length cap", () => {
    expect(validateSetting("hotwords", "a".repeat(10001))).toBe(false);
  });

  it("hotwords is NOT file-configurable (colleague names stay out of ~/.murmur.json)", () => {
    expect(FILE_CONFIGURABLE_KEYS).not.toContain("hotwords");
  });
});
