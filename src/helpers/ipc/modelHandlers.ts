// [20260724_TS_BigBang_ModelHandlers] Migrated from .js to .ts (ADR-010).
import * as C from "../ipc-contracts";
// [20260912_Refactor_261_TranscriptionService] Ticket #261 (spec #258
// Phase 0): the MODELS.CHECK engine-status probe moved into
// checkEngineStatusService (src/helpers/services/transcriptionService.ts)
// so it is callable without a renderer/window/sender. The handler stays a
// thin shell that forwards its funasrManager via the deps bag.
import { checkEngineStatusService } from "../services/transcriptionService";

interface FunasrManager {
  checkModelFiles(): Promise<
    { models_downloaded: boolean } & Record<string, unknown>
  >;
  downloadModels(
    cb: (progress: Record<string, unknown>) => void,
  ): Promise<unknown>;
  // [20260816_Refactor_DeadChannels] checkStatus removed from this interface:
  // its only consumer was the deleted MODELS.CURRENT placeholder handler.
}

interface Managers {
  funasrManager: FunasrManager;
}

export function register(ipcMain: Electron.IpcMain, managers: Managers): void {
  const { funasrManager } = managers;

  ipcMain.handle(C.MODELS.CHECK, async () => {
    // [20260912_Refactor_261_TranscriptionService] Thin shell delegating to
    // the extracted service function (pure pass-through to checkModelFiles).
    return await checkEngineStatusService({ funasrManager });
  });

  ipcMain.handle(C.MODELS.DOWNLOAD, async (event) => {
    return await funasrManager.downloadModels((progress) => {
      event.sender.send(C.EVENTS.MODEL_DOWNLOAD_PROGRESS, progress);
    });
  });

  // [20260816_Refactor_DeadChannels] The DOWNLOAD_MODEL duplicate entry and
  // the AVAILABLE/CURRENT/SWITCH placeholder handlers (hardcoded responses,
  // zero renderer callers) were removed with their contract constants.
}
// [20260724_TS_BigBang_ModelHandlers] END
