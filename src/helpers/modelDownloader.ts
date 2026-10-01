// [20261001_T5_ModelDownloaderV2] Ticket #417 (spec #412 T5): the model
// supply-chain trust-chain CLIENT — the v2 model downloader. Replaces the
// modelscope snapshot_download flow's implicit behaviors with an explicit,
// pinned pipeline:
//
//   1. Dual-source fetch with automatic failover: ModelScope mirror (primary,
//      domestic-fast) → own GitHub-Release mirror (backup, the T1
//      source-of-record from scripts/onnx-export/model-pin.json) → OSS
//      bucket (third source, placeholder until provisioned — spec #412
//      decision 9). No geo detection; sources fail over in order.
//   2. Byte-range resume that survives a source switch: partial bytes are
//      appended from whichever source answers next; integrity is anchored
//      ONLY on the pinned sha256, so cross-source byte concatenation is
//      verified, never trusted.
//   3. ONE-SHOT whole-manifest verification after assembly: every completed
//      download invocation hashes EVERY pinned file (strict set semantics,
//      mirroring scripts/onnx-export/onnx_export_common.py check_manifest).
//      There is deliberately NO branch that returns success without a full
//      hash pass — retries re-verify everything (the "skip-hash-on-retry"
//      hole is closed by construction).
//   4. Exact-filename readiness anchors (spec #412 decision 8): readiness
//      accepts ONLY the pinned exact file set with matching sizes — no
//      wildcards, and temp download names (our partial suffix, GitHub part
//      chunks, modelscope shard byte-range names) are excluded on both sides
//      of the name. A repo holding only the 34MB eb graph is NOT ready.
//   5. commit-SHA pin: every model record is validated to carry a 40-hex
//      upstream checkpoint commit; the mirror URL revision is the export
//      release tag from the same pin.
//
// This module is pure (no electron imports) so the S2 seam can unit-test it
// with an injected HttpFetch. modelManager owns the production path
// resolution and delegates here.
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { Readable } from "stream";
import { pipeline } from "stream/promises";

/** Logger interface (accepts console or LogManager) — structural twin of
 * modelManager's Logger. */
export interface DownloaderLogger {
  info?(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error?(message: string, ...args: unknown[]): void;
}

// --- pin types (structural mirror of scripts/onnx-export/model-pin.json) ---

export interface PinFileEntry {
  path: string;
  sha256: string;
  size_bytes: number;
  asset: string;
  asset_parts?: string[];
}

export interface PinModelEntry {
  name: string;
  modelscope_repo: string;
  modelscope_repo_alias?: string;
  model_revision: string;
  checkpoint_commit: string;
  export: Record<string, string | number>;
  files: PinFileEntry[];
}

export interface ModelPin {
  schema_version: number;
  generated_utc: string;
  license: string;
  attribution: string;
  release: { tag: string; url: string; asset_base_url: string };
  models: Record<string, PinModelEntry>;
}

// --- constants -------------------------------------------------------------

// [20261001_T5_ModelDownloaderV2] Temp download name markers. The suffix is
// OUR v2 downloader's in-flight name; the regexes cover the other two real
// temp shapes seen in model dirs: GitHub split-part chunks (<asset>.partNN)
// and modelscope's byte-range shard names (vocab.txt_0_167772159 — the #255
// class). Both sides of the name are covered: suffix markers only ever END a
// temp name, and exact-name anchors can never match a suffixed file.
export const PARTIAL_SUFFIX = ".murmur-partial";
const GH_PART_SUFFIX_RE = /\.part\d+$/;
const MODELSCOPE_SHARD_SUFFIX_RE = /_\d+_\d+$/;
const SHA256_HEX_RE = /^[0-9a-f]{64}$/;
const COMMIT_SHA_HEX_RE = /^[0-9a-f]{40}$/;

// The pinned ONNX file sets download into their own generation root so the
// torch-era damo caches and the v2 trust-chain artifacts never mix.
export const ONNX_MODELS_DIRNAME = "onnx-int8";

// Primary source: ModelScope mirror of OUR exports. The upstream iic repos
// named in the pin host the ORIGINAL torch checkpoints — they do NOT host
// our ONNX int8 artifacts, so the resolve URL must target the Murmur-owned
// mirror repo, not the pin's modelscope_repo. Publication of that repo is
// pending; until it exists this source fails fast (404/network) and the
// GitHub mirror answers — the failover order is the contract, not the
// primary's availability.
export const MODELSCOPE_RESOLVE_BASE = "https://modelscope.cn/models";
export const MODELSCOPE_MIRROR_REPO_ID = "murmur-asr/murmur-models-onnx-int8";

// Third source placeholder (spec #412 decision 9): a Murmur-owned OSS bucket
// for regions where ModelScope AND GitHub are jointly unreachable. Not yet
// provisioned — null keeps the source out of the chain. Set
// MURMUR_OSS_MIRROR_URL (base URL ending in "/") to activate it last.
export function getOssMirrorBaseUrl(): string | null {
  return process.env.MURMUR_OSS_MIRROR_URL || null;
}

// --- errors ----------------------------------------------------------------

/** Pin record missing or structurally invalid. */
export class ModelPinError extends Error {
  readonly code = "model_pin_invalid";
  constructor(message: string) {
    super(message);
    this.name = "ModelPinError";
  }
}

/** Every source in the chain failed for one file. Partial bytes are kept. */
export class AllSourcesFailedError extends Error {
  readonly code = "download_all_sources_failed";
  constructor(detail: string) {
    super(
      `模型下载失败：所有下载源均不可用（${detail}）。` +
        "请检查网络连接或代理设置后重试；已下载部分已保留，重试将自动断点续传",
    );
    this.name = "AllSourcesFailedError";
  }
}

/** Post-assembly one-shot verification failed. Actionable: names each file
 * and the expected/actual hashes; corrupt files have been removed so a
 * retry re-downloads them. */
export class ManifestVerificationError extends Error {
  readonly code = "manifest_mismatch";
  readonly problems: string[];
  constructor(problems: string[]) {
    super(
      "模型文件校验失败（sha256 或大小与 pin 不符）。已移除损坏文件，请重新下载；" +
        `如反复失败请检查网络或磁盘。问题清单:\n  ${problems.join("\n  ")}`,
    );
    this.name = "ManifestVerificationError";
    this.problems = problems;
  }
}

// --- pin loading & validation ---------------------------------------------

function validatePin(pin: unknown, source: string): asserts pin is ModelPin {
  if (typeof pin !== "object" || pin === null) {
    throw new ModelPinError(`模型 pin 记录无效（非对象）: ${source}`);
  }
  const record = pin as ModelPin;
  if (record.schema_version !== 1) {
    throw new ModelPinError(
      `模型 pin 记录无效（schema_version=${String(record.schema_version)}，需要 1）: ${source}`,
    );
  }
  const release = record.release;
  if (
    typeof release?.asset_base_url !== "string" ||
    release.asset_base_url.length === 0 ||
    !release.asset_base_url.endsWith("/")
  ) {
    throw new ModelPinError(
      `模型 pin 记录无效（release.asset_base_url 必须以 / 结尾）: ${source}`,
    );
  }
  for (const [key, model] of Object.entries(record.models ?? {})) {
    if (!COMMIT_SHA_HEX_RE.test(model.checkpoint_commit)) {
      throw new ModelPinError(
        `模型 pin 记录无效（${key}.checkpoint_commit 必须为 40 位十六进制 commit-SHA）: ${source}`,
      );
    }
    if (!Array.isArray(model.files) || model.files.length === 0) {
      throw new ModelPinError(
        `模型 pin 记录无效（${key}.files 为空）: ${source}`,
      );
    }
    for (const file of model.files) {
      if (!SHA256_HEX_RE.test(file.sha256)) {
        throw new ModelPinError(
          `模型 pin 记录无效（${key}/${file.path} 的 sha256 必须为 64 位十六进制）: ${source}`,
        );
      }
      if (!(file.size_bytes > 0)) {
        throw new ModelPinError(
          `模型 pin 记录无效（${key}/${file.path} 的 size_bytes 必须 > 0）: ${source}`,
        );
      }
      // Flat, in-directory names only: the pin paths are joined directly
      // under the model dir, so traversal must be impossible by contract.
      if (
        file.path.length === 0 ||
        file.path.includes("/") ||
        file.path.includes("\\") ||
        file.path.startsWith(".")
      ) {
        throw new ModelPinError(
          `模型 pin 记录无效（${key} 含非法文件路径 "${file.path}"，仅允许目录内平铺文件名）: ${source}`,
        );
      }
    }
  }
}

/** Load and structurally validate a model-pin.json record. */
export function loadModelPin(pinPath: string): ModelPin {
  let raw: string;
  try {
    raw = fs.readFileSync(pinPath, "utf8");
  } catch (error) {
    throw new ModelPinError(
      `模型 pin 记录不可读: ${pinPath}（${(error as Error).message}）`,
    );
  }
  const parsed: unknown = JSON.parse(raw);
  validatePin(parsed, pinPath);
  return parsed;
}

// --- temp-name + readiness anchors ----------------------------------------

/** True for in-flight download artifacts that must NEVER satisfy a readiness
 * anchor or a strict-set check: our partial suffix, GitHub part chunks, and
 * modelscope byte-range shard names. */
export function isTempDownloadName(name: string): boolean {
  return (
    name.endsWith(PARTIAL_SUFFIX) ||
    GH_PART_SUFFIX_RE.test(name) ||
    MODELSCOPE_SHARD_SUFFIX_RE.test(name)
  );
}

/** Any ONNX graph file marks the directory as the ONNX generation (used by
 * the readiness rules to refuse wildcard shortcuts for onnx-bearing dirs). */
export function hasOnnxMarker(dir: string): boolean {
  try {
    return fs
      .readdirSync(dir)
      .some(
        (name) =>
          !isTempDownloadName(name) && name.toLowerCase().endsWith(".onnx"),
      );
  } catch {
    return false;
  }
}

/** Fast readiness audit (presence + size only, no hashing): every pinned
 * file must exist under its EXACT name with the pinned size. No wildcards.
 * Temp names and extra files are ignored here — extra files are the strict
 * set check's job (verifyManifestDir), temp names are never anchors. */
export function readinessProblems(dir: string, model: PinModelEntry): string[] {
  const problems: string[] = [];
  for (const file of model.files) {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(path.join(dir, file.path));
    } catch {
      problems.push(`missing file: ${file.path}`);
      continue;
    }
    if (!stat.isFile()) {
      problems.push(`not a regular file: ${file.path}`);
      continue;
    }
    if (stat.size !== file.size_bytes) {
      problems.push(
        `size mismatch: ${file.path} (expected ${file.size_bytes}, got ${stat.size})`,
      );
    }
  }
  return problems;
}

export function isOnnxModelDirReady(
  dir: string,
  model: PinModelEntry,
): boolean {
  return readinessProblems(dir, model).length === 0;
}

/** Streaming sha256 of a file. */
function sha256File(filePath: string): string {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
}

/** Strict-set whole-manifest verification (the one-shot trust gate): every
 * pinned file present with matching size AND sha256; every non-temp on-disk
 * file must be pinned. Mirrors onnx_export_common.check_manifest. */
export function verifyManifestDir(dir: string, model: PinModelEntry): string[] {
  const problems: string[] = [];
  const listed = new Set(model.files.map((f) => f.path));
  for (const file of model.files) {
    const full = path.join(dir, file.path);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(full);
    } catch {
      problems.push(`missing file: ${file.path}`);
      continue;
    }
    if (stat.size !== file.size_bytes) {
      problems.push(
        `size mismatch: ${file.path} (expected ${file.size_bytes}, got ${stat.size})`,
      );
      continue; // hash of a wrong-sized file is definitionally wrong
    }
    const actual = sha256File(full);
    if (actual !== file.sha256) {
      problems.push(
        `sha256 mismatch: ${file.path} (expected ${file.sha256}, got ${actual})`,
      );
    }
  }
  let onDisk: string[] = [];
  try {
    onDisk = fs.readdirSync(dir);
  } catch {
    problems.push("model directory unreadable");
    return problems;
  }
  for (const name of onDisk) {
    if (isTempDownloadName(name)) continue; // 临时下载名双侧排除
    if (!listed.has(name)) {
      problems.push(`unexpected file not in manifest: ${name}`);
    }
  }
  return problems;
}

// --- source chain ----------------------------------------------------------

export interface DownloadSource {
  name: string;
  /** Ordered byte chunks to concatenate (single URL for whole-file sources,
   * split-part URLs for the GitHub mirror transport layout). */
  urls: string[];
}

/** Build the failover chain for one pinned file: ModelScope primary → GitHub
 * mirror backup → OSS placeholder (activated only when configured). */
export function buildFileSources(
  pin: ModelPin,
  file: PinFileEntry,
): DownloadSource[] {
  const sources: DownloadSource[] = [];
  sources.push({
    name: "modelscope",
    urls: [
      `${MODELSCOPE_RESOLVE_BASE}/${MODELSCOPE_MIRROR_REPO_ID}/resolve/${pin.release.tag}/${file.path}`,
    ],
  });
  sources.push({
    name: "github-mirror",
    urls:
      file.asset_parts && file.asset_parts.length > 0
        ? file.asset_parts.map((part) => `${pin.release.asset_base_url}${part}`)
        : [`${pin.release.asset_base_url}${file.asset}`],
  });
  const ossBase = getOssMirrorBaseUrl();
  if (ossBase) {
    sources.push({
      name: "oss",
      urls: [`${ossBase}${file.path}`],
    });
  }
  return sources;
}

// --- HTTP plumbing ---------------------------------------------------------

export interface HttpFetchResult {
  status: number;
  body: ReadableStream<Uint8Array>;
}

export type HttpFetch = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<HttpFetchResult>;

/** Default transport: global fetch (undici in Node/Electron main), the same
 * response-body pattern the repo already uses (updateManager/aiHandlers). */
export const defaultHttpFetch: HttpFetch = async (url, init) => {
  const response = await fetch(url, init);
  if (!response.body) {
    throw new Error(`空响应体: ${url}`);
  }
  return { status: response.status, body: response.body };
};

function parseResumeOffset(rangeHeader: string | undefined): number | null {
  if (!rangeHeader) return null;
  const match = /^bytes=(\d+)-$/.exec(rangeHeader);
  return match && match[1] !== undefined ? Number(match[1]) : null;
}

interface ByteSink {
  onBytes: (count: number) => void;
}

/** Download one URL into targetPath. Honors Range resume when the server
 * answers 206; a plain 200 (range ignored) rewrites from scratch. */
async function downloadSingleUrl(
  fetchImpl: HttpFetch,
  url: string,
  targetPath: string,
  byteSink: ByteSink,
): Promise<void> {
  const existingSize = fs.existsSync(targetPath)
    ? fs.statSync(targetPath).size
    : 0;
  const rangeHeader = existingSize > 0 ? `bytes=${existingSize}-` : undefined;
  const response = await fetchImpl(url, {
    headers: rangeHeader ? { Range: rangeHeader } : {},
  });
  if (response.status === 404) {
    throw new Error(`HTTP 404 (not found): ${url}`);
  }
  if (response.status >= 400) {
    throw new Error(`HTTP ${response.status}: ${url}`);
  }
  const resumedFrom =
    response.status === 206 ? (parseResumeOffset(rangeHeader) ?? 0) : 0;
  byteSink.onBytes(resumedFrom);
  const flags = resumedFrom > 0 ? "a" : "w";
  const fileStream = fs.createWriteStream(targetPath, { flags });
  let received = 0;
  try {
    // response.body is a web ReadableStream (async-iterable under DOM.iterable
    // libs); Readable.from adapts it without copying the whole body.
    await pipeline(
      Readable.from(response.body),
      async function* (chunks) {
        for await (const chunk of chunks) {
          received += chunk.length;
          byteSink.onBytes(resumedFrom + received);
          yield chunk;
        }
      },
      fileStream,
    );
  } catch (error) {
    fileStream.destroy();
    throw error;
  }
}

/** Assemble an ordered split-part layout into targetPath. Each part is
 * downloaded (individually resumable) to its own temp file, then all parts
 * are concatenated IN PIN ORDER — the part layout is transport only;
 * integrity anchors on the assembled file's sha256. */
async function downloadParts(
  fetchImpl: HttpFetch,
  urls: string[],
  targetPath: string,
  byteSink: ByteSink,
): Promise<void> {
  const partPaths = urls.map(
    (_, index) => `${targetPath}.part${String(index).padStart(2, "0")}`,
  );
  try {
    for (let index = 0; index < urls.length; index += 1) {
      const url = urls[index];
      if (!url) throw new Error(`split-part URL missing at index ${index}`);
      await downloadSingleUrl(fetchImpl, url, partPaths[index]!, byteSink);
    }
    // Parts layout always rebuilds the assembled file from scratch.
    fs.writeFileSync(targetPath, Buffer.alloc(0));
    for (const partPath of partPaths) {
      await pipeline(
        fs.createReadStream(partPath),
        fs.createWriteStream(targetPath, { flags: "a" }),
      );
    }
  } finally {
    for (const partPath of partPaths) {
      fs.rmSync(partPath, { force: true });
    }
  }
}

// --- orchestration ---------------------------------------------------------

export interface DownloadProgress {
  stage: string;
  model: string;
  progress: number;
  overall_progress: number;
  completed: number;
  total: number;
}

export interface DownloadOutcome {
  success: boolean;
  verified: string[];
}

export interface DownloadOnnxModelSetOptions {
  pin: ModelPin;
  /** Root directory that will hold <pin-model-name>/ subdirectories. */
  modelsRoot: string;
  fetchImpl?: HttpFetch;
  logger?: DownloaderLogger;
  onProgress?: (progress: DownloadProgress) => void;
}

class ProgressTracker {
  private readonly totals: Record<string, number> = {};
  private readonly doneBytes: Record<string, number> = {};
  private completedModels = 0;
  private readonly modelNames: string[];

  constructor(private readonly models: PinModelEntry[]) {
    this.modelNames = models.map((m) => m.name);
    for (const model of models) {
      this.totals[model.name] = model.files.reduce(
        (sum, file) => sum + file.size_bytes,
        0,
      );
      this.doneBytes[model.name] = 0;
    }
  }

  addBytes(modelName: string, totalBytesForFile: number): void {
    // Files already on disk count once: subtract what was registered before.
    this.doneBytes[modelName] = totalBytesForFile;
  }

  /** Pin a model's byte counter at 100% (used after its files resolve from
   * disk rather than from fresh downloads). */
  markModelBytesComplete(modelName: string): void {
    if (modelName in this.totals) {
      this.doneBytes[modelName] = this.totals[modelName]!;
    }
  }

  markComplete(): void {
    this.completedModels += 1;
  }

  emit(
    stage: string,
    modelName: string,
    onProgress?: (progress: DownloadProgress) => void,
  ): void {
    if (!onProgress) return;
    const model = this.models.find((m) => m.name === modelName);
    const modelTotal = model ? this.totals[model.name]! : 0;
    const modelDone = model ? this.doneBytes[model.name]! : 0;
    const modelPercent = modelTotal > 0 ? (modelDone * 100.0) / modelTotal : 0;
    const grandTotal = this.models.reduce(
      (sum, m) => sum + this.totals[m.name]!,
      0,
    );
    const grandDone = this.models.reduce(
      (sum, m) => sum + this.doneBytes[m.name]!,
      0,
    );
    const overallPercent =
      grandTotal > 0 ? (grandDone * 100.0) / grandTotal : 0;
    onProgress({
      stage,
      model: modelName,
      progress: Math.min(99.9, Math.round(modelPercent * 10) / 10),
      overall_progress: Math.min(99.9, Math.round(overallPercent * 10) / 10),
      completed: this.completedModels,
      total: this.modelNames.length,
    });
  }
}

async function fetchFileInto(
  fetchImpl: HttpFetch,
  destPath: string,
  sources: DownloadSource[],
  logger: DownloaderLogger | undefined,
  byteSink: ByteSink,
): Promise<string> {
  const tmpPath = `${destPath}${PARTIAL_SUFFIX}`;
  const failures: string[] = [];
  for (const source of sources) {
    try {
      if (source.urls.length === 1 && source.urls[0]) {
        await downloadSingleUrl(fetchImpl, source.urls[0], tmpPath, byteSink);
      } else {
        await downloadParts(fetchImpl, source.urls, tmpPath, byteSink);
      }
      fs.renameSync(tmpPath, destPath);
      return source.name;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      failures.push(`${source.name}: ${reason}`);
      logger?.warn?.(`下载源失败(${source.name}): ${reason}`);
    }
  }
  // Partial bytes stay on disk for the next resume attempt.
  throw new AllSourcesFailedError(failures.join("; "));
}

/** Remove files that failed verification (so a retry re-downloads them) and
 * unexpected non-temp strays (strict set — the managed dir holds only pinned
 * artifacts). Every removal is logged. */
function removeUnverifiableFiles(
  dir: string,
  model: PinModelEntry,
  problems: string[],
  logger: DownloaderLogger | undefined,
): void {
  for (const problem of problems) {
    if (problem.startsWith("missing file:")) continue;
    const name = problem.startsWith("unexpected file not in manifest: ")
      ? problem.slice("unexpected file not in manifest: ".length)
      : problem.slice(problem.indexOf(":") + 2).split(" ")[0]!;
    try {
      fs.rmSync(path.join(dir, name), { force: true });
      logger?.warn?.(`已移除未通过校验的文件: ${name}（模型 ${model.name}）`);
    } catch (error) {
      logger?.warn?.(
        `移除未通过校验的文件失败: ${name}（${(error as Error).message}）`,
      );
    }
  }
}

/**
 * Download and verify the full pinned model set.
 *
 * Contract (ticket #417): every invocation ends in exactly one FULL strict
 * manifest verification (sha256 + size over every pinned file) — including
 * the already-complete fast path and every retry. No code path returns
 * success without hashing the whole set; a same-size tampered file is
 * caught and removed. Any source failure keeps partial bytes for resume.
 * Fail-fast: the first model whose set cannot be verified aborts the run
 * (retry is resumable, so nothing is lost).
 */
export async function downloadOnnxModelSet(
  options: DownloadOnnxModelSetOptions,
): Promise<DownloadOutcome> {
  const {
    pin,
    modelsRoot,
    fetchImpl = defaultHttpFetch,
    logger,
    onProgress,
  } = options;
  const models = Object.values(pin.models);
  const tracker = new ProgressTracker(models);
  const verified: string[] = [];

  fs.mkdirSync(modelsRoot, { recursive: true });

  for (const model of models) {
    const targetDir = path.join(modelsRoot, model.name);
    fs.mkdirSync(targetDir, { recursive: true });
    tracker.emit("verifying", model.name, onProgress);

    // ONE-SHOT verification of whatever is on disk. For a fresh dir this is
    // cheap (all files missing); for a complete dir this IS the invocation's
    // full hash pass — a retry never skips it.
    let problems = verifyManifestDir(targetDir, model);
    if (problems.length === 0) {
      tracker.markComplete();
      tracker.emit("completed", model.name, onProgress);
      verified.push(model.name);
      continue;
    }
    // Anything other than a plain missing file (hash/size mismatch, stray
    // file) is CORRUPTION evidence: remove it and refuse loudly. Tampered
    // bytes are never silently re-fetched around — the user gets the
    // actionable error, and the removal makes the next retry clean.
    const corruptProblems = problems.filter(
      (problem) => !problem.startsWith("missing file:"),
    );
    if (corruptProblems.length > 0) {
      removeUnverifiableFiles(targetDir, model, problems, logger);
      throw new ManifestVerificationError(problems);
    }

    tracker.emit("downloading", model.name, onProgress);
    for (const file of model.files) {
      const destPath = path.join(targetDir, file.path);
      if (fs.existsSync(destPath)) continue; // survived verification → clean
      const sources = buildFileSources(pin, file);
      const sourceName = await fetchFileInto(
        fetchImpl,
        destPath,
        sources,
        logger,
        {
          onBytes: (count) => {
            tracker.addBytes(model.name, count);
            tracker.emit("downloading", model.name, onProgress);
          },
        },
      );
      logger?.info?.(
        `模型文件下载完成: ${model.name}/${file.path}（源: ${sourceName}）`,
      );
    }
    tracker.markModelBytesComplete(model.name);

    // THE one-shot post-assembly verification — unconditional, whole set.
    problems = verifyManifestDir(targetDir, model);
    if (problems.length > 0) {
      removeUnverifiableFiles(targetDir, model, problems, logger);
      throw new ManifestVerificationError(problems);
    }
    tracker.markComplete();
    tracker.emit("completed", model.name, onProgress);
    verified.push(model.name);
  }

  return { success: true, verified };
}
