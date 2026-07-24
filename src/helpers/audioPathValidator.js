// [20260724_TS_Migration_AudioPathValidator] Source of truth is now .ts.
// This .js file is kept for require() compatibility during the gradual
// backend TS migration (ADR-010). The .ts version provides full type safety.
const path = require("path");
const os = require("os");
const C = require("./ipc-contracts");

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
