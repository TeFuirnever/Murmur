// [20260904_Refactor_BloubEnginePort] Ported from bloub (github.com/jeremy-prt/bloub, MIT), src/bot/states.ts.
// Numeric constants are frame-by-frame measurements of the reference video:
// do not round, simplify or "fix" any of them (see docs/bot/measurements.md).

import {
  COMET_DOT,
  COMET_RIBBONS,
  DOT_PEAK,
  DOT_R,
  DOT_X,
  NOTIF_ANGLE,
  NOTIF_DIST,
  NOTIF_MARGIN,
  NOTIF_POP,
  NOTIF_R,
  RINGS,
  SWOOSH,
  particles,
  type ArcSpec,
  type DotRender,
} from "./decor";
import { EYE_H, EYE_SPLIT, EYE_W, REST_GAZE, type HeadGaze } from "./face";
import { TAU, clamp, easings } from "./math";
import {
  circle,
  hullOfCircles,
  polyPath,
  profileFromPolygon,
  silhouette,
  type Silhouette,
} from "./shape";

export interface EyeCfg {
  /** local width (short axis of the capsule), in units of ball radius */
  w: number;
  /** local height (long axis) */
  h: number;
  /** 1 = open, 0 = closed */
  open: number;
  /**
   * The capsule's own tilt, in degrees, positive = the top leans right.
   * Applied AFTER the sphere's tangent frame. Without it, both eyes always
   * lean the same way (head roll) and anger and sadness, which need mirrored
   * tilts, stay out of reach.
   */
  tilt?: number;
}

export interface Pose {
  /** silhouette of the body, in units of ball radius */
  sil: Silhouette;
  /** global offset of the body AND the eyes */
  offX: number;
  offY: number;
  gaze: HeadGaze;
  /** half-spacing of the eyes on the sphere, in degrees */
  split: number;
  /** [inner eye, outer eye] */
  eyes: [EyeCfg, EyeCfg];
  /** opacity of the eyes: serves the faceless states */
  eyeAlpha: number;
  bodyAlpha: number;
  dots: DotRender[];
  arcs: ArcSpec[];
  notif: { x: number; y: number; r: number; notch: number } | null;
  /** true = the decor passes behind the body (burst particles) */
  dotsBehind: boolean;
}

const pair = (w: number, h: number): [EyeCfg, EyeCfg] => [
  { w, h, open: 1 },
  { w, h, open: 1 },
];

function base(over: Partial<Pose> = {}): Pose {
  return {
    sil: circle(1),
    offX: 0,
    offY: 0,
    gaze: { ...REST_GAZE },
    split: EYE_SPLIT,
    eyes: pair(EYE_W, EYE_H),
    eyeAlpha: 1,
    bodyAlpha: 1,
    dots: [],
    arcs: [],
    notif: null,
    dotsBehind: false,
    ...over,
  };
}

/* ------------------------------------------------------ non-radial shapes */

/**
 * Bar of the upright "!": convex hull of two circles.
 * Measured: top circle (0, -0.505) r 0.132, bottom circle (0, +0.130) r 0.075,
 * rectilinear flanks. It is therefore a truncated cone (top/bottom ratio 1.76).
 */
const BAR_UPRIGHT_CY = -0.1875;
const BAR_UPRIGHT = profileFromPolygon(
  hullOfCircles(0, -0.505, 0.132, 0, 0.13, 0.075),
  0,
  BAR_UPRIGHT_CY,
);

/** Bar of the tilted "!": pure capsule (constant width 0.269, length 0.776). */
const BAR_ITALIC = profileFromPolygon(
  hullOfCircles(0, -0.2535, 0.1345, 0, 0.2535, 0.1345),
  0,
  0,
);

const barUpright = (pose: Partial<Silhouette> = {}): Silhouette => ({
  radii: [...BAR_UPRIGHT],
  rot: 0,
  cx: 0,
  cy: BAR_UPRIGHT_CY,
  sx: 1,
  sy: 1,
  ...pose,
});

const barItalic = (pose: Partial<Silhouette> = {}): Silhouette => ({
  radii: [...BAR_ITALIC],
  rot: 0,
  cx: 0,
  cy: 0,
  sx: 1,
  sy: 1,
  ...pose,
});

/**
 * The dot of the tilted "!" is not a disk: it is a teardrop, round end
 * (r 0.118) on the bar's side and a tapered point opposite, length 0.300 in
 * the glyph's axis. Centered on the round end's barycentre.
 */
const TEAR = polyPath(hullOfCircles(0, 0, 0.118, 0, 0.172, 0.012));

/**
 * The triangle does not spin on itself: its center describes a circle of
 * radius 0.213 around the origin (measured). That offset is what gives the
 * impression it topples instead of pivoting in place.
 */
const TRI_ORBIT = 0.213;

function spinningTriangle(rot: number): Silhouette {
  return silhouette("triangle", {
    rot,
    cx: -TRI_ORBIT * Math.sin(rot),
    cy: TRI_ORBIT * Math.cos(rot),
  });
}

/* ------------------------------------------------------------------ states */

export type StateId =
  | "idle"
  | "thinking"
  | "wink"
  | "wide"
  | "alert"
  | "notify"
  | "exclaim"
  | "sleep"
  | "egg"
  | "hexagon"
  | "play"
  | "orbit"
  | "burst"
  | "comet"
  /** UI transition, not a catalogue animation: outside `SEQUENCE` */
  | "swirl";

export interface StateDef {
  id: StateId;
  /** hold duration when the full sequence is played */
  duration: number;
  /**
   * Duration below which the animation is cut before completing: the "!" does
   * not come back, the body stays burst. It is read off the constants of the
   * `pose` below; it is not chosen. Absent = the state ignores time or loops,
   * any duration suits it (see `MIN_BLOCK`).
   */
  minDuration?: number;
  /** duration of the entry morph */
  morph: number;
  /** true = the entry is masked by a blink, as in the video */
  blinkIn: boolean;
  /**
   * true = the body is the "at rest" silhouette, hence replaceable by the
   * shape chosen in the customiser. States that draw their own shape (the "!",
   * the dots, the egg, the triangle...) are false: that shape IS the
   * animation.
   */
  baseBody: boolean;
  /**
   * true = the state carries the "at rest" face, hence replaceable by the
   * chosen expression. Only `idle`: the other face states have an expression
   * measured off the video — that is precisely what we reproduce.
   */
  baseFace: boolean;
  pose(local: number): Pose;
}

/** Pulse wave travelling across the three dots, left to right. */
function dotPulse(t: number, index: number): number {
  const p = ((((t - index * 0.5) / 1.5) % 1) + 1) % 1;
  const k = p < 0.5 ? 0.5 - 0.5 * Math.cos(p * TAU) : 0;
  return clamp(k * 2);
}

export const STATES: StateDef[] = [
  {
    id: "idle",
    duration: 2.4,
    morph: 0.45,
    blinkIn: false,
    baseFace: true,
    baseBody: true,
    pose: () => base(),
  },

  {
    id: "thinking",
    duration: 2.6,
    morph: 0.4,
    baseFace: false,
    baseBody: false,
    blinkIn: true,
    pose: (t) => {
      const mid = dotPulse(t, 1);
      // The side dots emerge from the ball's flanks: in the video they stay
      // merged with it 1-2 frames before detaching.
      const emerge = 0.3 + 0.7 * easings.easeOutCubic(clamp(t / 0.3));
      return base({
        // the ball BECOMES the middle dot: the morph stays continuous
        sil: circle(DOT_R * (1 + (DOT_PEAK - 1) * mid), { cx: DOT_X[1]! }),
        eyeAlpha: 0,
        dots: [0, 2].map((i) => {
          const k = dotPulse(t, i);
          return {
            x: DOT_X[i]! * emerge,
            y: 0,
            r: DOT_R * (1 + (DOT_PEAK - 1) * k),
            opacity: 0.55 + 0.45 * k,
          };
        }),
      });
    },
  },

  {
    id: "wink",
    duration: 1.6,
    morph: 0.3,
    blinkIn: true,
    baseFace: false,
    baseBody: true,
    pose: () =>
      base({
        gaze: { yaw: -5.37, pitch: 4.55, roll: 6.7 },
        split: 16.25,
        // The closed eye is not the open eye squashed: it is a horizontal dash
        // WIDER than the open eye (0.447 against 0.236).
        eyes: [
          { w: 0.236, h: 0.464, open: 1 },
          { w: 0.447, h: 0.089, open: 1 },
        ],
      }),
  },

  {
    id: "wide",
    duration: 1.8,
    morph: 0.55,
    blinkIn: true,
    baseFace: false,
    baseBody: true,
    pose: () =>
      base({
        gaze: { yaw: 6.92, pitch: -21.96, roll: 11.6 },
        split: 18.43,
        eyes: pair(0.356, 0.875),
      }),
  },

  {
    id: "alert",
    duration: 2.4,
    // the "!" is back in place at 1.6 + 0.4
    minDuration: 2,
    morph: 0.45,
    baseFace: false,
    baseBody: false,
    blinkIn: false,
    pose: (t) => {
      // Measured travel: -0.087 -> +0.732 in 1.5 s, ease-in-out, micro-overshoot.
      const p = clamp(t / 1.5);
      const travel = easings.easeInOutCubic(p) * 0.82 - 0.087;
      const back = t > 1.6 ? clamp((t - 1.6) / 0.4) : 0;
      const x = travel * (1 - back) + 0.1 * back;
      // Secondary vibration at 2.5 Hz, bar and dot in opposite phase.
      const buzz = Math.sin(t * 2.5 * TAU) * 0.005;
      const tilt = (17.7 * Math.PI) / 180;
      return base({
        sil: barItalic({ rot: tilt, cx: x, cy: -0.325 - buzz }),
        eyeAlpha: 0,
        dots: [
          {
            // the dot follows the glyph's axis, at 0.580 from the bar's center
            x: x - Math.sin(tilt) * 0.58,
            y: -0.325 + Math.cos(tilt) * 0.58 + buzz * 2.8,
            r: 0.118,
            d: TEAR,
            rot: (tilt * 180) / Math.PI,
            opacity: 1,
          },
        ],
      });
    },
  },

  {
    id: "notify",
    duration: 2.2,
    morph: 0.5,
    blinkIn: true,
    baseFace: false,
    baseBody: true,
    pose: (t) => {
      // Blue dot pop: peak at +14 % around 0.3 s then stabilisation.
      const p = clamp(t / 0.45);
      const pop = 1 + (NOTIF_POP - 1) * Math.sin(p * Math.PI) * (1 - p * 0.35);
      const r = NOTIF_R * (p < 1 ? pop : 1);
      const a = (NOTIF_ANGLE * Math.PI) / 180;
      return base({
        // the gaze goes opposite the badge
        gaze: { yaw: -21.94, pitch: -5.82, roll: -12.2 },
        split: 18.89,
        eyes: pair(0.505, 0.498),
        notif: {
          x: Math.cos(a) * NOTIF_DIST,
          y: Math.sin(a) * NOTIF_DIST,
          r,
          notch: r + NOTIF_MARGIN,
        },
      });
    },
  },

  {
    id: "exclaim",
    duration: 2,
    morph: 0.45,
    baseFace: false,
    baseBody: false,
    blinkIn: false,
    pose: () =>
      base({
        sil: barUpright(),
        eyeAlpha: 0,
        dots: [{ x: -0.012, y: 0.526, r: 0.113, opacity: 1 }],
      }),
  },

  {
    id: "sleep",
    duration: 2.4,
    morph: 0.5,
    baseFace: false,
    baseBody: false,
    blinkIn: false,
    pose: (t) =>
      base({
        // Measured vertical bounce: +-0.19 around +0.11, period 0.6 s.
        sil: circle(0.1585, { cy: 0.11 + Math.sin(t * (TAU / 0.6)) * 0.19 }),
        eyeAlpha: 0,
      }),
  },

  {
    id: "egg",
    duration: 1.8,
    morph: 0.4,
    baseFace: false,
    baseBody: false,
    blinkIn: true,
    pose: () =>
      base({
        sil: silhouette("egg"),
        gaze: { yaw: 19.97, pitch: 26.01, roll: -17.1 },
        // the eyes narrow as the body does
        split: 11.07,
        eyes: pair(0.164, 0.385),
      }),
  },

  {
    id: "hexagon",
    duration: 1.6,
    morph: 0.4,
    baseFace: false,
    baseBody: false,
    blinkIn: true,
    pose: () =>
      base({
        sil: silhouette("hexagon"),
        gaze: { yaw: 23.11, pitch: 24.42, roll: -13.3 },
        split: 13.37,
        eyes: pair(0.177, 0.411),
      }),
  },

  {
    id: "play",
    duration: 2,
    morph: 0.5,
    baseFace: false,
    baseBody: false,
    blinkIn: true,
    pose: (t) => {
      // The triangle stays almost still while the bouquet sweeps across it.
      const fade = clamp(t / 0.35) * clamp((2.2 - t) / 0.5);
      return base({
        sil: spinningTriangle(0),
        gaze: { yaw: 12, pitch: -8, roll: -6 },
        split: 15,
        eyes: pair(0.18, 0.34),
        // the bouquet sweeps right to left over the triangle
        arcs: SWOOSH.map((s, i) => ({
          id: `sw${i}`,
          seed: { ...s, cx: 0.45 - t * 0.42 },
          t,
          opacity: fade,
        })),
      });
    },
  },

  {
    id: "orbit",
    duration: 3.4,
    // the body is done relaxing from triangle to ball at 1.6 + 0.9
    minDuration: 2.5,
    morph: 0.6,
    baseFace: false,
    baseBody: false,
    blinkIn: false,
    pose: (t) => {
      // Measured rotation: ramp over 0.35 s then 1.25 turn/s (counterclockwise).
      const ramp = easings.easeInOutCubic(clamp(t / 0.35));
      const rot = -TAU * 1.25 * t * ramp;
      // The body relaxes from triangle to ball during the orbit.
      const back = easings.easeInOutCubic(clamp((t - 1.6) / 0.9));
      const tri = spinningTriangle(rot);
      const ball = circle(1, { rot });
      const sil: Silhouette = {
        radii: tri.radii.map((r, i) => r + (ball.radii[i]! - r) * back),
        rot,
        cx: tri.cx * (1 - back),
        cy: tri.cy * (1 - back),
        sx: 1,
        sy: 1,
      };
      const fade = clamp(t / 0.8) * clamp((3.6 - t) / 0.9);
      return base({
        sil,
        // the eyes race around the sphere ~3x faster than the silhouette
        gaze: {
          yaw: REST_GAZE.yaw + Math.sin(t * 6.5) * 65 * (1 - back),
          pitch: -4 + back * 32,
          roll: -13,
        },
        eyes: pair(0.18, 0.34 + back * 0.07),
        // the rings enter one by one over 0.8 s
        arcs: RINGS.map((s, i) => ({
          id: `rg${i}`,
          seed: s,
          t,
          opacity: fade * clamp((t - i * 0.13) / 0.3),
        })),
      });
    },
  },

  {
    /**
     * Entry into the settings view.
     *
     * ONLY state not measured off the video: it is CHOSEN, like the `--ink`
     * colour. It borrows `orbit`'s vocabulary — the same rings, with their
     * measured parameters — but cuts it short: 1 s instead of 3.4, half the
     * rings, and no triangle.
     *
     * The two `true` flags are the whole point of this state:
     *
     * - `baseBody` lets the chosen shape replace the body, so a view can
     *   impose the circle and the pebble or droplet MORPH into it instead of
     *   jumping;
     * - `baseFace` carries the rest face, so cursor tracking applies from
     *   this entry onward. A state with its own gaze pose (like `orbit`)
     *   would hand over to the next state mid-course, and the eyes would jump
     *   at once on resume.
     *
     * It is deliberately NOT in `SEQUENCE`: it is not a catalogue animation,
     * it is a UI transition.
     */
    id: "swirl",
    // a little more than the gaze's turn (`TURN_TIME`, 1.1 s): the eyes must
    // be settled left before the rings fade out
    duration: 1.3,
    minDuration: 1.3,
    morph: 0.3,
    baseFace: true,
    baseBody: true,
    // the shape morph is masked by a blink, as everywhere else
    blinkIn: true,
    pose: (t) =>
      base({
        // three rings out of `orbit`'s six: half the bouquet is enough to
        // recognise it, and that many fewer arcs to rasterise per frame
        arcs: RINGS.slice(0, 3).map((s, i) => ({
          id: `sw${i}`,
          seed: s,
          t,
          // they enter one after another then fade before the block ends, so
          // the resume at rest happens on an already-clean image
          opacity: clamp((t - i * 0.06) / 0.14) * clamp((1.22 - t) / 0.34),
        })),
      }),
  },

  {
    id: "burst",
    duration: 2.6,
    // the body is rebuilt at 1.7 + 0.7
    minDuration: 2.4,
    morph: 0.4,
    baseFace: false,
    baseBody: false,
    blinkIn: false,
    pose: (t) => {
      // Measured collapse: 1.0 -> 0.166 in 0.7 s, ease-out, no bounce.
      const collapse = 1 - 0.834 * easings.easeOutQuint(clamp(t / 0.7));
      const regrow = easings.easeOutQuint(clamp((t - 1.7) / 0.7));
      return base({
        sil: circle(collapse + (1 - collapse) * regrow),
        eyeAlpha: clamp((t - 1.85) / 0.4),
        dots: particles(t, 1),
        dotsBehind: true,
      });
    },
  },

  {
    id: "comet",
    duration: 2.4,
    // the dot rebuilds at 1.85 + 0.6 = 2.45, i.e. 0.05 s after the video's
    // cut: this leftover finishes during the next fade, as in the reference.
    // We therefore never go below the measured duration.
    minDuration: 2.4,
    morph: 0.45,
    baseFace: false,
    baseBody: false,
    blinkIn: false,
    pose: (t) => {
      const collapse =
        1 - (1 - COMET_DOT) * easings.easeOutQuint(clamp(t / 0.55));
      const regrow = easings.easeOutQuint(clamp((t - 1.85) / 0.6));
      const fade = clamp((t - 0.15) / 0.25) * clamp((1.95 - t) / 0.3);
      return base({
        // The dot drifts 0.035 down then comes back up (measured wobble).
        sil: circle(collapse + (1 - collapse) * regrow, {
          cy: Math.sin(clamp(t / 1.7) * Math.PI) * 0.035,
        }),
        eyeAlpha: clamp((t - 2) / 0.35),
        arcs: COMET_RIBBONS.map((s, i) => ({
          id: `cm${i}`,
          seed: s,
          t,
          opacity: fade,
        })),
      });
    },
  },
];

export const STATE_BY_ID = new Map(STATES.map((s) => [s.id, s]));

/** Reading order of the full sequence, traced from the reference video. */
/**
 * Local time at which each state is most legible: the pose shown by the
 * thumbnails and the state board. Deterministic render, hence comparable from
 * one run to the next. The type forces coverage of any new state.
 */
export const POSES: Record<StateId, number> = {
  idle: 1,
  thinking: 1.1,
  wink: 0.8,
  wide: 0.8,
  alert: 0.75,
  notify: 0.9,
  exclaim: 0.8,
  sleep: 0.45,
  egg: 0.8,
  hexagon: 0.8,
  play: 0.9,
  orbit: 1.2,
  swirl: 0.5,
  burst: 0.45,
  comet: 1.15,
};

export const SEQUENCE: StateId[] = [
  "idle",
  "thinking",
  "wink",
  "wide",
  "alert",
  "notify",
  "exclaim",
  "sleep",
  "egg",
  "hexagon",
  "play",
  "orbit",
  "burst",
  "comet",
];
