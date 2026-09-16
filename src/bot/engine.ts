// [20260904_Refactor_BloubEnginePort] Ported from bloub (github.com/jeremy-prt/bloub, MIT), src/bot/engine.ts.
// Numeric constants are frame-by-frame measurements of the reference video:
// do not round, simplify or "fix" any of them (see docs/bot/measurements.md).

import { arcRender, type ArcRender, type DotRender } from "./decor";
import { blendExpression, type BotExpression } from "./expressions";
import { eyeShift } from "./eyefit";
import { blinkScale, eyePoses, liveliness } from "./face";
import { clamp, easings, lerp, r2 } from "./math";
import {
  blend,
  capsulePath,
  closedPath,
  radiusAtAngle,
  toPoints,
  type Point,
  type Silhouette,
} from "./shape";
import { STATE_BY_ID, type Pose, type StateDef, type StateId } from "./states";

export interface RenderedEye {
  d: string;
  matrix: string;
  alpha: number;
}

export interface BotFrame {
  bodyPath: string;
  bodyAlpha: number;
  eyes: RenderedEye[];
  dots: DotRender[];
  /** true = the dots pass behind the body (burst particles) */
  dotsBehind: boolean;
  arcs: ArcRender[];
  notif: { x: number; y: number; r: number } | null;
  notch: { x: number; y: number; r: number } | null;
}

/**
 * Where the bot directs its gaze when something external drives it — the
 * mouse pointer, today.
 *
 * `yaw` and `pitch` are ABSOLUTE directions that replace the pose's own as
 * `mix` rises. Two reasons, each a trap already fallen into:
 *
 * - the ENGINE must do that mixing, not the caller, because only it knows the
 *   pose AT THAT INSTANT. A caller compensating for the expression's
 *   orientation would read its arrival value while the morph is still
 *   running, and the eyes would jump at every mood change;
 * - and it must be absolute on BOTH axes. In relative terms, eye height
 *   followed each expression's — "neutral" looks at +28.6deg while the others
 *   sit between -9 and +9 — so the eyes dropped abruptly at the first mood
 *   change. What gives an expression its character during tracking is the
 *   SHAPE of its eyes (squinted, round, asymmetric), not where it looks: that
 *   part is the cursor's call.
 *
 * `mix` says how much the outside commands the DIRECTION (0 = not at all).
 *
 * `wander` says, separately, what remains of automatic drift. The two must
 * not be confused: when the pointer moves, the drift must switch off —
 * summed, the bot would look like it is searching for the cursor without
 * ever holding it. But when there is NO pointer (keyboard or touch arrival,
 * or the mouse left the window), the head must stay turned AND keep living.
 * Confusing them froze the gaze as soon as the view opened.
 *
 * `spin` is a turn to travel IN TRANSIT, in degrees, melted toward 0 on
 * arrival. Since the eyes live on a sphere, a full turn takes them behind
 * the ball and back out the other side — and `-360deg` being the same angle
 * as `0`, it changes nothing about where they land.
 */
export interface Look {
  yaw: number;
  pitch: number;
  mix: number;
  spin: number;
  wander: number;
}

const NO_LOOK: Look = { yaw: 0, pitch: 0, mix: 0, spin: 0, wander: 1 };

const lerpLook = (a: Look, b: Look, t: number): Look => ({
  yaw: lerp(a.yaw, b.yaw, t),
  pitch: lerp(a.pitch, b.pitch, t),
  mix: lerp(a.mix, b.mix, t),
  spin: lerp(a.spin, b.spin, t),
  wander: lerp(a.wander, b.wander, t),
});

const lerpEye = (
  a: Pose["eyes"][number],
  b: Pose["eyes"][number],
  t: number,
) => ({
  w: lerp(a.w, b.w, t),
  h: lerp(a.h, b.h, t),
  open: lerp(a.open, b.open, t),
  tilt: lerp(a.tilt ?? 0, b.tilt ?? 0, t),
});

/** Interpolation of two poses. The decor crosses in opacity, not in geometry. */
function blendPose(a: Pose, b: Pose, t: number): Pose {
  const out = 1 - t;
  return {
    sil: blend(a.sil, b.sil, t),
    offX: lerp(a.offX, b.offX, t),
    offY: lerp(a.offY, b.offY, t),
    gaze: {
      yaw: lerp(a.gaze.yaw, b.gaze.yaw, t),
      pitch: lerp(a.gaze.pitch, b.gaze.pitch, t),
      roll: lerp(a.gaze.roll, b.gaze.roll, t),
    },
    split: lerp(a.split, b.split, t),
    eyes: [lerpEye(a.eyes[0], b.eyes[0], t), lerpEye(a.eyes[1], b.eyes[1], t)],
    eyeAlpha: lerp(a.eyeAlpha, b.eyeAlpha, t),
    bodyAlpha: lerp(a.bodyAlpha, b.bodyAlpha, t),
    dots: [
      ...a.dots.map((d) => ({ ...d, opacity: d.opacity * out })),
      ...b.dots.map((d) => ({ ...d, opacity: d.opacity * t })),
    ],
    arcs: [
      ...a.arcs.map((r) => ({
        ...r,
        id: `a${r.id}`,
        opacity: r.opacity * out,
      })),
      ...b.arcs.map((r) => ({ ...r, id: `b${r.id}`, opacity: r.opacity * t })),
    ],
    // the badge belongs to only one of the two states; it does not mix
    notif: t < 0.5 ? a.notif : b.notif,
    dotsBehind: t < 0.5 ? a.dotsBehind : b.dotsBehind,
  };
}

/**
 * Clock-less engine: `sample(t)` is a pure function of time.
 *
 * Practical consequence: pause, resume, slowdown and jumping to an arbitrary
 * date give exactly the same image, and the render is testable without a DOM.
 */
export class BotEngine {
  /** radius of the ball at rest, in viewBox units */
  readonly scale: number;

  private cur: StateId;
  private prev: StateId | null = null;
  /**
   * Frozen starting pose, set only when a state change arrives while a fade
   * is already in progress. See `setState`.
   */
  private frozenDeparture: Pose | null = null;
  private tCur = 0;
  private tPrev = 0;
  private blinkAt = -10;
  private pts: Point[] = [];
  private shape: number[] | null = null;
  private shapePrev: number[] | null = null;
  private shapeAt = -10;
  private expr: BotExpression | null = null;
  private exprPrev: BotExpression | null = null;
  private exprAt = -10;
  private look: Look = NO_LOOK;
  private lookPrev: Look = NO_LOOK;
  private lookAt = -10;
  /** ongoing catch-up duration; see `LOOK_MORPH`, its default */
  private lookMorph = 0.24;

  /** morph duration when the body's shape changes */
  static readonly SHAPE_MORPH = 0.45;

  /**
   * The gaze's catch-up duration toward its target. Shorter than
   * `SHAPE_MORPH`: a tracking gaze must look attentive, not viscous. Since
   * the target is re-set on every mouse move, this duration is what gives
   * tracking its inertia — the gaze never quite reaches a moving cursor.
   */
  static readonly LOOK_MORPH = 0.24;

  constructor(
    scale = 100,
    initial: StateId = "idle",
    shape: number[] | null = null,
    expression: BotExpression | null = null,
  ) {
    this.scale = scale;
    this.cur = initial;
    this.shape = shape;
    this.expr = expression;
  }

  /**
   * Rest expression chosen in the customiser. Like the shape, it glides to
   * the new value instead of jumping.
   */
  setExpression(expression: BotExpression | null, now = 0) {
    if (expression === this.expr) return;
    this.exprPrev = this.expr;
    this.expr = expression;
    this.exprAt = now;
  }

  /** Effective expression at instant `now`, ongoing morph included. */
  private exprAtTime(now: number): BotExpression | null {
    const to = this.expr;
    const from = this.exprPrev;
    if (!to || !from) return to;
    const k = (now - this.exprAt) / BotEngine.SHAPE_MORPH;
    if (k >= 1) return to;
    return blendExpression(from, to, easings.easeOutQuint(clamp(k)));
  }

  /**
   * Shape chosen in the customiser. It replaces the body only on the at-rest
   * states (`baseBody`): on the others, the silhouette IS the animation and
   * must not be crushed.
   *
   * The change happens as a morph, not at once: since all shapes are sampled
   * at the same angles, it is enough to interpolate the radii.
   */
  setShape(radii: number[] | null, now = 0) {
    if (radii === this.shape) return;
    this.shapePrev = this.shape;
    this.shape = radii;
    this.shapeAt = now;
  }

  /**
   * Effective shape at instant `now`, ongoing morph included.
   *
   * Does NOT reset `shapePrev` to null at the morph's end: `sample` must
   * stay a pure function of time, so re-reading a past date must give back
   * the intermediate image. We just keep one more reference around.
   */
  private shapeAtTime(now: number): number[] | null {
    const to = this.shape;
    const from = this.shapePrev;
    if (!to || !from) return to;
    const k = (now - this.shapeAt) / BotEngine.SHAPE_MORPH;
    if (k >= 1) return to;
    const t = easings.easeOutQuint(clamp(k));
    // allocated only during the morph; outside a morph the array is returned as is
    return to.map((r, i) => lerp(from[i] ?? r, r, t));
  }

  /**
   * New gaze target, `null` to return to the state's own.
   *
   * It starts from the CURRENT value, not from the previous target like
   * `setShape`: this method is called on every pointer move, and starting
   * from the old target would step the gaze backward before each catch-up —
   * tracking would tremble instead of gliding.
   *
   * Same contract as `setShape` otherwise: external state enters through a
   * timestamped setter, never through a variable read during `sample`,
   * otherwise the engine stops being a pure function of time.
   */
  setLook(look: Look | null, now: number, morph = BotEngine.LOOK_MORPH) {
    /*
     * A non-finite target is refused. The engine KEEPS the last one: a `NaN`
     * set once would propagate to every frame and the bot would never settle
     * again. It really happened — a `getBoundingClientRect` on a zero-size
     * box gives `0 / 0` at the call site. That one got fixed, but the engine
     * need not depend on its callers' prudence to stay replayable.
     */
    if (
      look &&
      !Number.isFinite(
        look.yaw + look.pitch + look.mix + look.spin + look.wander,
      )
    ) {
      return;
    }
    this.lookPrev = this.lookAtTime(now);
    this.look = look ?? NO_LOOK;
    this.lookAt = now;
    this.lookMorph = morph;
  }

  /** Effective gaze at instant `now`, ongoing catch-up included. */
  private lookAtTime(now: number): Look {
    const k = (now - this.lookAt) / this.lookMorph;
    if (k >= 1) return this.look;
    return lerpLook(this.lookPrev, this.look, easings.easeOutQuint(clamp(k)));
  }

  private posed(
    def: StateDef,
    t: number,
    shape: number[] | null,
    expr: BotExpression | null,
  ): Pose {
    let pose = def.pose(t);
    if (def.baseBody && shape) {
      // we keep the pose (rotation, offset, squash) and only swap the profile
      pose = { ...pose, sil: { ...pose.sil, radii: shape } };
    }
    if (def.baseFace && expr) {
      pose = { ...pose, gaze: expr.gaze, split: expr.split, eyes: expr.eyes };
    }
    return pose;
  }

  /**
   * Eye offset at instant `now` for a given state, in units of ball radius.
   *
   * It is READ from a table and interpolated, never recomputed: `eyefit.ts`
   * explains why that distinction is the whole fix. All that remains here is
   * interpolating it along the shape's axis, with exactly the silhouette
   * morph's curve and duration — same cause, so it must be the same motion.
   *
   * The table is queried on the morph's BOUNDS (`shapePrev` and `shape`), not
   * on the profile `shapeAtTime` renders: the latter is a fresh array
   * allocated every frame, therefore without identity, and it exists in no
   * table.
   */
  private eyeShiftAtTime(
    now: number,
    state: StateId,
  ): { x: number; y: number } {
    /**
     * One morph axis: the table is read on its two BOUNDS and interpolated
     * along its curve. Never on the interpolated value — that one has no
     * identity, exists in no table, and feeding it to the table is what made
     * previous versions tremble.
     */
    const alongAxis = (
      start: number,
      duration: number,
      a: { x: number; y: number },
      b: { x: number; y: number },
    ) => {
      if (a === b) return b;
      const k = (now - start) / duration;
      if (k >= 1) return b;
      const t = easings.easeOutQuint(clamp(k));
      return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
    };

    // expression axis, for each of the two shapes in play
    const perShape = (radii: number[] | null) =>
      alongAxis(
        this.exprAt,
        BotEngine.SHAPE_MORPH,
        eyeShift(radii, state, this.exprPrev?.id ?? null),
        eyeShift(radii, state, this.expr?.id ?? null),
      );

    // then the shape axis
    return alongAxis(
      this.shapeAt,
      BotEngine.SHAPE_MORPH,
      perShape(this.shapePrev),
      perShape(this.shape),
    );
  }

  get state(): StateId {
    return this.cur;
  }

  /**
   * Restarts on `id` WITHOUT a previous state, like a fresh engine placed on
   * that state.
   *
   * That is what "rewinding" means for this engine. `setState` alone cannot
   * do it: it keeps the exited state to fade from, which is exactly its role
   * in playback, and exactly what must not happen when returning to the
   * start of a sequence. Replaying image 0 after a full pass blended the
   * first state with the LAST, and the GIF export opened on an eyeless ball —
   * the comet has a null `eyeAlpha`.
   *
   * `sample` stays a pure function of time: like `setState`, this is a DATED
   * setter, called by the sequence's driver, never during a sampling.
   */
  reset(id: StateId, now: number) {
    this.cur = id;
    this.prev = null;
    this.frozenDeparture = null;
    this.tCur = now;
    this.tPrev = now;
    this.blinkAt = -10;
  }

  /**
   * Origin of the ongoing fade: the frozen pose if there is one, otherwise
   * the exited state evaluated at its own elapsed time — hence still
   * animating, which is wanted.
   */
  private fadeOrigin(
    now: number,
    shape: number[] | null,
    expr: BotExpression | null,
  ): Pose | null {
    if (this.frozenDeparture) return this.frozenDeparture;
    if (!this.prev) return null;
    const prevDef = STATE_BY_ID.get(this.prev)!;
    return this.posed(prevDef, Math.max(0, now - this.tPrev), shape, expr);
  }

  /**
   * Composite pose at instant `now`, ongoing fade included: exactly what
   * `sample` mixes, before the rest-life and gaze layers. Extracted so that
   * `setState` can freeze it.
   */
  private compositePose(now: number): Pose {
    const def = STATE_BY_ID.get(this.cur)!;
    const shape = this.shapeAtTime(now);
    const expr = this.exprAtTime(now);
    const pose = this.posed(def, Math.max(0, now - this.tCur), shape, expr);
    const since = now - this.tCur;
    if (since >= def.morph) return pose;
    const fadeOrigin = this.fadeOrigin(now, shape, expr);
    if (!fadeOrigin) return pose;
    return blendPose(
      fadeOrigin,
      pose,
      easings.easeOutQuint(clamp(since / def.morph)),
    );
  }

  /**
   * State change, dated.
   *
   * The engine keeps only ONE history slot, so a change arriving during a
   * fade used to replace the blend's origin with the FULL pose of the state
   * being left, instead of the partially blended image that was on screen.
   * Measured on `idle -> wide -> idle` at 100 ms: a 35.9 px jump against
   * 8.0 px of normal movement.
   *
   * We therefore freeze the current composite pose and blend from it.
   * Continuous by construction, whatever the number of chained changes.
   *
   * And ONLY in that case. Freezing on every change would halt the exiting
   * state's animation for the whole fade — `alert`'s "!" would freeze
   * mid-course — whereas outside a morph there is nothing to fix: the exited
   * state is already exactly the displayed image. Playback of a montage,
   * whose blocks last at least the longest fade (`MIN_BLOCK`), therefore
   * freezes nothing and renders bit-for-bit what it rendered before.
   */
  setState(id: StateId, now: number) {
    if (id === this.cur) return;
    const morph = STATE_BY_ID.get(this.cur)!.morph;
    const midFade = this.prev !== null && now - this.tCur < morph;
    this.frozenDeparture = midFade ? this.compositePose(now) : null;
    this.prev = this.cur;
    this.tPrev = this.tCur;
    this.cur = id;
    this.tCur = now;
    // In the video, every shape change is masked by a blink.
    if (STATE_BY_ID.get(id)?.blinkIn) this.blinkAt = now;
  }

  sample(now: number): BotFrame {
    const R = this.scale;
    const def = STATE_BY_ID.get(this.cur)!;
    const shape = this.shapeAtTime(now);
    const expr = this.exprAtTime(now);
    let pose = this.posed(def, Math.max(0, now - this.tCur), shape, expr);
    let shift = this.eyeShiftAtTime(now, this.cur);

    // --- transition -------------------------------------------------------
    const since = now - this.tCur;
    // The previous state is never purged: `since < def.morph` is enough to
    // ignore it once the fade has passed, and forgetting it would make the
    // engine non-replayable — re-reading a date from before the fade's end
    // would no longer find it. That is the innocent-looking optimisation
    // that breaks everything.
    const fadeOrigin =
      since < def.morph ? this.fadeOrigin(now, shape, expr) : null;
    if (fadeOrigin) {
      // Exponential ease-out: it is the curve measured on the video. The
      // body has no overshoot (only the badge and the eye opening do). The
      // ratio is bounded: re-reading a date EARLIER than the state change
      // would give a negative ratio, which the ease-out extrapolates — the
      // silhouette then flies thirty times too far.
      const ratio = easings.easeOutQuint(clamp(since / def.morph));
      pose = blendPose(fadeOrigin, pose, ratio);
      // The eye offset follows the SAME curve as the silhouette that causes
      // it. It comes from the exited state, which `setState` always records
      // at the same time as the origin — the test is there for typing, not
      // for a real case.
      const exited = this.prev;
      if (exited) {
        const prevShift = this.eyeShiftAtTime(now, exited);
        shift = {
          x: lerp(prevShift.x, shift.x, ratio),
          y: lerp(prevShift.y, shift.y, ratio),
        };
      }
    }

    // --- life at rest -----------------------------------------------------
    const alive = pose.eyeAlpha > 0.01;
    const look = this.lookAtTime(now);
    const life = liveliness(now, {
      wander: alive ? look.wander : 0,
      blink: alive,
    });

    const gaze = {
      // The two aims REPLACE the pose's own instead of adding to it (see
      // `Look`), and the full turn is subtracted en route. Drift is added
      // AFTER the mix, otherwise the target would cancel it along with the
      // pose — yet it must survive a turned head without a pointer.
      yaw: lerp(pose.gaze.yaw, look.yaw, look.mix) + life.dYaw - look.spin,
      pitch: lerp(pose.gaze.pitch, look.pitch, look.mix) + life.dPitch,
      // roll tracks nothing: the bot's head is tilted -13deg in the video,
      // and rolling it with the cursor breaks that signature
      roll: pose.gaze.roll + life.dRoll,
    };

    // blink triggered by the state change, on top of the schedule
    const forced = clamp((now - this.blinkAt) / 0.2);
    const forcedLid = forced < 1 ? Math.abs(forced * 2 - 1) : 1;
    const lid = Math.min(life.lid, forcedLid);

    const offX = pose.offX + life.driftX;
    const offY = pose.offY + life.driftY;

    // --- body -------------------------------------------------------------
    const sil: Silhouette = {
      ...pose.sil,
      cx: pose.sil.cx + offX,
      cy: pose.sil.cy + offY,
      sy: pose.sil.sy * life.breath,
    };
    const bodyPath = closedPath(toPoints(sil, R, this.pts));

    // --- eyes -------------------------------------------------------------
    // The eyes live on a sphere of radius 1; as soon as the silhouette is no
    // longer a circle, they are brought in pro rata to the real radius in
    // their direction, otherwise they overflow and the mask crops them.
    const bodyRadius = (x: number, y: number) =>
      radiusAtAngle(pose.sil.radii, Math.atan2(y, x) - pose.sil.rot);

    const eyes: RenderedEye[] = [];
    if (pose.eyeAlpha > 0.01) {
      const poses = eyePoses(gaze, R, pose.split);
      for (let i = 0; i < 2; i++) {
        const e = poses[i]!;
        if (e.depth <= 0.02) continue;
        const cfg = pose.eyes[i]!;
        const fit = bodyRadius(e.x, e.y);
        // The eye's own tilt: the tangent frame is composed with a rotation
        // in the eye's plane (Basis x Rot). That is what allows mirrored
        // tilts between the two eyes.
        const phi = ((cfg.tilt ?? 0) * Math.PI) / 180;
        const cp = Math.cos(phi);
        const sp = Math.sin(phi);
        const ax = e.a * cp + e.c * sp;
        const ay = e.b * cp + e.d * sp;
        const cx2 = -e.a * sp + e.c * cp;
        const cy2 = -e.b * sp + e.d * cp;
        // The blink applies AFTER all that: it is a vertical squash on
        // screen, not along the capsule's axis.
        const k = blinkScale(Math.min(lid, cfg.open));
        eyes.push({
          d: capsulePath(cfg.w * R, cfg.h * R),
          matrix: `matrix(${r2(ax)},${r2(ay * k)},${r2(cx2)},${r2(cy2 * k)},${r2(e.x * fit + (offX + shift.x) * R)},${r2(e.y * fit + (offY + shift.y) * R)})`,
          alpha: pose.eyeAlpha * clamp(e.depth / 0.12),
        });
      }
    }

    // --- decor ------------------------------------------------------------
    const dots = pose.dots
      .filter((p) => p.opacity > 0.01 && p.r > 0.0005)
      .map((p) => ({
        ...p,
        x: (p.x + offX) * R,
        y: (p.y + offY) * R,
        r: p.r * R,
      }));

    // the badge sits on the outline: it follows the shape too
    const nFit = pose.notif ? bodyRadius(pose.notif.x, pose.notif.y) : 1;
    const nx = pose.notif ? (pose.notif.x * nFit + offX) * R : 0;
    const ny = pose.notif ? (pose.notif.y * nFit + offY) * R : 0;
    const notif = pose.notif ? { x: nx, y: ny, r: pose.notif.r * R } : null;
    const notch = pose.notif ? { x: nx, y: ny, r: pose.notif.notch * R } : null;

    return {
      bodyPath,
      bodyAlpha: pose.bodyAlpha,
      eyes,
      dots,
      dotsBehind: pose.dotsBehind,
      // States declare arcs in units of ball radius; the engine is the only
      // one that knows the viewBox scale, so it is the one that draws.
      arcs: pose.arcs
        .filter((a) => a.opacity > 0.01)
        .map((a) => arcRender(a.seed, a.t, R, a.id, a.opacity)),
      notif,
      notch,
    };
  }
}
