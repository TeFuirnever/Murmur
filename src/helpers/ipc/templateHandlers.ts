// [20260912_Feat_242_TemplateSystem] Ticket #242 (spec #193 T15): IPC
// handlers for the custom-template editor — thin shells over
// templatesService (the same seam split aiHandlers → aiService in #262).
// Contract: only NAME+CONTENT cross the boundary; the service's
// sanitizer derives every on-disk filename, so no renderer input can
// point outside <templatesDir>. A successful SAVE/DELETE invalidates
// aiHandlers' module-level template cache (shared across the three
// windows) AFTER the filesystem mutation, so GET_MODES and the next
// polish run reflect the change immediately instead of after the 30s TTL.

import * as C from "../ipc-contracts";
import {
  deleteTemplate,
  listTemplates,
  readTemplate,
  saveTemplate,
} from "../services/templatesService";
// Existing export only — no new aiHandlers surface beyond
// invalidateTemplateCache (imported for the write-path invalidation).
import { invalidateTemplateCache } from "./aiHandlers";

interface Logger {
  info?(message: string, ...args: unknown[]): void;
  warn?(message: string, ...args: unknown[]): void;
  error?(message: string, ...args: unknown[]): void;
}

interface Managers {
  logger: Logger;
  templatesDir?: string;
}

export function register(ipcMain: Electron.IpcMain, managers: Managers): void {
  const { logger } = managers;
  // Same templatesDir resolution as aiHandlers.register: the managers bag
  // wins; the fallback lazily resolves <userData>/templates so main.ts
  // needs no new wiring.
  const templatesDir =
    managers.templatesDir ||
    (() => {
      // Lazy require("electron") — an import would be hoisted and load
      // electron at module init (same pattern as aiHandlers).
      const { app } = require("electron");
      return `${app.getPath("userData")}/templates`;
    })();

  const deps = { templatesDir, logger };

  ipcMain.handle(C.TEMPLATES.LIST, async () => {
    return { success: true, templates: listTemplates(deps) };
  });

  ipcMain.handle(C.TEMPLATES.READ, async (_event, fileName: string) => {
    // [20260912_Fix_242_ReviewRound2] The fileName (from LIST) is the file
    // key; the service still sanitizes it, so it stays a bare filename.
    return readTemplate(deps, fileName);
  });

  ipcMain.handle(
    C.TEMPLATES.SAVE,
    async (_event, fileName: string, content: string) => {
      // Invalidate AFTER the write: only a persisted template should
      // evict the shared cache.
      const result = saveTemplate(deps, fileName, content);
      if (result.success) invalidateTemplateCache();
      return result;
    },
  );

  ipcMain.handle(C.TEMPLATES.DELETE, async (_event, fileName: string) => {
    // Same invalidation contract as SAVE: deleting a custom file (the
    // restore-default arm) must re-expose the built-in mode immediately.
    const result = deleteTemplate(deps, fileName);
    if (result.success) invalidateTemplateCache();
    return result;
  });
}
