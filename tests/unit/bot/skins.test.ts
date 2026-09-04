// [20260904_Refactor_BloubEnginePort] Ported from bloub (github.com/jeremy-prt/bloub, MIT), src/bot/skins.test.ts.
// Numeric constants are frame-by-frame measurements of the reference video:
// do not round, simplify or "fix" any of them (see docs/bot/measurements.md).

import { describe, expect, it } from "vitest";
import { BotEngine, type RenderedEye } from "../../../src/bot/engine";
import { eyeShift, TEST_HOOKS } from "../../../src/bot/eyefit";
import { EXPRESSIONS } from "../../../src/bot/expressions";
import { DEFAULT_SHAPE, SHAPES, SHAPE_BY_ID } from "../../../src/bot/skins";
import { STATES, type StateId } from "../../../src/bot/states";

/**
 * The customiser's shapes, measured against the body they replace.
 *
 * This file locks two things, and the second cost far more than the first:
 *
 * 1. **The capsule never leaves the silhouette.** The eyes live on a sphere,
 *    and `radiusAtAngle` re-attaches them to the outline pro rata to the
 *    local radius — which divides their margin by that same pro rata. A shape
 *    narrow in the eye's direction pushed it against the edge until the mask
 *    opened it: the capsule showed up as a notch in the body.
 * 2. **The correction must not be seen moving.** Seven versions computed it
 *    in the render loop and all of them trembled. The oscillation tests
 *    below are what disqualified them, and they compare against the CIRCLE,
 *    the one shape the correction does not touch.
 *
 * Everything is about the RENDERED GEOMETRY, not the computation: we take the
 * body's outline and each capsule's exactly as the component draws them. It
 * is the only way to verify what the eye sees, and it assumes nothing about
 * the method used.
 */

const R = 100;

/**
 * Body outline, read off the `bodyPath`. `closedPath` emits `M x y` then one
 * `C` per point, so the curve's points are the 3rd pair of each `C`.
 */
function bodyContour(d: string) {
  const pts: Array<{ x: number; y: number }> = [];
  for (const seg of d.slice(1).split("C")) {
    const n = seg.match(/-?\d+\.?\d*/g)?.map(Number) ?? [];
    if (n.length >= 6) pts.push({ x: n[4]!, y: n[5]! });
    else if (n.length === 2) pts.push({ x: n[0]!, y: n[1]! });
  }
  return pts;
}

/** Is the point inside the polygon? Ray casting. */
function pointInPolygon(
  poly: Array<{ x: number; y: number }>,
  x: number,
  y: number,
) {
  let on = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (
      a.y > y !== b.y > y &&
      x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x
    )
      on = !on;
  }
  return on;
}

/**
 * A capsule's outline in screen coordinates: a stadium, sampled then put
 * through the rendered matrix. The dimensions are read back from the `d`
 * that `capsulePath` produced (`M-hw -hh+r A r r ...`), so as to depend only
 * on the output.
 *
 * Thirty-two points are enough: on a 40-unit-long capsule they sit less than
 * three units apart, where the smallest overflow we ever measured was worth
 * three.
 */
function eyeContour(eye: RenderedEye, N = 32) {
  const g = eye.d.match(/-?\d+\.?\d*/g)!.map(Number);
  const hw = Math.abs(g[0]!);
  const r = Math.abs(g[2]!);
  const straightLen = Math.abs(g[1]!);
  const m = eye.matrix.match(/-?\d+\.?\d*/g)!.map(Number);
  const [a, b, c, d, e, f] = m as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const out: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < N; i++) {
    const u = (i / N) * 4;
    let x: number;
    let y: number;
    if (u < 1) {
      const t = Math.PI * (u - 0.5);
      x = Math.cos(t) * r;
      y = -straightLen + Math.sin(t) * r;
    } else if (u < 2) {
      x = hw;
      y = -straightLen + (u - 1) * 2 * straightLen;
    } else if (u < 3) {
      const t = Math.PI * (u - 2 + 0.5);
      x = Math.cos(t) * r;
      y = straightLen + Math.sin(t) * r;
    } else {
      x = -hw;
      y = straightLen - (u - 3) * 2 * straightLen;
    }
    out.push({ x: a * x + c * y + e, y: b * x + d * y + f });
  }
  return out;
}

/** Three seconds at twenty frames per second: enough for several blinks. */
const INSTANTS = 60;
const TIME_STEP = 1 / 20;

/**
 * By how much the most overflowing capsule gets out of the body, in viewBox
 * units.
 *
 * It sweeps TIME, not only combinations. Gaze drift moves the eye by a dozen
 * units, so a single image proves nothing: measuring only at `POSES[state]`
 * is how `capsule` + `scared` went unnoticed, while it stuck out 4.4 units
 * one second later.
 */
function overflow(
  state: StateId,
  radii: number[],
  expr: (typeof EXPRESSIONS)[number] | null,
) {
  const e = new BotEngine(R, state, radii, expr);
  let worst = 0;
  for (let i = 0; i < INSTANTS; i++) {
    const f = e.sample(i * TIME_STEP);
    const body = bodyContour(f.bodyPath);
    for (const eye of f.eyes) {
      for (const p of eyeContour(eye)) {
        if (pointInPolygon(body, p.x, p.y)) continue;
        worst = Math.max(
          worst,
          Math.min(...body.map((q) => Math.hypot(q.x - p.x, q.y - p.y))),
        );
      }
    }
  }
  return worst;
}

/** The states whose body is replaceable by a customiser shape. */
const BASE_BODY_STATES = STATES.filter((s) => s.baseBody).map((s) => s.id);
/** The others: their silhouette IS the animation, measured on the video. */
const MEASURED_SILHOUETTES = STATES.filter((s) => !s.baseBody).map((s) => s.id);

describe("customiser shapes", () => {
  // 680 combinations x 60 instants x two outlines: the repo's heaviest test,
  // and the only one proving what the eye sees.
  it("no shape lets an eye leave the silhouette", () => {
    const offenders: string[] = [];
    for (const state of BASE_BODY_STATES) {
      for (const shape of SHAPES) {
        for (const expr of [null, ...EXPRESSIONS]) {
          const excess = overflow(state, shape.radii, expr);
          if (excess > 0.05) {
            offenders.push(
              `${state}/${shape.id}/${expr?.id ?? "pose"} ${excess.toFixed(1)}`,
            );
          }
        }
      }
    }
    // Five state x shape pairs used to overflow: `wide`+`capsule` by 14.5
    // units on a 100-radius ball, `wide`+`triangle` by 11.9, `idle`+`capsule`
    // and `swirl`+`capsule` by 5.3, `notify`+`droplet` by 3.3.
    expect(offenders).toEqual([]);
  }, 30_000);

  /**
   * The circle is the video-measured shape and the default body: choosing it
   * in the customiser must change NOTHING compared to choosing nothing. That
   * is what guarantees the correction is neutral on the reference — including
   * its outer eye, which already grazes the edge and must keep grazing it. It
   * is also what protects `public/favicon.svg`, whose two eye matrices are
   * those of `sample(1)` on `idle`, byte for byte.
   */
  it("choosing the circle renders exactly the same as choosing nothing", () => {
    expect(DEFAULT_SHAPE).toBe("circle");
    const circle = SHAPE_BY_ID.get("circle")!.radii;
    for (const state of BASE_BODY_STATES) {
      for (const expr of [null, ...EXPRESSIONS]) {
        const withFace = new BotEngine(R, state, circle, expr).sample(1);
        const withoutFace = new BotEngine(R, state, null, expr).sample(1);
        expect(withFace.eyes, `${state}/${expr?.id ?? "pose"}`).toEqual(
          withoutFace.eyes,
        );
      }
      expect(eyeShift(circle, state, null)).toEqual({ x: 0, y: 0 });
    }
  });

  /**
   * The video-measured silhouettes are not replaceable, so the chosen shape
   * must not reach them — neither their body nor their eyes. `orbit` is the
   * case that counts: its eye's margin is tighter than the circle's, and yet
   * it is just right, because it was measured that way. A margin rule applied
   * indiscriminately would move it.
   */
  it("the chosen shape does not touch the measured-silhouette states", () => {
    for (const state of MEASURED_SILHOUETTES) {
      const bare = new BotEngine(R, state, null, null).sample(1);
      for (const shape of SHAPES) {
        const dressed = new BotEngine(R, state, shape.radii, null).sample(1);
        expect(dressed.eyes, `${state}/${shape.id}`).toEqual(bare.eyes);
        expect(dressed.bodyPath).toBe(bare.bodyPath);
      }
    }
  });

  /**
   * The correction must change NOTHING about eye size.
   *
   * One version scaled it along with the position: it preserved all the
   * face's proportions and stayed stable, but the eyes became visibly
   * smaller on a flat body, and changing expression then animated that
   * shrink. It read as a defect.
   */
  it("eye size does not depend on the shape", () => {
    const sizes = new Set(
      SHAPES.map((f) =>
        new BotEngine(R, "idle", f.radii, null)
          .sample(1)
          .eyes.map((y) => y.d)
          .join("|"),
      ),
    );
    expect(sizes.size).toBe(1);
  });

  /**
   * The real trap: the correction must be INVISIBLE in motion.
   *
   * What we measure is OSCILLATION, not speed. A morph moves the eyes fast
   * anyway — expressions do not look at the same place — and that is wanted
   * movement. Trembling is going and COMING BACK. We therefore count
   * direction changes frame by frame, and compare against the circle, which
   * the correction does not touch.
   *
   * The measurement discriminates well: 0 to 1 reversal on the original
   * engine, 4 to 14 with kickbacks up to 26 units on the trembling versions.
   */
  it("the correction does not make the eyes oscillate", () => {
    const step = 1 / 60;

    const trajectory = (
      build: () => BotEngine,
      duration = BotEngine.SHAPE_MORPH,
    ) => {
      const e = build();
      const out: Array<Array<{ x: number; y: number }>> = [];
      for (let t = 0; t <= duration + step; t += step) {
        out.push(
          e.sample(t).eyes.map((eye) => {
            const n = eye.matrix.match(/-?\d+\.?\d*/g)!.map(Number);
            return { x: n[4]!, y: n[5]! };
          }),
        );
      }
      return out;
    };

    /** How many times an eye reverses, and by how much at most. */
    const reversals = (timeline: Array<Array<{ x: number; y: number }>>) => {
      let n = 0;
      let amplitude = 0;
      const eyeCount = Math.min(...timeline.map((f) => f.length));
      for (let j = 0; j < eyeCount; j++) {
        let px = 0;
        let py = 0;
        for (let i = 1; i < timeline.length; i++) {
          const dx = timeline[i]![j]!.x - timeline[i - 1]![j]!.x;
          const dy = timeline[i]![j]!.y - timeline[i - 1]![j]!.y;
          const len = Math.hypot(dx, dy);
          if (len <= 0.05) continue;
          if ((px || py) && dx * px + dy * py < 0) {
            n++;
            amplitude = Math.max(amplitude, len);
          }
          px = dx;
          py = dy;
        }
      }
      return { n, amplitude };
    };

    const circle = SHAPE_BY_ID.get("circle")!.radii;
    const shapeMorphRev = (radii: number[]) =>
      reversals(
        trajectory(() => {
          const e = new BotEngine(R, "idle", circle, null);
          e.setShape(radii, 0);
          return e;
        }),
      );
    const atRestRev = (radii: number[]) =>
      reversals(trajectory(() => new BotEngine(R, "idle", radii, null), 3));
    const exprMorphRev = (radii: number[]) =>
      EXPRESSIONS.map((expr) =>
        reversals(
          trajectory(() => {
            const e = new BotEngine(R, "idle", radii, EXPRESSIONS[0]!);
            e.setExpression(expr, 0);
            return e;
          }),
        ),
      ).reduce(
        (a, b) => ({
          n: a.n + b.n,
          amplitude: Math.max(a.amplitude, b.amplitude),
        }),
        {
          n: 0,
          amplitude: 0,
        },
      );

    /*
     * On the CIRCLE, nothing at all: the correction is null there, so it
     * cannot add any movement — it is the reference for all three
     * comparisons.
     */
    expect(exprMorphRev(circle).n, "circle: expression morphs").toBe(0);

    for (const shape of SHAPES) {
      // At rest, the only thing moving is gaze drift. A correction that
      // followed it would make the eyes tremble permanently: the most
      // visible defect of all, and the first one we had.
      expect(
        atRestRev(shape.radii).n,
        `${shape.id}: drift at rest`,
      ).toBeLessThanOrEqual(atRestRev(circle).n + 1);
      // A shape change moves the shift, but along the same curve as the
      // silhouette: no more reversals than the circle.
      expect(
        shapeMorphRev(shape.radii).n,
        `shape morph to ${shape.id}`,
      ).toBeLessThanOrEqual(shapeMorphRev(circle).n + 1);
      /*
       * An expression change moves the shift from one table entry to another.
       * Seven shapes out of eight gain no reversal from it; the `droplet`
       * goes from one 6.3-unit kickback — already present without the
       * correction — to two of 11.1. The bound lets that through and nothing
       * more: the faulty versions were at 26.
       */
      expect(
        exprMorphRev(shape.radii).amplitude,
        `${shape.id}: expression morphs`,
      ).toBeLessThan(14);
    }
  });

  /**
   * The table is a module constant. It must stay fast enough to build so as
   * not to weigh on first display: that is the only cost this fix adds to the
   * engine, which then only reads two entries from it and interpolates.
   */
  it("the table builds in a few milliseconds", () => {
    const t = performance.now();
    TEST_HOOKS.buildTable();
    expect(performance.now() - t).toBeLessThan(200);
  });
});
