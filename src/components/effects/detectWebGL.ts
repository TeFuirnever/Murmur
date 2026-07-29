// [20260729_Feat_EffectsWebGLDetect] WebGL availability detection.
// Purpose: reject software renderers (SwiftShader/llvmpipe) that would burn CPU
// when rendering the Aurora shader. Chromium silently falls back to software
// rendering on GPU-blocklisted machines; a naive getContext('webgl') check
// returns non-null on those machines, giving false confidence. This util queries
// UNMASKED_RENDERER_WEBGL and rejects known software-renderer strings.
// Used by EffectsLayer to decide whether to mount Aurora at all.

export interface WebGLDetectResult {
  supported: boolean;
  reason?: string;
}

// Renderer substrings that indicate software/CPU-based rendering.
// All lowercased — the comparison is case-insensitive.
const SOFTWARE_RENDERER_PATTERNS = [
  "swiftshader", // Chromium software fallback (most common on blocklisted GPUs)
  "llvmpipe", // Linux Mesa software rasterizer
  "software", // Generic "Software Renderer" / "Microsoft Basic Render"
  "microsoft basic", // Windows fallback
  "apple software", // macOS rare fallback
] as const;

/**
 * Detect whether real hardware-accelerated WebGL is available.
 * Returns { supported: true } only when a GL context can be created AND the
 * GPU renderer string does not match a known software renderer.
 *
 * Note: some Chromium versions hide the renderer string for privacy, returning
 * a generic value. In that case we optimistically treat it as supported —
 * hiding the renderer usually means real hardware, not SwiftShader.
 */
export function detectWebGL(): WebGLDetectResult {
  try {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl2") ||
      canvas.getContext("webgl")) as WebGLRenderingContext | null;

    if (!gl) {
      return { supported: false, reason: "no-webgl-context" };
    }

    const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
    if (debugInfo) {
      const renderer = String(
        gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL),
      ).toLowerCase();
      const matchedPattern = SOFTWARE_RENDERER_PATTERNS.find((p) =>
        renderer.includes(p),
      );
      if (matchedPattern) {
        return {
          supported: false,
          reason: `software-renderer:${matchedPattern}`,
        };
      }
    }

    return { supported: true };
  } catch {
    // getContext can throw on machines with broken GPU drivers.
    return { supported: false, reason: "context-creation-threw" };
  }
}
