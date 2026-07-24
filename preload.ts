// [20260724_TS_Migration_EntryPoints] Type declaration for preload.js entry
// point (ADR-010 final phase). preload.js runs in the renderer process
// sandbox and exposes electronAPI via contextBridge.
//
// The implementation stays in preload.js because:
// 1. Electron's preload script must use CJS (sandbox restriction)
// 2. esbuild bundles it (build:preload script)
// 3. The electronAPI shape is already typed in src/electronAPI.d.ts

// This file exists purely so tsc knows about preload.js.
// It has no exports (it's a script that calls contextBridge.exposeInMainWorld).
export {};
