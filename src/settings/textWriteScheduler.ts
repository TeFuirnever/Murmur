// [20260926_Perf_402_TextInputDebounce] Debounce + flush for text-like
// settings persistence (issue #402). Every keystroke in hotwords / API key
// / Base URL used to fire the full setSetting pipeline (SQLite write +
// syncToFileConfig fs.writeFileSync + two-window broadcast). This scheduler
// defers the write 400ms — the repo's autosave convention from
// TemplatesSection (TEMPLATE_AUTOSAVE_DELAY_MS) — collapses a keystroke
// burst into ONE write with last-value-wins, and exposes flush()/cancel()
// for the blur / window-blur / hide / window-close paths. React state in
// useSettings stays immediate; only the persistence write is deferred.
// Discrete controls (selects, switches, theme) never enter this scheduler.

// [20260926_Refactor_403_SettingsSchema] The key set moved into the schema
// (textLike flags); re-exported here so useSettings and its tests keep a
// stable import path. Issue #403: one declaration per key, schema-side.
import { TEXT_INPUT_SETTING_KEYS } from "./settingsSchema";

export { TEXT_INPUT_SETTING_KEYS };

/** Persist function shape matching window.electronAPI.setSetting. */
export type SetSettingFn = (
  key: string,
  value: unknown,
) => Promise<void> | void;

export interface TextWriteScheduler {
  /** Queue the latest value for a key under a 400ms trailing debounce. */
  schedule: (key: string, value: unknown) => void;
  /** Drop the pending value (and timer) for one key without writing. */
  cancel: (key: string) => void;
  /** Write all pending values now and cancel their timers. */
  flush: () => void;
}

export function createTextWriteScheduler(
  setSetting: SetSettingFn,
): TextWriteScheduler {
  const pending = new Map<string, unknown>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const schedule = (key: string, value: unknown): void => {
    pending.set(key, value);
    const existing = timers.get(key);
    if (existing !== undefined) clearTimeout(existing);
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key);
        const queued = pending.get(key);
        if (queued === undefined) return;
        pending.delete(key);
        setSetting(key, queued);
      }, TEXT_INPUT_PERSIST_DEBOUNCE_MS),
    );
  };

  const cancel = (key: string): void => {
    const timer = timers.get(key);
    if (timer !== undefined) {
      clearTimeout(timer);
      timers.delete(key);
    }
    pending.delete(key);
  };

  const flush = (): void => {
    if (pending.size === 0) return;
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    const snapshot = new Map(pending);
    pending.clear();
    for (const [key, value] of snapshot) {
      setSetting(key, value);
    }
  };

  return { schedule, cancel, flush };
}

// [20260926_Perf_402_TextInputDebounce] Matches TemplatesSection's
// TEMPLATE_AUTOSAVE_DELAY_MS (repo autosave convention).
export const TEXT_INPUT_PERSIST_DEBOUNCE_MS = 400;
