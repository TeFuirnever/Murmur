// [20260926_Fix_399_DefaultModeOptions] Issue #399: the General tab's
// default_mode dropdown must expose every built-in polish mode, not only the
// handful its original markup hardcoded. Built-in mode names are mirrored
// from BUILT_IN_MODES in src/helpers/ipc/aiHandlers.ts — they cannot be
// derived at runtime because GET_MODES filters shadowed built-ins out of the
// merged list (a custom template named like a built-in IS the override, so
// the built-in entry disappears from the backend response while the mode
// itself stays valid).
//
// Single renderer-side source of truth, shared by GeneralSection (default
// mode dropdown baseline) and TemplatesSection (shadow detection +
// restore-default visibility), so the two tabs can never drift apart.
export const BUILT_IN_MODE_NAMES = [
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
