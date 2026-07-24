// [20260724_TS_Migration_AudioFileHelpers] Type wrapper (ADR-010 Phase 4).
// Implementation stays in .js for runtime; this provides typed exports.

/** Minimal logger interface. */
interface Logger {
  info?(...args: unknown[]): void;
  debug?(...args: unknown[]): void;
  warn?(...args: unknown[]): void;
  error?(...args: unknown[]): void;
}

/** Supported audio blob input types. */
type AudioBlob = ArrayBuffer | Uint8Array | string | { buffer: ArrayBuffer };

const _impl = require("./audioFileHelpers.js") as {
  createTempAudioFile: (
    logger: Logger,
    audioBlob: AudioBlob,
  ) => Promise<string>;
  cleanupTempFile: (tempAudioPath: string) => Promise<void>;
  getFFmpegPath: () => string | null;
  _resetFFmpegCache: () => void;
  _setFFmpegDetector: (fn: () => string | null) => void;
  convertAudioFile: (logger: Logger, inputPath: string) => Promise<string>;
};

export const createTempAudioFile = _impl.createTempAudioFile;
export const cleanupTempFile = _impl.cleanupTempFile;
export const getFFmpegPath = _impl.getFFmpegPath;
export const convertAudioFile = _impl.convertAudioFile;
export const _resetFFmpegCache = _impl._resetFFmpegCache;
export const _setFFmpegDetector = _impl._setFFmpegDetector;
export type { Logger as AudioLogger, AudioBlob };
