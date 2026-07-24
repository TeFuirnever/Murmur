// [20260724_TS_Migration_ExportFormatters] Migrated from .js to .ts (ADR-010 Phase 3).
// Provides TypeScript type declarations for exportFormatters.js.
// The implementation (docx document generation) lives in the .js file.

/** A transcription segment with timestamps. */
export interface TranscriptionSegment {
  start_ms: number;
  end_ms: number;
  text: string;
}

/** A transcription record for formatting. */
export interface TranscriptionForExport {
  text?: string;
  duration?: number;
  created_at?: string;
  source_file_path?: string;
  parsedSegments?: TranscriptionSegment[];
}

/** Format info for an export type. */
export interface FormatInfo {
  formatter: (
    transcription: TranscriptionForExport,
  ) => string | Promise<Buffer>;
  ext: string;
  mime: string;
}

// Re-export the runtime implementation from .js with typed wrappers.
const {
  formatTXT: _formatTXT,
  formatSRT: _formatSRT,
  formatVTT: _formatVTT,
  formatMD: _formatMD,
  formatDOCX: _formatDOCX,
  getFormatInfo: _getFormatInfo,
  smartMergeSrt: _smartMergeSrt,
} = require("./exportFormatters.js") as {
  formatTXT: (t: TranscriptionForExport) => string;
  formatSRT: (t: TranscriptionForExport) => string;
  formatVTT: (t: TranscriptionForExport) => string;
  formatMD: (t: TranscriptionForExport) => string;
  formatDOCX: (t: TranscriptionForExport) => Promise<Buffer>;
  getFormatInfo: (formatName: string) => FormatInfo | null;
  smartMergeSrt: (segments: TranscriptionSegment[]) => TranscriptionSegment[];
};

export function formatTXT(t: TranscriptionForExport): string {
  return _formatTXT(t);
}
export function formatSRT(t: TranscriptionForExport): string {
  return _formatSRT(t);
}
export function formatVTT(t: TranscriptionForExport): string {
  return _formatVTT(t);
}
export function formatMD(t: TranscriptionForExport): string {
  return _formatMD(t);
}
export function formatDOCX(t: TranscriptionForExport): Promise<Buffer> {
  return _formatDOCX(t);
}
export function getFormatInfo(formatName: string): FormatInfo | null {
  return _getFormatInfo(formatName);
}
export function smartMergeSrt(
  segments: TranscriptionSegment[],
): TranscriptionSegment[] {
  return _smartMergeSrt(segments);
}
