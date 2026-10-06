// [20261006_T12_LegacyCacheCleanup] Ticket #425 (spec #412 decision 11 /
// user story 19): one version cycle after the ONNX cutover shipped the old
// torch models as the rollback path, the N+1 release reclaims them from
// disk. The deletion manifest MUST come from a parser that covers every
// on-disk layout generation the app ever downloaded into (the #216/#255/
// #336 lineage), and MUST only ever name Murmur's own repo directories —
// the modelscope cache is SHARED with other tools, so a sibling model dir
// belonging to someone else must survive untouched.
//
// Contract under test:
//   * collectLegacyTorchCacheDirs() enumerates exactly Murmur's torch repo
//     dirs across all layout generations (legacy damo layers, the >=1.19
//     `models` layer, the 1.39 hub shape `damo--<repo>/snapshots/<rev>`,
//     the explicit <userData>/models root, and $MODELSCOPE_CACHE variants).
//   * cleanupLegacyTorchCaches() deletes each manifest entry, logs what and
//     how big, keeps going (and reports) on per-entry failure, never throws.
//   * Parity: the enumerated root set is a SUPERSET of the authoritative
//     Python resolver's probe sets (funasr_server.py _default_damo_root /
//     _hub_models_roots) — deletion must see at least every place the
//     server could ever have resolved a torch repo.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  LEGACY_TORCH_REPO_NAMES,
  collectLegacyTorchCacheDirs,
  cleanupLegacyTorchCaches,
  enumerateLegacyTorchCacheRoots,
} from "../../src/helpers/legacyModelCleanup";
import ModelManager from "../../src/helpers/modelManager";

const PY_SERVER_PATH = path.resolve(__dirname, "../../funasr_server.py");

const SEACO_REPO =
  "speech_seaco_paraformer_large_asr_nat-zh-cn-16k-common-vocab8404-pytorch";
const FALLBACK_REPO =
  "speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch";
const VAD_REPO = "speech_fsmn_vad_zh-cn-16k-common-pytorch";
const PUNC_REPO = "punc_ct-transformer_zh-cn-common-vocab272727-pytorch";
const CAMPPLUS_REPO = "speech_campplus_sv_zh-cn_16k-common";
const REVISION = "v2.0.4";

/** Create a dir holding one payload file; returns the dir path. */
function dirWithPayload(dir: string, payload = "x"): string {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "model.pt"), payload);
  return dir;
}

/** Materialize a 1.39 hub-shape repo: <hubRoot>/damo--<repo>/snapshots/<rev>.
 * Returns the damo--<repo> dir — that is the deletion unit (the whole repo
 * cache incl. snapshots/blobs/refs), not the snapshot level. */
function materializeHubRepo(hubRoot: string, repo: string): string {
  dirWithPayload(path.join(hubRoot, `damo--${repo}`, "snapshots", REVISION));
  return path.join(hubRoot, `damo--${repo}`);
}

interface TestDeps {
  userDataModelsRoot: string;
  homeDir: string;
  modelscopeCacheRoot?: string | null;
}

function collectPaths(entries: { path: string }[]): string[] {
  return entries.map((e) => e.path).sort();
}

describe("[20261006_T12_LegacyCacheCleanup] repo-name manifest", () => {
  it("covers every torch-era repo the Node config knows (incl. the fallback ASR)", () => {
    const m = new ModelManager({
      info: () => {},
      warn: () => {},
      error: () => {},
    });
    const configured = Object.values(m.modelConfigs).flatMap((config) => [
      config.cache_path,
      ...(config.fallback_name ? [config.fallback_name.split("/")[1]!] : []),
    ]);
    for (const repo of configured) {
      expect(LEGACY_TORCH_REPO_NAMES).toContain(repo);
    }
    expect(configured).toContain(SEACO_REPO);
    expect(configured).toContain(FALLBACK_REPO);
  });

  it("covers every repo the Python server resolves via _resolve_repo_dir literals", () => {
    const source = fs.readFileSync(PY_SERVER_PATH, "utf8");
    const resolved = [
      ...source.matchAll(/_resolve_repo_dir\("([^"]+)"\)/g),
    ].map((match) => match[1]!);
    expect(resolved.length).toBeGreaterThan(0);
    expect(resolved).toContain(CAMPPLUS_REPO);
    for (const repo of resolved) {
      expect(LEGACY_TORCH_REPO_NAMES).toContain(repo);
    }
  });

  it("contains no duplicates", () => {
    expect(new Set(LEGACY_TORCH_REPO_NAMES).size).toBe(
      LEGACY_TORCH_REPO_NAMES.length,
    );
  });
});

describe("[20261006_T12_LegacyCacheCleanup] root enumeration (Python parity)", () => {
  it("is a superset of the Python _default_damo_root damo-style layers", () => {
    const source = fs.readFileSync(PY_SERVER_PATH, "utf8");
    const newLayers = source.match(/new_layers = \(([^)]*)\)/);
    const legacyLayers = source.match(/legacy_layers = \(([^)]*)\)/);
    expect(newLayers).not.toBeNull();
    expect(legacyLayers).not.toBeNull();
    const layers = [newLayers![1]!, legacyLayers![1]!].flatMap((tuple) =>
      [...tuple.matchAll(/"([^"]*)"/g)].map((m) => m[1]!),
    );
    expect(layers).toContain("models/damo");
    expect(layers).toContain("damo");

    const homeCache = path.join("/home/tester", ".cache", "modelscope");
    const { damoStyleRoots } = enumerateLegacyTorchCacheRoots({
      homeDir: "/home/tester",
      modelscopeCacheRoot: "/mc",
      userDataModelsRoot: "/ud/models",
    });
    const rootPaths = damoStyleRoots.map((root) => root.path);
    for (const base of ["/mc", path.join(homeCache, "hub")]) {
      for (const layer of layers) {
        const expected = path.join(base, ...layer.split("/"));
        expect(rootPaths).toContain(expected);
      }
    }
  });

  it("is a superset of the Python _hub_models_roots hub-style roots", () => {
    const source = fs.readFileSync(PY_SERVER_PATH, "utf8");
    const start = source.indexOf("def _hub_models_roots");
    const end = source.indexOf("def _resolve_repo_dir");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = source.slice(start, end);
    // roots.append(os.path.join(<base>, "models")) — first arg is the base
    // variable, the remaining string literals are the relative layer.
    const layers = new Set(
      [...body.matchAll(/roots\.append\(os\.path\.join\(([^)]*)\)\)/g)].map(
        (m) =>
          m[1]!
            .split(",")
            .slice(1)
            .map((part) => part.trim().replaceAll('"', ""))
            .filter(Boolean)
            .join("/"),
      ),
    );
    expect(layers).toContain("models");
    expect(layers).toContain("hub/models");

    const { hubStyleRoots } = enumerateLegacyTorchCacheRoots({
      homeDir: "/home/tester",
      modelscopeCacheRoot: "/mc",
      userDataModelsRoot: "/ud/models",
    });
    const rootPaths = hubStyleRoots.map((root) => root.path);
    for (const base of [
      "/mc",
      path.join("/home/tester", ".cache", "modelscope"),
    ]) {
      for (const layer of layers) {
        if (!layer) continue;
        expect(rootPaths).toContain(path.join(base, ...layer.split("/")));
      }
    }
  });

  it("probes the explicit userData root in both shapes plus its damo layer", () => {
    // Build the dep with path.join so the verbatim-add contract is asserted
    // in native separators on every platform (a literal "/ud/models" keeps
    // POSIX separators on Windows and can never equal path.join output).
    const userDataModels = path.join("/ud", "models");
    const { damoStyleRoots, hubStyleRoots } = enumerateLegacyTorchCacheRoots({
      homeDir: "/home/tester",
      userDataModelsRoot: userDataModels,
    });
    const damoPaths = damoStyleRoots.map((root) => root.path);
    const hubPaths = hubStyleRoots.map((root) => root.path);
    expect(damoPaths).toContain(userDataModels);
    expect(damoPaths).toContain(path.join(userDataModels, "damo"));
    expect(hubPaths).toContain(userDataModels);
  });

  it("skips env/userData groups when the dep is absent", () => {
    const roots = enumerateLegacyTorchCacheRoots({ homeDir: "/home/tester" });
    const allPaths = [...roots.damoStyleRoots, ...roots.hubStyleRoots].map(
      (root) => root.path,
    );
    // path.join normalizes the prefix into the platform's separators, so
    // the startsWith holds on Windows (backslashes) too.
    const homePrefix = path.join("/home/tester");
    expect(allPaths.every((p) => p.startsWith(homePrefix))).toBe(true);
  });
});

describe("[20261006_T12_LegacyCacheCleanup] layout-generation parser", () => {
  let tmpDir: string;
  let homeDir: string;
  let userDataModels: string;
  let deps: TestDeps;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "legacy-clean-"));
    homeDir = path.join(tmpDir, "home");
    userDataModels = path.join(tmpDir, "userdata", "models");
    fs.mkdirSync(homeDir, { recursive: true });
    deps = { homeDir, userDataModelsRoot: userDataModels };
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("G1: legacy repo dirs directly inside the explicit userData root", () => {
    const target = dirWithPayload(path.join(userDataModels, VAD_REPO));
    dirWithPayload(path.join(userDataModels, "someone-elses-model"));
    expect(collectPaths(collectLegacyTorchCacheDirs(deps))).toEqual([target]);
  });

  it("G2: damo layer inside the explicit userData root", () => {
    const target = dirWithPayload(path.join(userDataModels, "damo", PUNC_REPO));
    dirWithPayload(path.join(userDataModels, "damo", "other-tool-model"));
    expect(collectPaths(collectLegacyTorchCacheDirs(deps))).toEqual([target]);
  });

  it("G3: hub shape inside the explicit userData root", () => {
    const target = materializeHubRepo(userDataModels, SEACO_REPO);
    materializeHubRepo(userDataModels, "other-tool-model");
    expect(collectPaths(collectLegacyTorchCacheDirs(deps))).toEqual([target]);
  });

  it("G4: pre-1.19 home defaults (hub/damo and hub/models/damo layers)", () => {
    const target1 = dirWithPayload(
      path.join(homeDir, ".cache", "modelscope", "hub", "damo", SEACO_REPO),
    );
    const target2 = dirWithPayload(
      path.join(
        homeDir,
        ".cache",
        "modelscope",
        "hub",
        "models",
        "damo",
        VAD_REPO,
      ),
    );
    dirWithPayload(
      path.join(homeDir, ".cache", "modelscope", "hub", "damo", "other"),
    );
    expect(collectPaths(collectLegacyTorchCacheDirs(deps))).toEqual(
      [target1, target2].sort(),
    );
  });

  it("G5: modelscope 1.39 home layout (the #336 generation)", () => {
    const target = materializeHubRepo(
      path.join(homeDir, ".cache", "modelscope", "models"),
      SEACO_REPO,
    );
    materializeHubRepo(
      path.join(homeDir, ".cache", "modelscope", "models"),
      "other-tool-model",
    );
    expect(collectPaths(collectLegacyTorchCacheDirs(deps))).toEqual([target]);
  });

  it("G6: modelscope 1.39 with legacy hub layer", () => {
    const target = materializeHubRepo(
      path.join(homeDir, ".cache", "modelscope", "hub", "models"),
      VAD_REPO,
    );
    expect(collectPaths(collectLegacyTorchCacheDirs(deps))).toEqual([target]);
  });

  it("G7: all four $MODELSCOPE_CACHE damo-style layers", () => {
    const mc = path.join(tmpDir, "mc");
    deps.modelscopeCacheRoot = mc;
    const targets = [
      dirWithPayload(path.join(mc, "models", "damo", SEACO_REPO)),
      dirWithPayload(path.join(mc, "hub", "models", "damo", VAD_REPO)),
      dirWithPayload(path.join(mc, "damo", PUNC_REPO)),
      dirWithPayload(path.join(mc, "hub", "damo", FALLBACK_REPO)),
    ];
    expect(collectPaths(collectLegacyTorchCacheDirs(deps))).toEqual(
      targets.sort(),
    );
  });

  it("G8: $MODELSCOPE_CACHE hub shapes (with and without the hub layer)", () => {
    const mc = path.join(tmpDir, "mc");
    deps.modelscopeCacheRoot = mc;
    const target1 = materializeHubRepo(path.join(mc, "models"), PUNC_REPO);
    const target2 = materializeHubRepo(
      path.join(mc, "hub", "models"),
      SEACO_REPO,
    );
    expect(collectPaths(collectLegacyTorchCacheDirs(deps))).toEqual(
      [target1, target2].sort(),
    );
  });

  it("finds all five torch-era repos in one cache (complete generation)", () => {
    const modelsRoot = path.join(homeDir, ".cache", "modelscope", "models");
    const targets = [
      SEACO_REPO,
      FALLBACK_REPO,
      VAD_REPO,
      PUNC_REPO,
      CAMPPLUS_REPO,
    ].map((repo) => materializeHubRepo(modelsRoot, repo));
    expect(collectPaths(collectLegacyTorchCacheDirs(deps))).toEqual(
      targets.sort(),
    );
  });

  it("returns an empty manifest when nothing exists", () => {
    expect(collectLegacyTorchCacheDirs(deps)).toEqual([]);
    expect(
      collectLegacyTorchCacheDirs({
        homeDir: path.join(tmpDir, "void"),
        userDataModelsRoot: null,
      }),
    ).toEqual([]);
  });

  it("ignores similarly-prefixed sibling names (exact repo-name match only)", () => {
    dirWithPayload(path.join(userDataModels, `${VAD_REPO}-backup`));
    dirWithPayload(path.join(userDataModels, `${VAD_REPO}_old`));
    dirWithPayload(path.join(userDataModels, `damo--${PUNC_REPO}.partial`));
    dirWithPayload(path.join(userDataModels, SEACO_REPO.slice(0, 20)));
    expect(collectLegacyTorchCacheDirs(deps)).toEqual([]);
  });
});

describe("[20261006_T12_LegacyCacheCleanup] deletion executor", () => {
  let tmpDir: string;
  let homeDir: string;
  let userDataModels: string;
  let deps: TestDeps;
  function makeLogger() {
    return { info: vi.fn(), warn: vi.fn(), debug: vi.fn() };
  }
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "legacy-clean-exec-"));
    homeDir = path.join(tmpDir, "home");
    userDataModels = path.join(tmpDir, "userdata", "models");
    fs.mkdirSync(homeDir, { recursive: true });
    deps = { homeDir, userDataModelsRoot: userDataModels };
    logger = makeLogger();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("deletes every manifest entry and logs path + reclaimed bytes", async () => {
    const target1 = dirWithPayload(
      path.join(userDataModels, VAD_REPO),
      "12345",
    );
    const target2 = materializeHubRepo(userDataModels, PUNC_REPO);
    fs.appendFileSync(path.join(target2, "tokens.json"), "1234567");
    fs.mkdirSync(path.join(target2, "nested"), { recursive: true });
    fs.writeFileSync(path.join(target2, "nested", "b.bin"), "123");

    const summary = await cleanupLegacyTorchCaches({ ...deps, logger });

    expect(fs.existsSync(target1)).toBe(false);
    expect(fs.existsSync(target2)).toBe(false);
    expect(collectPaths(summary.deleted)).toEqual([target1, target2].sort());
    expect(summary.failed).toEqual([]);
    // target1 = one 5-byte model.pt; target2 = 1-byte marker + 7-byte
    // tokens.json + 3-byte nested/b.bin.
    const byPath = new Map(summary.deleted.map((d) => [d.path, d.bytes]));
    expect(byPath.get(target1)).toBe(5);
    expect(byPath.get(target2)).toBe(7 + 3 + 1);
    // Per-entry log lines carry what was deleted and how big it was.
    const deletionLogs = logger.info.mock.calls
      .map((call) => String(call.join(" ")))
      .filter((line) => line.includes(target1) || line.includes(target2));
    expect(deletionLogs.length).toBeGreaterThanOrEqual(2);
    const target1Log = deletionLogs.find((line) => line.includes(target1));
    expect(target1Log).toContain("释放 5 字节");
  });

  it("never touches foreign models sharing the same cache root", async () => {
    const foreignHub = materializeHubRepo(userDataModels, "other-tool-model");
    const foreignPlain = dirWithPayload(
      path.join(userDataModels, "someone-elses-model"),
      "precious",
    );
    dirWithPayload(path.join(userDataModels, VAD_REPO));

    await cleanupLegacyTorchCaches({ ...deps, logger });

    expect(fs.existsSync(foreignHub)).toBe(true);
    expect(fs.existsSync(foreignPlain)).toBe(true);
    expect(fs.readFileSync(path.join(foreignPlain, "model.pt"), "utf8")).toBe(
      "precious",
    );
  });

  it("deletes a symlinked repo entry without following the link", async () => {
    if (process.platform === "win32") {
      // Creating dir symlinks on Windows needs privileges; the guard is
      // Unix-only behavior by design.
      return;
    }
    const foreignTarget = dirWithPayload(
      path.join(homeDir, "unrelated", "precise-models"),
      "keep-me",
    );
    const linkPath = path.join(userDataModels, VAD_REPO);
    fs.mkdirSync(userDataModels, { recursive: true });
    fs.symlinkSync(foreignTarget, linkPath, "dir");

    await cleanupLegacyTorchCaches({ ...deps, logger });

    // The app-namespace link is gone; the pointed-at data is untouched.
    expect(fs.existsSync(linkPath)).toBe(false);
    expect(fs.existsSync(foreignTarget)).toBe(true);
    expect(fs.readFileSync(path.join(foreignTarget, "model.pt"), "utf8")).toBe(
      "keep-me",
    );
  });

  it("reports a symlink entry's reclaimed bytes as the link size, never the target's", async () => {
    // Review fix (T12): readdirSync walks THROUGH a top-level symlink, so
    // sizing the entry via a directory walk attributed the TARGET's bytes
    // (shared-cache data that is NOT reclaimed — possibly another tool's
    // model) to the deletion log. What is actually reclaimed is the link
    // inode itself.
    if (process.platform === "win32") {
      // Creating dir symlinks on Windows needs privileges; the guard is
      // Unix-only behavior by design.
      return;
    }
    const foreignTarget = dirWithPayload(
      path.join(homeDir, "unrelated", "huge-foreign-model"),
      "z".repeat(5000),
    );
    const linkPath = path.join(userDataModels, VAD_REPO);
    fs.mkdirSync(userDataModels, { recursive: true });
    fs.symlinkSync(foreignTarget, linkPath, "dir");
    const linkSize = fs.lstatSync(linkPath).size;
    expect(linkSize).toBeLessThan(5000);

    const summary = await cleanupLegacyTorchCaches({ ...deps, logger });

    const entry = summary.deleted.find((d) => d.path === linkPath);
    expect(entry).toBeDefined();
    expect(entry!.bytes).toBe(linkSize);
    const logLine = logger.info.mock.calls
      .map((call) => String(call.join(" ")))
      .find((line) => line.includes(linkPath));
    expect(logLine).toBeDefined();
    expect(logLine).toContain(`释放 ${linkSize} 字节`);
    expect(logLine).not.toContain("释放 5000 字节");
  });

  it("keeps going on per-entry failure, reports it, and never throws", async () => {
    if (process.platform === "win32") {
      // POSIX permission bits are the failure injection; Unix-only.
      return;
    }
    const locked = dirWithPayload(path.join(userDataModels, VAD_REPO));
    const deletable = dirWithPayload(path.join(userDataModels, PUNC_REPO));
    fs.chmodSync(locked, 0o500);
    try {
      const summary = await cleanupLegacyTorchCaches({ ...deps, logger });
      expect(fs.existsSync(deletable)).toBe(false);
      expect(fs.existsSync(locked)).toBe(true);
      expect(summary.failed).toHaveLength(1);
      expect(summary.failed[0]!.path).toBe(locked);
      expect(summary.failed[0]!.error).toBeTruthy();
      expect(logger.warn).toHaveBeenCalled();
    } finally {
      fs.chmodSync(locked, 0o700);
    }
  });

  it("works without a logger and on empty caches", async () => {
    const summary = await cleanupLegacyTorchCaches(deps);
    expect(summary.deleted).toEqual([]);
    expect(summary.failed).toEqual([]);
  });
});

describe("[20261006_T12_LegacyCacheCleanup] ModelManager.getUserDataModelsRoot", () => {
  it("returns <userData>/models (tmp fallback under vitest)", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "legacy-clean-mm-"));
    const spy = vi.spyOn(os, "tmpdir").mockReturnValue(tmp);
    try {
      const m = new ModelManager({
        info: () => {},
        warn: () => {},
        error: () => {},
      });
      expect(m.getUserDataModelsRoot()).toBe(path.join(tmp, "models"));
    } finally {
      spy.mockRestore();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
