// [20260904_Refactor_BloubEnginePort] Ported from bloub (github.com/jeremy-prt/bloub, MIT), src/bot/repere.ts.
// Numeric constants are frame-by-frame measurements of the reference video:
// do not round, simplify or "fix" any of them (see docs/bot/measurements.md).

/**
 * The reference frame of everything the engine renders.
 *
 * `engine.sample()` outputs coordinates in viewBox units, and these two numbers
 * are its definition: without them, an engine output means nothing. They used
 * to live in `BloubBot.vue`, hence out of reach — a `<script setup>` exports
 * nothing — and `export.ts` used to re-declare one by hand, with the comment
 * that named the problem.
 *
 * They live here because `src/bot/` is what gets read and consumed from the
 * outside: the UI component is A client of the engine, not its definition.
 */

/**
 * Radius of the ball at rest, in viewBox units. This is the `scale` the
 * component passes to `BotEngine`.
 *
 * Chosen, not measured: it is the unit of work. Everything else in the folder
 * is expressed in fractions of this radius, which keeps the measurements taken
 * off the video independent of the display size.
 */
export const RADIUS = 100;

/**
 * Half-side of the displayed viewBox. The margin beyond the radius houses the
 * rings.
 *
 * This is not a free value: the orbit rings and the comet swoosh reach 1.4
 * times the radius, i.e. 140. Nothing bounds them at runtime — hand-tuning the
 * `RINGS` and `SWOOSH` tables (`decor.ts`) keeps them under 158, and a test
 * locks that in.
 */
export const HALF_VIEWBOX = 158;
