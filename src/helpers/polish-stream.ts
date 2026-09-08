// [20260907_Feat_235_StreamMerger] Spec #193 T8 (ticket #235): pure-function
// module converting an upstream OpenAI-compatible SSE text stream into
// merged Polish delta chunks.
//
// Design contract (see tests/unit/polish-stream.test.ts):
//  - torn SSE lines reassemble across push() calls (CRLF tolerated)
//  - delta content coalesces inside a merge window (default 16ms, injected
//    clock) and each emitted delta never exceeds maxChunkChars (2048)
//  - thinking-model `delta.reasoning` is counted via onReasoning and NEVER
//    mixed into onDelta content
//  - `data: [DONE]` terminates the stream; later frames are ignored
//  - malformed JSON frames are skipped; the stream survives
// No clocks, no globals: the caller injects `now` and owns all timeouts.
export const SSE_MERGE_WINDOW_MS = 16;
export const SSE_MAX_CHUNK_CHARS = 2048;

export interface SseMerger {
  /** Feed decoded upstream text (one network chunk or any fragment). */
  push(raw: string): void;
  /** Emit any coalesced content held inside the merge window. */
  flush(): void;
  /** True once `data: [DONE]` has been seen. */
  isDone(): boolean;
  /** Total content chars RECEIVED (including ones still inside the window). */
  contentChars(): number;
}

export interface SseMergerOptions {
  now?: () => number;
  onDelta: (text: string) => void;
  onReasoning?: (text: string) => void;
  onDone?: () => void;
}

interface SseFrame {
  data: string;
}

export function createSseMerger(options: SseMergerOptions): SseMerger {
  const now = options.now ?? (() => 0);
  const windowMs = SSE_MERGE_WINDOW_MS;
  let lineBuf = "";
  let done = false;
  let pending = "";
  let pendingSince = -1;
  let contentReceived = 0;

  const emitDelta = (text: string) => {
    if (!text) return;
    options.onDelta(text);
  };

  const bufferContent = (text: string) => {
    if (!text) return;
    if (pendingSince < 0) pendingSince = now();
    pending += text;
  };

  const drain = (force: boolean) => {
    if (!pending) return;
    const elapsed = now() - pendingSince;
    if (!force && elapsed < windowMs && pending.length < SSE_MAX_CHUNK_CHARS) {
      return;
    }
    // Emit in slices no longer than the single-chunk cap.
    for (let i = 0; i < pending.length; i += SSE_MAX_CHUNK_CHARS) {
      emitDelta(pending.slice(i, i + SSE_MAX_CHUNK_CHARS));
    }
    pending = "";
    pendingSince = now();
  };

  const handleFrame = (data: string) => {
    if (done) return;
    if (data === "[DONE]") {
      done = true;
      options.onDone?.();
      return;
    }
    try {
      const parsed = JSON.parse(data) as {
        choices?: Array<{ delta?: { content?: string; reasoning?: string } }>;
      };
      const delta = parsed.choices?.[0]?.delta;
      if (!delta) return;
      if (typeof delta.reasoning === "string" && delta.reasoning) {
        options.onReasoning?.(delta.reasoning);
      }
      if (typeof delta.content === "string" && delta.content) {
        contentReceived += delta.content.length;
        bufferContent(delta.content);
      }
    } catch {
      // Malformed frame: skip it, keep the stream alive.
    }
  };

  const handleLine = (line: string) => {
    const trimmed = line.replace(/\r$/, "");
    if (!trimmed.startsWith("data:")) return;
    handleFrame(trimmed.slice(5).trim());
  };

  return {
    push(raw: string) {
      if (done) return;
      // [20260907_Feat_235_StreamMerger] Flush the window BEFORE buffering
      // newly arrived content: content that arrives after the window
      // elapsed starts a fresh delta, it never joins the previous one.
      drain(false);
      lineBuf += raw;
      // The last element is a possibly-torn line — keep it buffered.
      const lines = lineBuf.split("\n");
      lineBuf = lines.pop() ?? "";
      for (const line of lines) {
        if (done) break;
        handleLine(line);
      }
      drain(false);
    },
    flush() {
      if (lineBuf) {
        const rest = lineBuf;
        lineBuf = "";
        handleLine(rest);
      }
      drain(true);
    },
    isDone() {
      return done;
    },
    contentChars() {
      return contentReceived;
    },
  };
}

// [20260907_Feat_235_TimeoutMatrix] Ticket #235: the response-body
// consumption deadline matrix. Stages: no content delta within
// firstDeltaMs of the response headers; no delta at all within idleMs of
// the last activity; total duration is enforced by the caller (the
// existing 150s/180s timeout). All values overridable for tests.
export interface StreamTimeouts {
  firstDeltaMs: number;
  idleMs: number;
}

export const DEFAULT_STREAM_TIMEOUTS: StreamTimeouts = {
  firstDeltaMs: 15_000,
  idleMs: 30_000,
};

export const STREAM_MAX_CHUNKS = 100_000;

export type StreamDeadlineViolation = "first_delta" | "idle" | null;

/**
 * Pure deadline check for one iteration of the stream-consumption loop.
 * `receivedDelta` is false until the first content delta arrives; after
 * that the idle deadline takes over. Returns the violated stage or null.
 */
export function streamDeadlineViolation(
  stage: "awaiting_first" | "streaming",
  startedAtMs: number,
  lastActivityAtMs: number,
  nowMs: number,
  timeouts: StreamTimeouts = DEFAULT_STREAM_TIMEOUTS,
): StreamDeadlineViolation {
  if (stage === "awaiting_first") {
    return nowMs - startedAtMs > timeouts.firstDeltaMs ? "first_delta" : null;
  }
  return nowMs - lastActivityAtMs > timeouts.idleMs ? "idle" : null;
}
