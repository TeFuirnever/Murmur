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
  const [isStreaming, setIsStreaming] = React.useState(false);
  const requestIdRef = React.useRef<string | null>(null);
  const abortRef = React.useRef<StreamingApi["abortPolish"] | null>(null);

  const cancel = React.useCallback(() => {
    const id = requestIdRef.current;
    if (id && abortRef.current) {
      void abortRef.current(id);
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
      const requestId = crypto.randomUUID();
      requestIdRef.current = requestId;
      abortRef.current = api.abortPolish;
      setIsStreaming(true);
      setStreamText("");

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
          if (result.success && result.text) setStreamText(null);
          if (result.cancelled) setStreamText(null);
          resolve(result);
        };
        const unsubscribe = api.onPolishChunk((chunk) => {
          if (chunk.requestId !== requestId) return;
          if (chunk.type === "delta" && chunk.text) {
            streamedSoFar += chunk.text;
            setStreamText(streamedSoFar);
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
          .catch(() => settle({ success: false, error: "AI处理失败，请重试" }));
      });
    },
    [],
  );

  return { streamText, isStreaming, start, cancel };
}
