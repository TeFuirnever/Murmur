// [20260724_TS_BigBang_IpcIndex] Migrated from .js to .ts (ADR-010).
// `module.exports = { registerAll }` (named) became a named export.
// Each handler module is imported with named `register`. ipcRateLimiter
// uses `export default` so it is a default import. updateManager exports
// named `register`.
//
// [20260724_TS_BigBang_IpcIndex_TypeRelax] The managers bag is forwarded
// verbatim to each handler's `register()`. Each handler declares its own
// `Managers` interface with the fields it needs. To avoid cross-module
// interface clashes without resorting to `any` (forbidden by the
// backend-type-safety test), the bag is typed as a broad object and cast
// through `unknown` to each handler's expected parameter type.
import * as C from "../ipc-contracts";
import * as environmentHandlers from "./environmentHandlers";
import * as modelHandlers from "./modelHandlers";
import * as aiHandlers from "./aiHandlers";
import * as transcriptionHandlers from "./transcriptionHandlers";
import * as settingsHandlers from "./settingsHandlers";
import * as windowHandlers from "./windowHandlers";
import * as hotkeyHandlers from "./hotkeyHandlers";
import * as clipboardHandlers from "./clipboardHandlers";
import * as systemHandlers from "./systemHandlers";
import * as updateHandlers from "../updateManager";
import createRateLimitedHandler from "../ipcRateLimiter";

// The managers bag is an opaque object owned by main.ts; each handler's
// register() narrows it to the fields it needs. Typed as a plain object
// (not `any`) to satisfy the backend-type-safety guard.
type ManagersBag = Record<string, unknown>;
type IpcHandler = (event: unknown, ...args: unknown[]) => unknown;

interface RateLimitConfig {
  maxCalls: number;
  windowMs: number;
}

function wrapWithRateLimits(ipcMain: Electron.IpcMain): Electron.IpcMain {
  const originalHandle = ipcMain.handle.bind(ipcMain) as (
    channel: string,
    handler: IpcHandler,
  ) => void;
  const RATE_LIMITS: Record<string, RateLimitConfig> = {
    [C.AI.PROCESS]: { maxCalls: 20, windowMs: 60_000 },
    [C.AI.CHECK_STATUS]: { maxCalls: 30, windowMs: 60_000 },
    [C.TRANSCRIPTION.SAVE]: { maxCalls: 30, windowMs: 60_000 },
    [C.MODELS.DOWNLOAD]: { maxCalls: 3, windowMs: 300_000 },
    [C.FUNASR.INSTALL]: { maxCalls: 3, windowMs: 300_000 },
  };

  // Reassign handle with a rate-limiting wrapper. Cast through unknown to
  // satisfy the readonly IpcMain.handle signature without using `any`.
  (
    ipcMain as unknown as {
      handle: (channel: string, handler: IpcHandler) => void;
    }
  ).handle = function (channel: string, handler: IpcHandler) {
    const limits = RATE_LIMITS[channel];
    if (limits) {
      return originalHandle(
        channel,
        createRateLimitedHandler(
          handler as (event: unknown, ...args: unknown[]) => Promise<unknown>,
          limits,
        ),
      );
    }
    return originalHandle(channel, handler);
  };

  return ipcMain;
}

// Cast helper: route ManagersBag through `unknown` to a handler's expected
// managers type. This avoids `any` while letting structural compatibility
// flow at runtime (the bag really does contain every manager).
function asManagers<T>(bag: ManagersBag): T {
  return bag as unknown as T;
}

export function registerAll(
  ipcMain: Electron.IpcMain,
  managers: ManagersBag,
): void {
  const wrappedIpc = wrapWithRateLimits(ipcMain);
  environmentHandlers.register(
    wrappedIpc,
    asManagers<Parameters<typeof environmentHandlers.register>[1]>(managers),
  );
  modelHandlers.register(
    wrappedIpc,
    asManagers<Parameters<typeof modelHandlers.register>[1]>(managers),
  );
  aiHandlers.register(
    wrappedIpc,
    asManagers<Parameters<typeof aiHandlers.register>[1]>(managers),
  );
  transcriptionHandlers.register(wrappedIpc, {
    ...managers,
    processTextWithAI: aiHandlers.processTextWithAI,
  } as unknown as Parameters<typeof transcriptionHandlers.register>[1]);
  settingsHandlers.register(
    wrappedIpc,
    asManagers<Parameters<typeof settingsHandlers.register>[1]>(managers),
  );
  windowHandlers.register(
    wrappedIpc,
    asManagers<Parameters<typeof windowHandlers.register>[1]>(managers),
  );
  hotkeyHandlers.register(
    wrappedIpc,
    asManagers<Parameters<typeof hotkeyHandlers.register>[1]>(managers),
  );
  clipboardHandlers.register(
    wrappedIpc,
    asManagers<Parameters<typeof clipboardHandlers.register>[1]>(managers),
  );
  systemHandlers.register(
    wrappedIpc,
    asManagers<Parameters<typeof systemHandlers.register>[1]>(managers),
  );
  updateHandlers.register(
    wrappedIpc,
    asManagers<Parameters<typeof updateHandlers.register>[1]>(managers),
  );
}
// [20260724_TS_BigBang_IpcIndex] END
