const path = require("path");
const os = require("os");
const C = require("./ipc-contracts");

/**
 * Validate that an audio file path has a supported extension
 * and is within an allowed directory.
 *
 * @param {string} filePath - Absolute or relative path to the audio file
 * @returns {{ valid: true, ext: string, resolved: string } | { valid: false, error: string }}
 */
function validateAudioPath(filePath) {
  const allowedExts = C.AUDIO_EXTENSIONS;
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

module.exports = { validateAudioPath };
