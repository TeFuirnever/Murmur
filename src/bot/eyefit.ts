// [20260904_Refactor_BloubEnginePort] Ported from bloub (github.com/jeremy-prt/bloub, MIT), src/bot/eyefit.ts.
// Numeric constants are frame-by-frame measurements of the reference video:
// do not round, simplify or "fix" any of them (see docs/bot/measurements.md).

/**
 * Where to place the face on a customiser shape.
 *
 * The eyes live on a sphere, and `radiusAtAngle` re-attaches them to the real
 * outline pro rata to the local radius. That pro rata places their CENTER
 * correctly, but the eye has a size: the margin it keeps in front of the edge
 * gets multiplied by the same factor, so a silhouette that is narrow in the
 * eye's direction pushes it against the edge until the mask opens it to the
 * outside. The capsule showed up as a notch in the body on `capsule`,
 * `triangle`, `cloud` and `droplet`.
 *
 * This module solves the problem ONCE, at load time, and returns a table of
 * shifts. That choice is the essence of the fix, far more than the geometry
 * below:
 *
 * Solved inside the render loop, the correction reacts to everything that
 * moves at sixty frames per second — gaze drift, the pointer, the expression
 * mid-morph, the nearest edge changing, the most constrained eye changing.
 * Seven variants were written that way and all of them produced a visible
 * motion artefact: permanent trembling, a 26-unit jump of direction when the
 * reference edge flipped, sudden growth when size entered the computation.
 * The defect was in none of their geometries; it was in solving per frame.
 *
 * The rest of the engine does not work like that: poses are DECLARED and it
 * merely interpolates them along known curves. A tabulated shift fits that
 * mould. It does not move when the gaze drifts nor when the pointer moves,
 * and on a shape or expression change it only goes from one table entry to
 * another, along that morph's curve. Trembling becomes impossible by
 * construction, instead of being pushed back: interpolating between two
 * constants is monotone, whereas re-solving the problem on a gaze that is
 * itself interpolating is not.
 *
 * Pleasant corollary: the solver no longer has any continuity constraint,
 * since it does not run during the animation. It can therefore probe a whole
 * fan of directions and cover the worst case of gaze drift, which a per-frame
 * version could not afford.
 *
 * The table is a module constant, built at import from pure data: the same
 * nature as `face.ts`'s blink schedule, deterministic and stateless, hence no
 * effect on the purity of `engine.sample(t)`.
 */

import { EXPRESSIONS, type BotExpression } from "./expressions";
import { eyePoses } from "./face";
import { radiusAtAngle, toPoints, type Point } from "./shape";
import { SHAPES } from "./skins";
import { STATES, type Pose, type StateDef, type StateId } from "./states";

/** Solver's reference radius. The returned shift is in units of this radius. */
const R = 100;

/**
 * Maximal amplitudes of the life at rest, read off `liveliness`: `loopNoise`
 * is bounded to 1 in absolute value, so these sums are exact bounds, not
 * estimates.
 *
 * They must be covered, otherwise the correction is right on the nominal pose
 * and wrong one second later: 7 degrees of yaw move the eye by a dozen units
 * on a ball of radius 100. That is precisely what made `capsule` + `scared`
 * overflow while a single-instant measurement declared it fine.
 */
const DRIFT_YAW = 5.5 + 1.6;
const DRIFT_PITCH = 4.2 + 1.3;
/** Center wander, in units of ball radius. */
const DRIFT_X = 0.006;
const DRIFT_Y = 0.007;

/** A pose's face — what the solver needs to place its capsules. */
interface FaceLayout {
  gaze: Pose["gaze"];
  split: number;
  eyes: Pose["eyes"];
}

/**
 * A capsule ready to be measured: its axis segment, and what it takes to
 * compute the radius to clear IN A GIVEN direction.
 *
 * A capsule is exactly a segment thickened by a disk of radius `r`. Its image
 * through the tangent matrix is therefore a segment thickened by an ELLIPSE,
 * and the radius to clear depends on the direction: it is that ellipse's
 * support function, `r * |A^T u|`.
 *
 * Taking its largest singular value instead would be conservative but wrong
 * in the only direction that matters, and it costs dearly: the reference
 * margin on the circle came out NEGATIVE, so the requirement became toothless
 * and 34 combinations kept overflowing.
 */
interface EyeFootprint {
  /** center, in viewBox units */
  x: number;
  y: number;
  /** half-vector of the axis */
  ax: number;
  ay: number;
  /** radius of the local disk, before transformation */
  r: number;
  /** columns of the tangent matrix, for the support function */
  m: [number, number, number, number];
}

/**
 * Footprints of a face's two eyes, placed on a profile.
 *
 * A capsule is exactly a segment thickened by a disk of radius `r`. Its image
 * through the tangent matrix is therefore a segment thickened by an ELLIPSE,
 * and a disk of its major axis's radius covers it: hence the largest singular
 * value. The measurement stays conservative in the strict sense, a positive
 * margin guaranteeing the capsule is inside.
 *
 * The blink is not part of it: a closed eye needs no room made for it.
 */
function eyeFootprints(
  visage: FaceLayout,
  sil: Pose["sil"],
  radii: number[],
): EyeFootprint[] {
  const out: EyeFootprint[] = [];
  const poses = eyePoses(visage.gaze, R, visage.split);
  for (let i = 0; i < 2; i++) {
    const e = poses[i]!;
    if (e.depth <= 0.02) continue;
    const cfg = visage.eyes[i]!;
    const phi = ((cfg.tilt ?? 0) * Math.PI) / 180;
    const cp = Math.cos(phi);
    const sp = Math.sin(phi);
    const ax = e.a * cp + e.c * sp;
    const ay = e.b * cp + e.d * sp;
    const cx = -e.a * sp + e.c * cp;
    const cy = -e.b * sp + e.d * cp;

    const hw = Math.max(cfg.w * R, 0.01) / 2;
    const hh = Math.max(cfg.h * R, 0.01) / 2;
    const r = Math.min(hw, hh);
    // the axis is the one of the largest dimension
    const isTallAxis = hh > hw;
    const halfAxis = isTallAxis ? hh - r : hw - r;
    // the local radius's pro rata, exactly as the engine does it
    const fit = radiusAtAngle(radii, Math.atan2(e.y, e.x) - sil.rot);
    out.push({
      x: e.x * fit,
      y: e.y * fit,
      ax: (isTallAxis ? cx : ax) * halfAxis,
      ay: (isTallAxis ? cy : ay) * halfAxis,
      r,
      m: [ax, ay, cx, cy],
    });
  }
  return out;
}

/**
 * Closest approach between an outline and a segment: the distance, and the
 * vector going from the outline toward the segment — the direction that
 * clears it.
 *
 * Both come out of the SAME pass. Computing them separately doubled the only
 * real cost of this module, which is that sweep.
 */
function closestApproach(
  pts: Point[],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
) {
  const sx = x1 - x0;
  const sy = y1 - y0;
  const len2 = sx * sx + sy * sy;
  let best = Infinity;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    let t = len2 > 0 ? ((p.x - x0) * sx + (p.y - y0) * sy) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = x0 + t * sx - p.x;
    const ey = y0 + t * sy - p.y;
    const d2 = ex * ex + ey * ey;
    if (d2 < best) {
      best = d2;
      vx = ex;
      vy = ey;
    }
  }
  const d = Math.sqrt(best);
  return { d, ux: d > 1e-9 ? vx / d : 0, uy: d > 1e-9 ? vy / d : 0 };
}

/** A trial: capsules to fit inside an outline, and the reference outline. */
interface FitTrial {
  eyeFootprints: EyeFootprint[];
  reference: EyeFootprint[];
  contour: Point[];
  calContour: Point[];
}

/**
 * Center wander at rest, in viewBox units. It is added to the capsule's
 * radius: less than one unit, so absorbing it this way costs less than
 * multiplying the trials by its four corners.
 */
const WANDER_RADIUS = Math.hypot(DRIFT_X, DRIFT_Y) * R;

/** Margin of the tightest capsule, and the direction that clears it. */
function worstMargin(
  pts: Point[],
  footprints: EyeFootprint[],
  tx: number,
  ty: number,
) {
  let margin = Infinity;
  let ux = 0;
  let uy = 0;
  for (const e of footprints) {
    const x = e.x + tx;
    const y = e.y + ty;
    const a = closestApproach(pts, x - e.ax, y - e.ay, x + e.ax, y + e.ay);
    // support function of the ellipse in the approach's direction
    const [m0, m1, m2, m3] = e.m;
    const radius =
      e.r * Math.hypot(m0 * a.ux + m1 * a.uy, m2 * a.ux + m3 * a.uy) +
      WANDER_RADIUS;
    if (a.d - radius < margin) {
      margin = a.d - radius;
      ux = a.ux;
      uy = a.uy;
    }
  }
  return { margin, ux, uy };
}

/**
 * Probed directions and the bisection step. Their product is the table's
 * build cost, the only figure worth watching here.
 */
const PROBE_DIRECTIONS = 12;
const BISECTION_STEPS = 8;

/**
 * The shift to put on both eyes for this shape, this state and this
 * expression.
 *
 * One TRANSLATION common to both eyes, hence an isometry: eye spacing, sizes
 * and tilts are preserved to the pixel. The face is only placed a little
 * lower on a body that has no room on top, which is the gesture one would
 * make by hand. The variants that bounded each eye separately pulled the pair
 * apart, and the ones that scaled the face shrank the eyes — visibly.
 *
 * The target margin is the ORIGINAL profile's, not a strict clearance: on the
 * circle the outer eye already grazes the edge, 17.3 units for a ball of
 * radius 100 — and that is wanted, it is what gives the volume. It is capped
 * by what the shape offers at its center, otherwise the requirement is
 * untenable on a flat body.
 *
 * DIRECTIONAL SEARCH, not descent. We look for the smallest-norm translation
 * that fits, so we probe a crown of directions and bisect the distance along
 * each. A gradient descent was written first and it does not converge:
 * freeing the pair from one edge brings it closer to the other, so it
 * fumbles and merely keeps its best attempt — dropping its turns from 40 to
 * 18 was enough to bring 34 overflows back. Here the result does not depend
 * on a convergence: each direction is solved exactly, to the bisection step.
 */
function solveShift(trials: FitTrial[]): { x: number; y: number } {
  if (!trials.length) return { x: 0, y: 0 };

  /** The tightest margin over all trials, for a given translation. */
  const margin = (tx: number, ty: number) => {
    let m = Infinity;
    for (const ep of trials)
      m = Math.min(m, worstMargin(ep.contour, ep.eyeFootprints, tx, ty).margin);
    return m;
  };

  // Required margin: the tightest the original profile tolerates, over all
  // trials. Then capped by the most room the shape can offer the pair, at its
  // center.
  let requiredMargin = Infinity;
  for (const ep of trials) {
    requiredMargin = Math.min(
      requiredMargin,
      worstMargin(ep.calContour, ep.reference, 0, 0).margin,
    );
  }
  /*
   * The travel must be able to reach the body's center: `wide` has capsules
   * 87 units long, and on a triangle they only fit toward the middle, some
   * fifty units from their nominal place. A fixed travel left them outside.
   */
  let mx = 0;
  let my = 0;
  const footprints = trials[0]!.eyeFootprints;
  for (const e of footprints) {
    mx -= e.x / footprints.length;
    my -= e.y / footprints.length;
  }
  const travelSpan = Math.max(0.35 * R, Math.hypot(mx, my) * 1.25);

  // Cap of the requirement: what the shape offers at its center, always
  // reachable.
  requiredMargin = Math.min(requiredMargin, margin(mx, my));

  /*
   * Already good: the circle's case, and any shape wide enough. The capsule
   * must get IN, on top of not being tighter than on the original profile —
   * without that second condition, a shape nothing fits into satisfies the
   * first one in a degenerate way and we gave up. `wide` has capsules 87
   * units long, `notify` 50 in diameter: on a triangle or the droplet they
   * overflow no matter what, and one must then aim for the least bad, not
   * resign.
   */
  const startMargin = margin(0, 0);
  if (startMargin >= requiredMargin && startMargin >= 0) return { x: 0, y: 0 };
  const target = Math.max(requiredMargin, 0);

  let bestX = 0;
  let bestY = 0;
  let bestNorm = Infinity;
  // fallback when nothing fits: the translation that clears the most, probed
  // along the way
  let fallbackX = 0;
  let fallbackY = 0;
  let fallback = startMargin;

  for (let d = 0; d < PROBE_DIRECTIONS; d++) {
    const a = (d / PROBE_DIRECTIONS) * Math.PI * 2;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    if (margin(ux * travelSpan, uy * travelSpan) < target) {
      // this direction leads nowhere; we still keep the best clearance
      // no solution that way, but maybe a better clearance
      for (const k of [0.3, 0.6, 1]) {
        const m = margin(ux * travelSpan * k, uy * travelSpan * k);
        if (m > fallback) {
          fallback = m;
          fallbackX = ux * travelSpan * k;
          fallbackY = uy * travelSpan * k;
        }
      }
      continue;
    }
    // the shortest distance that fits, along this direction
    let lo = 0;
    let hi = travelSpan;
    for (let i = 0; i < BISECTION_STEPS; i++) {
      const mid = (lo + hi) / 2;
      if (margin(ux * mid, uy * mid) >= target) hi = mid;
      else lo = mid;
    }
    if (hi < bestNorm) {
      bestNorm = hi;
      bestX = ux * hi;
      bestY = uy * hi;
    }
  }

  const x = bestNorm === Infinity ? fallbackX : bestX;
  const y = bestNorm === Infinity ? fallbackY : bestY;
  // returned in units of BALL RADIUS: the engine rescales it
  return { x: +(x / R).toFixed(6), y: +(y / R).toFixed(6) };
}

/**
 * The face to cover: the expression's if the state accepts it, the state's own
 * otherwise.
 *
 * ONE table entry per expression, not a common worst case for all of them. A
 * worst case seemed safer — a constant shift cannot move when the expression
 * changes — but it is untenable: on a capsule, `neutral` has high eyes and
 * asks to go down while `scared` has them low and asks to go up. No single
 * translation satisfies both, and measurement confirms it (4 overflows of 4.8
 * units).
 *
 * One entry per expression is no less smooth for all that: the engine
 * interpolates between TWO CONSTANTS, which is monotone by construction. What
 * trembled was re-solving the problem on a gaze that was itself
 * interpolating.
 */
function faceFor(
  def: StateDef,
  pose: Pose,
  expr: BotExpression | null,
): FaceLayout {
  if (def.baseFace && expr)
    return { gaze: expr.gaze, split: expr.split, eyes: expr.eyes };
  return { gaze: pose.gaze, split: pose.split, eyes: pose.eyes };
}

/** The times to sample within a state: a single one if its pose does not move. */
function dates(def: StateDef): number[] {
  /** Everything the solver reads: if nothing moves, one time is enough. */
  const signature = (p: Pose) =>
    JSON.stringify([
      p.gaze,
      p.split,
      p.eyes,
      p.sil.rot,
      p.sil.cx,
      p.sil.cy,
      p.sil.sx,
      p.sil.sy,
    ]);
  if (signature(def.pose(0)) === signature(def.pose(def.duration))) return [0];
  const n = 3;
  return Array.from({ length: n }, (_, i) => (i / (n - 1)) * def.duration);
}

/** A shape's shift on one state and one expression, drift included. */
function shiftFor(
  def: StateDef,
  radii: number[],
  expr: BotExpression | null,
): { x: number; y: number } {
  const trials: FitTrial[] = [];
  for (const t of dates(def)) {
    const pose = def.pose(t);
    const contour = toPoints({ ...pose.sil, radii }, R);
    const calContour = toPoints(pose.sil, R);
    const v = faceFor(def, pose, expr);
    // The four corners of the drift bound the nominal pose, which is their
    // center: testing it in addition would change no margin and cost one
    // trial in five.
    const corners: FaceLayout[] = [];
    for (const dy of [-DRIFT_YAW, DRIFT_YAW]) {
      for (const dp of [-DRIFT_PITCH, DRIFT_PITCH]) {
        corners.push({
          ...v,
          gaze: {
            yaw: v.gaze.yaw + dy,
            pitch: v.gaze.pitch + dp,
            roll: v.gaze.roll,
          },
        });
      }
    }
    for (const c of corners) {
      trials.push({
        eyeFootprints: eyeFootprints(c, pose.sil, radii),
        reference: eyeFootprints(c, pose.sil, pose.sil.radii),
        contour,
        calContour,
      });
    }
  }
  return solveShift(trials);
}

/** Zero — the value common to everything that has nothing to correct. */
const ZERO_SHIFT = { x: 0, y: 0 } as const;

/** A table entry's key: the state, and the expression when the state takes one. */
const entryKey = (state: StateId, expr: string | null) =>
  `${state}|${expr ?? ""}`;

/**
 * The shift table, built at import: one entry per (shape, base-body state,
 * expression). Only `idle` and `swirl` carry the rest face, so only they
 * decline per expression — the three other base-body states have a face
 * measured off the video and a single entry.
 *
 * Keyed by REFERENCE of the radii array, which is already the engine's
 * convention: its guards `radii === this.shape` and `expression === this.expr`
 * rely on the same stability. An unknown profile, or `null`, corrects
 * nothing — the API accepts any array and the engine need not depend on its
 * callers' prudence.
 */
function buildTable(): Map<number[], Map<string, { x: number; y: number }>> {
  return new Map(
    SHAPES.map((shape) => {
      const perShape = new Map<string, { x: number; y: number }>();
      for (const def of STATES) {
        if (!def.baseBody) continue;
        const expressions = def.baseFace ? [null, ...EXPRESSIONS] : [null];
        for (const expr of expressions) {
          perShape.set(
            entryKey(def.id, expr?.id ?? null),
            shiftFor(def, shape.radii, expr),
          );
        }
      }
      return [shape.radii, perShape];
    }),
  );
}

const EYE_SHIFT_TABLE = buildTable();

/**
 * Shift to apply to both eyes for this shape on this state, in units of ball
 * radius — the engine rescales it.
 *
 * Zero as soon as the shape is not in the catalogue, which covers `null` and
 * the circle: on the circle both profiles are the same, so the margin is
 * already the required one and the search exits on its first pass. The
 * video-measured shape therefore does not move, with no special case.
 */
export function eyeShift(
  radii: number[] | null,
  state: StateId,
  expr: string | null,
): { x: number; y: number } {
  if (!radii) return ZERO_SHIFT;
  const perShape = EYE_SHIFT_TABLE.get(radii);
  if (!perShape) return ZERO_SHIFT;
  // a state without a rest face has a single entry, whatever the expression
  return (
    perShape.get(entryKey(state, expr)) ??
    perShape.get(entryKey(state, null)) ??
    ZERO_SHIFT
  );
}

/** For tests: a way to inspect the table without redoing the geometry. */
/** For tests: a way to time the table's construction. */
export const TEST_HOOKS = { buildTable };
