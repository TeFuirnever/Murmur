// [20260904_Refactor_BloubEnginePort] Ported from bloub (github.com/jeremy-prt/bloub, MIT), src/bot/face.test.ts.
// Numeric constants are frame-by-frame measurements of the reference video:
// do not round, simplify or "fix" any of them (see docs/bot/measurements.md).

import { describe, expect, it } from "vitest";
import {
  EYE_H,
  EYE_SPLIT,
  EYE_W,
  REST_GAZE,
  eyePoses,
  type HeadGaze,
} from "../../../src/bot/face";

/**
 * Values measured frame by frame on the reference video (units: ball radius
 * at rest = 1, y pointing down). The sphere model must reproduce them: it is
 * what guarantees the near-edge eye compresses exactly as in the original.
 */
const MEASURED_POSES: Array<{
  name: string;
  gaze: HeadGaze;
  split: number;
  w: number;
  h: number;
  eyes: Array<{ x: number; y: number; shortAxis: number; longAxis: number }>;
}> = [
  {
    name: "rest",
    gaze: REST_GAZE,
    split: EYE_SPLIT,
    w: EYE_W,
    h: EYE_H,
    eyes: [
      { x: 0.189, y: -0.412, shortAxis: 0.178, longAxis: 0.39 },
      { x: 0.614, y: -0.51, shortAxis: 0.12, longAxis: 0.395 },
    ],
  },
  {
    name: "wide eyes",
    gaze: { yaw: 6.92, pitch: -21.96, roll: 11.6 },
    split: 18.43,
    w: 0.356,
    h: 0.875,
    eyes: [
      { x: -0.198, y: 0.295, shortAxis: 0.353, longAxis: 0.82 },
      { x: 0.412, y: 0.415, shortAxis: 0.315, longAxis: 0.826 },
    ],
  },
  {
    name: "notification",
    gaze: { yaw: -21.94, pitch: -5.82, roll: -12.2 },
    split: 18.89,
    w: 0.505,
    h: 0.498,
    eyes: [
      { x: -0.675, y: 0.172, shortAxis: 0.39, longAxis: 0.495 },
      { x: -0.059, y: 0.027, shortAxis: 0.495, longAxis: 0.5 },
    ],
  },
];

const shortAxis = (e: ReturnType<typeof eyePoses>[number], w: number) =>
  Math.hypot(e.a, e.b) * w;
const longAxis = (e: ReturnType<typeof eyePoses>[number], h: number) =>
  Math.hypot(e.c, e.d) * h;

describe("eyes posed on a sphere", () => {
  for (const m of MEASURED_POSES) {
    it(`reproduces the "${m.name}" pose measured on the video`, () => {
      const poses = eyePoses(m.gaze, 1, m.split);
      for (let i = 0; i < 2; i++) {
        const p = poses[i]!;
        const expected = m.eyes[i]!;
        // 0.04 radius = ~7 px on the video's 190 px ball
        expect(p.x).toBeCloseTo(expected.x, 1);
        expect(p.y).toBeCloseTo(expected.y, 1);
        expect(Math.abs(shortAxis(p, m.w) - expected.shortAxis)).toBeLessThan(
          0.04,
        );
        expect(Math.abs(longAxis(p, m.h) - expected.longAxis)).toBeLessThan(
          0.04,
        );
      }
    });
  }

  it("compresses the eye exactly by the sphere depth factor", () => {
    // Exact invariant: the projected tangent frame's determinant equals z.
    // That is what makes the eye's area follow the curvature (measured: 0.663).
    for (const e of eyePoses(REST_GAZE, 1)) {
      expect(e.a * e.d - e.b * e.c).toBeCloseTo(e.depth, 6);
    }
    const [nearEye, farEye] = eyePoses(REST_GAZE, 1);
    expect(farEye.depth / nearEye.depth).toBeCloseTo(0.663, 1);
    // video width measurement: 0.120 / 0.178 = 0.674
    expect(shortAxis(farEye, EYE_W) / shortAxis(nearEye, EYE_W)).toBeCloseTo(
      0.674,
      1,
    );
  });

  it("keeps the same length for both eyes (undeformed tangential axis)", () => {
    const [a, b] = eyePoses(REST_GAZE, 1);
    expect(longAxis(a, EYE_H)).toBeCloseTo(longAxis(b, EYE_H), 3);
  });

  it("keeps the 31-degree angular separation whatever the gaze", () => {
    for (const gaze of [
      REST_GAZE,
      { yaw: -40, pitch: 10, roll: 5 },
      { yaw: 0, pitch: 0, roll: 0 },
    ]) {
      const [a, b] = eyePoses(gaze, 1);
      const dot = a.x * b.x + a.y * b.y + a.depth * b.depth;
      expect((Math.acos(dot) * 180) / Math.PI).toBeCloseTo(EYE_SPLIT * 2, 4);
    }
  });

  it("takes an eye behind the sphere when the head turns hard", () => {
    const [, farEye] = eyePoses({ yaw: 80, pitch: 0, roll: 0 }, 1);
    expect(farEye.depth).toBeLessThan(0);
  });
});
