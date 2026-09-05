// [20260904_Refactor_BloubEnginePort] Ported from bloub (github.com/jeremy-prt/bloub, MIT), src/bot/expressions.ts.
// Numeric constants are frame-by-frame measurements of the reference video:
// do not round, simplify or "fix" any of them (see docs/bot/measurements.md).

import { EYE_H, EYE_SPLIT, EYE_W, REST_GAZE, type HeadGaze } from "./face";
import { lerp } from "./math";
import type { EyeCfg } from "./states";

/**
 * The bot's rest expression.
 *
 * The face is only two capsules, so everything plays on four levers: head
 * orientation, eye spacing, their proportions, and each eye's own tilt. The
 * tilt is what makes anger and sadness reachable: they demand MIRRORED
 * tilts (tops converging or diverging), impossible with head roll alone,
 * which tilts both eyes the same way.
 *
 * Only the rest state carries this expression. The video's expressive states
 * (wink, wide eyes, notification) keep their own: that is precisely what we
 * came here to reproduce.
 *
 * The amplitudes lean on bible-strong-avatar-lab, which exposes the same
 * model (head X/Y/Z, per-eye width and height, spacing, per-eye angle): there,
 * width ranges from 0.8 to 2.7 times the neutral, height from 0.3 to 1.5, and
 * angles up to ±80°. We stay inside that envelope.
 */
/** Enumerated so the i18n layer can verify their translations at compile time. */
export type ExpressionId =
  | "neutral"
  | "attentive"
  | "surprised"
  | "excited"
  | "happy"
  | "gleeful"
  | "angry"
  | "sad"
  | "scared"
  | "wary"
  | "confused"
  | "curious"
  | "proud"
  | "shy"
  | "jaded"
  | "drowsy";

export interface BotExpression {
  id: ExpressionId;
  gaze: HeadGaze;
  split: number;
  eyes: [EyeCfg, EyeCfg];
}

/** `tilt` in degrees, positive = the capsule's top leans right. */
const eye = (w: number, h: number, tilt = 0, open = 1): EyeCfg => ({
  w,
  h,
  tilt,
  open,
});

/** Two identical eyes, mirrored tilts when `tilt` is given. */
const pair = (w: number, h: number, tilt = 0, open = 1): [EyeCfg, EyeCfg] => [
  eye(w, h, tilt, open),
  eye(w, h, -tilt, open),
];

export const EXPRESSIONS: BotExpression[] = [
  {
    // the pose measured frame by frame on the reference video
    id: "neutral",
    gaze: { ...REST_GAZE },
    split: EYE_SPLIT,
    eyes: [eye(EYE_W, EYE_H), eye(EYE_W, EYE_H)],
  },
  {
    id: "attentive",
    gaze: { yaw: 4, pitch: 5, roll: -4 },
    split: 16,
    eyes: pair(0.21, 0.44),
  },
  {
    id: "surprised",
    gaze: { yaw: 3, pitch: -3, roll: 0 },
    split: 19,
    eyes: pair(0.45, 0.47),
  },
  {
    id: "excited",
    gaze: { yaw: 6, pitch: -14, roll: 0 },
    split: 19.5,
    eyes: pair(0.4, 0.56, -10),
  },
  {
    // eyes squinted into arcs: the tops converge slightly
    id: "happy",
    gaze: { yaw: 5, pitch: 9, roll: 0 },
    split: 17,
    eyes: pair(0.27, 0.17, 14),
  },
  {
    id: "gleeful",
    gaze: { yaw: 4, pitch: 14, roll: 0 },
    split: 18,
    eyes: pair(0.34, 0.13, 20),
  },
  {
    // eye tops converging hard toward the center + narrowed eyes
    id: "angry",
    gaze: { yaw: 3, pitch: 7, roll: 0 },
    split: 17,
    eyes: pair(0.34, 0.15, 30),
  },
  {
    // the reverse: tops diverging, and the gaze dropping
    id: "sad",
    gaze: { yaw: 3, pitch: -13, roll: 0 },
    split: 16,
    eyes: pair(0.22, 0.4, -28),
  },
  {
    id: "scared",
    gaze: { yaw: 2, pitch: -20, roll: 0 },
    split: 20.5,
    eyes: pair(0.4, 0.6),
  },
  {
    // one eye decidedly more closed than the other
    id: "wary",
    gaze: { yaw: 12, pitch: 6, roll: -6 },
    split: 16,
    eyes: [eye(0.21, 0.4), eye(0.22, 0.15)],
  },
  {
    // asymmetric on both axes: sizes AND tilts mismatched on purpose.
    // The squinted eye is deliberately flat (ratio 1.6): at a ratio close
    // to 1 it would be round, and its tilt would be invisible.
    id: "confused",
    gaze: { yaw: -14, pitch: 3, roll: 8 },
    split: 16.5,
    eyes: [eye(0.2, 0.44, -18), eye(0.28, 0.17, 14)],
  },
  {
    // the head tilts: roll is what carries the curiosity
    id: "curious",
    gaze: { yaw: 16, pitch: -9, roll: -15 },
    split: 16.5,
    eyes: [eye(0.24, 0.46, -8), eye(0.2, 0.38, -8)],
  },
  {
    id: "proud",
    gaze: { yaw: 5, pitch: 17, roll: 0 },
    split: 17,
    eyes: pair(0.3, 0.15, 18),
  },
  {
    id: "shy",
    gaze: { yaw: -19, pitch: -14, roll: -7 },
    split: 14,
    eyes: pair(0.17, 0.3),
  },
  {
    // horizontal slits and a gaze drifting sideways
    id: "jaded",
    gaze: { yaw: -22, pitch: 2, roll: 0 },
    split: 16,
    eyes: pair(0.3, 0.12),
  },
  {
    // half-closed lids: goes through `open`, i.e. the vertical squash on
    // screen — the same mechanism as the blink
    id: "drowsy",
    gaze: { yaw: 6, pitch: -9, roll: -3 },
    split: 16,
    eyes: pair(0.2, 0.42, 0, 0.42),
  },
];

export const EXPRESSION_BY_ID = new Map<string, BotExpression>(
  EXPRESSIONS.map((e) => [e.id, e]),
);
export const DEFAULT_EXPRESSION = "neutral";

const lerpEyeCfg = (a: EyeCfg, b: EyeCfg, t: number): EyeCfg => ({
  w: lerp(a.w, b.w, t),
  h: lerp(a.h, b.h, t),
  tilt: lerp(a.tilt ?? 0, b.tilt ?? 0, t),
  open: lerp(a.open, b.open, t),
});

/** Interpolation of two expressions: the change glides instead of jumping. */
export function blendExpression(
  a: BotExpression,
  b: BotExpression,
  t: number,
): BotExpression {
  return {
    id: b.id,
    gaze: {
      yaw: lerp(a.gaze.yaw, b.gaze.yaw, t),
      pitch: lerp(a.gaze.pitch, b.gaze.pitch, t),
      roll: lerp(a.gaze.roll, b.gaze.roll, t),
    },
    split: lerp(a.split, b.split, t),
    eyes: [
      lerpEyeCfg(a.eyes[0], b.eyes[0], t),
      lerpEyeCfg(a.eyes[1], b.eyes[1], t),
    ],
  };
}
