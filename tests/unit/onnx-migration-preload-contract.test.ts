// [20261002_T9_MigrationUx] Ticket #420 type-contract test (AGENTS.md MUST-DO
// #3: .d.ts / shared type schema changes ship a type-contract test first).
// Two dimensions:
//   1. compile-time — the ElectronAPI declaration must carry the migration
//      surface with exact signatures (drift fails `pnpm typecheck`);
//   2. runtime — preloadApi must expose both methods and route them through
//      the ipc-contracts constants (drift fails this suite here).
import { describe, it, expect, vi } from "vitest";

vi.mock("electron", () => ({
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: {
    invoke: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
  },
  webUtils: { getPathForFile: vi.fn() },
}));

import { preloadApi } from "../../preload";
import type { ElectronAPI } from "../../src/electronAPI";
import type { OnnxMigrationStatus } from "../../src/types/ipc";
import * as C from "../../src/helpers/ipc-contracts";

// --- compile-time contract (checked by tsc, kept honest by usage below) ---

type MigrationMembers = Extract<
  keyof ElectronAPI,
  "checkOnnxMigration" | "downloadOnnxModels"
>;
// Fails typecheck unless BOTH members exist on the declared API.
const _members: ReadonlyArray<MigrationMembers> = [
  "checkOnnxMigration",
  "downloadOnnxModels",
];
void _members;

// Signature pins: the status promise resolves the shared OnnxMigrationStatus
// shape; the download resolves the v2 outcome.
function _statusSignature(api: ElectronAPI): Promise<OnnxMigrationStatus> {
  return api.checkOnnxMigration();
}
function _downloadSignature(
  api: ElectronAPI,
): Promise<{ success: boolean; verified?: string[] }> {
  return api.downloadOnnxModels();
}
void _statusSignature;
void _downloadSignature;

// --- runtime contract (checked here) ---------------------------------------

describe("[20261002_T9_MigrationUx] preload migration contract (#420)", () => {
  it("exposes checkOnnxMigration and routes it through the contract constant", async () => {
    expect(typeof preloadApi.checkOnnxMigration).toBe("function");
    const invoke = (await import("electron")).ipcRenderer.invoke as ReturnType<
      typeof vi.fn
    >;
    invoke.mockResolvedValue({
      needed: false,
      onnx_ready: true,
      torch_fallback_available: false,
      total_bytes: 0,
      remaining_bytes: 0,
    });
    const status = await preloadApi.checkOnnxMigration();
    expect(invoke).toHaveBeenCalledWith(C.MODELS.MIGRATION_STATUS);
    expect(status).toMatchObject({ onnx_ready: true });
  });

  it("exposes downloadOnnxModels and routes it through the contract constant", async () => {
    expect(typeof preloadApi.downloadOnnxModels).toBe("function");
    const invoke = (await import("electron")).ipcRenderer.invoke as ReturnType<
      typeof vi.fn
    >;
    invoke.mockResolvedValue({ success: true, verified: ["vad-fsmn"] });
    const result = await preloadApi.downloadOnnxModels();
    expect(invoke).toHaveBeenCalledWith(C.MODELS.DOWNLOAD_ONNX);
    expect(result).toEqual({ success: true, verified: ["vad-fsmn"] });
  });
});
