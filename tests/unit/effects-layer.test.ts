// [20260729_Fix_ColorStopsSeamlessLoop] Verify Aurora colorStops form a
// seamless loop (first color == last color). Aurora's GLSL shader interpolates
// linearly between stops; without the wrap-around, the gradient produces a
// visible seam at the loop boundary. The plan specified 4 stops ending where
// they start; code review caught a 3-stop implementation missing the wrap.
import { describe, it, expect } from "vitest";
import { AURORA_COLOR_STOPS } from "../../src/components/effects/EffectsLayer";

describe("Aurora colorStops seamless loop", () => {
  it("exports at least 3 stops", () => {
    expect(AURORA_COLOR_STOPS.length).toBeGreaterThanOrEqual(3);
  });

  it("first and last stop are identical (seamless loop)", () => {
    const first = AURORA_COLOR_STOPS[0];
    const last = AURORA_COLOR_STOPS[AURORA_COLOR_STOPS.length - 1];
    expect(last).toBe(first);
  });

  it("uses Murmur brand palette (blue + purple family)", () => {
    expect(AURORA_COLOR_STOPS).toContain("#0071e3");
    expect(AURORA_COLOR_STOPS).toContain("#af52de");
  });
});
