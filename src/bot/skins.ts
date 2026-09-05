// [20260904_Refactor_BloubEnginePort] Ported from bloub (github.com/jeremy-prt/bloub, MIT), src/bot/skins.ts.
// Numeric constants are frame-by-frame measurements of the reference video:
// do not round, simplify or "fix" any of them (see docs/bot/measurements.md).

import { PROFILE_SAMPLES } from "./profiles";
import {
  hullOfCircles,
  profileFromPolygon,
  regularPolygonProfile,
  superellipseProfile,
  unionOfCirclesProfile,
} from "./shape";

/**
 * Shapes and colours offered by the bot customiser.
 *
 * Unlike the animation silhouettes (`profiles.ts`), these are NOT measured off
 * the video: they are built analytically from the original customiser's grid.
 * Two distinct sources, deliberately — the animated states must stay faithful
 * to the video, the base shapes are a user's choice.
 */

/**
 * The ids are enumerated rather than derived from the array, so the compiler
 * checks every new shape id against every place that consumes the union (the
 * catalogue is closed). Upstream additionally leaned on vue-i18n typed keys to
 * force per-locale labels; Murmur's i18n has no such compile-time link, so new
 * ids must update the settings UI's locale keys by hand (see spec #224,
 * ticket 5). An `as const` on the array would make `radii` read-only, whereas
 * the engine passes it around as is.
 */
export type ShapeId =
  | "circle"
  | "pebble"
  | "squircle"
  | "capsule"
  | "triangle"
  | "hexagon"
  | "cloud"
  | "droplet";

export interface BotShape {
  id: ShapeId;
  radii: number[];
}

/** Brings the maximal radius to `max` so all shapes weigh the same to the eye. */
function normalize(radii: number[], max = 1): number[] {
  const peak = Math.max(...radii);
  if (peak <= 0) return radii;
  const k = max / peak;
  return radii.map((r) => r * k);
}

const ANGLES = Array.from(
  { length: PROFILE_SAMPLES },
  (_, i) => (i / PROFILE_SAMPLES) * Math.PI * 2,
);

/** Pebble: a circle deformed by two low harmonics, hence irregular but smooth. */
const pebble = normalize(
  ANGLES.map(
    (a) => 1 + 0.075 * Math.cos(2 * a + 0.5) + 0.035 * Math.cos(3 * a + 2.1),
  ),
  1.02,
);

/** Cloud: union of bumps, wide at the bottom, two lobes on top. */
const cloud = normalize(
  unionOfCirclesProfile([
    { x: -0.44, y: 0.2, r: 0.54 },
    { x: 0.46, y: 0.2, r: 0.5 },
    { x: 0.02, y: 0.3, r: 0.6 },
    { x: -0.24, y: -0.3, r: 0.48 },
    { x: 0.3, y: -0.24, r: 0.44 },
  ]),
  1.02,
);

/** Droplet: large disk at the bottom, tapered point on top. */
const droplet = normalize(
  profileFromPolygon(hullOfCircles(0, 0.28, 0.66, 0, -0.96, 0.05), 0, 0),
  1.04,
);

/** Lying capsule: hull of two disks side by side. */
const capsule = profileFromPolygon(
  hullOfCircles(-0.42, 0, 0.62, 0.42, 0, 0.62),
  0,
  0,
);

export const SHAPES: BotShape[] = [
  { id: "circle", radii: new Array(PROFILE_SAMPLES).fill(1) },
  { id: "pebble", radii: pebble },
  // 1.15 and not 1.02: on a superellipse the maximal radius is the diagonal,
  // so normalizing on it gives a shape that looks smaller than the circle.
  { id: "squircle", radii: normalize(superellipseProfile(4.2), 1.15) },
  { id: "capsule", radii: capsule },
  // -90deg: one vertex toward the top of the screen (y points down)
  { id: "triangle", radii: regularPolygonProfile(3, 1.12, 0.34, -90) },
  // 0deg: vertices left and right, so flat edges top and bottom
  { id: "hexagon", radii: regularPolygonProfile(6, 1.04, 0.26, 0) },
  { id: "cloud", radii: cloud },
  { id: "droplet", radii: droplet },
];

// Map keyed by `string` rather than `ShapeId`: callers query it with a value
// read back from localStorage or a prop, hence unvalidated.
export const SHAPE_BY_ID = new Map<string, BotShape>(
  SHAPES.map((s) => [s.id, s]),
);
export const DEFAULT_SHAPE = "circle";

export type ColorId =
  | "ink"
  | "cream"
  | "brown"
  | "red"
  | "orange"
  | "amber"
  | "green"
  | "turquoise"
  | "blue"
  | "violet"
  | "rose"
  | "gray";

export interface BotColor {
  id: ColorId;
  hex: string;
}

/** Palette of the original customiser. */
export const COLORS: BotColor[] = [
  { id: "ink", hex: "#0a0a0c" },
  { id: "brown", hex: "#8b5e3c" },
  { id: "red", hex: "#e8483f" },
  { id: "orange", hex: "#f08a24" },
  { id: "amber", hex: "#f0b429" },
  { id: "green", hex: "#3ecf8e" },
  { id: "turquoise", hex: "#2fbfa0" },
  { id: "blue", hex: "#3b93f0" },
  { id: "violet", hex: "#8b5cf6" },
  { id: "rose", hex: "#e152b0" },
  { id: "gray", hex: "#a3a3a3" },
  { id: "cream", hex: "#f1efe9" },
];

export const COLOR_BY_ID = new Map<string, BotColor>(
  COLORS.map((c) => [c.id, c]),
);
export const DEFAULT_COLOR = "ink";

/** Mixes two hex colours. Used for the particles' depth haze. */
export function mixHex(from: string, to: string, t: number): string {
  const parse = (h: string) => {
    const v = parseInt(h.slice(1), 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  };
  const a = parse(from);
  const b = parse(to);
  const c = a.map((x, i) => Math.round(x + (b[i]! - x) * t));
  return `#${c.map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}
