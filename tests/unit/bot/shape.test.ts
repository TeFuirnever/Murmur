// [20260904_Refactor_BloubEnginePort] Ported from bloub (github.com/jeremy-prt/bloub, MIT), src/bot/shape.test.ts.
// Numeric constants are frame-by-frame measurements of the reference video:
// do not round, simplify or "fix" any of them (see docs/bot/measurements.md).

import { describe, expect, it } from "vitest";
import { TAU } from "../../../src/bot/math";
import { PROFILE_SAMPLES } from "../../../src/bot/profiles";
import { radiusAtAngle, silhouette } from "../../../src/bot/shape";
import { SHAPES } from "../../../src/bot/skins";

/**
 * `radiusAtAngle`, the function that re-attaches to the real outline whatever
 * sits "on" the body — the eyes and the notification badge.
 *
 * It had no test, while the engine calls it as `atan2(y, x) - pose.sil.rot`
 * and `orbit` pushes `rot` to about -30 rad: its argument goes far outside
 * `[0, 2*PI)`. Any simplification of its double modulo would lift the eyes
 * off the silhouette during the orbit — exactly the failure this function
 * exists to prevent.
 */

/** A decidedly non-circular profile: on a circle, any angle would give 1. */
const TRIANGLE = silhouette("triangle").radii;

describe("radiusAtAngle", () => {
  it("returns the profile radius, not a constant", () => {
    const seen = new Set(
      Array.from({ length: 16 }, (_, i) =>
        radiusAtAngle(TRIANGLE, (i / 16) * TAU),
      ),
    );
    expect(seen.size).toBeGreaterThan(8);
  });

  it("wraps negative angles", () => {
    expect(radiusAtAngle(TRIANGLE, -0.1)).toBeCloseTo(
      radiusAtAngle(TRIANGLE, TAU - 0.1),
      12,
    );
    expect(radiusAtAngle(TRIANGLE, -1)).toBeCloseTo(
      radiusAtAngle(TRIANGLE, TAU - 1),
      12,
    );
  });

  /**
   * The `orbit` case: several turns in the negative. That is what the double
   * modulo of `((x % 1) + 1) % 1` handles and a simple modulo breaks.
   */
  it("wraps over several turns, both ways", () => {
    for (const base of [-30, -12.5, 7.3]) {
      for (const turns of [-3, -1, 1, 5]) {
        expect(
          radiusAtAngle(TRIANGLE, base),
          `base=${base} turns=${turns}`,
        ).toBeCloseTo(radiusAtAngle(TRIANGLE, base + turns * TAU), 10);
      }
    }
  });

  /**
   * Continuous through zero, where wrapping makes the index jump from 63 to
   * 0. A simplification returning a fallback value — 1, typically — would
   * show up here as a 0.22 step on this profile.
   *
   * Eight decimals and not nine: the measured gap is 7e-10, float noise on
   * modulo-computed indices. Three orders of magnitude below what a real
   * discontinuity would produce.
   */
  it("is continuous through zero", () => {
    expect(radiusAtAngle(TRIANGLE, -1e-9)).toBeCloseTo(
      radiusAtAngle(TRIANGLE, 1e-9),
      8,
    );
    // and the value there is the profile's own, not a fallback
    expect(radiusAtAngle(TRIANGLE, 0)).toBeCloseTo(TRIANGLE[0]!, 12);
  });
});

/**
 * The customiser's shapes are built analytically, without going through the
 * generator that produces `profiles.ts`. Nothing verified their sampling.
 *
 * That is what makes this check necessary: `blend` interpolates by INDEX and
 * falls back to `?? 1` when the index is missing, so a shape built with a
 * different sample count morphs silently into a unit circle instead of
 * failing. It would be right at rest and wrong in all its transitions — the
 * worst of both worlds, because nobody would think to watch a morph.
 */
describe("customiser shape profiles", () => {
  it("all share the same angular sampling, finite and positive", () => {
    for (const shape of SHAPES) {
      expect(shape.radii, shape.id).toHaveLength(PROFILE_SAMPLES);
      for (const [i, r] of shape.radii.entries()) {
        expect(Number.isFinite(r), `${shape.id}[${i}] = ${r}`).toBe(true);
        expect(r, `${shape.id}[${i}]`).toBeGreaterThan(0);
      }
    }
  });

  /**
   * Wide bounds, only there to catch an aberrant shape: a radius under 0.3
   * would push the eyes out, a radius beyond 1.6 would leave the viewBox.
   * These are not measurements, just the domain where the rest of the folder
   * makes sense.
   */
  it("stay within a domain where the rest of the engine holds", () => {
    for (const shape of SHAPES) {
      const min = Math.min(...shape.radii);
      const max = Math.max(...shape.radii);
      expect(min, `${shape.id} min`).toBeGreaterThan(0.3);
      expect(max, `${shape.id} max`).toBeLessThan(1.6);
    }
  });
});
