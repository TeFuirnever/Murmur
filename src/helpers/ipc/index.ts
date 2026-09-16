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
// [20260912_Feat_242_TemplateSystem] Ticket #242 (spec #193 T15): the
// template-editor handlers (LIST/READ/SAVE/DELETE over templatesService).
import * as templateHandlers from "./templateHandlers";
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
    // [20260907_Feat_233_ListModels] Model-list derivation (T6): small
    // quota — it fires on base_url edits, not per keystroke.
    [C.AI.LIST_MODELS]: { maxCalls: 10, windowMs: 60_000 },
    // [20260908_Feat_240_VocabCorrections] T13 settings-page CRUD.
    [C.AI.VOCAB_LIST]: { maxCalls: 30, windowMs: 60_000 },
    [C.AI.VOCAB_ADD]: { maxCalls: 30, windowMs: 60_000 },
    [C.AI.VOCAB_DELETE]: { maxCalls: 30, windowMs: 60_000 },
    [C.AI.VOCAB_CLEAR]: { maxCalls: 5, windowMs: 60_000 },
    // [20260910_Feat_237_StreamDegradation] T10 settings-page view/reset.
    [C.AI.STREAM_DEGRADATION_LIST]: { maxCalls: 30, windowMs: 60_000 },
    [C.AI.STREAM_DEGRADATION_RESET]: { maxCalls: 5, windowMs: 60_000 },
    // [20260912_Feat_242_TemplateSystem] Template editor CRUD. DELETE is a
    // destructive restore-default arm (small quota, mirroring VOCAB_CLEAR /
    // STREAM_DEGRADATION_RESET).
    // [20260912_Fix_242_ReviewRound2] SAVE allows 120/min: the editor
    // autosaves on a 400ms debounce, and ~1 edit per 0.5s of sustained
    // typing was already reachable at the old 60/min — hitting the limiter
    // surfaces in the UI as a failed save (payload effectively lost).
    [C.TEMPLATES.LIST]: { maxCalls: 30, windowMs: 60_000 },
    [C.TEMPLATES.READ]: { maxCalls: 30, windowMs: 60_000 },
    [C.TEMPLATES.SAVE]: { maxCalls: 120, windowMs: 60_000 },
    [C.TEMPLATES.DELETE]: { maxCalls: 5, windowMs: 60_000 },
    [C.TRANSCRIPTION.SAVE]: { maxCalls: 30, windowMs: 60_000 },
    // [20260906_Feat_TranscriptionUpdate] Manual polish write-back (spec #193
    // T1, ticket #228): fires once per polish action, so it carries the same
    // budget as the sibling SAVE row.
    [C.TRANSCRIPTION.UPDATE]: { maxCalls: 30, windowMs: 60_000 },
    [C.MODELS.DOWNLOAD]: { maxCalls: 3, windowMs: 300_000 },
    // [20260906_Refactor_DeadChannelCleanup] Ticket #250: the FUNASR.INSTALL
    // rate-limit entry was removed with the channel (zero renderer callers).
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
  // [20260912_Feat_242_TemplateSystem] Template editor handlers (repo rule:
  // every new handler file registers here).
  templateHandlers.register(
    wrappedIpc,
    asManagers<Parameters<typeof templateHandlers.register>[1]>(managers),
  );
  updateHandlers.register(
    wrappedIpc,
    asManagers<Parameters<typeof updateHandlers.register>[1]>(managers),
  );
}
// [20260724_TS_BigBang_IpcIndex] END
