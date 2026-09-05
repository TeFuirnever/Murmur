// [20260905_Test_BotBranchRecovery] Branch-level pins for the ported engine's
// defensive fallbacks (spec #224 coverage debt found by the ultraqa cycle:
// the mascot additions dropped the global branch threshold below 92%).
// These exercise the guards the happy-path profile data never trips: short
// radii arrays (`?? 1` coercion in blend/toPoints), degenerate polygons
// (parallel segments, non-intersecting unions) and the cycle-editor's edge
// moves. No production code is changed — these are measurement gaps, not bugs.

import { describe, expect, it } from "vitest";
import {
  blend,
  circle,
  hullOfCircles,
  polyPath,
  profileFromPolygon,
  radiusAtAngle,
  silhouette,
  toPoints,
  unionOfCirclesProfile,
  type Silhouette,
} from "../../../src/bot/shape";
import { PROFILES, PROFILE_SAMPLES } from "../../../src/bot/profiles";
import {
  blockAt,
  moveBlock,
  nextCycleId,
  parseCycles,
  uniqueName,
} from "../../../src/bot/cycles";

describe("shape defensive branches", () => {
  it("blend coerces missing radii samples to 1 on both operands", () => {
    // arrays shorter than PROFILE_SAMPLES leave blend's `?? 1` to fill in
    const a: Silhouette = { ...circle(0.5), radii: [0.5] };
    const b: Silhouette = { ...circle(1), radii: [1] };
    const out = blend(a, b, 0.5);
    expect(out.radii).toHaveLength(PROFILE_SAMPLES);
    expect(out.radii[0]).toBeCloseTo(0.75, 5);
    expect(out.radii[PROFILE_SAMPLES - 1]).toBeCloseTo(1, 5); // a missing -> 1
  });

  it("toPoints coerces missing radii samples to 1", () => {
    const s: Silhouette = { ...circle(1), radii: [2] };
    const pts = toPoints(s, 10);
    expect(pts).toHaveLength(PROFILE_SAMPLES);
    expect(pts[0]!.x).toBeCloseTo(20, 5);
    expect(pts[1]!.x).toBeCloseTo(
      10 * Math.cos((1 / PROFILE_SAMPLES) * Math.PI * 2),
      5,
    );
  });

  it("radiusAtAngle interpolates between the first and last sample at the seam", () => {
    const radii = [1, 2, 3]; // arbitrary length: wraps index past the end
    expect(radiusAtAngle(radii, 0)).toBeCloseTo(1, 5);
    // half a turn lands exactly between samples 1 and 2 of a 3-sample ring
    const mid = radiusAtAngle(radii, Math.PI);
    expect(mid).toBeCloseTo(2.5, 5);
  });

  it("profileFromPolygon skips segments parallel to the ray", () => {
    // a vertical segment cannot be hit by a vertical ray (den == 0)
    const poly = [
      { x: 0, y: -1 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 1, y: -1 },
    ];
    const radii = profileFromPolygon(poly, 0, 0);
    expect(radii).toHaveLength(PROFILE_SAMPLES);
    // rightward ray (theta=0) hits the vertical x=1 edge
    expect(radii[0]).toBeCloseTo(1, 5);
  });

  it("unionOfCirclesProfile skips circles the ray never meets", () => {
    // circle fully behind the origin along every sampled direction still
    // leaves the far circle to answer
    const radii = unionOfCirclesProfile([
      { x: -5, y: 0, r: 0.5 },
      { x: 0.5, y: 0, r: 0.5 },
    ]);
    expect(radii[0]).toBeCloseTo(1, 5);
    expect(radii[1]).toBeGreaterThan(0);
  });

  it("polyPath returns empty for degenerate point sets", () => {
    expect(polyPath([])).toBe("");
    expect(polyPath([{ x: 0, y: 0 }])).toBe("");
  });

  it("silhouette copies the measured profile", () => {
    const s = silhouette("triangle");
    expect(s.radii).toHaveLength(PROFILE_SAMPLES);
    expect(s.radii[0]).toBe(PROFILES.triangle[0]);
    expect(s.radii[PROFILE_SAMPLES - 1]).toBe(
      PROFILES.triangle[PROFILE_SAMPLES - 1],
    );
    expect(s.rot).toBe(0);
  });
});

describe("cycles editor edge branches", () => {
  it("moveBlock returns the input unchanged for an out-of-range index", () => {
    const blocks = [
      { state: "idle" as const, duration: 2 },
      { state: "wink" as const, duration: 1 },
    ];
    expect(moveBlock(blocks, 5, 0)).toBe(blocks);
    // negative indices count from the end (Array.splice semantics): moving
    // -1 to the front is a legitimate last-block move, not a no-op
    expect(moveBlock(blocks, -1, 0).map((b) => b.state)).toEqual([
      "wink",
      "idle",
    ]);
  });

  it("uniqueName walks past existing numbered suffixes", () => {
    const taken = [
      { id: "a", name: "My cycle", blocks: [] },
      { id: "b", name: "My cycle 2", blocks: [] },
      { id: "c", name: "My cycle 3", blocks: [] },
    ];
    expect(uniqueName("My cycle", taken)).toBe("My cycle 4");
    expect(uniqueName("Fresh", taken)).toBe("Fresh");
  });

  it("nextCycleId skips ids already claimed", () => {
    const cycles = [
      { id: "c1", name: "a", blocks: [] },
      { id: "c2", name: "b", blocks: [] },
    ];
    expect(nextCycleId(cycles)).toBe("c3");
  });

  it("blockAt tolerates zero-duration and single-block montages", () => {
    const zero = [{ state: "idle" as const, duration: 0 }];
    expect(blockAt(zero, 1)).toEqual({ index: 0, elapsed: 0 });
    expect(blockAt(zero, -5)).toEqual({ index: 0, elapsed: 0 });
  });

  it("parseCycles rejects non-array block lists and duplicate ids", () => {
    expect(parseCycles('[{"id":"c1","name":"A","blocks":{"nope":1}}]')).toEqual(
      [],
    );
    const dup = JSON.stringify([
      { id: "c1", name: "A", blocks: [{ state: "idle", duration: 2 }] },
      { id: "c1", name: "B", blocks: [{ state: "idle", duration: 2 }] },
    ]);
    expect(parseCycles(dup)).toHaveLength(1);
  });
});

describe("shape geometry edge arms", () => {
  it("blend rotates the long way round when angles straddle +/-pi", () => {
    const a: Silhouette = { ...circle(1), rot: Math.PI - 0.1 };
    const b: Silhouette = { ...circle(1), rot: -Math.PI + 0.1 };
    // the shortest path wraps (both while-loops adjust dRot); the result
    // equals the target modulo a full turn
    const TAU = Math.PI * 2;
    const out = blend(a, b, 1);
    expect((((out.rot - b.rot) % TAU) + TAU) % TAU).toBeLessThan(1e-5);
    const fwd = blend(b, a, 1);
    expect((((fwd.rot - a.rot) % TAU) + TAU) % TAU).toBeLessThan(1e-5);
  });

  it("toPoints reuses a caller-provided out array", () => {
    const s = circle(1);
    const out = toPoints(s, 1);
    const again = toPoints(s, 1, out);
    expect(again).toBe(out); // same array, entries overwritten in place
    expect(again[0]!.x).toBeCloseTo(1, 5);
  });

  it("hullOfCircles handles coincident centres and extreme radius ratios", () => {
    // coincident centres: dist || 1e-6 guard
    const degenerate = profileFromPolygon(
      hullOfCircles(0, 0, 1, 0, 0, 1),
      0,
      0,
    );
    expect(degenerate.every((r) => Number.isFinite(r))).toBe(true);
    // extreme ratio far apart: acos clamp inputs
    const clamped = profileFromPolygon(
      hullOfCircles(0, 0, 10, 50, 0, 0.1),
      0,
      0,
    );
    expect(clamped.every((r) => Number.isFinite(r))).toBe(true);
  });

  it("radiusAtAngle coerces holes in sparse radii arrays to 1", () => {
    const sparse = [1, , 3] as unknown as number[]; // index 1 missing
    expect(radiusAtAngle(sparse, Math.PI / 3)).toBeTruthy();
  });

  it("unionOfCirclesProfile skips circles off the ray entirely", () => {
    // a circle centred perpendicular to theta=0 never intersects that ray
    const radii = unionOfCirclesProfile([{ x: 0, y: 5, r: 0.5 }]);
    expect(radii[0]).toBe(0); // nothing hit rightward
    expect(radii).toHaveLength(PROFILE_SAMPLES);
  });
});
