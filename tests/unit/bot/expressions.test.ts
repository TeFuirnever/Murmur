// [20260904_Refactor_BloubEnginePort] Ported from bloub (github.com/jeremy-prt/bloub, MIT), src/bot/expressions.test.ts.
// Numeric constants are frame-by-frame measurements of the reference video:
// do not round, simplify or "fix" any of them (see docs/bot/measurements.md).

import { describe, expect, it } from "vitest";
import { BotEngine } from "../../../src/bot/engine";
import {
  EXPRESSIONS,
  EXPRESSION_BY_ID,
  blendExpression,
} from "../../../src/bot/expressions";
import { radiusAtAngle } from "../../../src/bot/shape";
import { SHAPE_BY_ID } from "../../../src/bot/skins";

const circle = () => SHAPE_BY_ID.get("circle")!.radii;

/** Rendered eye matrix -> position, screen dimensions and major-axis angle. */
function renderedEye(matrix: string, w: number, h: number) {
  const [a, b, c, d, e, f] = /matrix\(([^)]+)\)/
    .exec(matrix)![1]!
    .split(",")
    .map(Number) as number[];
  return {
    x: e!,
    y: f!,
    width: Math.hypot(a!, b!) * w,
    height: Math.hypot(c!, d!) * h,
    axis: (Math.atan2(d!, c!) * 180) / Math.PI - 90,
  };
}

describe("expression catalogue", () => {
  it("exposes 16 expressions with unique ids", () => {
    expect(EXPRESSIONS).toHaveLength(16);
    expect(new Set(EXPRESSIONS.map((e) => e.id)).size).toBe(16);
    expect(EXPRESSION_BY_ID.size).toBe(16);
  });

  /**
   * The trap we fell into: an eye whose width/height ratio approaches 1 is a
   * circle — it looks the same at any angle and its tilt is invisible. Any
   * expression relying on a tilt must therefore have frankly elongated eyes.
   */
  it("only tilts eyes elongated enough for it to show", () => {
    for (const e of EXPRESSIONS) {
      for (const eye of e.eyes) {
        const tilt = Math.abs(eye.tilt ?? 0);
        if (tilt < 1) continue;
        const ratio = eye.w / eye.h;
        const threshold = tilt >= 20 ? [0.6, 1.7] : [0.8, 1.25];
        expect(
          ratio < threshold[0]! || ratio > threshold[1]!,
          `${e.id}: ratio ${ratio.toFixed(2)} too close to 1 for a ${tilt}deg tilt`,
        ).toBe(true);
      }
    }
  });

  it("tilts anger and sadness in mirror, and in opposite directions", () => {
    const angles = (id: string) => {
      const f = new BotEngine(
        100,
        "idle",
        circle(),
        EXPRESSION_BY_ID.get(id)!,
      ).sample(1);
      const e = EXPRESSION_BY_ID.get(id)!;
      return f.eyes.map(
        (eye, i) => renderedEye(eye.matrix, e.eyes[i]!.w, e.eyes[i]!.h).axis,
      );
    };
    const angry = angles("angry");
    const sad = angles("sad");
    // mirrored: the two eyes lean opposite each other
    expect(Math.sign(angry[0]!)).toBe(-Math.sign(angry[1]!));
    expect(Math.sign(sad[0]!)).toBe(-Math.sign(sad[1]!));
    // and the two emotions are inverted relative to one another
    expect(Math.sign(angry[0]!)).toBe(-Math.sign(sad[0]!));
  });

  it("keeps both eyes inside the silhouette, across all 16 expressions", () => {
    for (const e of EXPRESSIONS) {
      const f = new BotEngine(100, "idle", circle(), e).sample(1);
      expect(f.eyes, e.id).toHaveLength(2);
      for (let i = 0; i < 2; i++) {
        const r = renderedEye(f.eyes[i]!.matrix, e.eyes[i]!.w, e.eyes[i]!.h);
        // eye half-diagonal: the farthest corner must stay inside
        const halfDiag = Math.hypot(r.width, r.height) / 2;
        const bord = radiusAtAngle(circle(), Math.atan2(r.y, r.x)) * 100;
        expect(
          Math.hypot(r.x, r.y) + halfDiag,
          `${e.id} eye ${i}`,
        ).toBeLessThan(bord * 1.02);
      }
    }
  });
});

describe("expression change", () => {
  it("interpolates the geometry monotonically", () => {
    // We measure on blendExpression, not on the render: gaze drift at rest
    // varies the projection, so the on-screen height is not monotone even
    // when the interpolation itself is.
    const fromExpr = EXPRESSION_BY_ID.get("neutral")!;
    const toExpr = EXPRESSION_BY_ID.get("scared")!;
    const heights = [0, 0.25, 0.5, 0.75, 1].map(
      (t) => blendExpression(fromExpr, toExpr, t).eyes[0]!.h,
    );
    for (let i = 1; i < heights.length; i++) {
      expect(heights[i]!).toBeGreaterThan(heights[i - 1]!);
    }
    expect(heights[0]!).toBeCloseTo(fromExpr.eyes[0]!.h, 5);
    expect(heights[4]!).toBeCloseTo(toExpr.eyes[0]!.h, 5);
  });

  it("glides to the new expression instead of jumping", () => {
    const target = EXPRESSION_BY_ID.get("scared")!;
    const e = new BotEngine(
      100,
      "idle",
      circle(),
      EXPRESSION_BY_ID.get("neutral")!,
    );
    e.setExpression(target, 1);

    // just after the change, the eye does not have the target's shape yet...
    const early = e.sample(1.02).eyes[0]!.d;
    const arrived = new BotEngine(100, "idle", circle(), target).sample(1)
      .eyes[0]!.d;
    expect(early).not.toBe(arrived);
    // ...and it does once the morph is done
    expect(e.sample(1 + BotEngine.SHAPE_MORPH + 0.05).eyes[0]!.d).toBe(arrived);
  });

  it("stays a pure function of time during the morph", () => {
    const e = new BotEngine(
      100,
      "idle",
      circle(),
      EXPRESSION_BY_ID.get("neutral")!,
    );
    e.setExpression(EXPRESSION_BY_ID.get("angry")!, 1);
    const midFrame = e.sample(1.12).eyes[0]!.matrix;
    e.sample(3);
    expect(e.sample(1.12).eyes[0]!.matrix).toBe(midFrame);
  });

  it("applies the expression only to the rest state", () => {
    const expr = EXPRESSION_BY_ID.get("scared")!;
    // wink has its own expression, measured on the video: it must survive
    const bare = new BotEngine(100, "wink", circle()).sample(1);
    const dressed = new BotEngine(100, "wink", circle(), expr).sample(1);
    expect(dressed.eyes[0]!.d).toBe(bare.eyes[0]!.d);

    const resting = new BotEngine(100, "idle", circle(), expr).sample(1);
    const restingBare = new BotEngine(100, "idle", circle()).sample(1);
    expect(resting.eyes[0]!.d).not.toBe(restingBare.eyes[0]!.d);
  });

  it("interpolates every component, tilt included", () => {
    const a = EXPRESSION_BY_ID.get("angry")!;
    const b = EXPRESSION_BY_ID.get("sad")!;
    const m = blendExpression(a, b, 0.5);
    expect(m.eyes[0]!.tilt).toBeCloseTo(
      ((a.eyes[0]!.tilt ?? 0) + (b.eyes[0]!.tilt ?? 0)) / 2,
      5,
    );
    expect(m.split).toBeCloseTo((a.split + b.split) / 2, 5);
    expect(m.gaze.pitch).toBeCloseTo((a.gaze.pitch + b.gaze.pitch) / 2, 5);
  });
});
