// [20260912_Feat_242_TemplateSystem] Ticket #242 (spec #193 T15): the
// settings-page custom-template editor. Lists custom templates (file-backed)
// alongside the built-in modes; a selection loads its content into an
// autosaving editor (400ms debounce, flushed on unmount). Only filename+
// content cross the IPC boundary — the main process sanitizes every input
// into <templatesDir>/<sanitized>.
//
// Restore-default semantics (the ticket's 恢复默认): a built-in mode whose
// name has a custom file is "shadowed" — the file IS the override, so the
// built-in default is in effect exactly when no override file exists. The
// restore-default button is therefore visible ONLY for a built-in mode that
// currently has an override file (content differs from default), and it
// deletes that file (restore-default equivalent). A pure custom template
// gets a plain delete instead. Built-in mode names are mirrored here (they
// cannot be derived at runtime: GET_MODES filters shadowed built-ins out of
// the merged list) — see BUILT_IN_MODES in src/helpers/ipc/aiHandlers.ts.
//
// [20260912_Fix_242_ReviewRound2] Identity + resilience fixes:
//  - The editor keys every bridge call off the ON-DISK fileName from LIST
//    (a file's frontmatter name can diverge from its stem; keying off the
//    display name used to 404 reads, duplicate saves and no-op deletes).
//  - A pending autosave is cleared by object IDENTITY, so an in-flight
//    older save can no longer drop a newer pending edit.
//  - A throttled save ("Rate limit exceeded" from ipcRateLimiter) gets a
//    distinct retryable message and exactly one retry after the limiter
//    window instead of a generic save-failure toast; list reload failures
//    are surfaced (non-silent).
//  - A save that persisted frontmatter-less content warns that the file
//    will never appear as a mode.
//  - The name input is disabled while an existing template is selected —
//    name edits were never saved ("rename" silently duplicated the file).
import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import type { TemplateMeta } from "../../types/ipc";

/** Debounce window for the editor autosave (named constant per ticket). */
const TEMPLATE_AUTOSAVE_DELAY_MS = 400;

/**
 * [20260912_Fix_242_ReviewRound2] One-shot retry delay for a throttled
 * save — matches the SAVE rate-limiter window in src/helpers/ipc/index.ts.
 */
const TEMPLATE_SAVE_RETRY_DELAY_MS = 60_000;

/**
 * [20260912_Fix_242_ReviewRound2] The stable error string the main-process
 * rate limiter (src/helpers/ipcRateLimiter.ts) resolves with; anything else
 * is a genuine save failure.
 */
const RATE_LIMIT_ERROR = "Rate limit exceeded";

/**
 * [20260912_Fix_242_ReviewRound2] Service warning for a saved file without
 * parseable frontmatter (local mirror — the service module pulls in node
 * fs and must not be imported into renderer code).
 */
const WARNING_MISSING_FRONTMATTER = "missing_frontmatter";

/**
 * Built-in mode names mirrored from aiHandlers' BUILT_IN_MODES. Needed in
 * the renderer for shadow detection and restore-default visibility; the
 * merged GET_MODES list hides shadowed built-ins, so they cannot be
 * recovered from the backend alone.
 */
const BUILT_IN_MODE_NAMES = [
  "optimize",
  "optimize_long",
  "format",
  "correct",
  "summarize",
  "enhance",
  "xiaohongshu",
  "zhihu",
  "douyin",
  "de-ai",
] as const;

// [20260912_Fix_242_ReviewRound2] Identity-carrying autosave payload: the
// pending slot is cleared only when THIS object is still the newest edit.
interface PendingSave {
  fileName: string;
  content: string;
  retried: boolean;
}

export const TemplatesSection: React.FC = () => {
  const { t } = useTranslation();
  const [customs, setCustoms] = React.useState<TemplateMeta[]>([]);
  const [nameInput, setNameInput] = React.useState("");
  const [content, setContent] = React.useState("");
  // The on-disk file backing the current selection. null = new draft (the
  // name input is editable); set whenever an existing entry is selected.
  const [selectedFile, setSelectedFile] = React.useState<string | null>(null);
  // Pending autosave payload + its timers; read by the unmount flush.
  const pendingSaveRef = React.useRef<PendingSave | null>(null);
  const saveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  // Latest customs for saveNow's is-this-a-new-file check without
  // resubscribing its callbacks (keeps saveNow stable across reloads).
  const customsRef = React.useRef<TemplateMeta[]>([]);
  React.useEffect(() => {
    customsRef.current = customs;
  }, [customs]);

  const reload = React.useCallback(async () => {
    if (!window.electronAPI?.listTemplates) return;
    try {
      const result = await window.electronAPI.listTemplates();
      // [20260912_Fix_242_ReviewRound2] Failures are surfaced — the list
      // silently staying stale read as an empty templates page.
      if (result.success) {
        setCustoms(result.templates);
      } else {
        toast.error(t("settings.templates.loadFailed", "模板列表加载失败"));
      }
    } catch {
      toast.error(t("settings.templates.loadFailed", "模板列表加载失败"));
    }
  }, [t]);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  const saveNow = React.useCallback(
    async (payload: PendingSave) => {
      if (!window.electronAPI?.saveTemplate) return;
      try {
        const result = await window.electronAPI.saveTemplate(
          payload.fileName,
          payload.content,
        );
        if (result.success) {
          // [20260912_Fix_242_ReviewRound2] Identity-guarded clear: if a
          // newer edit (different payload object) is pending, it survives
          // this resolution and the unmount flush still persists it.
          if (pendingSaveRef.current === payload) {
            pendingSaveRef.current = null;
          }
          if (result.warning === WARNING_MISSING_FRONTMATTER) {
            toast.warning(
              t(
                "settings.templates.frontmatterWarning",
                "已保存，但缺少 frontmatter，模板不会出现在模式列表中。",
              ),
            );
          }
          // Reload only for brand-new files — per-save reloads would burn
          // the 30/min LIST budget under autosave.
          const isNewFile = !customsRef.current.some(
            (c) => c.fileName === result.fileName,
          );
          if (isNewFile) await reload();
        } else if (result.error === RATE_LIMIT_ERROR) {
          // [20260912_Fix_242_ReviewRound2] The throttle is classified and
          // retryable — never surfaced as a generic save failure.
          toast.error(
            t(
              "settings.templates.saveThrottled",
              "保存过于频繁，稍后将自动重试一次。",
            ),
          );
          if (!payload.retried && pendingSaveRef.current === payload) {
            payload.retried = true;
            retryTimerRef.current = setTimeout(() => {
              retryTimerRef.current = null;
              // [20260912_Fix_242_ReviewRound2] Re-check identity at fire
              // time: if a newer edit saved successfully meanwhile, firing
              // the stale payload would silently revert the record.
              if (pendingSaveRef.current === payload) void saveNow(payload);
            }, TEMPLATE_SAVE_RETRY_DELAY_MS);
          }
        } else {
          toast.error(t("settings.templates.saveFailed", "模板保存失败"));
        }
      } catch {
        toast.error(t("settings.templates.saveFailed", "模板保存失败"));
      }
    },
    [reload, t],
  );

  const scheduleSave = React.useCallback(
    (fileName: string, body: string) => {
      if (!fileName.trim()) return;
      pendingSaveRef.current = { fileName, content: body, retried: false };
      if (saveTimerRef.current !== null) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        const pending = pendingSaveRef.current;
        if (pending) void saveNow(pending);
      }, TEMPLATE_AUTOSAVE_DELAY_MS);
    },
    [saveNow],
  );

  // Unmount flush: leaving the section mid-debounce must not lose the
  // user's last edit. saveNow is stable (deps: reload + t), so binding it
  // here never reschedules the flush.
  React.useEffect(() => {
    const saveFn = saveNow;
    return () => {
      if (saveTimerRef.current !== null) clearTimeout(saveTimerRef.current);
      if (retryTimerRef.current !== null) clearTimeout(retryTimerRef.current);
      const pending = pendingSaveRef.current;
      if (pending) void saveFn(pending);
    };
  }, [saveNow]);

  // A pristine built-in has no override file: fileName is null, the editor
  // starts empty, and saving creates the override under the typed name.
  const select = async (entry: {
    name: string;
    fileName: string | null;
  }): Promise<void> => {
    // [20260912_Fix_242_ReviewRound2] The FILE is the selection identity:
    // name edits for existing templates were never persisted, so the input
    // is disabled instead of letting "rename" silently duplicate the file.
    setNameInput(entry.name);
    setSelectedFile(entry.fileName);
    if (entry.fileName === null) {
      setContent("");
      return;
    }
    if (!window.electronAPI?.readTemplate) return;
    try {
      const result = await window.electronAPI.readTemplate(entry.fileName);
      setContent(result.success ? (result.content ?? "") : "");
    } catch {
      setContent("");
    }
  };

  const onContentChange = (value: string): void => {
    setContent(value);
    // Existing templates save through their on-disk fileName; new drafts
    // through the typed (display) name — both sanitized main-side.
    const target = selectedFile ?? nameInput.trim();
    if (target) scheduleSave(target, value);
  };

  const isBuiltInName = (BUILT_IN_MODE_NAMES as readonly string[]).includes(
    nameInput.trim(),
  );

  // Built-ins not shadowed by a custom file keep their own list entries.
  const shadowed = new Set(customs.map((c) => c.name));
  const pristineBuiltIns = BUILT_IN_MODE_NAMES.filter(
    (name) => !shadowed.has(name),
  );

  const remove = async (fileName: string): Promise<void> => {
    if (!window.electronAPI?.deleteTemplate) return;
    try {
      const result = await window.electronAPI.deleteTemplate(fileName);
      if (!result.success) {
        toast.error(t("settings.templates.deleteFailed", "模板删除失败"));
        return;
      }
    } catch {
      toast.error(t("settings.templates.deleteFailed", "模板删除失败"));
      return;
    }
    setNameInput("");
    setSelectedFile(null);
    setContent("");
    await reload();
  };

  return (
    <div data-testid="templates-section" className="space-y-3">
      <div className="flex items-center gap-2">
        <input
          type="text"
          data-testid="template-name-input"
          aria-label={t("settings.templates.nameLabel", "模板名称")}
          placeholder={t("settings.templates.namePlaceholder", "输入模板名称")}
          value={nameInput}
          disabled={selectedFile !== null}
          onChange={(e) => setNameInput(e.target.value)}
          className="flex-1 px-2 py-1 text-sm border border-[#d2d2d7] dark:border-[#3a3a3c] rounded-md bg-[#f5f5f7] dark:bg-[#3a3a3c] text-[#1d1d1f] dark:text-[#f5f5f7]"
        />
      </div>

      <textarea
        data-testid="template-content-editor"
        aria-label={t("settings.templates.contentLabel", "模板内容")}
        value={content}
        onChange={(e) => onContentChange(e.target.value)}
        rows={10}
        className="w-full px-2 py-1 text-sm font-mono border border-[#d2d2d7] dark:border-[#3a3a3c] rounded-md bg-[#f5f5f7] dark:bg-[#3a3a3c] text-[#1d1d1f] dark:text-[#f5f5f7]"
      />

      {/* AC: placeholder hint lists the three placeholders and notes that
          {speakers} renders empty when the request has no speaker data. */}
      <p
        data-testid="template-placeholder-hint"
        className="text-xs text-[#86868b]"
      >
        {t(
          "settings.templates.placeholderHint",
          "可用占位符：{text}（转写原文）、{output_lang}（输出语言）、{speakers}（说话人分行）；当请求没有说话人数据时 {speakers} 渲染为空。",
        )}
      </p>

      {/* AC: shadow warning — a template named like a built-in mode
          overrides the built-in prompt. */}
      {nameInput.trim() && isBuiltInName && (
        <p
          data-testid="template-shadow-warning"
          className="text-xs text-[#ff9f0a]"
        >
          {t(
            "settings.templates.shadowWarning",
            "该名称与内置模式相同：保存后会覆盖内置提示词，删除或恢复默认即可还原。",
          )}
        </p>
      )}

      {/* AC: restore-default ONLY when the built-in currently differs from
          its default (an override file exists). Deletes THAT file. */}
      {selectedFile !== null && isBuiltInName && (
        <button
          type="button"
          data-testid="template-restore-default"
          onClick={() => void remove(selectedFile)}
          className="px-2 py-1 text-xs rounded-md border border-[#d2d2d7] dark:border-[#3a3a3c] text-[#0071e3]"
        >
          {t("settings.templates.restoreDefault", "恢复默认")}
        </button>
      )}
      {/* Pure custom templates get a plain delete. */}
      {selectedFile !== null && !isBuiltInName && (
        <button
          type="button"
          data-testid="template-delete"
          onClick={() => void remove(selectedFile)}
          className="px-2 py-1 text-xs rounded-md border border-[#d2d2d7] dark:border-[#3a3a3c] text-[#ff5f57]"
        >
          {t("settings.templates.delete", "删除模板")}
        </button>
      )}

      <ul
        data-testid="templates-list"
        className="space-y-1 max-h-48 overflow-y-auto"
      >
        {customs.map((template) => (
          <li key={`custom-${template.fileName}`}>
            <button
              type="button"
              data-testid={`template-entry-${template.name}`}
              onClick={() => void select(template)}
              className="w-full text-left px-2 py-1 text-sm rounded-md text-[#1d1d1f] dark:text-[#f5f5f7] hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e]"
            >
              {template.label}
            </button>
          </li>
        ))}
        {pristineBuiltIns.map((name) => (
          <li key={`builtin-${name}`}>
            <button
              type="button"
              data-testid={`template-entry-${name}`}
              onClick={() => void select({ name, fileName: null })}
              className="w-full text-left px-2 py-1 text-sm rounded-md text-[#1d1d1f]/70 dark:text-[#f5f5f7]/70 hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e]"
            >
              {t(`settings.templates.builtinLabels.${name}`, name)}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};
