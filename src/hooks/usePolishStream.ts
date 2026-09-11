// [20260907_Feat_236_StreamingUi] T9 ①: renderer-side streaming polish
// coordinator (ticket #236). Owns the chunk subscription lifecycle so the
// component stays declarative: subscribe BEFORE the invoke, incremental
// delta state, settle on finish/error/abort, unsubscribe exactly once.
// A user cancel is silent (no error surfaced — the run resolves
// {cancelled:true}).
import * as React from "react";
import type { PolishChunk } from "../types/ipc";

type PolishResult = {
  success?: boolean;
  text?: string;
  error?: string;
  cancelled?: boolean;
};

type StreamingApi = {
  processText: (
    text: string,
    mode: string,
    timeout?: number,
    requestId?: string,
  ) => Promise<unknown>;
  onPolishChunk: (cb: (chunk: PolishChunk) => void) => () => void;
  abortPolish: (requestId: string) => Promise<unknown>;
};

export function usePolishStream() {
  const [streamText, setStreamText] = React.useState<string | null>(null);
  const [streamBytes, setStreamBytes] = React.useState(0);
  // [20260911_Feat_241_LongTextChunking] T14: block progress for chunked
  // polish (第几块/共几块 + 已耗时), driven by the progress chunk triplet.
  const [chunkProgress, setChunkProgress] = React.useState<{
    index: number;
    count: number;
    elapsedMs: number;
  } | null>(null);
  const [isStreaming, setIsStreaming] = React.useState(false);
  const requestIdRef = React.useRef<string | null>(null);
  const abortRef = React.useRef<StreamingApi["abortPolish"] | null>(null);

  const cancel = React.useCallback(() => {
    const id = requestIdRef.current;
    if (id && abortRef.current) {
      abortRef.current(id).catch((error) => {
        // [20260907_Fix_236_Review] An abort IPC failure must not surface
        // as an unhandled rejection — the run still settles via the
        // orchestrator's deadline matrix.
        console.warn("abortPolish failed:", error);
      });
    }
  }, []);

  // Runs one streaming polish to completion. The listener is registered
  // before the invoke and removed on the FIRST terminal chunk (or the
  // invoke's own settlement for the degraded JSON path).
  const start = React.useCallback(
    async (
      api: StreamingApi,
      text: string,
      mode: string,
    ): Promise<PolishResult> => {
      // [20260907_Fix_236_Review] Guard against overlapping runs — checked
      // BEFORE the ref is claimed: one coordinator, one live stream (the UI
      // disables apply during a run; this makes it explicit at the boundary).
      if (requestIdRef.current !== null) {
        return { success: false, error: "STREAM_IN_FLIGHT" };
      }
      // [20260907_Fix_236_Review] jsdom lacks crypto.randomUUID — fall back
      // to a time-based id (uniqueness within one window is sufficient).
      const requestId =
        typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `polish-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      requestIdRef.current = requestId;
      abortRef.current = api.abortPolish;
      setIsStreaming(true);
      setStreamText("");
      setStreamBytes(0);
      setChunkProgress(null);

      return await new Promise<PolishResult>((resolve) => {
        let settled = false;
        let streamedSoFar = "";
        const settle = (result: PolishResult) => {
          if (settled) return;
          settled = true;
          unsubscribe();
          requestIdRef.current = null;
          abortRef.current = null;
          setIsStreaming(false);
          // [20260907_Fix_236_Review] Clear the stream on EVERY terminal
          // outcome: a mid-stream error must not leave the truncated
          // partial rendered as the user's transcription. Success hands
          // over to optimizedText; cancel/error restore the original.
          setStreamText(null);
          // [20260911_Feat_241_LongTextChunking] Clear block progress on
          // EVERY terminal outcome alongside the stream text.
          setChunkProgress(null);
          resolve(result);
        };
        const unsubscribe = api.onPolishChunk((chunk) => {
          if (chunk.requestId !== requestId) return;
          if (chunk.type === "delta" && chunk.text) {
            streamedSoFar += chunk.text;
            setStreamText(streamedSoFar);
          } else if (chunk.type === "degraded") {
            // [20260907_Fix_236_Review] Intentionally ignored here: the
            // degraded run settles via the invoke's own JSON result (no
            // finish chunk ever arrives); the static optimizing indicator
            // keeps showing until then.
          } else if (chunk.type === "progress") {
            // [20260907_Feat_236_StreamingUi] T9 ③: block progress (bytes)
            // for consumers without per-word rendering (file import).
            setStreamBytes(
              (prev) => prev + ((chunk as { bytes?: number }).bytes ?? 0),
            );
            // [20260911_Feat_241_LongTextChunking] T14: the block triplet is
            // the chunked-polish dimension; byte-only progress chunks leave
            // it untouched.
            if (chunk.chunkIndex !== undefined) {
              setChunkProgress({
                index: chunk.chunkIndex,
                count: chunk.chunkCount ?? 0,
                elapsedMs: chunk.elapsedMs ?? 0,
              });
            }
          } else if (chunk.type === "finish") {
            settle({ success: true, text: chunk.text });
          } else if (chunk.type === "error") {
            settle({ success: false, error: chunk.error });
          } else if (chunk.type === "abort") {
            settle({ success: false, cancelled: true });
          }
        });
        api
          .processText(text, mode, undefined, requestId)
          .then((invokeResult) => {
            settle(invokeResult as PolishResult);
          })
          .catch((error) => {
            // [20260907_Fix_236_Review] Log the IPC-level cause, settle with
            // a machine sentinel — the component maps it to an i18n message.
            console.warn("streaming polish invoke failed:", error);
            settle({ success: false, error: "STREAM_INVOKE_FAILED" });
          });
      });
    },
    [],
  );

  // [20260907_Fix_236_Review] Unmount teardown: release the chunk listener
  // and abort the orphaned run instead of letting it burn tokens until the
  // deadline matrix kills it.
  React.useEffect(() => {
    return () => {
      const id = requestIdRef.current;
      requestIdRef.current = null;
      abortRef.current = null;
      if (id && window.electronAPI?.abortPolish) {
        window.electronAPI.abortPolish(id).catch(() => {
          // window torn down — nothing to abort
        });
      }
    };
  }, []);

  return { streamText, streamBytes, chunkProgress, isStreaming, start, cancel };
}
