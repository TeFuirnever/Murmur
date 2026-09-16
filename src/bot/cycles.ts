// [20260904_Refactor_BloubEnginePort] Ported from bloub (github.com/jeremy-prt/bloub, MIT), src/bot/cycles.ts.
// Numeric constants are frame-by-frame measurements of the reference video:
// do not round, simplify or "fix" any of them (see docs/bot/measurements.md).

import { SEQUENCE, STATES, STATE_BY_ID, type StateId } from "./states";

/**
 * A cycle is a montage: a series of blocks, each a state held for a chosen
 * duration. This is the folder's "editor" part, and it keeps its rules — pure
 * data, no clock, no UI import: the same cycle must be readable by the tests,
 * by the player and by the timeline.
 *
 * A block has no identifier: it is a position in a list, the render key is the
 * index. That keeps the stored JSON legible and the tests deterministic.
 */
export interface Block {
  state: StateId;
  duration: number;
}

export interface Cycle {
  id: string;
  name: string;
  blocks: Block[];
}

/**
 * Common floor for all blocks. The engine keeps a single history slot
 * (`BotEngine.setState` overwrites `prev`), so a block shorter than the next
 * block's entry fade cuts to the image instead of blending into it.
 *
 * DERIVED from the catalogue, not written by hand. The value used to be 0.6,
 * which worked only because 0.6 happened to be the catalogue's longest
 * `morph` — `orbit`'s. Nothing guaranteed it: adding a state that morphed in
 * 0.8 s would have made the editor tremble with no test noticing. The floor
 * now follows.
 */
export const MIN_BLOCK = Math.max(...STATES.map((s) => s.morph));

/**
 * An editor guard, not a measurement: lengthening a block is risk-free (the
 * states saturate their ramps and hold their final pose), but a one-minute
 * track of blocks stops being legible.
 */
export const MAX_BLOCK = 10;

/**
 * How many blocks and montages are accepted, at editing time as well as at
 * playback.
 *
 * These are not product limits but bounds against hostile storage, which is
 * editable and holds a few megabytes while nothing downstream is sized for
 * that: a single cycle of 150,000 blocks — about 4 MB of JSON — gave
 * 1,500,000 s of duration, that many graduations to allocate and a track
 * 29,700,000 px wide. The tab froze on entering the Animations view.
 *
 * 200 blocks make half an hour of montage, well beyond any usage.
 */
export const MAX_BLOCKS = 200;
export const MAX_CYCLES = 50;

/** Wheel and resize step, in seconds. */
export const STEP = 0.1;

const DEFAULT_CYCLE_ID = "default";

/** Minimal duration of a block: the engine floor, or the state's measurement. */
export function minDurationOf(state: StateId): number {
  return Math.max(MIN_BLOCK, STATE_BY_ID.get(state)?.minDuration ?? MIN_BLOCK);
}

/** Brings a duration within its bounds and onto the step, no float dust. */
export function clampDuration(state: StateId, seconds: number): number {
  const snapped = Math.round(seconds / STEP) * STEP;
  const bounded = Math.min(MAX_BLOCK, Math.max(minDurationOf(state), snapped));
  return Math.round(bounded * 100) / 100;
}

export function makeBlock(state: StateId): Block {
  // the reference duration is the one measured on the video for that state
  return {
    state,
    duration: clampDuration(state, STATE_BY_ID.get(state)?.duration ?? 2),
  };
}

/**
 * The montage measured on the video: the order of `SEQUENCE`, each state held
 * its measured duration. It serves as the seed on first launch, then belongs
 * to the user — it is edited and stored like any other. The reference stays
 * in the code: clearing the storage brings it back.
 */
export function defaultCycle(): Cycle {
  return {
    /**
     * Empty name = "never named by the user", hence displayed in the current
     * language. Writing "Default cycle" here would have frozen it: the name
     * goes to storage on the first visit and becomes user data, which
     * switching language would no longer re-translate.
     */
    name: "",
    id: DEFAULT_CYCLE_ID,
    blocks: SEQUENCE.map(makeBlock),
  };
}

export function totalDuration(blocks: Block[]): number {
  return blocks.reduce((sum, b) => sum + b.duration, 0);
}

/** Start time of a block within the montage. */
export function offsetOf(blocks: Block[], index: number): number {
  let acc = 0;
  for (let i = 0; i < index && i < blocks.length; i++)
    acc += blocks[i]!.duration;
  return acc;
}

/**
 * Block playing at time `t` and the time already spent inside it. Past the
 * last block we fall back to the start: playback loops. The caller checks
 * that the montage is not empty.
 */
export function blockAt(
  blocks: Block[],
  t: number,
): { index: number; elapsed: number } {
  const total = totalDuration(blocks);
  if (!blocks.length || total <= 0) return { index: 0, elapsed: 0 };
  // the modulo is applied only when it serves: on a time already inside the
  // cycle it would just add float dust to the elapsed time
  const wrapped = t >= 0 && t < total ? t : ((t % total) + total) % total;
  let acc = 0;
  for (let i = 0; i < blocks.length; i++) {
    const end = acc + blocks[i]!.duration;
    if (wrapped < end) return { index: i, elapsed: wrapped - acc };
    acc = end;
  }
  return { index: blocks.length - 1, elapsed: 0 };
}

/**
 * Appends an animation to the end of the montage (right-hand palette or "+"
 * card).
 *
 * Capped at `MAX_BLOCKS`, like playback. Without this the editor let one
 * build a montage larger than what storage returns on reload, and the work
 * silently vanished — a playback bound that is not also an editing bound is
 * a trap, not a protection.
 */
export function blocksWith(blocks: Block[], state: StateId): Block[] {
  if (blocks.length >= MAX_BLOCKS) return blocks;
  return [...blocks, makeBlock(state)];
}

/** Moves a block, returning a new list (never mutating the caller's). */
export function moveBlock(blocks: Block[], from: number, to: number): Block[] {
  const next = blocks.slice();
  const [moved] = next.splice(from, 1);
  if (!moved) return blocks;
  next.splice(Math.min(Math.max(to, 0), next.length), 0, moved);
  return next;
}

/** `My cycle`, `My cycle 2`, `My cycle 3`... — never the same name twice. */
export function uniqueName(base: string, cycles: Cycle[]): string {
  const taken = new Set(cycles.map((c) => c.name));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

/** Collision-free identifier, even against a hand-tampered storage. */
export function nextCycleId(cycles: Cycle[]): string {
  const taken = new Set(cycles.map((c) => c.id));
  let n = 1;
  while (taken.has(`c${n}`)) n++;
  return `c${n}`;
}

/* -------------------------------------------------------- storage re-reading */

function parseBlock(raw: unknown): Block | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { state, duration } = raw as { state?: unknown; duration?: unknown };
  /*
   * Validated against SEQUENCE rather than `STATE_BY_ID`: the latter contains
   * `swirl`, deliberately outside the catalogue — it is the settings-entry
   * transition, which a test locks out of the palette and the board. A user
   * montage is only ever built from the palette, so a `swirl` could only get
   * in through hand-tampered storage, and there is no reason to tolerate it
   * here when it is excluded everywhere else.
   */
  if (typeof state !== "string" || !SEQUENCE.includes(state as StateId))
    return null;
  if (typeof duration !== "number" || !Number.isFinite(duration)) return null;
  return {
    state: state as StateId,
    duration: clampDuration(state as StateId, duration),
  };
}

function parseCycle(raw: unknown, seen: Cycle[]): Cycle | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { id, name, blocks } = raw as {
    id?: unknown;
    name?: unknown;
    blocks?: unknown;
  };
  if (typeof id !== "string" || !id) return null;
  // the name may be empty — it is the seed montage, which follows the language
  if (typeof name !== "string") return null;
  if (!Array.isArray(blocks)) return null;
  // truncate BEFORE reading back: validating 150,000 blocks to keep 200 would
  // be doing the very work we are trying to avoid
  const kept = blocks
    .slice(0, MAX_BLOCKS)
    .map(parseBlock)
    .filter((b): b is Block => b !== null);
  if (!kept.length) return null;
  if (seen.some((c) => c.id === id)) return null;
  return { id, name, blocks: kept };
}

/**
 * Storage is hand-editable: we do not trust it, same rule as the URL hash.
 * Anything that fails to read back is silently dropped rather than breaking
 * the application at startup.
 */
export function parseCycles(raw: string | null): Cycle[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const out: Cycle[] = [];
  for (const item of data.slice(0, MAX_CYCLES)) {
    const cycle = parseCycle(item, out);
    if (cycle) out.push(cycle);
  }
  return out;
}
