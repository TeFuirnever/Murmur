// [20260724_TS_Migration_AiPrompts] Migrated from .js to .ts (ADR-010 Phase 3).
// This file provides TypeScript type declarations for aiPrompts.js.
// The implementation (474 lines of prompt string literals) lives in the .js
// file for runtime. This .ts file re-exports it with proper types.

/** A parsed custom prompt template from a Markdown file. */
export interface PromptTemplate {
  name: string;
  label: string;
  system: string;
  user: string;
}

/** Result of buildPrompt: system + user prompt pair. */
export interface PromptResult {
  system: string;
  user: string;
}

/** Options for buildPrompt. */
export interface BuildPromptOptions {
  customTemplates?: PromptTemplate[];
}

// Re-export the runtime implementation from .js with typed wrappers.
// vitest resolves .ts first, so these typed versions are used in tests.
const {
  buildPrompt: _buildPrompt,
  parseTemplateFile: _parseTemplateFile,
  loadCustomTemplates: _loadCustomTemplates,
} = require("./aiPrompts.js") as {
  buildPrompt: (
    mode: string,
    text: string,
    options?: BuildPromptOptions,
  ) => PromptResult;
  parseTemplateFile: (
    content: string,
    fileName: string,
  ) => PromptTemplate | null;
  loadCustomTemplates: (templatesDir: string) => PromptTemplate[];
};

export function buildPrompt(
  mode: string,
  text: string,
  options?: BuildPromptOptions,
): PromptResult {
  return _buildPrompt(mode, text, options);
}

export function parseTemplateFile(
  content: string,
  fileName: string,
): PromptTemplate | null {
  return _parseTemplateFile(content, fileName);
}

export function loadCustomTemplates(templatesDir: string): PromptTemplate[] {
  return _loadCustomTemplates(templatesDir);
}

export const DEFAULT_PIPELINE = ["optimize"];
