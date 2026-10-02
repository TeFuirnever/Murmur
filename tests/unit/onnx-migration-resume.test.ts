// [20261002_T9_MigrationUx] Ticket #420 acceptance criterion 2 (S2 download
// seam): resume from the breakpoint — an interrupted download must continue
// after an app RESTART, not start over. The on-disk `.murmur-partial` temps
// and completed files ARE the resume state; each downloadOnnxModelSet call
// below is a fresh "process" with no in-memory carryover:
//
//   run 1 — network dies mid-run after the ASR set is complete → the error
//           keeps the partial bytes (AllSourcesFailedError promise);
//   run 2 — after "restart" the completed ASR set is NOT re-fetched and the
//           partial VAD file resumes via Range from exactly where run 1
//           stopped;
//   run 3 — another restart with the set complete → ZERO network calls
//           (the one-shot verification fast path).
//
// The network is fully injected (HttpFetch) — no test touches the internet.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";

import {
  AllSourcesFailedError,
  PARTIAL_SUFFIX,
  buildFileSources,
  downloadOnnxModelSet,
  MODELSCOPE_RESOLVE_BASE,
  MODELSCOPE_MIRROR_REPO_ID,
  isTempDownloadName,
} from "../../src/helpers/modelDownloader";
import type { HttpFetch, ModelPin } from "../../src/helpers/modelDownloader";

const MIRROR_BASE = "https://gh-mirror.test/download/models-resume-1/";

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

/** Serves `prefix` bytes then kills the connection — the mid-flight death
 * of run 1. A range request that starts at/after prefix length gets 416.
 * (The prefix chunk is delivered on the first pull; erroring on the SAME
 * pull would discard it per the web streams spec.) */
function dyingByteServer(content: Uint8Array, prefixLength: number) {
  return (_url: string, headers: Record<string, string>) => {
    const range = headers["Range"];
    if (range) {
      const match = /^bytes=(\d+)-$/.exec(range);
      if (match && match[1] !== undefined && Number(match[1]) >= prefixLength) {
        return { status: 416 };
      }
    }
    let sent = false;
    return {
      status: 200,
      body: new ReadableStream<Uint8Array>({
        pull(controller) {
          if (!sent) {
            sent = true;
            controller.enqueue(content.subarray(0, prefixLength));
            return;
          }
          controller.error(new Error("connection reset mid-download"));
        },
      }),
    };
  };
}

/** Honors byte-range resume like a real static file server. */
function byteServer(content: Uint8Array) {
  return (_url: string, headers: Record<string, string>) => {
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

interface Recorder extends HttpFetch {
  calls: Array<{ url: string; headers: Record<string, string> }>;
}

function makeFetch(
  routes: Record<
    string,
    (url: string, headers: Record<string, string>) => unknown
  >,
): Recorder {
  const recorder = ((
    url: string,
    init?: { headers?: Record<string, string> },
  ) => {
    recorder.calls.push({ url, headers: init?.headers ?? {} });
    const route = routes[url];
    if (!route) {
      return Promise.reject(new Error(`connection failed: ${url}`));
    }
    return Promise.resolve(
      route(url, init?.headers ?? {}) as {
        status: number;
        body: ReadableStream<Uint8Array>;
      },
    );
  }) as Recorder;
  recorder.calls = [];
  return recorder;
}

function primaryUrl(pin: ModelPin, path: string): string {
  return `${MODELSCOPE_RESOLVE_BASE}/${MODELSCOPE_MIRROR_REPO_ID}/resolve/${pin.release.tag}/${path}`;
}

describe("[20261002_T9_MigrationUx] resume across restart (#420 AC2)", () => {
  let tmpDir: string;
  let modelsRoot: string;
  let pin: ModelPin;
  let contents: Record<string, Buffer>;
  let asrName: string;
  let vadName: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "onnx-resume-"));
    modelsRoot = path.join(tmpDir, "onnx-int8");
    const vadConfig = Buffer.from("vad_config: fsmn\n");
    const asrConfigYaml = Buffer.from("model_config: seaco\nvocab: 8404\n");
    const asrGraph = crypto.randomBytes(2048);
    contents = {
      "vad_config.yaml": vadConfig,
      "config.yaml": asrConfigYaml,
      "model_quant.onnx": asrGraph,
    };
    asrName = "asr-seaco-paraformer";
    vadName = "vad-fsmn";
    pin = {
      schema_version: 1,
      generated_utc: "2026-10-02T00:00:00+00:00",
      license: "Apache-2.0",
      attribution: "Exported from official iic checkpoints (FunASR).",
      release: {
        tag: "models-resume-1",
        url: "https://gh-mirror.test/releases/tags/models-resume-1",
        asset_base_url: MIRROR_BASE,
      },
      models: {
        asr: {
          name: asrName,
          modelscope_repo: "iic/speech_seaco_paraformer_test",
          model_revision: "v2.0.4",
          checkpoint_commit: "a".repeat(40),
          export: { funasr: "1.3.1", torch: "2.0.1" },
          files: [
            {
              path: "config.yaml",
              sha256: sha256(asrConfigYaml),
              size_bytes: asrConfigYaml.length,
              asset: `${asrName}__config.yaml`,
            },
            {
              path: "model_quant.onnx",
              sha256: sha256(asrGraph),
              size_bytes: asrGraph.length,
              asset: `${asrName}__model_quant.onnx`,
            },
          ],
        },
        vad: {
          name: vadName,
          modelscope_repo: "iic/speech_fsmn_vad_test",
          model_revision: "v2.0.4",
          checkpoint_commit: "b".repeat(40),
          export: { funasr: "1.3.1", torch: "2.0.1" },
          files: [
            {
              path: "vad_config.yaml",
              sha256: sha256(vadConfig),
              size_bytes: vadConfig.length,
              asset: `${vadName}__vad_config.yaml`,
            },
          ],
        },
      },
    };
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /** Healthy routes for every source URL of every pinned file. */
  function healthyRoutes() {
    const routes: Record<
      string,
      (url: string, headers: Record<string, string>) => unknown
    > = {};
    for (const model of Object.values(pin.models)) {
      for (const file of model.files) {
        for (const source of buildFileSources(pin, file)) {
          for (const url of source.urls) {
            if (routes[url] === undefined) {
              routes[url] = byteServer(contents[file.path]!);
            }
          }
        }
      }
    }
    return routes;
  }

  it("run1 dies mid-file → run2 resumes from the breakpoint → run3 needs zero network", async () => {
    const vadPrimary = primaryUrl(pin, "vad_config.yaml");

    // --- run 1: ASR set completes; the VAD primary serves 5 bytes then the
    // connection dies; the VAD mirror 404s → all sources failed, partial
    // bytes stay on disk. This is the "user quit / network dropped" launch.
    const run1Routes = healthyRoutes();
    run1Routes[vadPrimary] = dyingByteServer(contents["vad_config.yaml"]!, 5);
    run1Routes[`${MIRROR_BASE}${vadName}__vad_config.yaml`] = () => ({
      status: 404,
    });
    const run1Fetch = makeFetch(run1Routes);
    await expect(
      downloadOnnxModelSet({ pin, modelsRoot, fetchImpl: run1Fetch }),
    ).rejects.toBeInstanceOf(AllSourcesFailedError);

    const asrDir = path.join(modelsRoot, asrName);
    const vadDir = path.join(modelsRoot, vadName);
    // ASR files fully landed in run 1 (byte-exact, they will pass hash).
    expect(
      fs
        .readFileSync(path.join(asrDir, "config.yaml"))
        .equals(contents["config.yaml"]!),
    ).toBe(true);
    expect(
      fs
        .readFileSync(path.join(asrDir, "model_quant.onnx"))
        .equals(contents["model_quant.onnx"]!),
    ).toBe(true);
    // The breakpoint: 5 partial VAD bytes survive on disk under the temp name.
    const vadPartial = path.join(vadDir, `vad_config.yaml${PARTIAL_SUFFIX}`);
    expect(fs.statSync(vadPartial).size).toBe(5);

    // --- run 2: the app restarted (fresh call, only disk state carries
    // over). The completed ASR set must NOT be re-fetched; the VAD file
    // resumes with Range from exactly the breakpoint.
    const run2Fetch = makeFetch(healthyRoutes());
    const outcome = await downloadOnnxModelSet({
      pin,
      modelsRoot,
      fetchImpl: run2Fetch,
    });
    expect(outcome.success).toBe(true);
    expect(outcome.verified.sort()).toEqual([asrName, vadName]);
    const asrCalls = run2Fetch.calls.filter((c) =>
      c.url.includes(`${asrName}__`),
    );
    expect(asrCalls).toEqual([]);
    const vadCall = run2Fetch.calls.find((c) => c.url === vadPrimary);
    expect(vadCall).toBeDefined();
    expect(vadCall!.headers["Range"]).toBe("bytes=5-");
    // Final VAD bytes are complete and no temp state leaked.
    expect(
      fs
        .readFileSync(path.join(vadDir, "vad_config.yaml"))
        .equals(contents["vad_config.yaml"]!),
    ).toBe(true);
    expect(fs.readdirSync(vadDir).filter(isTempDownloadName)).toEqual([]);

    // --- run 3: another restart with everything verified on disk — the
    // one-shot verification fast path answers with ZERO network calls.
    const run3Fetch = makeFetch({});
    const run3 = await downloadOnnxModelSet({
      pin,
      modelsRoot,
      fetchImpl: run3Fetch,
    });
    expect(run3.success).toBe(true);
    expect(run3Fetch.calls).toEqual([]);
  });

  // [20261002_T9_ReviewFix] A WRITE-side failure (production shapes: ENOSPC,
  // EACCES / antivirus lock mid-660MB-download) fires on the FILE stream,
  // not the network. Without an error listener on the write stream, the
  // first such error escaped as an uncaughtException AND the pending
  // drain/end waits hung forever - every later retry then folded onto the
  // dead in-flight promise and the migration dialog spun with no actionable
  // error. The download must instead reject through the normal failure path
  // (source failover -> AllSourcesFailedError). Deterministic write-side
  // error: the destination "file" is a directory (open fails with EISDIR),
  // with every network source healthy - the ONLY failure is the write side.
  it("write-side failure (EACCES/ENOSPC shape) rejects - never hangs or crashes", async () => {
    const asrDir = path.join(modelsRoot, asrName);
    fs.mkdirSync(asrDir, { recursive: true });
    // The ASR dir exists but is UNWRITABLE: every pinned file is "missing"
    // (so the one-shot verification orders a download) and the first
    // createWriteStream open fails with EACCES - the error fires on the
    // FILE stream, not the network, which is the production shape under
    // review (ENOSPC / EACCES / antivirus lock mid-download).
    fs.chmodSync(asrDir, 0o555);
    const fetcher = makeFetch(healthyRoutes());
    try {
      await expect(
        downloadOnnxModelSet({ pin, modelsRoot, fetchImpl: fetcher }),
      ).rejects.toBeInstanceOf(AllSourcesFailedError);
    } finally {
      fs.chmodSync(asrDir, 0o755);
    }
    // Reaching these lines proves the promise settled (no hang) with no
    // uncaughtException - vitest fails the run on either.
  });

  // [20261002_T9_MigrationUx] AC5: the main-process failure messages must be
  // actionable on their own (the migration dialog appends the settings
  // pointer): name the check (proxy) and promise the resume, so a weak-
  // network or proxied user knows exactly what to do.
  it("AC5: source-failure and verification errors carry actionable guidance", () => {
    const allSources = new AllSourcesFailedError("modelscope: timeout");
    expect(allSources.message).toContain("代理");
    expect(allSources.message).toContain("重试");
    expect(allSources.message).toContain("断点续传");
    expect(allSources.message).toContain("modelscope: timeout");
  });
});
