// [20261001_T5_ModelDownloaderV2] Ticket #417 (spec #412 T5, S2 download seam):
// unit contract for the v2 model downloader client. The trust chain it
// serves: dual-source fetch (ModelScope primary → own GitHub-Release mirror
// backup → OSS placeholder) with automatic failover, byte-range resume that
// survives a source switch, ONE-SHOT whole-manifest sha256 verification after
// assembly (no skip-hash-on-retry branch may exist), commit-SHA-pinned
// records, and exact-filename readiness anchors (no wildcards, temp download
// names excluded on both sides of the name).
//
// The network is fully injected (HttpFetch) — no test touches the real
// internet. Source URLs are obtained through buildFileSources() so the tests
// never duplicate URL construction.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";

import {
  AllSourcesFailedError,
  ManifestVerificationError,
  ModelPinError,
  MODELSCOPE_MIRROR_REPO_ID,
  MODELSCOPE_RESOLVE_BASE,
  PARTIAL_SUFFIX,
  buildFileSources,
  downloadOnnxModelSet,
  getOssMirrorBaseUrl,
  hasOnnxMarker,
  isOnnxModelDirReady,
  isTempDownloadName,
  loadModelPin,
  readinessProblems,
  verifyManifestDir,
} from "../../src/helpers/modelDownloader";
import type {
  DownloadProgress,
  HttpFetch,
  ModelPin,
  PinFileEntry,
  PinModelEntry,
} from "../../src/helpers/modelDownloader";

const SHA256_RE = /^[0-9a-f]{64}$/;
const COMMIT_RE = /^[0-9a-f]{40}$/;

function sha256(content: Uint8Array): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  let sent = false;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!sent) {
        controller.enqueue(bytes);
        sent = true;
      } else {
        controller.close();
      }
    },
  });
}

type Responder = (
  url: string,
  headers: Record<string, string>,
) => { status: number; body?: ReadableStream<Uint8Array> };

interface FetchRecorder extends HttpFetch {
  calls: Array<{ url: string; headers: Record<string, string> }>;
}

/** Route-table fetch double. Routes map URL → responder; unmatched URLs are
 * connection failures (the "network unreachable" case for a source). */
function makeFetch(routes: Record<string, Responder>): FetchRecorder {
  const recorder = ((
    url: string,
    init?: { headers?: Record<string, string> },
  ) => {
    recorder.calls.push({ url, headers: init?.headers ?? {} });
    const responder = routes[url];
    if (!responder) {
      return Promise.reject(new Error(`connection failed: ${url}`));
    }
    return Promise.resolve(responder(url, init?.headers ?? {}));
  }) as FetchRecorder;
  recorder.calls = [];
  return recorder;
}

/** Honors byte-range resume like a real static file server. */
function byteServer(content: Uint8Array): Responder {
  return (_url, headers) => {
    const range = headers["Range"];
    if (range) {
      const match = /^bytes=(\d+)-$/.exec(range);
      if (match && match[1] !== undefined) {
        const start = Number(match[1]);
        if (start < content.length) {
          return { status: 206, body: streamOf(content.subarray(start)) };
        }
        return { status: 416 };
      }
    }
    return { status: 200, body: streamOf(content) };
  };
}

function statusServer(status: number): Responder {
  return () => ({ status });
}

// --- fixture pin -----------------------------------------------------------

const MIRROR_BASE = "https://gh-mirror.test/download/models-test-1/";

interface Fixture {
  pin: ModelPin;
  /** Canonical bytes for every pin path across all fixture models. */
  contents: Record<string, Buffer>;
  /** Byte chunks per GH part asset (for split-part files). */
  partContents: Record<string, Uint8Array>;
  asr: PinModelEntry;
  vad: PinModelEntry;
}

let counter = 0;
function makeFixture(): Fixture {
  counter += 1;
  const releaseTag = `models-test-${counter}`;
  const contents: Record<string, Buffer> = {
    "config.yaml": Buffer.from("model_config: seaco\nvocab: 8404\n"),
    "model_quant.onnx": crypto.randomBytes(4096),
    "model_eb_quant.onnx": crypto.randomBytes(1024),
    "am.mvn": Buffer.from("cmvn-data"),
    "tokens.json": Buffer.from('{"<blk>": 0}'),
    seg_dict: Buffer.from("seg-a\nseg-b\n"),
    "vad_config.yaml": Buffer.from("vad_config: fsmn\n"),
  };
  // The big ASR graph mirrors as two ordered GH parts (transport layout only;
  // integrity anchors on the assembled file's sha256).
  const big = contents["model_quant.onnx"]!;
  const partContents: Record<string, Uint8Array> = {
    "asr-seaco-paraformer__model_quant.onnx.part00": big.subarray(0, 3000),
    "asr-seaco-paraformer__model_quant.onnx.part01": big.subarray(3000),
  };

  const asrFiles: PinFileEntry[] = [
    {
      path: "config.yaml",
      sha256: sha256(contents["config.yaml"]!),
      size_bytes: contents["config.yaml"]!.length,
      asset: "asr-seaco-paraformer__config.yaml",
    },
    {
      path: "model_quant.onnx",
      sha256: sha256(big),
      size_bytes: big.length,
      asset: "asr-seaco-paraformer__model_quant.onnx",
      asset_parts: Object.keys(partContents),
    },
    {
      path: "model_eb_quant.onnx",
      sha256: sha256(contents["model_eb_quant.onnx"]!),
      size_bytes: contents["model_eb_quant.onnx"]!.length,
      asset: "asr-seaco-paraformer__model_eb_quant.onnx",
    },
    {
      path: "am.mvn",
      sha256: sha256(contents["am.mvn"]!),
      size_bytes: contents["am.mvn"]!.length,
      asset: "asr-seaco-paraformer__am.mvn",
    },
    {
      path: "tokens.json",
      sha256: sha256(contents["tokens.json"]!),
      size_bytes: contents["tokens.json"]!.length,
      asset: "asr-seaco-paraformer__tokens.json",
    },
    {
      path: "seg_dict",
      sha256: sha256(contents["seg_dict"]!),
      size_bytes: contents["seg_dict"]!.length,
      asset: "asr-seaco-paraformer__seg_dict",
    },
  ];
  const vadFiles: PinFileEntry[] = [
    {
      path: "vad_config.yaml",
      sha256: sha256(contents["vad_config.yaml"]!),
      size_bytes: contents["vad_config.yaml"]!.length,
      asset: "vad-fsmn__vad_config.yaml",
    },
  ];

  const pin: ModelPin = {
    schema_version: 1,
    generated_utc: "2026-10-01T00:00:00+00:00",
    license: "Apache-2.0",
    attribution: "Exported from official iic checkpoints (FunASR).",
    release: {
      tag: releaseTag,
      url: `https://gh-mirror.test/releases/tags/${releaseTag}`,
      asset_base_url: MIRROR_BASE,
    },
    models: {
      asr: {
        name: "asr-seaco-paraformer",
        modelscope_repo: "iic/speech_seaco_paraformer_test",
        model_revision: "v2.0.4",
        checkpoint_commit: "a".repeat(40),
        export: { funasr: "1.3.1", torch: "2.0.1" },
        files: asrFiles,
      },
      vad: {
        name: "vad-fsmn",
        modelscope_repo: "iic/speech_fsmn_vad_test",
        model_revision: "v2.0.4",
        checkpoint_commit: "b".repeat(40),
        export: { funasr: "1.3.1", torch: "2.0.1" },
        files: vadFiles,
      },
    },
  };
  return {
    pin,
    contents,
    partContents,
    asr: pin.models.asr!,
    vad: pin.models.vad!,
  };
}

function routesForAllSources(
  fixture: Fixture,
  overrides: Record<string, Responder> = {},
): Record<string, Responder> {
  const routes: Record<string, Responder> = {};
  for (const model of Object.values(fixture.pin.models)) {
    for (const file of model.files) {
      for (const source of buildFileSources(fixture.pin, file)) {
        for (const url of source.urls) {
          if (routes[url] !== undefined) continue;
          // GH URLs end with the asset (or part) name; every other source
          // serves the same canonical file bytes — part chunks are the only
          // partial payloads.
          const assetName = url.slice(MIRROR_BASE.length);
          const bytes =
            fixture.partContents[assetName] ?? fixture.contents[file.path];
          routes[url] = bytes ? byteServer(bytes) : statusServer(404);
        }
      }
    }
  }
  return { ...routes, ...overrides };
}

function serveDir(
  fixture: Fixture,
  overrides: Record<string, Responder> = {},
): FetchRecorder {
  return makeFetch(routesForAllSources(fixture, overrides));
}

// --- tests -----------------------------------------------------------------

describe("[20261001_T5_ModelDownloaderV2] pin loading & validation", () => {
  it("loads and validates the committed repo pin", () => {
    const pin = loadModelPin(
      path.resolve(__dirname, "../../scripts/onnx-export/model-pin.json"),
    );
    expect(pin.schema_version).toBe(1);
    for (const model of Object.values(pin.models)) {
      expect(model!.checkpoint_commit).toMatch(COMMIT_RE);
      for (const file of model!.files) {
        expect(file.sha256).toMatch(SHA256_RE);
        expect(file.size_bytes).toBeGreaterThan(0);
      }
    }
  });

  it("rejects a pin whose sha256 is not 64-hex with an actionable error", () => {
    const fixture = makeFixture();
    fixture.asr.files[0]!.sha256 = "deadbeef";
    const pinPath = path.join(os.tmpdir(), `bad-pin-${counter}.json`);
    fs.writeFileSync(pinPath, JSON.stringify(fixture.pin));
    try {
      expect(() => loadModelPin(pinPath)).toThrow(ModelPinError);
      try {
        loadModelPin(pinPath);
      } catch (error) {
        expect((error as Error).message).toContain("config.yaml");
      }
    } finally {
      fs.rmSync(pinPath, { force: true });
    }
  });

  it("rejects pin file paths that escape the model directory", () => {
    const fixture = makeFixture();
    fixture.asr.files[0]!.path = "../escape.yaml";
    fixture.asr.files[0]!.sha256 = sha256(Buffer.from("x"));
    const pinPath = path.join(os.tmpdir(), `traverse-pin-${counter}.json`);
    fs.writeFileSync(pinPath, JSON.stringify(fixture.pin));
    try {
      expect(() => loadModelPin(pinPath)).toThrow(ModelPinError);
    } finally {
      fs.rmSync(pinPath, { force: true });
    }
  });
});

describe("[20261001_T5_ModelDownloaderV2] source chain (dual source + OSS placeholder)", () => {
  it("orders sources ModelScope primary → GitHub mirror backup", () => {
    const fixture = makeFixture();
    const file = fixture.asr.files.find((f) => f.path === "config.yaml")!;
    const sources = buildFileSources(fixture.pin, file);
    expect(sources.map((s) => s.name)).toEqual(["modelscope", "github-mirror"]);
    expect(sources[0]!.urls).toEqual([
      `${MODELSCOPE_RESOLVE_BASE}/${MODELSCOPE_MIRROR_REPO_ID}/resolve/${fixture.pin.release.tag}/config.yaml`,
    ]);
    expect(sources[1]!.urls).toEqual([
      `${MIRROR_BASE}asr-seaco-paraformer__config.yaml`,
    ]);
  });

  it("expands split-part assets into ordered mirror part URLs", () => {
    const fixture = makeFixture();
    const file = fixture.asr.files.find((f) => f.asset_parts !== undefined)!;
    const sources = buildFileSources(fixture.pin, file);
    const gh = sources.find((s) => s.name === "github-mirror")!;
    expect(gh.urls).toEqual(
      file.asset_parts!.map((part) => `${MIRROR_BASE}${part}`),
    );
  });

  it("keeps the OSS third source as a disabled placeholder by default", () => {
    const fixture = makeFixture();
    const file = fixture.vad.files[0]!;
    const sources = buildFileSources(fixture.pin, file);
    expect(sources.map((s) => s.name)).not.toContain("oss");
    expect(getOssMirrorBaseUrl()).toBeNull();
  });

  it("activates the OSS third source last when a base URL is configured", () => {
    const fixture = makeFixture();
    const file = fixture.vad.files[0]!;
    process.env.MURMUR_OSS_MIRROR_URL = "https://oss-bucket.test/models/";
    try {
      const sources = buildFileSources(fixture.pin, file);
      expect(sources.map((s) => s.name)).toEqual([
        "modelscope",
        "github-mirror",
        "oss",
      ]);
      expect(sources[2]!.urls).toEqual([
        `https://oss-bucket.test/models/vad_config.yaml`,
      ]);
    } finally {
      delete process.env.MURMUR_OSS_MIRROR_URL;
    }
  });
});

describe("[20261001_T5_ModelDownloaderV2] exact-filename readiness anchors", () => {
  let tmpDir: string;
  let fixture: Fixture;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mmdl-ready-"));
    fixture = makeFixture();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeDir(
    model: PinModelEntry,
    names: Record<string, Buffer | number>,
  ): string {
    const dir = path.join(tmpDir, model.name);
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, content] of Object.entries(names)) {
      const full = path.join(dir, name);
      if (typeof content === "number") {
        fs.writeFileSync(full, Buffer.alloc(content));
      } else {
        fs.writeFileSync(full, content);
      }
    }
    return dir;
  }

  function fullSet(model: PinModelEntry): Record<string, Buffer | number> {
    const set: Record<string, Buffer | number> = {};
    for (const file of model.files) {
      set[file.path] =
        fixture.contents[file.path] ?? Buffer.alloc(file.size_bytes);
    }
    return set;
  }

  it("accepts a directory holding exactly the pinned file set with matching sizes", () => {
    const dir = writeDir(fixture.asr, fullSet(fixture.asr));
    expect(readinessProblems(dir, fixture.asr)).toEqual([]);
    expect(isOnnxModelDirReady(dir, fixture.asr)).toBe(true);
  });

  it("judges a 34MB-style single-file repo NOT ready (only model_eb_quant.onnx present)", () => {
    // THE #417 HOLE: the old "*.onnx" wildcard anchor read a repo holding
    // only the 34,028,131-byte eb graph as ready. The exact-set anchor must
    // refuse it.
    const dir = writeDir(fixture.asr, {
      "model_eb_quant.onnx": fixture.contents["model_eb_quant.onnx"]!,
    });
    expect(hasOnnxMarker(dir)).toBe(true);
    expect(isOnnxModelDirReady(dir, fixture.asr)).toBe(false);
    expect(readinessProblems(dir, fixture.asr)).toContain(
      "missing file: config.yaml",
    );
  });

  it("rejects a truncated file (size mismatch against the pin)", () => {
    const names = fullSet(fixture.asr);
    names["seg_dict"] = fixture.contents["seg_dict"]!.subarray(0, 4);
    const dir = writeDir(fixture.asr, names);
    expect(isOnnxModelDirReady(dir, fixture.asr)).toBe(false);
  });

  it("matches exact names only — suffix lookalikes never satisfy an anchor", () => {
    const names = fullSet(fixture.asr);
    delete names["tokens.json"];
    names["tokens.json.bak"] = fixture.contents["tokens.json"]!;
    const dir = writeDir(fixture.asr, names);
    expect(isOnnxModelDirReady(dir, fixture.asr)).toBe(false);
  });

  it("ignores temp download names (v2 partial suffix, GH parts, modelscope shard names)", () => {
    const names = fullSet(fixture.asr);
    names[`model_quant.onnx${PARTIAL_SUFFIX}`] = 10;
    names["model_quant.onnx.murmur-partial.part00"] = 10;
    names["tokens.json_0_167772159"] = 10;
    const dir = writeDir(fixture.asr, names);
    expect(isOnnxModelDirReady(dir, fixture.asr)).toBe(true);
    expect(isTempDownloadName(`model_quant.onnx${PARTIAL_SUFFIX}`)).toBe(true);
    expect(isTempDownloadName("model_quant.onnx.murmur-partial.part00")).toBe(
      true,
    );
    expect(isTempDownloadName("tokens.json_0_167772159")).toBe(true);
    expect(isTempDownloadName("model_quant.onnx")).toBe(false);
  });

  it("flags unexpected non-temp files in strict-set verification (parity with check_manifest)", () => {
    const dir = writeDir(fixture.asr, fullSet(fixture.asr));
    fs.writeFileSync(path.join(dir, "stray.txt"), "x");
    const problems = verifyManifestDir(dir, fixture.asr);
    expect(problems.join("\n")).toContain(
      "unexpected file not in manifest: stray.txt",
    );
  });
});

describe("[20261001_T5_ModelDownloaderV2] one-shot manifest verification & download", () => {
  let tmpDir: string;
  let modelsRoot: string;
  let fixture: Fixture;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mmdl-dl-"));
    modelsRoot = path.join(tmpDir, "onnx-int8");
    fixture = makeFixture();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("downloads from the primary source and passes the one-shot verification", async () => {
    const fetcher = serveDir(fixture);
    const progress: DownloadProgress[] = [];
    const outcome = await downloadOnnxModelSet({
      pin: fixture.pin,
      modelsRoot,
      fetchImpl: fetcher,
      onProgress: (p) => progress.push({ ...p }),
    });
    expect(outcome.success).toBe(true);
    expect(outcome.verified.sort()).toEqual([
      "asr-seaco-paraformer",
      "vad-fsmn",
    ]);
    const asrDir = path.join(modelsRoot, fixture.asr.name);
    for (const file of fixture.asr.files) {
      expect(
        fs
          .readFileSync(path.join(asrDir, file.path))
          .equals(fixture.contents[file.path]!),
      ).toBe(true);
    }
    // No temp state may leak into the managed dir after completion.
    const leftovers = fs
      .readdirSync(asrDir)
      .filter((n) => isTempDownloadName(n));
    expect(leftovers).toEqual([]);
    // Progress carried the protocol shape through downloading → completed.
    expect(
      progress.some(
        (p) => p.stage === "downloading" && p.model === "asr-seaco-paraformer",
      ),
    ).toBe(true);
    expect(progress[progress.length - 1]!.stage).toBe("completed");
  }, 15000);

  it("fails over from the primary to the mirror when the primary is down", async () => {
    const fetcher = serveDir(fixture, {
      [`${MODELSCOPE_RESOLVE_BASE}/${MODELSCOPE_MIRROR_REPO_ID}/resolve/${fixture.pin.release.tag}/config.yaml`]:
        statusServer(503),
    });
    const outcome = await downloadOnnxModelSet({
      pin: fixture.pin,
      modelsRoot,
      fetchImpl: fetcher,
    });
    expect(outcome.success).toBe(true);
    const ghCalls = fetcher.calls.filter((c) => c.url.startsWith(MIRROR_BASE));
    expect(ghCalls.length).toBeGreaterThan(0);
    // Failover order: every mirror call happens only after a failed primary call.
    const firstPrimaryIndex = fetcher.calls.findIndex((c) =>
      c.url.includes("modelscope"),
    );
    const firstMirrorIndex = fetcher.calls.findIndex((c) =>
      c.url.startsWith(MIRROR_BASE),
    );
    expect(firstMirrorIndex).toBeGreaterThan(firstPrimaryIndex);
  });

  it("resumes across a source switch: appended bytes still pass sha256 verification", async () => {
    const configUrl = `${MODELSCOPE_RESOLVE_BASE}/${MODELSCOPE_MIRROR_REPO_ID}/resolve/${fixture.pin.release.tag}/config.yaml`;
    // Pre-seed a partial download from a dead attempt: first 5 bytes on disk.
    const asrDir = path.join(modelsRoot, fixture.asr.name);
    fs.mkdirSync(asrDir, { recursive: true });
    const configContent = fixture.contents["config.yaml"]!;
    fs.writeFileSync(
      path.join(asrDir, `config.yaml${PARTIAL_SUFFIX}`),
      configContent.subarray(0, 5),
    );

    // Primary now serves garbage-free 500s; the mirror completes the bytes.
    const fetcher = serveDir(fixture, { [configUrl]: statusServer(500) });
    const outcome = await downloadOnnxModelSet({
      pin: fixture.pin,
      modelsRoot,
      fetchImpl: fetcher,
    });
    expect(outcome.success).toBe(true);
    // The resume Range asked for exactly the missing tail.
    const mirrorConfigCall = fetcher.calls.find(
      (c) => c.url === `${MIRROR_BASE}asr-seaco-paraformer__config.yaml`,
    );
    expect(mirrorConfigCall).toBeDefined();
    expect(mirrorConfigCall!.headers["Range"]).toBe("bytes=5-");
    expect(
      fs.readFileSync(path.join(asrDir, "config.yaml")).equals(configContent),
    ).toBe(true);
  });

  it("assembles split-part mirror assets in pin order and passes verification", async () => {
    // Kill the single-file primary for the big graph so the parts layout is used.
    const bigPrimary = `${MODELSCOPE_RESOLVE_BASE}/${MODELSCOPE_MIRROR_REPO_ID}/resolve/${fixture.pin.release.tag}/model_quant.onnx`;
    const fetcher = serveDir(fixture, { [bigPrimary]: statusServer(404) });
    const outcome = await downloadOnnxModelSet({
      pin: fixture.pin,
      modelsRoot,
      fetchImpl: fetcher,
    });
    expect(outcome.success).toBe(true);
    const assembled = fs.readFileSync(
      path.join(modelsRoot, fixture.asr.name, "model_quant.onnx"),
    );
    expect(assembled.equals(fixture.contents["model_quant.onnx"]!)).toBe(true);
  });

  // [20261001_T5_ReviewFix] Independent review: a multi-file model's progress
  // used to RESET to the in-flight file's own byte count on every file
  // start (addBytes overwrite + the onBytes(0) bootstrap callback) — the
  // #249/#254 dip class that can re-cross the stall watchdog's peak and
  // kill a live download. Lock: overall AND per-model progress are
  // non-decreasing across the whole run, and the completed stage carries
  // the torch protocol's 100 (download_models.py emits exactly 100 there).
  it("never regresses progress across a model's files; completed carries 100", async () => {
    const progress: DownloadProgress[] = [];
    await downloadOnnxModelSet({
      pin: fixture.pin,
      modelsRoot,
      fetchImpl: serveDir(fixture),
      onProgress: (p) => progress.push({ ...p }),
    });
    for (let i = 1; i < progress.length; i += 1) {
      expect(progress[i]!.overall_progress).toBeGreaterThanOrEqual(
        progress[i - 1]!.overall_progress,
      );
    }
    for (const model of Object.values(fixture.pin.models)) {
      const stream = progress.filter((p) => p.model === model!.name);
      expect(stream.length).toBeGreaterThan(1);
      for (let i = 1; i < stream.length; i += 1) {
        expect(stream[i]!.progress).toBeGreaterThanOrEqual(
          stream[i - 1]!.progress,
        );
      }
    }
    const completed = progress.filter((p) => p.stage === "completed");
    expect(completed.map((p) => p.model).sort()).toEqual([
      "asr-seaco-paraformer",
      "vad-fsmn",
    ]);
    for (const event of completed) {
      expect(event.progress).toBe(100);
    }
    expect(progress[progress.length - 1]!.overall_progress).toBe(100);
  });

  // [20261001_T5_ReviewFix2] Residual dip WITHIN a split-part file: the parts
  // loop used to feed the shared sink each part's PART-local absolute bytes,
  // and each new part bootstraps at 0 — so the model's in-flight counter
  // reset at every part boundary (reviewer probe: 54.5 → 9.1 → climb; in
  // production model_quant.onnx, 345,131,848 B × 5 parts, dips ~17.8 points
  // at each of its 4 boundaries). This variant FORCES the parts layout (the
  // primary is down, so the big graph must come from the mirror's part
  // URLs) and re-locks the monotonicity contract on that path.
  it("never regresses progress across split-part boundaries either", async () => {
    const bigPrimary = `${MODELSCOPE_RESOLVE_BASE}/${MODELSCOPE_MIRROR_REPO_ID}/resolve/${fixture.pin.release.tag}/model_quant.onnx`;
    const progress: DownloadProgress[] = [];
    const fetcher = serveDir(fixture, { [bigPrimary]: statusServer(404) });
    await downloadOnnxModelSet({
      pin: fixture.pin,
      modelsRoot,
      fetchImpl: fetcher,
      onProgress: (p) => progress.push({ ...p }),
    });
    // The parts layout was genuinely exercised.
    expect(
      fetcher.calls.some((c) => c.url.endsWith("model_quant.onnx.part00")),
    ).toBe(true);
    expect(
      fetcher.calls.some((c) => c.url.endsWith("model_quant.onnx.part01")),
    ).toBe(true);
    for (let i = 1; i < progress.length; i += 1) {
      expect(progress[i]!.overall_progress).toBeGreaterThanOrEqual(
        progress[i - 1]!.overall_progress,
      );
    }
    for (const model of Object.values(fixture.pin.models)) {
      const stream = progress.filter((p) => p.model === model!.name);
      expect(stream.length).toBeGreaterThan(1);
      for (let i = 1; i < stream.length; i += 1) {
        expect(stream[i]!.progress).toBeGreaterThanOrEqual(
          stream[i - 1]!.progress,
        );
      }
    }
    expect(progress[progress.length - 1]!.overall_progress).toBe(100);
  });

  // [20261001_T5_ReviewFix] Independent review: a failed split-part download
  // deleted the completed part temps in a `finally` and rebuilt the assembled
  // file from zero on retry — contradicting the module header and the
  // AllSourcesFailedError promise (已下载部分已保留，重试将自动断点续传).
  // The affected file is the pin's only split-part asset (model_quant.onnx,
  // 345,131,848 bytes, 5 parts). Lock: completed part temps survive the
  // failure, the retry resumes them (Range from the temp's size; a 416
  // Range answer means the temp is already complete per RFC 7233), and the
  // temps are cleaned only after a successful assembly.
  it("keeps completed part temps on failure and resumes them on retry", async () => {
    const bigPrimary = `${MODELSCOPE_RESOLVE_BASE}/${MODELSCOPE_MIRROR_REPO_ID}/resolve/${fixture.pin.release.tag}/model_quant.onnx`;
    const part00Url = `${MIRROR_BASE}asr-seaco-paraformer__model_quant.onnx.part00`;
    const part01Url = `${MIRROR_BASE}asr-seaco-paraformer__model_quant.onnx.part01`;
    const part00Bytes =
      fixture.partContents["asr-seaco-paraformer__model_quant.onnx.part00"]!;

    // Attempt 1: primary dead; part00 completes, part01 connection dies.
    const failing = serveDir(fixture, {
      [bigPrimary]: statusServer(404),
      [part01Url]: () => {
        throw new Error("connection reset mid-part");
      },
    });
    await expect(
      downloadOnnxModelSet({
        pin: fixture.pin,
        modelsRoot,
        fetchImpl: failing,
      }),
    ).rejects.toThrow(AllSourcesFailedError);
    const asrDir = path.join(modelsRoot, fixture.asr.name);
    const part00Temp = path.join(
      asrDir,
      "model_quant.onnx.murmur-partial.part00",
    );
    expect(fs.existsSync(part00Temp)).toBe(true);
    expect(fs.statSync(part00Temp).size).toBe(part00Bytes.length);

    // Attempt 2: all sources healthy — the completed part must be RESUMED
    // (Range from its temp size), not re-fetched from zero.
    const retry = serveDir(fixture, { [bigPrimary]: statusServer(404) });
    const outcome = await downloadOnnxModelSet({
      pin: fixture.pin,
      modelsRoot,
      fetchImpl: retry,
    });
    expect(outcome.success).toBe(true);
    const part00RetryCalls = retry.calls.filter((c) => c.url === part00Url);
    expect(part00RetryCalls.length).toBeGreaterThan(0);
    expect(part00RetryCalls[0]!.headers["Range"]).toBe(
      `bytes=${part00Bytes.length}-`,
    );
    // Assembly is byte-exact and the part temps are cleaned only now.
    expect(
      fs
        .readFileSync(path.join(asrDir, "model_quant.onnx"))
        .equals(fixture.contents["model_quant.onnx"]!),
    ).toBe(true);
    expect(fs.readdirSync(asrDir).filter((n) => isTempDownloadName(n))).toEqual(
      [],
    );
  });

  it("treats a 416 Range answer as an already-complete temp (RFC 7233)", async () => {
    // A fully-downloaded part temp makes the retry's Range start at/after
    // EOF; a conforming server answers 416. That must read as "complete",
    // not as a source failure.
    const bigPrimary = `${MODELSCOPE_RESOLVE_BASE}/${MODELSCOPE_MIRROR_REPO_ID}/resolve/${fixture.pin.release.tag}/model_quant.onnx`;
    const part00Url = `${MIRROR_BASE}asr-seaco-paraformer__model_quant.onnx.part00`;
    const part00Bytes =
      fixture.partContents["asr-seaco-paraformer__model_quant.onnx.part00"]!;
    const asrDir = path.join(modelsRoot, fixture.asr.name);
    fs.mkdirSync(asrDir, { recursive: true });
    fs.writeFileSync(
      path.join(asrDir, "model_quant.onnx.murmur-partial.part00"),
      part00Bytes,
    );
    const fetcher = serveDir(fixture, {
      [bigPrimary]: statusServer(404),
      [part00Url]: statusServer(416),
    });
    const outcome = await downloadOnnxModelSet({
      pin: fixture.pin,
      modelsRoot,
      fetchImpl: fetcher,
    });
    expect(outcome.success).toBe(true);
    expect(
      fs
        .readFileSync(path.join(asrDir, "model_quant.onnx"))
        .equals(fixture.contents["model_quant.onnx"]!),
    ).toBe(true);
  });

  it("rejects a tampered file with an actionable error and removes it for re-download", async () => {
    // Fully download once, then tamper config.yaml (same length, different
    // bytes — only the sha256 pass can catch this).
    await downloadOnnxModelSet({
      pin: fixture.pin,
      modelsRoot,
      fetchImpl: serveDir(fixture),
    });
    const asrDir = path.join(modelsRoot, fixture.asr.name);
    const configPath = path.join(asrDir, "config.yaml");
    const original = fixture.contents["config.yaml"]!;
    const tampered = Buffer.from(original);
    tampered[0] = (tampered[0]! + 1) % 256;
    fs.writeFileSync(configPath, tampered);

    // The rejection is actionable: names the file, the expected hash, and
    // the recovery action.
    let rejection: unknown = null;
    try {
      await downloadOnnxModelSet({
        pin: fixture.pin,
        modelsRoot,
        fetchImpl: serveDir(fixture),
      });
      expect.unreachable("verification must reject the tampered set");
    } catch (error) {
      rejection = error;
    }
    expect(rejection).toBeInstanceOf(ManifestVerificationError);
    const message = (rejection as Error).message;
    expect(message).toContain("config.yaml");
    expect(message).toContain(sha256(original));
    expect(message).toContain("重新下载");
    // The corrupt file was removed so a retry actually re-fetches it…
    expect(fs.existsSync(configPath)).toBe(false);
    // …and the retry then repairs the set and passes.
    const repaired = await downloadOnnxModelSet({
      pin: fixture.pin,
      modelsRoot,
      fetchImpl: serveDir(fixture),
    });
    expect(repaired.success).toBe(true);
    expect(fs.readFileSync(configPath).equals(original)).toBe(true);
  }, 15000);

  it("re-verifies the WHOLE manifest on every invocation — no skip-hash-on-retry branch", async () => {
    // First invocation completes. Second invocation (retry semantics, dir
    // already complete) must STILL run the full sha256 pass — observable by
    // a same-size tampered file being caught WITHOUT any network activity
    // beforehand: a size-only check could not detect it.
    await downloadOnnxModelSet({
      pin: fixture.pin,
      modelsRoot,
      fetchImpl: serveDir(fixture),
    });
    const vadDir = path.join(modelsRoot, fixture.vad.name);
    const vadPath = path.join(vadDir, "vad_config.yaml");
    const original = fixture.contents["vad_config.yaml"]!;
    const tampered = Buffer.from(original);
    tampered[tampered.length - 1] = (tampered[tampered.length - 1]! + 1) % 256;
    fs.writeFileSync(vadPath, tampered);

    const fetcher = serveDir(fixture); // would happily serve if asked
    await expect(
      downloadOnnxModelSet({
        pin: fixture.pin,
        modelsRoot,
        fetchImpl: fetcher,
      }),
    ).rejects.toThrow(ManifestVerificationError);
    // Detection happened during the verification pass; the vad file needed no
    // fetch because the hash — not a download — is what caught the tamper.
    expect(fetcher.calls.filter((c) => c.url.includes("vad-fsmn")).length).toBe(
      0,
    );
    expect(fs.existsSync(vadPath)).toBe(false);
  });

  it("keeps the partial download when every source fails, with an actionable error", async () => {
    const fetcher = makeFetch({}); // no routes at all → all sources unreachable
    // Pre-seed resume state from a dead attempt: the first 5 config bytes.
    const asrDir = path.join(modelsRoot, fixture.asr.name);
    fs.mkdirSync(asrDir, { recursive: true });
    fs.writeFileSync(
      path.join(asrDir, `config.yaml${PARTIAL_SUFFIX}`),
      fixture.contents["config.yaml"]!.subarray(0, 5),
    );
    await expect(
      downloadOnnxModelSet({
        pin: fixture.pin,
        modelsRoot,
        fetchImpl: fetcher,
      }),
    ).rejects.toThrow(AllSourcesFailedError);
    try {
      await downloadOnnxModelSet({
        pin: fixture.pin,
        modelsRoot,
        fetchImpl: fetcher,
      });
      expect.unreachable("all sources failed — must reject");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain("modelscope");
      expect(message).toContain("github-mirror");
      expect(message).toContain("断点续传");
    }
    // The partial tmp state survived for the next resume.
    expect(
      fs.existsSync(path.join(asrDir, `config.yaml${PARTIAL_SUFFIX}`)),
    ).toBe(true);
  });

  it("removes unexpected stray files (strict set) and refuses until the set is clean", async () => {
    await downloadOnnxModelSet({
      pin: fixture.pin,
      modelsRoot,
      fetchImpl: serveDir(fixture),
    });
    const asrDir = path.join(modelsRoot, fixture.asr.name);
    fs.writeFileSync(path.join(asrDir, "leftover.tmp"), "junk");
    await expect(
      downloadOnnxModelSet({
        pin: fixture.pin,
        modelsRoot,
        fetchImpl: serveDir(fixture),
      }),
    ).rejects.toThrow(ManifestVerificationError);
    // The stray was removed, so the retry verifies clean without fetching.
    const fetcher = serveDir(fixture);
    const outcome = await downloadOnnxModelSet({
      pin: fixture.pin,
      modelsRoot,
      fetchImpl: fetcher,
    });
    expect(outcome.success).toBe(true);
    expect(fetcher.calls).toEqual([]);
  }, 15000);

  it("skips fetching entirely when the whole set already verifies clean", async () => {
    await downloadOnnxModelSet({
      pin: fixture.pin,
      modelsRoot,
      fetchImpl: serveDir(fixture),
    });
    const fetcher = serveDir(fixture);
    const progress: DownloadProgress[] = [];
    const outcome = await downloadOnnxModelSet({
      pin: fixture.pin,
      modelsRoot,
      fetchImpl: fetcher,
      onProgress: (p) => progress.push({ ...p }),
    });
    expect(outcome.success).toBe(true);
    expect(fetcher.calls).toEqual([]);
    expect(progress.filter((p) => p.stage === "completed").length).toBe(2);
  }, 15000);
});
