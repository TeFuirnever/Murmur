// [20260724_TS_BigBang_AudioPathValidator] Migrated from .js to .ts as part
// of backend TypeScript migration (ADR-010). Pure validation function.
// [20260724_TS_BigBang_IpcContractsImport] ipc-contracts now uses named
// exports, so use a namespace import (`import * as C`) to preserve `C.AI`
// access semantics for both esbuild CJS output and vitest.
import path from "path";
import os from "os";
import fs from "fs";
import * as C from "./ipc-contracts";
// [20260724_TS_BigBang_IpcContractsImport] END

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
  // UNC paths (\\server\share\...) are never under the allowed roots.
  // Reject before any fs.* call — realpathSync on non-existent UNC hosts
  // triggers multi-second network timeouts (Windows).
  if (process.platform === "win32" && filePath.startsWith("\\\\")) {
    return { valid: false, error: "路径不在允许范围内" };
  }
  const resolved = path.resolve(filePath);
  // [20260725_Fix_SymlinkEscape] path.resolve() does NOT resolve symlinks,
  // so an attacker could plant a symlink inside an allowed directory that
  // points outside the sandbox (e.g. /etc/passwd.wav). Resolve the real path
  // via fs.realpathSync and run the allowed-directory check against the
  // canonicalized path. Also canonicalize the allowed roots, because on macOS
  // os.tmpdir() returns "/var/folders/..." while its real path is
  // "/private/var/folders/..." — comparing realPath against the raw tmpdir
  // string would over-reject legitimate temp files.
  //
  // Two cases:
  //  - Path EXISTS on disk (including a symlink whose target exists) → MUST
  //    canonicalize via realpathSync before the allowed check. A symlink
  //    escape only matters when the target exists (otherwise there's nothing
  //    for callers to read), so this is the security-critical branch. If
  //    realpathSync fails here (e.g. permission denied), reject rather than
  //    fall back to the unsafe prefix check.
  //  - Path does NOT exist → cannot be a symlink escape (no link target to
  //    read). Fall back to the legacy prefix check on `resolved` so callers
  //    that pre-validate a destination path (e.g. /Volumes/External on a
  //    machine with nothing mounted there, or a Windows path under WINE) are
  //    still accepted.
  let realPath: string | null = null;
  let pathExists = false;
  try {
    // fs.existsSync resolves symlinks themselves; a symlink whose target is
    // missing returns false here, which routes us to the safe fallback
    // branch (no escape possible because nothing is readable).
    pathExists = fs.existsSync(resolved);
  } catch {
    pathExists = false;
  }
  if (pathExists) {
    try {
      realPath = fs.realpathSync(resolved);
    } catch {
      return { valid: false, error: "路径不在允许范围内" };
    }
  }
  const homedir = os.homedir();
  const tmpdir = os.tmpdir();
  const isAllowed = isPathAllowed(realPath ?? resolved, homedir, tmpdir);
  if (!isAllowed) {
    return { valid: false, error: "路径不在允许范围内" };
  }
  // Keep the original resolved path for callers (they expect the path they
  // submitted, not the realpath the link points at). Security was enforced
  // above via realPath.
  return { valid: true, ext, resolved };
}

/**
 * Decide whether `candidate` is inside one of the allowed root prefixes.
 *
 * Both `candidate` and each root are normalized so prefix comparison is
 * consistent across macOS's `/var` ↔ `/private/var` symlink and across
 * trailing-separator differences:
 *  - Roots that exist on disk are canonicalized via realpathSync and given a
 *    trailing path.sep.
 *  - Roots that don't exist (e.g. "/Volumes/" with nothing mounted) are kept
 *    as-is with a trailing path.sep.
 *  - The candidate is canonicalized via realpathSync when it exists; when it
 *    does not exist (caller is pre-validating a destination), the longest
 *    existing ancestor directory is canonicalized and the remaining tail is
 *    re-joined. This keeps non-existent tmpdir/homedir files accepted even
 *    when their parent is a symlink (e.g. macOS /var → /private/var).
 */
function isPathAllowed(
  candidate: string,
  homedir: string,
  tmpdir: string,
): boolean {
  if (/^[A-Za-z]:\\/.test(candidate)) {
    return true;
  }
  const canonicalCandidate = canonicalizeCandidate(candidate);
  const roots = canonicalizeRoots([homedir, tmpdir, "/Volumes/"]);
  return roots.some(
    (root) =>
      canonicalCandidate === root || canonicalCandidate.startsWith(root),
  );
}

/**
 * Canonicalize a candidate path for prefix comparison. If the path exists,
 * realpathSync handles the full chain. If it does not, walk up to the nearest
 * existing ancestor, realpath that, and re-append the non-existent tail.
 * Falls back to the raw candidate if even the root cannot be stat'd.
 */
function canonicalizeCandidate(candidate: string): string {
  try {
    return fs.realpathSync(candidate);
  } catch {
    // candidate does not exist — walk up to the nearest existing ancestor.
    const segments = candidate.split(path.sep);
    let i = segments.length;
    let existingPrefix = candidate;
    while (i > 1) {
      i -= 1;
      const trial = segments.slice(0, i).join(path.sep) || path.sep;
      try {
        existingPrefix = fs.realpathSync(trial);
        const tail = segments.slice(i).join(path.sep);
        // Re-join with a separator so prefix checks against roots (which
        // also end in path.sep) behave naturally.
        const joined =
          existingPrefix.endsWith(path.sep) || tail.length === 0
            ? existingPrefix + tail
            : existingPrefix + path.sep + tail;
        return joined.endsWith(path.sep) ? joined : joined + path.sep;
      } catch {
        // keep walking up
      }
    }
    // Nothing exists on this branch; return raw candidate normalized with
    // trailing separator so prefix matching still works.
    return candidate.endsWith(path.sep) ? candidate : candidate + path.sep;
  }
}

/**
 * Canonicalize a list of allowed root prefixes by resolving symlinks on each
 * that exists on disk. Roots that don't exist (e.g. "/Volumes/" on a machine
 * with no mounted volumes) are kept as-is so a later mount still matches.
 * Trailing separators are normalized so prefix checks are unambiguous.
 */
function canonicalizeRoots(roots: string[]): string[] {
  const out: string[] = [];
  for (const root of roots) {
    try {
      const real = fs.realpathSync(root);
      out.push(real.endsWith(path.sep) ? real : real + path.sep);
    } catch {
      out.push(root.endsWith(path.sep) ? root : root + path.sep);
    }
  }
  return out;
}

export { validateAudioPath };
export type { AudioPathValid, AudioPathInvalid, AudioPathResult };
