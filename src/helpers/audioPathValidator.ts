// [20260724_TS_Migration_AudioPathValidator] Migrated from .js to .ts as part
// of backend TypeScript migration (ADR-010). Pure validation function.
import path from "path";
import os from "os";
import C from "./ipc-contracts.js";

/** Successful validation result. */
interface AudioPathValid {
  valid: true;
  ext: string;
  resolved: string;
}

/** Failed validation result. */
interface AudioPathInvalid {
  valid: false;
  error: string;
}

type AudioPathResult = AudioPathValid | AudioPathInvalid;

/**
 * Validate that an audio file path has a supported extension
 * and is within an allowed directory.
 */
function validateAudioPath(filePath: string): AudioPathResult {
  const allowedExts: readonly string[] = C.AUDIO_EXTENSIONS;
  const ext = path.extname(filePath).toLowerCase();
  if (!allowedExts.includes(ext)) {
    return { valid: false, error: "不支持的音频格式: " + ext };
  }
  const resolved = path.resolve(filePath);
  const homedir = os.homedir();
  const tmpdir = os.tmpdir();
  if (
    !resolved.startsWith(homedir) &&
    !resolved.startsWith(tmpdir) &&
    !resolved.startsWith("/Volumes/") &&
    !/^[A-Za-z]:\\/.test(resolved)
  ) {
    return { valid: false, error: "路径不在允许范围内" };
  }
  return { valid: true, ext, resolved };
}

export { validateAudioPath };
export type { AudioPathValid, AudioPathInvalid, AudioPathResult };
