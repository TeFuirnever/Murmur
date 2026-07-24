// [20260724_Fix_DynamicTranscriptionTimeout] Tests for dynamic file
// transcription timeout based on file size (ADR-012 Issue #1).
import { describe, it, expect } from "vitest";

const {
  calculateTranscriptionTimeout,
} = require("../../src/helpers/funasrServer");

describe("Dynamic transcription timeout (ADR-012 Issue #1)", () => {
  describe("calculateTranscriptionTimeout", () => {
    it("returns minimum timeout for small files (< 10MB)", () => {
      // Small files (short clips) — minimum 5 min is plenty
      const timeout = calculateTranscriptionTimeout(5 * 1024 * 1024);
      expect(timeout.ms).toBeGreaterThanOrEqual(300000); // at least 5 min
      expect(timeout.ms).toBeLessThan(600000); // less than 10 min
    });

    it("scales timeout proportionally for medium files (10-100MB)", () => {
      // ~50MB ≈ ~50 min audio at 16kbps mono
      const timeout = calculateTranscriptionTimeout(50 * 1024 * 1024);
      // Should be significantly more than the old hardcoded 5 min
      expect(timeout.ms).toBeGreaterThan(300000);
    });

    it("scales timeout for large files (100MB+)", () => {
      // ~200MB ≈ ~3+ hour audio
      const timeout = calculateTranscriptionTimeout(200 * 1024 * 1024);
      expect(timeout.ms).toBeGreaterThan(600000); // more than 10 min
    });

    it("respects a maximum timeout cap", () => {
      // Even very large files should have a reasonable cap
      const timeout = calculateTranscriptionTimeout(500 * 1024 * 1024);
      expect(timeout.ms).toBeLessThanOrEqual(3600000); // max 60 min
    });

    it("returns a human-readable timeout label", () => {
      const timeout = calculateTranscriptionTimeout(100 * 1024 * 1024);
      expect(typeof timeout.label).toBe("string");
      expect(timeout.label.length).toBeGreaterThan(0);
    });

    it("handles edge case of zero bytes", () => {
      const timeout = calculateTranscriptionTimeout(0);
      expect(timeout.ms).toBeGreaterThanOrEqual(300000); // still returns minimum
    });
  });
});
