// [20260725_Fix_SymlinkEscape] TDD test for symlink escape prevention in
// audioPathValidator. path.resolve() does NOT follow symlinks, so an attacker
// can plant a symlink inside an allowed directory that points outside the
// sandbox (e.g. /etc/passwd.wav). The validator must resolve the real path
// via fs.realpathSync before the allowed-directory check.
// [20260726_Tier32_AudioPathValidatorSymlink] Tier 3.2: converted the in-test
// require() of audioPathValidator to a top-level ESM namespace import. The
// require was called inside an it() body with no vi.mock / vi.resetModules,
// so hoisting to a static import is behavior-preserving.
// [20260726_Tier32_AudioPathValidatorSymlink] END
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import * as audioPathValidator from "../../src/helpers/audioPathValidator";

describe("audioPathValidator — symlink escape prevention", () => {
  let tmpDir: string;
  let outsideTmp: string;
  let symlinkPath: string;

  beforeEach(() => {
    // tmpDir lives INSIDE os.tmpdir() (an allowed directory).
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-symlink-test-"));
    // outsideTmp lives under a writable path whose REAL path is genuinely
    // outside the canonical allowed set (homedir + realpath(tmpdir)). On
    // macOS, os.tmpdir() returns "/var/folders/..." (realpath
    // "/private/var/folders/...") while "/var/tmp" has realpath
    // "/private/var/tmp" — a different subtree. On Linux/CI the path may
    // already be canonical; the test still passes because realpath resolves
    // both sides consistently.
    // /var/tmp is Unix-only. On Windows the test is skipped (see it.skipIf
    // below) — symlinks require elevated permissions and /var/tmp is absent.
    if (process.platform === "win32") return;
    outsideTmp = fs.mkdtempSync("/var/tmp/murmur-outside-");
    const targetFile = path.join(outsideTmp, "secret.wav");
    fs.writeFileSync(targetFile, "secret");
    // Symlink INSIDE tmpDir pointing to the outside target. Before the fix,
    // path.resolve() leaves the link unresolved and the validator accepts it.
    symlinkPath = path.join(tmpDir, "escape.wav");
    fs.symlinkSync(targetFile, symlinkPath);
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    try {
      fs.rmSync(outsideTmp, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it.skipIf(process.platform === "win32")(
    "rejects symlink that escapes allowed directories",
    () => {
      // Sanity: the fixture's realpath really is outside the allowed set on
      // this host. If a CI environment mounts /var/tmp inside the same real
      // root as os.tmpdir(), this test cannot exercise escape semantics and we
      // skip rather than give a false negative.
      const realPath = fs.realpathSync(symlinkPath);
      const tmpdir = fs.realpathSync(os.tmpdir());
      const homedir = fs.realpathSync(os.homedir());
      const realPathAllowed =
        realPath.startsWith(homedir) ||
        realPath.startsWith(tmpdir) ||
        realPath.startsWith("/Volumes/") ||
        /^[A-Za-z]:\\/.test(realPath);
      if (realPathAllowed) {
        // Host environment collapses the escape; nothing meaningful to assert.
        return;
      }

      const { validateAudioPath } = audioPathValidator;
      const result = validateAudioPath(symlinkPath);

      // The symlink's real path escapes the allowed set — must be rejected.
      expect(result.valid).toBe(false);
    },
  );
});
