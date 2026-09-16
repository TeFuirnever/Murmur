// [20260904_Refactor_BloubEnginePort] Ported from bloub (github.com/jeremy-prt/bloub, MIT), src/bot/cycles.test.ts.
// Numeric constants are frame-by-frame measurements of the reference video:
// do not round, simplify or "fix" any of them (see docs/bot/measurements.md).

import { describe, expect, it } from "vitest";
import {
  MAX_BLOCK,
  MAX_BLOCKS,
  MAX_CYCLES,
  MIN_BLOCK,
  blockAt,
  blocksWith,
  clampDuration,
  defaultCycle,
  makeBlock,
  minDurationOf,
  moveBlock,
  nextCycleId,
  parseCycles,
  totalDuration,
  type Cycle,
  uniqueName,
} from "../../../src/bot/cycles";
import { SEQUENCE, STATES, STATE_BY_ID } from "../../../src/bot/states";

describe("default cycle", () => {
  it("follows the sequence measured on the video, in order", () => {
    expect(defaultCycle().blocks.map((b) => b.state)).toEqual(SEQUENCE);
  });

  it("holds each state for its measured duration", () => {
    for (const block of defaultCycle().blocks) {
      expect(block.duration).toBe(STATE_BY_ID.get(block.state)!.duration);
    }
  });

  it("is rebuilt identically on every call", () => {
    expect(defaultCycle()).toEqual(defaultCycle());
    // ...without sharing objects, otherwise editing one montage would touch the seed
    expect(defaultCycle().blocks[0]).not.toBe(defaultCycle().blocks[0]);
  });

  it("always leaves room for a new cycle, without collision", () => {
    const reference = defaultCycle();
    const one: Cycle = {
      id: nextCycleId([reference]),
      name: uniqueName("My cycle", [reference]),
      blocks: [],
    };
    const two: Cycle = {
      id: nextCycleId([reference, one]),
      name: uniqueName("My cycle", [reference, one]),
      blocks: [],
    };
    expect(one.id).not.toBe(reference.id);
    expect(two.id).not.toBe(one.id);
    expect(two.name).not.toBe(one.name);
  });
});

describe("durations", () => {
  it("never goes below the engine floor", () => {
    // below it, the block is shorter than the next block's entry fade
    expect(clampDuration("idle", 0.1)).toBe(MIN_BLOCK);
    expect(clampDuration("idle", -5)).toBe(MIN_BLOCK);
  });

  it("respects the measurement of states that need to complete", () => {
    // the "!" is back at 2.0, the body rebuilt at 2.4
    expect(minDurationOf("alert")).toBe(2);
    expect(minDurationOf("burst")).toBe(2.4);
    expect(clampDuration("orbit", 1)).toBe(2.5);
    // a time-ignoring state only gets the floor
    expect(minDurationOf("idle")).toBe(MIN_BLOCK);
  });

  it("lets no state go below its own measurement", () => {
    for (const state of SEQUENCE) {
      expect(clampDuration(state, 0)).toBeGreaterThanOrEqual(
        minDurationOf(state),
      );
    }
  });

  it("caps and lands on the step, no float dust", () => {
    expect(clampDuration("idle", 999)).toBe(MAX_BLOCK);
    expect(clampDuration("idle", 2.44)).toBe(2.4);
    expect(clampDuration("idle", 2.46)).toBe(2.5);
  });
});

describe("playback", () => {
  const cycle: Cycle = {
    id: "c1",
    name: "Test",
    blocks: [
      { state: "idle", duration: 2 },
      { state: "wink", duration: 1 },
      { state: "egg", duration: 3 },
    ],
  };

  it("adds the blocks up", () => {
    expect(totalDuration(cycle.blocks)).toBe(6);
  });

  it("finds the playing block and the time spent inside it", () => {
    expect(blockAt(cycle.blocks, 0)).toEqual({ index: 0, elapsed: 0 });
    expect(blockAt(cycle.blocks, 1.9)).toEqual({ index: 0, elapsed: 1.9 });
    // the boundary belongs to the next block
    expect(blockAt(cycle.blocks, 2)).toEqual({ index: 1, elapsed: 0 });
    expect(blockAt(cycle.blocks, 3.5)).toEqual({ index: 2, elapsed: 0.5 });
  });

  it("loops past the last block", () => {
    expect(blockAt(cycle.blocks, 6)).toEqual({ index: 0, elapsed: 0 });
    expect(blockAt(cycle.blocks, 8)).toEqual({ index: 1, elapsed: 0 });
  });

  it("does not break on an empty cycle", () => {
    expect(blockAt([], 3)).toEqual({ index: 0, elapsed: 0 });
    expect(totalDuration([])).toBe(0);
  });

  it("moves a block without touching the original list", () => {
    const blocks = cycle.blocks;
    expect(moveBlock(blocks, 0, 2).map((b) => b.state)).toEqual([
      "wink",
      "egg",
      "idle",
    ]);
    expect(moveBlock(blocks, 2, 0).map((b) => b.state)).toEqual([
      "egg",
      "idle",
      "wink",
    ]);
    expect(blocks.map((b) => b.state)).toEqual(["idle", "wink", "egg"]);
  });
});

describe("storage re-reading", () => {
  it("does not break on empty or invalid JSON", () => {
    expect(parseCycles(null)).toEqual([]);
    expect(parseCycles("")).toEqual([]);
    expect(parseCycles("{not json")).toEqual([]);
    expect(parseCycles('{"id":"c1"}')).toEqual([]);
  });

  it("drops blocks whose state no longer exists", () => {
    const raw =
      '[{"id":"c1","name":"A","blocks":[{"state":"idle","duration":2},' +
      '{"state":"vanished","duration":2}]}]';
    expect(parseCycles(raw)[0]!.blocks.map((b) => b.state)).toEqual(["idle"]);
  });

  it("brings aberrant durations back into their bounds", () => {
    const raw =
      '[{"id":"c1","name":"A","blocks":[{"state":"idle","duration":-4},' +
      '{"state":"egg","duration":9999}]}]';
    expect(parseCycles(raw)[0]!.blocks.map((b) => b.duration)).toEqual([
      MIN_BLOCK,
      MAX_BLOCK,
    ]);
  });

  it("drops an empty, unnamed, or duplicate cycle", () => {
    expect(parseCycles('[{"id":"c1","name":"A","blocks":[]}]')).toEqual([]);
    expect(
      parseCycles('[{"id":"c1","blocks":[{"state":"idle","duration":2}]}]'),
    ).toEqual([]);
    const duplicateFixture =
      '[{"id":"c1","name":"A","blocks":[{"state":"idle","duration":2}]},' +
      '{"id":"c1","name":"B","blocks":[{"state":"egg","duration":2}]}]';
    expect(parseCycles(duplicateFixture).map((c) => c.name)).toEqual(["A"]);
  });

  it("keeps only the model fields, not whatever else is smuggled in", () => {
    const raw =
      '[{"id":"default","name":"My montage","locked":true,"secret":1,' +
      '"blocks":[{"state":"idle","duration":2,"speed":3}]}]';
    const cycle = parseCycles(raw)[0]!;
    expect(Object.keys(cycle).sort()).toEqual(["blocks", "id", "name"]);
    expect(Object.keys(cycle.blocks[0]!).sort()).toEqual(["duration", "state"]);
  });

  /*
   * Storage is editable and holds a few megabytes, while nothing downstream
   * is sized for that. A single cycle of 150,000 blocks — about 4 MB of JSON,
   * so within budget — gave 1,500,000 s of duration, that many graduations to
   * allocate and a track 29,700,000 px wide: the tab froze on entering the
   * Animations view.
   */
  it("bounds the size of a read-back montage", () => {
    const blocks = Array.from({ length: 200_000 }, () => ({
      state: "idle",
      duration: 10,
    }));
    const raw = JSON.stringify([{ id: "c1", name: "A", blocks: blocks }]);
    expect(parseCycles(raw)[0]!.blocks).toHaveLength(MAX_BLOCKS);
  });

  /*
   * The floor is DERIVED from the longest `morph`, no longer written by hand.
   * This test keeps the link visible: it used to be 0.6 hardcoded, which only
   * worked because 0.6 happened to be `orbit`'s morph. A slower-morphing
   * state drags it along.
   */
  it("the block floor covers the catalogue longest fade", () => {
    const longestMorph = Math.max(...STATES.map((s) => s.morph));
    expect(MIN_BLOCK).toBeGreaterThanOrEqual(longestMorph);
    // and it is not gratuitously larger: it is exactly that fade
    expect(MIN_BLOCK).toBe(longestMorph);
  });

  it("bounds editor additions too, not only read-back", () => {
    let blocks = Array.from({ length: MAX_BLOCKS }, () => makeBlock("idle"));
    expect(blocksWith(blocks, "egg")).toHaveLength(MAX_BLOCKS);
    // and adding just below the bound stays possible
    blocks = blocks.slice(0, MAX_BLOCKS - 1);
    expect(blocksWith(blocks, "egg")).toHaveLength(MAX_BLOCKS);
  });

  it("bounds the number of montages read back", () => {
    const raw = JSON.stringify(
      Array.from({ length: 5000 }, (_, i) => ({
        id: `c${i}`,
        name: `A${i}`,
        blocks: [{ state: "idle", duration: 2 }],
      })),
    );
    expect(parseCycles(raw)).toHaveLength(MAX_CYCLES);
  });

  /*
   * `swirl` is the settings entry transition, deliberately outside `SEQUENCE`:
   * a test keeps it out of the palette and the board. A user montage is only
   * built from the palette, so it could only get here through hand-tampered
   * storage — and we refuse it there as everywhere else.
   */
  it("refuses an out-of-catalogue state, `swirl` included", () => {
    const raw =
      '[{"id":"c1","name":"A","blocks":[{"state":"swirl","duration":2},' +
      '{"state":"idle","duration":2}]}]';
    expect(parseCycles(raw)[0]!.blocks.map((b) => b.state)).toEqual(["idle"]);
    // a montage containing ONLY that becomes empty, hence dropped
    expect(
      parseCycles(
        '[{"id":"c1","name":"A","blocks":[{"state":"swirl","duration":2}]}]',
      ),
    ).toEqual([]);
  });
});
