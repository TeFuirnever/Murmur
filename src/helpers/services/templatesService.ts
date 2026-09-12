// [20260912_Feat_242_TemplateSystem] Ticket #242 (spec #193 T15): the
// custom-template file IO service. Pure main-process functions (same seam
// style as aiService/historyService): every caller passes
// `{ templatesDir, logger }` deps; no renderer, window, or event sender
// here. The renderer crosses the IPC boundary with NAME+CONTENT ONLY —
// never a client-supplied path. Every filename that reaches the filesystem
// flows through sanitizeTemplateFileName, which rejects path separators,
// parent references, colons, control characters and Windows reserved
// names, and normalizes the result to a fixed lowercase `.md` suffix.
// Two named size caps are enforced at this boundary: the write cap bounds
// what a save may persist, and the read cap bounds any single-file read
// (list/read both honor it).
//
// [20260912_Fix_242_ReviewRound2] Identity contract: a file's frontmatter
// name can diverge from its on-disk stem (hand-edited files), so LIST
// returns the ON-DISK fileName alongside the parsed display name/label,
// and READ/SAVE/DELETE key off that fileName. The inputs still pass
// through the sanitizer, so a fileName is merely a pre-normalized name —
// the on-disk location is always `<templatesDir>/<sanitized>`.

import fs from "fs";
import path from "path";
import { parseTemplateFile } from "../aiPrompts";
// [20260912_Fix_242_ReviewRound2] Single source of truth for the list
// entry shape (shared with the renderer contract) — no duplicate type.
import type { TemplateMeta } from "../../types/ipc";

/** Logger surface used for diagnostics; every method is optional. */
export interface TemplatesServiceLogger {
  warn?(message: string, ...args: unknown[]): void;
}

/** Deps bag every service function receives. */
export interface TemplatesServiceDeps {
  templatesDir: string;
  logger?: TemplatesServiceLogger;
}

// [20260912_Feat_242_TemplateSystem] Size caps (named constants): a save
// may persist at most 512KB of template content; a single-file read (list
// or read) never reads more than 1MB from disk. Hand-edited oversize files
// are skipped/rejected instead of being read into memory.
export const TEMPLATE_MAX_CONTENT_BYTES = 512 * 1024;
export const TEMPLATE_MAX_READ_BYTES = 1024 * 1024;

/** [20260912_Feat_242_TemplateSystem] Max template-name length after trim. */
export const TEMPLATE_NAME_MAX_CHARS = 64;

// [20260912_Fix_242_ReviewRound2] Post-save validation outcome: set when
// the persisted content has no parseable frontmatter, in which case the
// file exists but will never appear as a mode.
export const TEMPLATE_WARNING_MISSING_FRONTMATTER = "missing_frontmatter";

/** A listed template: parsed display identity + the on-disk file key. */
export type { TemplateMeta };

// [20260912_Feat_242_TemplateSystem] Windows reserved device names
// (case-insensitive). [20260912_Fix_242_ReviewRound2] Checked against the
// stem AND its first dot-delimited token, so "CON.txt" and "NUL.md.md"
// cannot smuggle a DOS device name past the old trailing-.md-only strip.
const WINDOWS_RESERVED_NAMES = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9",
]);

const PATH_SEPARATOR_REGEX = /[/\\]/;
const PARENT_REFERENCE_MARKER = "..";
const COLON_CHAR = ":";
// C0 control characters plus DEL — never legitimate in a user-facing name.
const CONTROL_CHAR_REGEX = /[\x00-\x1f\x7f]/;
const MARKDOWN_SUFFIX_REGEX = /\.md$/i;
const DOT_CHAR = ".";

/**
 * Outcome of filename sanitization. On the success arm `fileName` is the
 * normalized on-disk name (stem + fixed `.md` suffix); the error arm
 * carries a stable machine-readable code the UI maps to a message.
 */
export type SanitizeTemplateFileNameResult =
  | { valid: true; fileName: string }
  | { valid: false; error: string };

/**
 * Validates and normalizes a template name into an on-disk filename.
 * Rules (ticket #242 ①): rejects path separators (/ \), parent references
 * (..), colons, control characters, Windows reserved device names
 * (case-insensitive), names over TEMPLATE_NAME_MAX_CHARS after trim, and
 * empty/whitespace-only input. A trailing `.md` (any case) is stripped and
 * a fixed lowercase `.md` suffix is appended, so every template file
 * shares one extension.
 *
 * [20260912_Fix_242_ReviewRound2] The reserved check fires on the stem's
 * FIRST dot-delimited token (not just the whole stem), closing the
 * "CON.txt" → CON.txt.md / "NUL.md.md" DOS-device bypass; stems ending in
 * "." are rejected outright ("CON." → CON..md would also resolve to the
 * device on win32).
 */
export function sanitizeTemplateFileName(
  name: string,
): SanitizeTemplateFileNameResult {
  const trimmed = name.trim();
  if (trimmed.length === 0) return { valid: false, error: "empty_name" };
  if (trimmed.length > TEMPLATE_NAME_MAX_CHARS) {
    return { valid: false, error: "name_too_long" };
  }
  // [20260912_Feat_242_TemplateSystem] The parent-reference check runs
  // BEFORE the separator check so a traversal attempt like "foo/../bar"
  // reports its most specific cause (..) rather than the incidental slash.
  if (trimmed.includes(PARENT_REFERENCE_MARKER)) {
    return { valid: false, error: "name_parent_reference" };
  }
  if (PATH_SEPARATOR_REGEX.test(trimmed)) {
    return { valid: false, error: "name_path_separator" };
  }
  if (trimmed.includes(COLON_CHAR)) {
    return { valid: false, error: "name_colon" };
  }
  if (CONTROL_CHAR_REGEX.test(trimmed)) {
    return { valid: false, error: "name_control_char" };
  }
  const stem = trimmed.replace(MARKDOWN_SUFFIX_REGEX, "");
  if (stem.length === 0) return { valid: false, error: "empty_name" };
  if (stem.endsWith(DOT_CHAR)) {
    return { valid: false, error: "name_trailing_dot" };
  }
  const firstToken = stem.split(DOT_CHAR)[0] ?? "";
  if (WINDOWS_RESERVED_NAMES.has(firstToken.toUpperCase())) {
    return { valid: false, error: "name_reserved" };
  }
  return { valid: true, fileName: `${stem}.md` };
}

/**
 * Lists the custom templates in `templatesDir`: every `.md` file under the
 * read cap whose content parses (frontmatter required — the same rule
 * loadCustomTemplates applies). Returns the PARSED name/label (what the
 * runtime modes actually use) plus the ON-DISK fileName, which is the key
 * the read/save/delete operations accept
 * [20260912_Fix_242_ReviewRound2]. A missing directory yields an empty
 * list; over-cap and unparsable files are skipped with a warning log.
 */
export function listTemplates(deps: TemplatesServiceDeps): TemplateMeta[] {
  if (!fs.existsSync(deps.templatesDir)) return [];
  const listed: TemplateMeta[] = [];
  for (const file of fs.readdirSync(deps.templatesDir)) {
    if (!file.endsWith(".md")) continue;
    const filePath = path.join(deps.templatesDir, file);
    try {
      if (fs.statSync(filePath).size > TEMPLATE_MAX_READ_BYTES) {
        deps.logger?.warn?.("模板文件超过读取上限，已跳过:", file);
        continue;
      }
      const parsed = parseTemplateFile(
        fs.readFileSync(filePath, "utf-8"),
        file,
      );
      if (parsed) {
        listed.push({ name: parsed.name, label: parsed.label, fileName: file });
      }
    } catch (error) {
      deps.logger?.warn?.("模板文件读取失败，已跳过:", file, error);
    }
  }
  return listed;
}

/** Result envelope for readTemplate. */
export type ReadTemplateResult =
  | { success: true; content: string }
  | { success: false; error: string };

/**
 * Reads one custom template by its ON-DISK fileName (from listTemplates).
 * The value is sanitized first — the caller never supplies a path — so
 * only `<templatesDir>/<sanitized>` can be read. Files over the read cap
 * are refused without being read.
 */
export function readTemplate(
  deps: TemplatesServiceDeps,
  fileName: string,
): ReadTemplateResult {
  const sanitized = sanitizeTemplateFileName(fileName);
  if (!sanitized.valid) return { success: false, error: sanitized.error };
  const filePath = path.join(deps.templatesDir, sanitized.fileName);
  if (!fs.existsSync(filePath)) return { success: false, error: "not_found" };
  try {
    if (fs.statSync(filePath).size > TEMPLATE_MAX_READ_BYTES) {
      return { success: false, error: "read_too_large" };
    }
    return { success: true, content: fs.readFileSync(filePath, "utf-8") };
  } catch (error) {
    deps.logger?.warn?.("模板文件读取失败:", sanitized.fileName, error);
    return { success: false, error: "not_found" };
  }
}

/** Result envelope for saveTemplate. */
export type SaveTemplateResult =
  | { success: true; fileName: string; warning?: string }
  | { success: false; error: string };

/**
 * Saves (create or overwrite) a template. The target may be a fresh user
 * name or an existing on-disk fileName (from listTemplates) — either way
 * it is sanitized and normalized, and the content's byte size is capped
 * at the write cap before anything touches the disk; the templates dir is
 * created on demand. Returns the normalized fileName on success.
 *
 * [20260912_Fix_242_ReviewRound2] Post-save validation: when the persisted
 * content carries no parseable frontmatter the write still succeeds but
 * the result carries TEMPLATE_WARNING_MISSING_FRONTMATTER, because such a
 * file never appears as a mode (parseTemplateFile → null).
 */
export function saveTemplate(
  deps: TemplatesServiceDeps,
  fileName: string,
  content: string,
): SaveTemplateResult {
  const sanitized = sanitizeTemplateFileName(fileName);
  if (!sanitized.valid) return { success: false, error: sanitized.error };
  if (Buffer.byteLength(content, "utf-8") > TEMPLATE_MAX_CONTENT_BYTES) {
    return { success: false, error: "content_too_large" };
  }
  try {
    fs.mkdirSync(deps.templatesDir, { recursive: true });
    const filePath = path.join(deps.templatesDir, sanitized.fileName);
    fs.writeFileSync(filePath, content, "utf-8");
    const warning = parseTemplateFile(content, sanitized.fileName)
      ? undefined
      : TEMPLATE_WARNING_MISSING_FRONTMATTER;
    return warning
      ? { success: true, fileName: sanitized.fileName, warning }
      : { success: true, fileName: sanitized.fileName };
  } catch (error) {
    deps.logger?.warn?.("模板文件写入失败:", sanitized.fileName, error);
    return { success: false, error: "write_failed" };
  }
}

/** Result envelope for deleteTemplate. */
export type DeleteTemplateResult =
  | { success: true }
  | { success: false; error: string };

/**
 * Deletes a custom template by its ON-DISK fileName (sanitized — no
 * client paths). For a custom file this is the delete action; for a file
 * that shadows a built-in mode it is the restore-default equivalent
 * (removing the file makes the built-in prompt take effect again).
 * Idempotent: deleting a name with no file on disk is still a success.
 */
export function deleteTemplate(
  deps: TemplatesServiceDeps,
  fileName: string,
): DeleteTemplateResult {
  const sanitized = sanitizeTemplateFileName(fileName);
  if (!sanitized.valid) return { success: false, error: sanitized.error };
  try {
    const filePath = path.join(deps.templatesDir, sanitized.fileName);
    if (fs.existsSync(filePath)) fs.rmSync(filePath);
    return { success: true };
  } catch (error) {
    deps.logger?.warn?.("模板文件删除失败:", sanitized.fileName, error);
    return { success: false, error: "delete_failed" };
  }
}
