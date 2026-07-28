// [20260729_Feat_EffectsWebGLDetect] Unit tests for WebGL detection.
// Pattern: node test env has no `document`, so we stub canvas creation via
// global overrides (same approach as assert-electron-api.test.ts).
import { describe, it, expect, vi, afterEach } from "vitest";
import { detectWebGL } from "../../src/components/effects/detectWebGL";

// Mock GL context shape matching what detectWebGL reads.
function makeMockGL(rendererString?: string) {
  const ext =
    rendererString != null ? { UNMASKED_RENDERER_WEBGL: 0x9246 } : null;
  return {
    getExtension: vi.fn((name: string) => {
      if (name === "WEBGL_debug_renderer_info") return ext;
      return null;
    }),
    getParameter: vi.fn((param: number) => {
      if (param === 0x9246) return rendererString ?? "";
      return "";
    }),
  };
}

describe("detectWebGL", () => {
  const savedDocument = (globalThis as { document?: Document }).document;
  const savedWindow = (globalThis as { window?: unknown }).window;

  afterEach(() => {
    // Restore globals between tests.
    if (savedDocument !== undefined) {
      (globalThis as { document?: Document }).document = savedDocument;
    } else {
      delete (globalThis as { document?: Document }).document;
    }
    if (savedWindow !== undefined) {
      (globalThis as { window?: unknown }).window = savedWindow;
    }
  });

  function stubCanvas(getContextReturn: unknown) {
    const fakeCanvas = {
      getContext: vi.fn(() => getContextReturn),
    };
    (globalThis as { document: Document }).document = {
      createElement: vi.fn(() => fakeCanvas),
    } as unknown as Document;
  }

  it("returns supported:false when no WebGL context can be created", () => {
    stubCanvas(null);
    const result = detectWebGL();
    expect(result.supported).toBe(false);
    expect(result.reason).toBe("no-webgl-context");
  });

  it("returns supported:true for a hardware GPU renderer", () => {
    stubCanvas(makeMockGL("Apple M1 Pro"));
    const result = detectWebGL();
    expect(result.supported).toBe(true);
  });

  it("returns supported:false for SwiftShader (software renderer)", () => {
    stubCanvas(makeMockGL("Apple SwiftShader"));
    const result = detectWebGL();
    expect(result.supported).toBe(false);
    expect(result.reason).toContain("software-renderer");
    expect(result.reason).toContain("swiftshader");
  });

  it("returns supported:false for llvmpipe (Linux software rasterizer)", () => {
    stubCanvas(makeMockGL("Mesa llvmpipe"));
    const result = detectWebGL();
    expect(result.supported).toBe(false);
    expect(result.reason).toContain("llvmpipe");
  });

  it("returns supported:true when renderer string is hidden (privacy mode)", () => {
    // getExtension returns null → we treat as supported (optimistic).
    stubCanvas(makeMockGL(undefined));
    const result = detectWebGL();
    expect(result.supported).toBe(true);
  });

  it("returns supported:false when getContext throws", () => {
    const throwingCanvas = {
      getContext: vi.fn(() => {
        throw new Error("GPU driver crash");
      }),
    };
    (globalThis as { document: Document }).document = {
      createElement: vi.fn(() => throwingCanvas),
    } as unknown as Document;
    const result = detectWebGL();
    expect(result.supported).toBe(false);
    expect(result.reason).toBe("context-creation-threw");
  });
});
