// [20260729_Feat_EffectsLayer] Unified entry point for react-bits visual effects.
// Purpose: gate ALL effect rendering behind a single component so the main
// dictation panel never pays for effects, and so effects can be toggled at
// runtime via the `effects_enabled` setting.
//
// Design decisions (informed by adversarial review of v1 plan):
// 1. default off — effects_enabled defaults to false to protect low-end machines
// 2. lazy import — Aurora/BlurText chunks only load when effects are ON, so
//    users who keep effects off never download ogl/motion (verified by CI)
// 3. WebGL detection — SwiftShader/llvmpipe machines get rejected explicitly
// 4. prefers-reduced-motion — macOS "reduce motion" users see no animation
// 5. GL context-loss defense — defensive listener in addition to Aurora's cleanup
//
// The Aurora colorStops use Murmur's brand palette (#0071e3 blue → #5856d6 indigo
// → #af52de purple) to keep the effects visually consistent with the fox mascot
// rebrand (lavender background + warm fox).

import { lazy, Suspense, useEffect, useState } from "react";
import { detectWebGL } from "./detectWebGL";

// Lazy import: Vite emits Aurora + its ogl dependency as a separate chunk.
// Users with effects off never fetch this chunk.
const Aurora = lazy(() => import("./Aurora"));

// Murmur brand palette for Aurora. Matches the fox-rebrand lavender/purple system.
// 4 stops with the first repeated at the end so the gradient loops seamlessly
// (Aurora's shader interpolates between stops; a missing wrap-around creates a
// visible seam at the loop boundary). Exported for test verification.
export const AURORA_COLOR_STOPS = ["#0071e3", "#5856d6", "#af52de", "#0071e3"];

export interface EffectsLayerProps {
  enabled: boolean;
}

export function EffectsLayer({ enabled }: EffectsLayerProps) {
  const [webglOk, setWebglOk] = useState<boolean | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);

  // Detect WebGL capability only when effects are enabled. When disabled, this
  // effect returns early — no GPU probe runs, zero overhead.
  useEffect(() => {
    if (!enabled) {
      setWebglOk(null);
      return;
    }
    setWebglOk(detectWebGL().supported);

    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [enabled]);

  // Defensive WebGL context-loss listener. Aurora's own cleanup calls
  // loseContext() on unmount, but Electron can destroy the renderer process
  // before React flushes. This listener logs context-loss events for diagnosis.
  useEffect(() => {
    if (!enabled || !webglOk || reducedMotion) return;
    const handler = () =>
      console.warn(
        "[EffectsLayer] WebGL context lost — Aurora may need remount",
      );
    window.addEventListener("webglcontextlost", handler);
    return () => window.removeEventListener("webglcontextlost", handler);
  }, [enabled, webglOk, reducedMotion]);

  // Render nothing when disabled, when WebGL is unavailable, or when the user
  // has reduced-motion enabled. This is the single gate that isolates all cost.
  if (!enabled || !webglOk || reducedMotion) return null;

  return (
    <div className="fixed inset-0 -z-10 pointer-events-none">
      <Suspense fallback={null}>
        <Aurora colorStops={AURORA_COLOR_STOPS} />
      </Suspense>
    </div>
  );
}
