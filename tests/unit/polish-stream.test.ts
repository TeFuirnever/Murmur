// [20260907_Feat_235_StreamMerger] TDD for the Spec #193 T8 pure-function
// module: upstream SSE byte/text stream → merged Polish delta chunks.
// Contracts under test (ticket #235):
//   - cross-chunk torn SSE lines are reassembled before parsing
//   - delta content coalesces within the merge window (16ms default,
//     clock injected) and never exceeds the single-chunk char cap (2048)
//   - reasoning deltas (thinking models) are counted but NEVER mixed into
//     the content stream
//   - [DONE] terminates; frames after it are ignored
//   - malformed JSON frames are skipped without killing the stream
import { describe, it, expect, beforeEach } from "vitest";
import {
  createSseMerger,
  SSE_MERGE_WINDOW_MS,
  SSE_MAX_CHUNK_CHARS,
  streamDeadlineViolation,
} from "../../src/helpers/polish-stream";

function frame(delta: Record<string, unknown>): string {
  return `data: ${JSON.stringify({
    id: "chatcmpl-x",
    choices: [{ delta, finish_reason: null }],
  })}\n\n`;
}

describe("[20260907_Feat_235_StreamMerger] SSE → merged deltas", () => {
  let now: number;
  let clock: () => number;

  beforeEach(() => {
    now = 1_000_000;
    clock = () => now;
  });

  interface Harness {
    deltas: string[];
    reasoningChars: number;
    push: (raw: string) => void;
    advance: (ms: number) => void;
    flush: () => void;
    done: boolean;
  }

  function make(): Harness {
    const h: Harness = {
      deltas: [],
      reasoningChars: 0,
      push: () => {},
      advance: (ms: number) => {
        now += ms;
      },
      flush: () => {},
      done: false,
    };
    const merger = createSseMerger({
      now: clock,
      onDelta: (text) => h.deltas.push(text),
      onReasoning: (text) => {
        h.reasoningChars += text.length;
      },
      onDone: () => {
        h.done = true;
      },
    });
    h.push = merger.push;
    h.flush = merger.flush;
    h.done = merger.isDone;
    return h;
  }

  it("emits one merged delta for frames arriving inside the window", () => {
    const h = make();
    h.push(frame({ content: "你" }));
    h.advance(5); // < 16ms window
    h.push(frame({ content: "好" }));
    h.flush();
    expect(h.deltas).toEqual(["你好"]);
  });

  it("splits deltas when the merge window elapses between frames", () => {
    const h = make();
    h.push(frame({ content: "第一" }));
    h.advance(SSE_MERGE_WINDOW_MS + 1);
    h.push(frame({ content: "第二" }));
    h.flush();
    expect(h.deltas).toEqual(["第一", "第二"]);
  });

  it("reassembles a torn SSE line across two pushes", () => {
    const h = make();
    // Generate a known-valid frame, then split it at an arbitrary byte —
    // the merger must reassemble the torn SSE line before parsing.
    const full = frame({ content: "你好" });
    const cut = Math.floor(full.length / 2);
    h.push(full.slice(0, cut));
    h.advance(SSE_MERGE_WINDOW_MS + 1);
    h.push(full.slice(cut));
    h.flush();
    expect(h.deltas).toEqual(["你好"]);
  });

  it("caps a single delta at the 2048-char chunk limit", () => {
    const h = make();
    h.push(frame({ content: "字".repeat(SSE_MAX_CHUNK_CHARS + 500) }));
    h.flush();
    expect(h.deltas.join("")).toHaveLength(SSE_MAX_CHUNK_CHARS + 500);
    for (const d of h.deltas) {
      expect(d.length).toBeLessThanOrEqual(SSE_MAX_CHUNK_CHARS);
    }
  });

  it("never mixes reasoning deltas into the content stream", () => {
    const h = make();
    h.push(frame({ reasoning: "思考过程" }));
    h.advance(SSE_MERGE_WINDOW_MS + 1);
    h.push(frame({ content: "正文" }));
    h.flush();
    expect(h.deltas).toEqual(["正文"]);
    expect(h.reasoningChars).toBe("思考过程".length);
  });

  it("terminates on [DONE] and ignores frames after it", () => {
    const h = make();
    h.push(`data: [DONE]\n\n${frame({ content: "迟到" })}`);
    h.flush();
    expect(h.done).toBe(true);
    expect(h.deltas).toEqual([]);
  });

  it("skips malformed JSON frames without killing the stream", () => {
    const h = make();
    h.push("data: {broken\n\n");
    h.advance(SSE_MERGE_WINDOW_MS + 1);
    h.push(frame({ content: "恢复" }));
    h.flush();
    expect(h.deltas).toEqual(["恢复"]);
  });

  it("ignores non-comment empty lines and CRLF separators", () => {
    const h = make();
    h.push(frame({ content: "行" }).replaceAll("\n", "\r\n"));
    h.flush();
    expect(h.deltas).toEqual(["行"]);
  });
});

// [20260907_Feat_235_TimeoutMatrix] deadline matrix: first-delta vs idle
describe("[20260907_Feat_235_TimeoutMatrix] stream deadline guard", () => {
  const T = { firstDeltaMs: 15_000, idleMs: 30_000 };

  it("flags first_delta when no content within firstDeltaMs", () => {
    expect(
      streamDeadlineViolation("awaiting_first", 0, 0, 15_000, T),
    ).toBeNull();
    expect(streamDeadlineViolation("awaiting_first", 0, 0, 15_001, T)).toBe(
      "first_delta",
    );
  });

  it("flags idle when streaming stalls past idleMs", () => {
    expect(streamDeadlineViolation("streaming", 0, 0, 30_000, T)).toBeNull();
    expect(streamDeadlineViolation("streaming", 0, 0, 30_001, T)).toBe("idle");
  });

  it("never flags a first_delta inside the window", () => {
    expect(
      streamDeadlineViolation("awaiting_first", 0, 0, 14_999, T),
    ).toBeNull();
  });
});
