// [20260816_Test_BranchPush] Branch-coverage tests for
// src/helpers/audioPathValidator.ts beyond the symlink-escape suite: UNC
// rejection on win32, drive-letter acceptance, relative-path resolution,
// empty/whitespace and extension filtering, the non-existent-ancestor
// canonicalization walk, and the realpathSync-failure fallbacks.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { validateAudioPath } from "../../src/helpers/audioPathValidator";

const ORIG_PLATFORM = process.platform;

function setPlatform(platform: string): void {
  Object.defineProperty(process, "platform", {
    value: platform,
    configurable: true,
    writable: true,
  });
}

describe("[20260816_Test_BranchPush] audioPathValidator branch coverage", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-apv-branch-"));
  });

  afterEach(() => {
    setPlatform(ORIG_PLATFORM);
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("rejects UNC paths on win32 before any fs call", () => {
    setPlatform("win32");
    const result = validateAudioPath("\\\\server\\share\\audio.wav");
    expect(result).toEqual({ valid: false, error: "路径不在允许范围内" });
  });

  it("accepts a windows drive-letter real path", () => {
    // realpathSync is stubbed to yield a C:\ path, exercising isPathAllowed's
    // drive-letter fast-accept branch.
    const target = path.join(tmpDir, "audio.wav");
    fs.writeFileSync(target, "x");
    const spy = vi
      .spyOn(fs, "realpathSync")
      .mockReturnValue("C:\\Users\\user\\audio.wav");
    const result = validateAudioPath(target);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.ext).toBe(".wav");
      expect(result.resolved).toBe(target);
    }
    expect(spy).toHaveBeenCalled();
  });

  it("resolves a relative path against the cwd and accepts it under tmpdir", () => {
    const origCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      // process.chdir canonicalizes (macOS /var -> /private/var), so compare
      // against the post-chdir cwd — exactly what path.resolve() uses.
      const result = validateAudioPath("audio.wav");
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.resolved).toBe(path.join(process.cwd(), "audio.wav"));
      }
    } finally {
      process.chdir(origCwd);
    }
  });

  it("rejects empty and whitespace-only paths", () => {
    expect(validateAudioPath("")).toEqual({
      valid: false,
      error: "不支持的音频格式: ",
    });
    expect(validateAudioPath("   ")).toEqual({
      valid: false,
      error: "不支持的音频格式: ",
    });
  });

  it("rejects a disallowed extension but accepts an uppercase one", () => {
    expect(validateAudioPath(path.join(tmpDir, "notes.txt")).valid).toBe(false);
    const upper = validateAudioPath(path.join(tmpDir, "REC.WAV"));
    expect(upper.valid).toBe(true);
    if (upper.valid) {
      expect(upper.ext).toBe(".wav");
    }
  });

  it("rejects an absolute path outside every allowed root", () => {
    const result = validateAudioPath("/etc/passwd.wav");
    expect(result.valid).toBe(false);
  });

  it("walks up to the filesystem root when no ancestor exists", () => {
    // Every component is non-existent, so the canonicalization loop falls
    // back to "/" as the first existing ancestor and the prefix join takes
    // the trailing-separator arm.
    const result = validateAudioPath("/definitely-not-here-xyz/sub/audio.wav");
    expect(result.valid).toBe(false);
  });

  it("falls back to raw-prefix comparison when realpathSync always fails", () => {
    const spy = vi.spyOn(fs, "realpathSync").mockImplementation(() => {
      throw new Error("EIO");
    });
    // Existing file + failing realpath must be rejected outright...
    const existing = path.join(tmpDir, "real.wav");
    fs.writeFileSync(existing, "x");
    expect(validateAudioPath(existing).valid).toBe(false);
    // ...while a NON-existent file skips realpath in validateAudioPath and
    // matches the raw tmpdir prefix inside the canonicalization fallback.
    const missing = validateAudioPath(path.join(tmpDir, "nope.wav"));
    expect(missing.valid).toBe(true);
    if (missing.valid) {
      expect(missing.resolved).toBe(path.join(tmpDir, "nope.wav"));
    }
    expect(spy).toHaveBeenCalled();
  });

  it("keeps trailing separators on canonical roots via identity realpath", () => {
    // realpathSync returns its input unchanged: "/Volumes/" already ends in a
    // separator (canonicalizeRoots true arm) while homedir gets one appended.
    vi.spyOn(fs, "realpathSync").mockImplementation((p: fs.PathLike) =>
      String(p),
    );
    const target = path.join(tmpDir, "audio.wav");
    fs.writeFileSync(target, "x");
    const result = validateAudioPath(target);
    expect(result.valid).toBe(true);
  });
});
