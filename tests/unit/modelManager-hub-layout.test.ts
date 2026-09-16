// [20260911_Fix_336_HubLayout] Regression tests for issue #336: modelscope
// 1.39 downloads into ~/.cache/modelscope/models/damo--<repo>/snapshots/<rev>/
// (no `hub` layer, repo dirs renamed `damo--<name>`, extra snapshots level),
// which getModelCachePath()/checkModelFiles() could not see — Node's check
// passed or failed on a DIFFERENT directory than the Python readiness gate,
// which is exactly the flapping 已加载/下载中 UI from the issue.
//
// Contract under test:
//   * getModelCachePath() resolves the 1.39 no-hub modelscope root when it
//     holds damo--<repo> repos, and still prefers a populated userData
//     models dir (upgrading users / the symlink workaround).
//   * _resolveRepoDir() maps a repo name to the direct legacy dir or the
//     first ready damo--<repo>/snapshots/<rev> dir (marker-checked).
//   * checkModelFiles() passes end-to-end when the models exist ONLY in the
//     1.39 hub layout — agreeing with the Python gate.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import ModelManager from "../../src/helpers/modelManager";

const SEACO_REPO =
  "speech_seaco_paraformer_large_asr_nat-zh-cn-16k-common-vocab8404-pytorch";
const FALLBACK_REPO =
  "speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch";
const VAD_REPO = "speech_fsmn_vad_zh-cn-16k-common-pytorch";
const PUNC_REPO = "punc_ct-transformer_zh-cn-common-vocab272727-pytorch";
const PINNED_REVISION = "v2.0.4";

function makeManager(): ModelManager {
  return new ModelManager({
    info: () => {},
    warn: () => {},
    error: () => {},
  });
}

/** Build <hubRoot>/damo--<repo>/snapshots/<rev>/<marker> (1.39 layout). */
function materializeHubRepo(
  hubRoot: string,
  repo: string,
  revision = PINNED_REVISION,
  marker = "model.pt",
): string {
  const snapshotDir = path.join(
    hubRoot,
    `damo--${repo}`,
    "snapshots",
    revision,
  );
  fs.mkdirSync(snapshotDir, { recursive: true });
  fs.writeFileSync(path.join(snapshotDir, marker), "x");
  return snapshotDir;
}

describe("[20260911_Fix_336_HubLayout] modelscope 1.39 hub layout", () => {
  let tmpDir: string;
  let fakeHome: string;
  let fakeUserData: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mm-hub-"));
    fakeHome = path.join(tmpDir, "home");
    // The electron require fails under vitest, so userDataPath falls back to
    // os.tmpdir(); spy tmpdir to keep userData/models deterministic+empty.
    fakeUserData = path.join(tmpDir, "userdata");
    fs.mkdirSync(fakeHome, { recursive: true });
    fs.mkdirSync(fakeUserData, { recursive: true });
    vi.spyOn(os, "homedir").mockReturnValue(fakeHome);
    vi.spyOn(os, "tmpdir").mockReturnValue(fakeUserData);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function hubRoot(): string {
    return path.join(fakeHome, ".cache", "modelscope", "models");
  }

  describe("getModelCachePath", () => {
    it("resolves the 1.39 no-hub modelscope root holding damo-- repos", () => {
      materializeHubRepo(hubRoot(), SEACO_REPO);
      const m = makeManager();
      expect(m.getModelCachePath()).toBe(hubRoot());
    });

    it("still prefers a populated userData models dir (upgrading users)", () => {
      const userDataModels = path.join(fakeUserData, "models");
      fs.mkdirSync(path.join(userDataModels, SEACO_REPO), { recursive: true });
      materializeHubRepo(hubRoot(), SEACO_REPO);
      const m = makeManager();
      expect(m.getModelCachePath()).toBe(userDataModels);
    });

    it("ignores a hub root whose damo-- dirs match no known model", () => {
      materializeHubRepo(hubRoot(), "unrelated_model");
      const m = makeManager();
      // Falls through to the userData fallback (created on demand).
      expect(m.getModelCachePath()).toBe(path.join(fakeUserData, "models"));
    });
  });

  describe("_resolveRepoDir", () => {
    it("returns the direct legacy dir when present", () => {
      const direct = path.join(tmpDir, SEACO_REPO);
      fs.mkdirSync(direct, { recursive: true });
      const m = makeManager();
      expect(m._resolveRepoDir(tmpDir, SEACO_REPO)).toBe(direct);
    });

    it("returns the ready snapshot dir for the hub layout", () => {
      const expected = materializeHubRepo(tmpDir, SEACO_REPO);
      const m = makeManager();
      expect(m._resolveRepoDir(tmpDir, SEACO_REPO)).toBe(expected);
    });

    it("skips snapshot dirs without a marker file", () => {
      materializeHubRepo(tmpDir, SEACO_REPO, PINNED_REVISION, "notes.txt");
      const m = makeManager();
      expect(m._resolveRepoDir(tmpDir, SEACO_REPO)).toBeNull();
    });

    it("prefers the pinned revision over other ready snapshots", () => {
      materializeHubRepo(tmpDir, SEACO_REPO, "v9.9.9");
      const pinned = materializeHubRepo(tmpDir, SEACO_REPO, PINNED_REVISION);
      const m = makeManager();
      expect(m._resolveRepoDir(tmpDir, SEACO_REPO)).toBe(pinned);
    });

    it("returns null when the repo is nowhere on disk", () => {
      const m = makeManager();
      expect(m._resolveRepoDir(tmpDir, SEACO_REPO)).toBeNull();
    });
  });

  describe("checkModelFiles", () => {
    it("passes when models exist ONLY in the 1.39 hub layout", async () => {
      // THE #336 SCENARIO: nothing under userData/models; every repo lives
      // in ~/.cache/modelscope/models/damo--<repo>/snapshots/v2.0.4/.
      for (const repo of [SEACO_REPO, VAD_REPO, PUNC_REPO]) {
        materializeHubRepo(hubRoot(), repo);
      }
      const m = makeManager();
      m.clearCache();
      const r = await m.checkModelFiles();
      expect(r.cache_path).toBe(hubRoot());
      expect(r.models_downloaded).toBe(true);
      expect(r.minimum_ready).toBe(true);
      expect(r.missing_models).toEqual([]);
    });

    it("counts a hub-layout fallback ASR as ready while flagging the upgrade", async () => {
      materializeHubRepo(hubRoot(), FALLBACK_REPO);
      materializeHubRepo(hubRoot(), VAD_REPO);
      materializeHubRepo(hubRoot(), PUNC_REPO);
      const m = makeManager();
      m.clearCache();
      const r = await m.checkModelFiles();
      expect(r.minimum_ready).toBe(true);
      expect(r.models_downloaded).toBe(false);
      expect(r.missing_models).toEqual(["asr"]);
      expect(r.model_details!.asr!.downloaded).toBe(true);
    });

    it("reports missing when the hub snapshots hold no marker files", async () => {
      materializeHubRepo(hubRoot(), SEACO_REPO, PINNED_REVISION, "notes.txt");
      const m = makeManager();
      m.clearCache();
      const r = await m.checkModelFiles();
      expect(r.models_downloaded).toBe(false);
      expect(r.missing_models).toContain("asr");
    });
  });
});
