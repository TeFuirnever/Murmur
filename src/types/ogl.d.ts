// [20260729_Feat_OglTypeDecls] Minimal ambient type declarations for ogl.
// ogl ships without bundled TypeScript declarations. Rather than depend on the
// community `ogl-types` package (low download count, stale maintenance), we
// declare only the surface area that Murmur's vendored Aurora.tsx uses.
// If Murmur later adopts more ogl features, extend this file or migrate to
// a maintained @types package.

declare module "ogl" {
  export class Renderer {
    gl: WebGLRenderingContext & { canvas: HTMLCanvasElement };
    constructor(options?: Record<string, unknown>);
    setSize(width: number, height: number): void;
    render(options: { scene: unknown }): void;
  }

  // Uniforms interface: using an index signature (not Record<K,V>) so that
  // noUncheckedIndexedAccess does not add `| undefined` to indexed access —
  // ogl always populates uniforms from the constructor, so they are present.
  interface ProgramUniforms {
    [key: string]: { value: any };
  }

  export class Program {
    uniforms: ProgramUniforms;
    constructor(gl: WebGLRenderingContext, options?: Record<string, unknown>);
  }

  export class Mesh extends Program {
    constructor(
      gl: WebGLRenderingContext,
      options?: { geometry?: unknown; program?: unknown },
    );
  }

  export class Color {
    r: number;
    g: number;
    b: number;
    constructor(...args: unknown[]);
  }

  export class Triangle {
    attributes: Record<string, unknown>;
    constructor(gl: WebGLRenderingContext, options?: Record<string, unknown>);
  }
}
