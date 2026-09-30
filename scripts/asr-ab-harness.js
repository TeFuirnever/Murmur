#!/usr/bin/env node
"use strict";

// [20261001_Feat_414_AbCorpusHarness] Ticket #414 (spec #412 T3): real-
// speech A/B corpus harness + torch baseline. Drives any engine that speaks
// the production stdin/stdout JSON-lines protocol (funasr_server.py today,
// the ONNX server in spec #412 T5 later) over the corpus in
// scripts/asr-corpus/, and emits a four-dimension comparison report:
//
//   1. per-domain CER            (character error rate, punctuation-stripped)
//   2. punctuation insert/delete diff (vs authored punctuated references)
//   3. hotword repair rate       (double pass: hotword off vs on)
//   4. timestamp deviation       (vs golden expectedSegments, in ms)
//
// One command per engine; `--compare baseline.json candidate.json` diffs two
// runs for the torch-vs-ONNX verdict (spec #412 T4).
//
// Usage:
//   node scripts/asr-ab-harness.js --engine torch
//   node scripts/asr-ab-harness.js --engine torch --report out.json --markdown out.md
//   node scripts/asr-ab-harness.js --compare torch.json onnx.json
//
// Dev-machine only for real engines (torch model load is far too heavy for
// PR CI — the corpus integrity gate that DOES run in CI is
// tests/unit/asr-ab-corpus.test.ts). A workflow_dispatch job in
// .github/workflows/asr-ab.yml makes the full run CI-callable on demand.
//
// Exit codes: 0 pass · 1 regression/infra failure · 2 usage error.
// [20261001_Feat_414_AbCorpusHarness] END

const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const { charErrorRate, normalizeForCer } = require("./asr-regression.js");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_CORPUS_DIR = path.join(ROOT, "scripts", "asr-corpus");
const DEFAULT_REPORT_PATH = path.join(ROOT, "scripts", "asr_ab_results.json");

// [20261001_Feat_414_AbCorpusHarness] Named constants (repo rule: no magic
// numbers). Timeouts mirror scripts/asr-regression.js: torch cold model
// load needs a long budget; requests get 3min for the longest noisy clips.
const DEFAULT_INIT_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_REQUEST_TIMEOUT_MS = 3 * 60 * 1000;
const SERVER_EXIT_GRACE_MS = 3000;

// Engine presets: torch is the current production stack (repo-root
// funasr_server.py + embedded python). The onnx entry is the landing slot
// for spec #412 T5 — until that server exists the preset resolves to a
// missing file and main() fails with a pointer to --server-script, which
// also lets any ad-hoc engine binary be driven without touching this file.
const ENGINE_PRESETS = {
  torch: {
    serverScript: "funasr_server.py",
    description: "fp32 torch stack (funasr AutoModel, current production)",
  },
  onnx: {
    serverScript: "funasr_server_onnx.py",
    description:
      "ONNX int8 stack (spec #412 T5, not landed yet — pass --server-script)",
  },
};

// [20261001_Feat_414_AbCorpusHarness] A/B gate tolerances for --compare.
// Spec #412: "逐域 CER 门禁(torch vs ONNX delta)" and "热词修复率 ≥ torch 才
// 算过". CER tolerance is absolute on the domain mean; timestamp tolerance is
// absolute ms on the pooled mean deviation. These defaults are the gate the
// T4 verdict runs with unless the owner overrides them on the CLI.
const CER_DELTA_TOLERANCE = 0.02;
const TIMESTAMP_DELTA_TOLERANCE_MS = 150;

// Punctuation width equivalence: full/half-width variants of the same mark
// are the same punctuation decision (the punc model may emit either).
// Distinct marks (、 vs ，) never collapse — a swap is a real diff.
const WIDTH_EQUIVALENT = new Map([
  ["，", ","],
  [",", "，"],
  ["。", "."],
  [".", "。"],
  ["！", "!"],
  ["!", "！"],
  ["？", "?"],
  ["?", "？"],
  ["；", ";"],
  [";", "；"],
  ["：", ":"],
  [":", "："],
]);

function marksEquivalent(a, b) {
  return a === b || WIDTH_EQUIVALENT.get(a) === b;
}

// ---------------------------------------------------------------------------
// Text skeleton + punctuation events
// ---------------------------------------------------------------------------

// Split text into a punctuation-stripped skeleton (aligned with
// normalizeForCer semantics) plus punctuation "events", each anchored to the
// number of skeleton characters that precede it. Runs of adjacent marks
// (e.g. `。"`) collapse into one multi-mark event.
function extractSkeletonAndEvents(text) {
  const skeleton = [];
  const events = [];
  let currentRun = null;
  for (const ch of String(text ?? "").normalize("NFKC")) {
    if (/[\p{L}\p{N}]/u.test(ch)) {
      skeleton.push(ch.toLowerCase());
      currentRun = null;
      continue;
    }
    if (/\s/u.test(ch)) {
      continue; // whitespace is not a punctuation decision
    }
    if (currentRun) {
      currentRun.marks.push(ch);
    } else {
      currentRun = { gap: skeleton.length, marks: [ch] };
      events.push(currentRun);
    }
  }
  return { skeleton, events };
}

// Levenshtein alignment (ref → hyp character indices; -1 when a ref char has
// no counterpart). Refs are short sentences, O(m·n) DP with backtrace.
function alignSkeletons(refSkeleton, hypSkeleton) {
  const m = refSkeleton.length;
  const n = hypSkeleton.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i]);
  for (let j = 1; j <= n; j += 1) dp[0][j] = j;
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (refSkeleton[i - 1] === hypSkeleton[j - 1] ? 0 : 1),
      );
    }
  }
  const aligned = new Array(m).fill(-1);
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (
      dp[i][j] ===
      dp[i - 1][j - 1] + (refSkeleton[i - 1] === hypSkeleton[j - 1] ? 0 : 1)
    ) {
      aligned[i - 1] = j - 1;
      i -= 1;
      j -= 1;
    } else if (dp[i][j] === dp[i - 1][j] + 1) {
      i -= 1;
    } else {
      j -= 1;
    }
  }
  return aligned;
}

// 标点插删差: compare the punctuation decisions of a hypothesis against a
// punctuated reference. Marks anchored to skeleton gaps surviving character
// substitutions still match; a changed mark counts as one deletion + one
// insertion (both an author decision lost and an engine decision added).
function punctuationDiff(reference, hypothesis) {
  const ref = extractSkeletonAndEvents(reference);
  const hyp = extractSkeletonAndEvents(hypothesis);
  const aligned = alignSkeletons(ref.skeleton, hyp.skeleton);

  // Map a ref skeleton gap (g chars consumed) to the hyp gap after the
  // aligned hyp char; null when the anchor char was deleted.
  const refGapToHypGap = (gap) => {
    if (gap === 0) return 0;
    const hypIdx = aligned[gap - 1];
    return hypIdx === -1 ? null : hypIdx + 1;
  };

  const hypEventsByGap = new Map();
  for (const event of hyp.events) {
    hypEventsByGap.set(event.gap, event);
  }

  let insertions = 0;
  let deletions = 0;
  let matched = 0;
  const consumedHypEvents = new Set();

  for (const refEvent of ref.events) {
    const hypGap = refGapToHypGap(refEvent.gap);
    const hypEvent = hypGap === null ? undefined : hypEventsByGap.get(hypGap);
    if (hypEvent) {
      consumedHypEvents.add(hypEvent);
      // Pair marks positionally; unmatched leftovers split into ins/del.
      const hypMarks = [...hypEvent.marks];
      for (const refMark of refEvent.marks) {
        const at = hypMarks.findIndex((hypMark) =>
          marksEquivalent(refMark, hypMark),
        );
        if (at !== -1) {
          hypMarks.splice(at, 1);
          matched += 1;
        } else {
          deletions += 1;
        }
      }
      insertions += hypMarks.length;
    } else {
      deletions += refEvent.marks.length;
    }
  }
  for (const event of hyp.events) {
    if (!consumedHypEvents.has(event)) insertions += event.marks.length;
  }
  return { insertions, deletions, matched };
}

// ---------------------------------------------------------------------------
// Hotword repair classification
// ---------------------------------------------------------------------------

function normalizedContains(haystack, needle) {
  return normalizeForCer(haystack).includes(normalizeForCer(needle));
}

function classifyHotwordCase({
  reference,
  terms,
  hypothesisWithoutHotword,
  hypothesisWithHotword,
}) {
  const termResults = terms.map((term) => {
    const withoutOk = normalizedContains(hypothesisWithoutHotword, term);
    const withOk = normalizedContains(hypothesisWithHotword, term);
    const verdict = withoutOk
      ? withOk
        ? "always-right"
        : "regressed"
      : withOk
        ? "repaired"
        : "still-wrong";
    return {
      term,
      withoutHotwordCorrect: withoutOk,
      withHotwordCorrect: withOk,
      verdict,
    };
  });
  // Verdict → counts key (explicit map: a regex title-case would lowercase
  // "still-wrong" into the wrong key and silently null the repair rate).
  const VERDICT_COUNT_KEYS = {
    repaired: "repaired",
    "still-wrong": "stillWrong",
    "always-right": "alwaysRight",
    regressed: "regressed",
  };
  const counts = { repaired: 0, stillWrong: 0, alwaysRight: 0, regressed: 0 };
  for (const r of termResults) counts[VERDICT_COUNT_KEYS[r.verdict]] += 1;
  const discriminative = counts.repaired + counts.stillWrong;
  return {
    reference,
    terms: termResults,
    counts,
    repairRate: discriminative === 0 ? null : counts.repaired / discriminative,
  };
}

// ---------------------------------------------------------------------------
// Timestamp deviation vs golden segments
// ---------------------------------------------------------------------------

// Fraction of the expected skeleton's characters found in order inside the
// actual skeleton (LCS / expected length) — robust to punctuation and
// partial merges/splits from the engine's segmenter.
function orderedOverlapRatio(expectedSkeleton, actualSkeleton) {
  const lcs = Array.from({ length: expectedSkeleton.length + 1 }, () =>
    new Array(actualSkeleton.length + 1).fill(0),
  );
  for (let i = expectedSkeleton.length - 1; i >= 0; i -= 1) {
    for (let j = actualSkeleton.length - 1; j >= 0; j -= 1) {
      lcs[i][j] =
        expectedSkeleton[i] === actualSkeleton[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  return expectedSkeleton.length === 0
    ? 0
    : lcs[0][0] / expectedSkeleton.length;
}

function segmentSkeleton(segment) {
  return normalizeForCer(segment.text ?? "");
}

function percentile(sortedValues, p) {
  if (sortedValues.length === 0) return 0;
  const idx = Math.min(
    sortedValues.length - 1,
    Math.ceil(p * sortedValues.length) - 1,
  );
  return sortedValues[idx];
}

function timestampDeviation(expectedSegments, actualSegments) {
  const expected = expectedSegments ?? [];
  const actual = actualSegments ?? [];
  const used = new Set();
  const matched = [];
  const missingExpected = [];
  const MIN_OVERLAP = 0.5; // majority of expected chars must survive
  for (let e = 0; e < expected.length; e += 1) {
    const exp = expected[e];
    const expSkeleton = segmentSkeleton(exp);
    let bestIdx = -1;
    let bestRatio = 0;
    for (let a = 0; a < actual.length; a += 1) {
      if (used.has(a)) continue;
      const ratio = orderedOverlapRatio(
        expSkeleton,
        segmentSkeleton(actual[a]),
      );
      if (ratio > bestRatio) {
        bestRatio = ratio;
        bestIdx = a;
      }
    }
    if (bestIdx === -1 || bestRatio < MIN_OVERLAP) {
      missingExpected.push(e);
      continue;
    }
    used.add(bestIdx);
    const act = actual[bestIdx];
    const dStartMs = act.startMs - exp.startMs;
    const dEndMs = act.endMs - exp.endMs;
    matched.push({
      expectedIndex: e,
      actualIndex: bestIdx,
      overlapRatio: bestRatio,
      dStartMs,
      dEndMs,
    });
  }
  const extraActual = actual
    .map((_, idx) => idx)
    .filter((idx) => !used.has(idx));
  const absDevs = matched.flatMap((m) => [
    Math.abs(m.dStartMs),
    Math.abs(m.dEndMs),
  ]);
  const sorted = [...absDevs].sort((a, b) => a - b);
  const mean =
    sorted.length === 0
      ? 0
      : sorted.reduce((sum, v) => sum + v, 0) / sorted.length;
  const median = sorted.length === 0 ? 0 : percentile(sorted, 0.5);
  return {
    matched,
    missingExpected,
    extraActual,
    meanAbsDevMs: mean,
    medianAbsDevMs: median,
    p95AbsDevMs: percentile(sorted, 0.95),
    maxAbsDevMs: sorted.length === 0 ? 0 : sorted[sorted.length - 1],
  };
}

// ---------------------------------------------------------------------------
// Per-domain aggregation
// ---------------------------------------------------------------------------

function medianOf(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  // Even-sized samples average the two middle values (statistical median,
  // matching what a reader expects a "median CER" to be).
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function aggregateByDomain(cases) {
  const byDomain = {};
  for (const c of cases) {
    byDomain[c.domain] ??= {
      count: 0,
      cerSum: 0,
      puncInsertions: 0,
      puncDeletions: 0,
      cers: [],
    };
    const agg = byDomain[c.domain];
    agg.count += 1;
    agg.cerSum += Number.isFinite(c.cer) ? c.cer : 1;
    agg.cers.push(Number.isFinite(c.cer) ? c.cer : 1);
    if (c.punc) {
      agg.puncInsertions += c.punc.insertions;
      agg.puncDeletions += c.punc.deletions;
    }
  }
  for (const domain of Object.keys(byDomain)) {
    const agg = byDomain[domain];
    byDomain[domain] = {
      count: agg.count,
      meanCer: agg.cerSum / agg.count,
      medianCer: medianOf(agg.cers),
      maxCer: Math.max(...agg.cers),
      puncInsertions: agg.puncInsertions,
      puncDeletions: agg.puncDeletions,
    };
  }
  return byDomain;
}

// ---------------------------------------------------------------------------
// Corpus manifest loading + validation
// ---------------------------------------------------------------------------

const SUPPORTED_AUDIO_EXTENSIONS = new Set([".flac", ".wav"]);

function validateExpectedSegments(segs) {
  if (!Array.isArray(segs) || segs.length === 0) return false;
  let prevEnd = -1;
  for (const seg of segs) {
    if (
      !seg ||
      typeof seg.startMs !== "number" ||
      typeof seg.endMs !== "number" ||
      typeof seg.text !== "string" ||
      seg.text.trim() === "" ||
      !Number.isInteger(seg.startMs) ||
      !Number.isInteger(seg.endMs) ||
      seg.startMs < 0 ||
      seg.endMs <= seg.startMs ||
      seg.startMs < prevEnd
    ) {
      return false;
    }
    prevEnd = seg.endMs;
  }
  return true;
}

function loadCorpusManifest(corpusDir) {
  const manifestPath = path.join(corpusDir, "manifest.json");
  let raw;
  try {
    raw = fs.readFileSync(manifestPath, "utf8");
  } catch (readError) {
    return { error: `cannot read ${manifestPath}: ${readError.message}` };
  }
  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (parseError) {
    return { error: `manifest is not valid JSON: ${parseError.message}` };
  }
  const issues = [];
  if (manifest.version !== 1)
    issues.push(`version must be 1, got ${manifest.version}`);
  if (typeof manifest.name !== "string" || !manifest.name) {
    issues.push("name must be a non-empty string");
  }
  const domains = Array.isArray(manifest.domains) ? manifest.domains : [];
  const domainIds = new Set();
  for (const domain of domains) {
    if (!domain || typeof domain.id !== "string")
      issues.push("domain missing id");
    else if (domainIds.has(domain.id))
      issues.push(`duplicate domain id ${domain.id}`);
    else domainIds.add(domain.id);
  }
  if (!Array.isArray(manifest.cases) || manifest.cases.length === 0) {
    issues.push("cases must be a non-empty array");
  }
  const caseIds = new Set();
  for (const corpusCase of manifest.cases ?? []) {
    if (!corpusCase || typeof corpusCase.id !== "string" || !corpusCase.id) {
      issues.push("case missing id");
      continue;
    }
    if (caseIds.has(corpusCase.id))
      issues.push(`duplicate case id ${corpusCase.id}`);
    caseIds.add(corpusCase.id);
    if (typeof corpusCase.audio !== "string" || !corpusCase.audio) {
      issues.push(`case ${corpusCase.id}: audio path missing`);
    } else {
      const audioPath = path.resolve(corpusDir, corpusCase.audio);
      if (
        !SUPPORTED_AUDIO_EXTENSIONS.has(path.extname(audioPath).toLowerCase())
      ) {
        issues.push(`case ${corpusCase.id}: unsupported audio extension`);
      }
      if (!fs.existsSync(audioPath)) {
        issues.push(
          `case ${corpusCase.id}: audio file not found: ${corpusCase.audio}`,
        );
      }
      corpusCase.audioPath = audioPath;
    }
    if (!domainIds.has(corpusCase.domain)) {
      issues.push(`case ${corpusCase.id}: unknown domain ${corpusCase.domain}`);
    }
    if (
      typeof corpusCase.provenance !== "string" ||
      !corpusCase.provenance.trim()
    ) {
      issues.push(`case ${corpusCase.id}: provenance must be documented`);
    }
    const reference = corpusCase.reference;
    if (
      !reference ||
      typeof reference.text !== "string" ||
      !reference.text.trim()
    ) {
      issues.push(`case ${corpusCase.id}: reference.text missing`);
    }
    if (
      reference &&
      reference.punctuatedText !== null &&
      reference.punctuatedText !== undefined &&
      (typeof reference.punctuatedText !== "string" ||
        !reference.punctuatedText.trim())
    ) {
      issues.push(
        `case ${corpusCase.id}: reference.punctuatedText must be a non-empty string when present`,
      );
    }
    const hotword = corpusCase.hotword;
    if (hotword !== null && hotword !== undefined) {
      if (
        !Array.isArray(hotword.terms) ||
        hotword.terms.length === 0 ||
        hotword.terms.some((t) => typeof t !== "string" || !t.trim()) ||
        typeof hotword.hotwordString !== "string" ||
        !hotword.hotwordString.trim()
      ) {
        issues.push(`case ${corpusCase.id}: malformed hotword spec`);
      }
    }
    if (
      corpusCase.expectedSegments !== null &&
      corpusCase.expectedSegments !== undefined &&
      !validateExpectedSegments(corpusCase.expectedSegments)
    ) {
      issues.push(
        `case ${corpusCase.id}: expectedSegments must be sorted, positive, non-overlapping`,
      );
    }
  }
  if (issues.length > 0) {
    return {
      error: `corpus manifest invalid (${issues.length} issues): ${issues.slice(0, 5).join("; ")}`,
    };
  }
  return { manifest };
}

// ---------------------------------------------------------------------------
// Client loop against a real engine server (spawn shape mirrors
// funasrServer.ts / asr-regression.js)
// ---------------------------------------------------------------------------

function resolveInterpreter() {
  const candidates =
    process.platform === "win32"
      ? [path.join(ROOT, "python", "python.exe"), "python"]
      : [path.join(ROOT, "python", "bin", "python3.11"), "python3", "python"];
  for (const candidate of candidates) {
    if (path.isAbsolute(candidate)) {
      if (fs.existsSync(candidate)) return candidate;
    } else {
      const probe = spawnSync(candidate, ["--version"], { encoding: "utf8" });
      if (!probe.error) return candidate;
    }
  }
  return null;
}

function killServerProcess(proc) {
  if (!proc || proc.exitCode !== null || proc.signalCode) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/T", "/F", "/PID", String(proc.pid)], {
      windowsHide: true,
    });
    return;
  }
  try {
    proc.kill("SIGKILL");
  } catch {
    // already dead — nothing to clean up
  }
}

function mapServerSegments(segments) {
  if (!Array.isArray(segments)) return [];
  return segments.map((seg) => ({
    startMs: Number(seg.start_ms ?? seg.startMs ?? 0),
    endMs: Number(seg.end_ms ?? seg.endMs ?? 0),
    text: String(seg.text ?? ""),
  }));
}

// A hotword case expands into two protocol passes (hotword off, then on) so
// the repair rate measures what the hotword pass actually changed.
function buildRequestPlan(manifest) {
  const plan = [];
  for (const corpusCase of manifest.cases) {
    if (corpusCase.hotword) {
      plan.push({ corpusCase, pass: "no-hotword", hotword: "" });
      plan.push({
        corpusCase,
        pass: "hotword",
        hotword: corpusCase.hotword.hotwordString,
      });
    } else {
      plan.push({ corpusCase, pass: "single", hotword: null });
    }
  }
  return plan;
}

function scoreCorpusRun(manifest, passResults) {
  const scoredCases = [];
  for (const corpusCase of manifest.cases) {
    const noHotword = passResults.get(`${corpusCase.id}#no-hotword`);
    const withHotword = passResults.get(`${corpusCase.id}#hotword`);
    const single = passResults.get(`${corpusCase.id}#single`);
    const primary = withHotword ?? single;
    const hypothesis = primary?.text ?? "";
    const cer =
      primary?.success === false
        ? Number.POSITIVE_INFINITY
        : charErrorRate(corpusCase.reference.text, hypothesis);
    const punc =
      corpusCase.reference.punctuatedText && primary?.success !== false
        ? punctuationDiff(corpusCase.reference.punctuatedText, hypothesis)
        : null;
    const timestamp =
      corpusCase.expectedSegments && primary
        ? timestampDeviation(corpusCase.expectedSegments, primary.segments)
        : null;
    let hotword = null;
    if (corpusCase.hotword) {
      hotword = classifyHotwordCase({
        reference: corpusCase.reference.text,
        terms: corpusCase.hotword.terms,
        hypothesisWithoutHotword: noHotword?.text ?? "",
        hypothesisWithHotword: withHotword?.text ?? "",
      });
    }
    scoredCases.push({
      id: corpusCase.id,
      domain: corpusCase.domain,
      provenance: corpusCase.provenance,
      reference: corpusCase.reference.text,
      hypothesis,
      hypothesisWithoutHotword: noHotword?.text ?? "",
      rawHypothesis: primary?.rawText ?? "",
      segments: primary?.segments ?? [],
      success: primary?.success !== false,
      serverError: primary?.success === false ? primary.error : undefined,
      cer,
      punc,
      hotword,
      timestamp,
      cerNoHotword: noHotword
        ? charErrorRate(corpusCase.reference.text, noHotword.text ?? "")
        : undefined,
      elapsedMs: primary?.elapsedMs,
    });
  }
  return scoredCases;
}

function summarizeHotwords(scoredCases) {
  const counts = { repaired: 0, stillWrong: 0, alwaysRight: 0, regressed: 0 };
  const cases = [];
  for (const c of scoredCases) {
    if (!c.hotword) continue;
    for (const key of Object.keys(counts)) counts[key] += c.hotword.counts[key];
    cases.push({
      id: c.id,
      reference: c.reference,
      hypothesisWithoutHotword: c.hypothesisWithoutHotword ?? "",
      hypothesisWithHotword: c.hypothesis,
      terms: c.hotword.terms,
    });
  }
  const discriminative = counts.repaired + counts.stillWrong;
  return {
    counts,
    repairRate: discriminative === 0 ? null : counts.repaired / discriminative,
    cases,
  };
}

function summarizeTimestamps(scoredCases) {
  const absDevs = [];
  let missing = 0;
  let extra = 0;
  for (const c of scoredCases) {
    if (!c.timestamp) continue;
    for (const m of c.timestamp.matched) {
      absDevs.push(Math.abs(m.dStartMs), Math.abs(m.dEndMs));
    }
    missing += c.timestamp.missingExpected.length;
    extra += c.timestamp.extraActual.length;
  }
  const sorted = absDevs.sort((a, b) => a - b);
  const mean =
    sorted.length === 0
      ? 0
      : sorted.reduce((sum, v) => sum + v, 0) / sorted.length;
  return {
    pooledBoundaryCount: sorted.length,
    meanAbsDevMs: mean,
    medianAbsDevMs: medianOf(sorted),
    p95AbsDevMs: percentile(sorted, 0.95),
    maxAbsDevMs: sorted.length === 0 ? 0 : sorted[sorted.length - 1],
    missingSegmentCount: missing,
    extraSegmentCount: extra,
  };
}

function runCorpus(options, callbacks = {}) {
  const {
    interpreter,
    serverScript,
    corpusDir = DEFAULT_CORPUS_DIR,
    engineName = "custom",
    initTimeoutMs = DEFAULT_INIT_TIMEOUT_MS,
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    damoRoot = process.env.DAMO_ROOT || null,
    reportPath = DEFAULT_REPORT_PATH,
    env = {},
  } = options;

  if (!interpreter) {
    return Promise.reject(new Error("no python interpreter found"));
  }
  if (!fs.existsSync(serverScript)) {
    return Promise.reject(
      new Error(`server script not found: ${serverScript}`),
    );
  }
  const { manifest, error } = loadCorpusManifest(corpusDir);
  if (error) return Promise.reject(new Error(error));

  const plan = buildRequestPlan(manifest);
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const serverArgs = damoRoot
      ? [serverScript, "--damo-root", damoRoot]
      : [serverScript];
    const proc = spawn(interpreter, serverArgs, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: { ...process.env, ...env },
    });

    const passResults = new Map();
    let buffer = "";
    let serverReady = false;
    let settled = false;
    let planIndex = 0;
    let requestStartedAt = 0;
    let initTimer = null;
    let requestTimer = null;

    const finish = (error2) => {
      if (settled) return;
      settled = true;
      if (initTimer) clearTimeout(initTimer);
      if (requestTimer) clearTimeout(requestTimer);
      try {
        proc.stdin.write(JSON.stringify({ action: "exit" }) + "\n");
      } catch {
        // stdin already closed
      }
      const graceTimer = setTimeout(
        () => killServerProcess(proc),
        SERVER_EXIT_GRACE_MS,
      );
      graceTimer.unref?.();
      proc.stdout.removeAllListeners();
      // Kill unconditionally after the polite ask: a leaked engine process
      // pins gigabytes of RAM (see asr-regression.js review fixup).
      killServerProcess(proc);
      if (error2) {
        reject(error2);
        return;
      }
      const scoredCases = scoreCorpusRun(manifest, passResults);
      const finiteCers = scoredCases.filter((c) => Number.isFinite(c.cer));
      const report = {
        generatedAt: new Date().toISOString(),
        engine: {
          name: engineName,
          interpreter,
          serverScript,
          protocol: "stdio-jsonl",
        },
        corpus: {
          dir: corpusDir,
          name: manifest.name,
          manifestVersion: manifest.version,
          caseCount: manifest.cases.length,
        },
        cases: scoredCases,
        domains: aggregateByDomain(scoredCases),
        hotword: summarizeHotwords(scoredCases),
        timestampSummary: summarizeTimestamps(scoredCases),
        summary: {
          caseCount: scoredCases.length,
          failedCount: scoredCases.filter((c) => !c.success).length,
          meanCer:
            finiteCers.length === 0
              ? null
              : finiteCers.reduce((sum, c) => sum + c.cer, 0) /
                finiteCers.length,
        },
        elapsedMs: Date.now() - startedAt,
        reportPath,
      };
      try {
        fs.mkdirSync(path.dirname(reportPath), { recursive: true });
        fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
      } catch (writeError) {
        callbacks.onLog?.(
          `warn: could not write report: ${writeError.message}`,
        );
      }
      resolve(report);
    };

    proc.stderr.on("data", (data) => {
      for (const line of String(data).split("\n").filter(Boolean)) {
        callbacks.onLog?.(`[server:stderr] ${line.slice(0, 300)}`);
      }
    });

    proc.on("error", (err) =>
      finish(new Error(`server spawn failed: ${err.message}`)),
    );
    proc.on("close", (code) => {
      if (!settled) finish(new Error(`server exited early (code ${code})`));
    });

    const sendNext = () => {
      if (planIndex >= plan.length) {
        finish(null);
        return;
      }
      const entry = plan[planIndex];
      const request = {
        action: "transcribe_file",
        audio_path: entry.corpusCase.audioPath,
        options: entry.hotword === null ? {} : { hotword: entry.hotword },
        request_id: `${entry.corpusCase.id}#${entry.pass}`,
      };
      callbacks.onLog?.(`[${request.request_id}] transcribing…`);
      requestStartedAt = Date.now();
      if (requestTimer) clearTimeout(requestTimer);
      requestTimer = setTimeout(() => {
        finish(
          new Error(
            `request timeout after ${requestTimeoutMs}ms: ${request.request_id}`,
          ),
        );
      }, requestTimeoutMs);
      proc.stdin.write(`${JSON.stringify(request)}\n`);
    };

    const handleLine = (line) => {
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        callbacks.onLog?.(`[server] (non-json) ${line.slice(0, 200)}`);
        return;
      }
      if (!serverReady) {
        serverReady = true;
        if (initTimer) clearTimeout(initTimer);
        if (msg.success !== true) {
          finish(
            new Error(
              `server init failed: ${JSON.stringify(msg).slice(0, 300)}`,
            ),
          );
          return;
        }
        callbacks.onLog?.("[server] ready (models initialized)");
        sendNext();
        return;
      }
      if (typeof msg.success !== "boolean") {
        callbacks.onLog?.(`[server:progress] ${line.slice(0, 160)}`);
        return;
      }
      if (requestTimer) clearTimeout(requestTimer);
      const entry = plan[planIndex];
      planIndex += 1;
      passResults.set(
        msg.request_id ?? `${entry.corpusCase.id}#${entry.pass}`,
        {
          success: msg.success,
          text: typeof msg.text === "string" ? msg.text : "",
          rawText: typeof msg.raw_text === "string" ? msg.raw_text : "",
          // [20261001_Feat_414_AbCorpusHarness] Timestamps are scored on
          // raw_segments (one per VAD region, closest to the engine's char
          // timestamps): the merged `segments` follow a display policy
          // (≈5s blocks / punctuation) that would smear sentence boundaries
          // by construction — that smear is policy, not engine error.
          segments: mapServerSegments(msg.raw_segments ?? msg.segments),
          error: msg.error,
          elapsedMs: Date.now() - requestStartedAt,
        },
      );
      sendNext();
    };

    proc.stdout.on("data", (data) => {
      buffer += data.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (line.trim()) handleLine(line);
      }
    });

    initTimer = setTimeout(() => {
      finish(new Error(`server init timeout after ${initTimeoutMs}ms`));
    }, initTimeoutMs);
  });
}

// ---------------------------------------------------------------------------
// torch vs ONNX comparison (spec #412 T4 verdict input)
// ---------------------------------------------------------------------------

function compareReports(baseline, candidate) {
  const domains = new Set([
    ...Object.keys(baseline.domains ?? {}),
    ...Object.keys(candidate.domains ?? {}),
  ]);
  const perDomain = [...domains].sort().map((domain) => {
    const b = baseline.domains?.[domain];
    const c = candidate.domains?.[domain];
    if (!b || !c) {
      return {
        domain,
        baselineMeanCer: b?.meanCer ?? null,
        candidateMeanCer: c?.meanCer ?? null,
        cerDelta: null,
        passed: false,
        note: "domain missing in one report — corpus/manifest drifted between runs",
      };
    }
    const cerDelta = c.meanCer - b.meanCer;
    return {
      domain,
      baselineMeanCer: b.meanCer,
      candidateMeanCer: c.meanCer,
      cerDelta,
      passed: cerDelta <= CER_DELTA_TOLERANCE,
    };
  });
  const bHotword = baseline.hotword ?? {};
  const cHotword = candidate.hotword ?? {};
  const repairRateDelta =
    bHotword.repairRate === null || cHotword.repairRate === null
      ? null
      : cHotword.repairRate - bHotword.repairRate;
  const hotwordPassed =
    repairRateDelta === null ? true : repairRateDelta >= -1e-9;
  const bTs = baseline.timestampSummary ?? { meanAbsDevMs: 0 };
  const cTs = candidate.timestampSummary ?? { meanAbsDevMs: 0 };
  const tsDeltaMs = cTs.meanAbsDevMs - bTs.meanAbsDevMs;
  const tsPassed = tsDeltaMs <= TIMESTAMP_DELTA_TOLERANCE_MS;
  const punc = {
    baselineInsertions: Object.values(baseline.domains ?? {}).reduce(
      (sum, d) => sum + d.puncInsertions,
      0,
    ),
    candidateInsertions: Object.values(candidate.domains ?? {}).reduce(
      (sum, d) => sum + d.puncInsertions,
      0,
    ),
    baselineDeletions: Object.values(baseline.domains ?? {}).reduce(
      (sum, d) => sum + d.puncDeletions,
      0,
    ),
    candidateDeletions: Object.values(candidate.domains ?? {}).reduce(
      (sum, d) => sum + d.puncDeletions,
      0,
    ),
  };
  return {
    baseline: {
      engine: baseline.engine?.name,
      generatedAt: baseline.generatedAt,
    },
    candidate: {
      engine: candidate.engine?.name,
      generatedAt: candidate.generatedAt,
    },
    perDomain,
    hotword: {
      baselineRepairRate: bHotword.repairRate ?? null,
      candidateRepairRate: cHotword.repairRate ?? null,
      repairRateDelta,
      passed: hotwordPassed,
    },
    timestamp: {
      baselineMeanAbsDevMs: bTs.meanAbsDevMs,
      candidateMeanAbsDevMs: cTs.meanAbsDevMs,
      deltaMs: tsDeltaMs,
      passed: tsPassed,
    },
    punc,
    gates: {
      cerDeltaTolerance: CER_DELTA_TOLERANCE,
      repairRateMustNotRegress: true,
      timestampDeltaToleranceMs: TIMESTAMP_DELTA_TOLERANCE_MS,
    },
    passed: perDomain.every((d) => d.passed) && hotwordPassed && tsPassed,
  };
}

// ---------------------------------------------------------------------------
// Markdown rendering (for docs/research/ baselines)
// ---------------------------------------------------------------------------

function pct(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : "FAILED";
}

function renderMarkdownReport(report) {
  const lines = [];
  lines.push(`# ASR A/B 报告 — ${report.engine.name} (${report.generatedAt})`);
  lines.push("");
  lines.push(
    `- 引擎: ${report.engine.name} · server: \`${path.basename(report.engine.serverScript)}\` · 协议: ${report.engine.protocol}`,
  );
  lines.push(
    `- 语料: ${report.corpus.name} (manifest v${report.corpus.manifestVersion}, ${report.corpus.caseCount} cases)`,
  );
  lines.push("");
  lines.push("## 逐域 CER(标点剥离)");
  lines.push("");
  lines.push("| 域 | cases | mean CER | median | max |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const [domain, agg] of Object.entries(report.domains)) {
    lines.push(
      `| ${domain} | ${agg.count} | ${pct(agg.meanCer)} | ${pct(agg.medianCer)} | ${pct(agg.maxCer)} |`,
    );
  }
  lines.push("");
  lines.push("## 标点插删差(对含标点参考文本的用例)");
  lines.push("");
  lines.push("| 域 | 插入 | 删除 |");
  lines.push("| --- | --- | --- |");
  for (const [domain, agg] of Object.entries(report.domains)) {
    lines.push(`| ${domain} | ${agg.puncInsertions} | ${agg.puncDeletions} |`);
  }
  lines.push("");
  lines.push("## 热词修复率");
  lines.push("");
  const hw = report.hotword;
  lines.push(
    `- 修复率: ${hw.repairRate === null ? "n/a" : pct(hw.repairRate)}(repaired=${hw.counts.repaired}, still-wrong=${hw.counts.stillWrong}, always-right=${hw.counts.alwaysRight}, regressed=${hw.counts.regressed})`,
  );
  for (const c of hw.cases) {
    const verdicts = c.terms.map((t) => `${t.term}: ${t.verdict}`).join("; ");
    lines.push(`- **${c.id}** — ${verdicts}`);
    lines.push(`  - 无热词: ${c.hypothesisWithoutHotword}`);
    lines.push(`  - 有热词: ${c.hypothesisWithHotword}`);
  }
  lines.push("");
  lines.push("## 时间戳偏差(黄金集)");
  lines.push("");
  const ts = report.timestampSummary;
  lines.push(
    `- 边界样本 ${ts.pooledBoundaryCount} 个:mean ${ts.meanAbsDevMs.toFixed(0)}ms · median ${ts.medianAbsDevMs.toFixed(0)}ms · p95 ${ts.p95AbsDevMs.toFixed(0)}ms · max ${ts.maxAbsDevMs.toFixed(0)}ms`,
  );
  lines.push(
    `- 未匹配:期望段缺失 ${ts.missingSegmentCount} · 多余段 ${ts.extraSegmentCount}`,
  );
  lines.push("");
  lines.push(
    `总耗时 ${(report.elapsedMs / 1000).toFixed(1)}s;逐用例明细见 JSON 报告。`,
  );
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    engine: "torch",
    corpus: DEFAULT_CORPUS_DIR,
    report: DEFAULT_REPORT_PATH,
    markdown: null,
    serverScript: null,
    interpreter: null,
    initTimeoutMs: DEFAULT_INIT_TIMEOUT_MS,
    requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
    damoRoot: process.env.DAMO_ROOT || null,
    compare: null,
  };
  let argsIndex = 0;
  const takeValue = (flag) => {
    const value = argv[++argsIndex];
    if (value === undefined) {
      throw new Error(`missing value for ${flag}`);
    }
    return value;
  };
  try {
    for (; argsIndex < argv.length; argsIndex += 1) {
      const arg = argv[argsIndex];
      if (arg === "--engine") args.engine = takeValue(arg);
      else if (arg === "--corpus") args.corpus = path.resolve(takeValue(arg));
      else if (arg === "--report") args.report = path.resolve(takeValue(arg));
      else if (arg === "--markdown")
        args.markdown = path.resolve(takeValue(arg));
      else if (arg === "--server-script")
        args.serverScript = path.resolve(takeValue(arg));
      else if (arg === "--interpreter")
        args.interpreter = path.resolve(takeValue(arg));
      else if (arg === "--init-timeout")
        args.initTimeoutMs = Number(takeValue(arg));
      else if (arg === "--request-timeout")
        args.requestTimeoutMs = Number(takeValue(arg));
      else if (arg === "--damo-root")
        args.damoRoot = path.resolve(takeValue(arg));
      else if (arg === "--compare") {
        const a = takeValue(arg);
        const b = takeValue(arg);
        args.compare = [path.resolve(a), path.resolve(b)];
      } else return { error: `unknown or incomplete argument: ${arg}` };
    }
  } catch (flagError) {
    return { error: flagError.message };
  }
  if (!ENGINE_PRESETS[args.engine]) {
    return {
      error: `--engine must be one of ${Object.keys(ENGINE_PRESETS).join("|")}`,
    };
  }
  for (const timeout of [args.initTimeoutMs, args.requestTimeoutMs]) {
    if (!Number.isFinite(timeout) || timeout <= 0) {
      return { error: "timeouts must be positive numbers" };
    }
  }
  return { args };
}

function printRunSummary(report) {
  console.log(`\n===== ASR A/B summary — ${report.engine.name} =====`);
  console.log("per-domain CER (punctuation-stripped):");
  for (const [domain, agg] of Object.entries(report.domains)) {
    console.log(
      `  ${domain.padEnd(14)} n=${agg.count} mean=${pct(agg.meanCer)} median=${pct(agg.medianCer)} max=${pct(agg.maxCer)} puncIns=${agg.puncInsertions} puncDel=${agg.puncDeletions}`,
    );
  }
  const hw = report.hotword;
  console.log(
    `hotword: repairRate=${hw.repairRate === null ? "n/a" : pct(hw.repairRate)} repaired=${hw.counts.repaired} stillWrong=${hw.counts.stillWrong} alwaysRight=${hw.counts.alwaysRight} regressed=${hw.counts.regressed}`,
  );
  for (const c of hw.cases) {
    const verdicts = c.terms.map((t) => `${t.term}=${t.verdict}`).join(" ");
    console.log(`  [${c.id}] ${verdicts}`);
    console.log(`    no-hotword: ${c.hypothesisWithoutHotword}`);
    console.log(`    with-hotword: ${c.hypothesisWithHotword}`);
  }
  const ts = report.timestampSummary;
  console.log(
    `timestamp: boundaries=${ts.pooledBoundaryCount} mean=${ts.meanAbsDevMs.toFixed(0)}ms median=${ts.medianAbsDevMs.toFixed(0)}ms p95=${ts.p95AbsDevMs.toFixed(0)}ms max=${ts.maxAbsDevMs.toFixed(0)}ms missing=${ts.missingSegmentCount} extra=${ts.extraSegmentCount}`,
  );
  console.log(`report: ${report.reportPath}`);
}

function printCompareSummary(cmp) {
  console.log("\n===== ASR A/B compare =====");
  console.log(
    `baseline: ${cmp.baseline.engine} · candidate: ${cmp.candidate.engine}`,
  );
  for (const d of cmp.perDomain) {
    const delta =
      d.cerDelta === null ? "n/a" : `${(d.cerDelta * 100).toFixed(2)}pp`;
    console.log(
      `  ${d.domain.padEnd(14)} ${pct(d.baselineMeanCer ?? 0)} -> ${pct(d.candidateMeanCer ?? 0)} delta=${delta} ${d.passed ? "PASS" : "FAIL"}`,
    );
  }
  console.log(
    `hotword repairRate: ${cmp.hotword.baselineRepairRate ?? "n/a"} -> ${cmp.hotword.candidateRepairRate ?? "n/a"} ${cmp.hotword.passed ? "PASS" : "FAIL"}`,
  );
  console.log(
    `timestamp meanAbsDev: ${cmp.timestamp.baselineMeanAbsDevMs.toFixed(0)}ms -> ${cmp.timestamp.candidateMeanAbsDevMs.toFixed(0)}ms delta=${cmp.timestamp.deltaMs.toFixed(0)}ms ${cmp.timestamp.passed ? "PASS" : "FAIL"}`,
  );
  console.log(
    `punc insertions: ${cmp.punc.baselineInsertions} -> ${cmp.punc.candidateInsertions} (deletions ${cmp.punc.baselineDeletions} -> ${cmp.punc.candidateDeletions})`,
  );
  console.log(
    cmp.passed
      ? "VERDICT: PASS (all gates)"
      : "VERDICT: FAIL (gate regression)",
  );
}

async function main(argv = process.argv.slice(2)) {
  const parsed = parseArgs(argv);
  if (parsed.error) {
    console.error(`asr-ab-harness: ${parsed.error}`);
    return 2;
  }
  const args = parsed.args;

  if (args.compare) {
    const [baselinePath, candidatePath] = args.compare;
    const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
    let baseline;
    let candidate;
    try {
      baseline = readJson(baselinePath);
      candidate = readJson(candidatePath);
    } catch (readError) {
      console.error(
        `asr-ab-harness: cannot read compare input: ${readError.message}`,
      );
      return 1;
    }
    const cmp = compareReports(baseline, candidate);
    printCompareSummary(cmp);
    if (args.markdown) {
      fs.mkdirSync(path.dirname(args.markdown), { recursive: true });
      fs.writeFileSync(
        args.markdown,
        `# ASR A/B compare\n\n\`\`\`json\n${JSON.stringify(cmp, null, 2)}\n\`\`\`\n`,
      );
      console.log(`compare markdown: ${args.markdown}`);
    }
    if (args.report && args.report !== DEFAULT_REPORT_PATH) {
      fs.mkdirSync(path.dirname(args.report), { recursive: true });
      fs.writeFileSync(args.report, `${JSON.stringify(cmp, null, 2)}\n`);
    }
    return cmp.passed ? 0 : 1;
  }

  const preset = ENGINE_PRESETS[args.engine];
  const serverScript =
    args.serverScript ?? path.join(ROOT, preset.serverScript);
  if (!fs.existsSync(serverScript)) {
    console.error(
      `asr-ab-harness: engine "${args.engine}" server script not found: ${serverScript}`,
    );
    console.error(
      args.engine === "torch"
        ? "run `pnpm run prepare:python:embedded` (dev) or point --server-script at a funasr_server.py"
        : `the ONNX server has not landed yet (spec #412 T5) — pass --server-script explicitly; ${preset.description}`,
    );
    return 1;
  }
  const interpreter = args.interpreter ?? resolveInterpreter();
  if (!interpreter) {
    console.error("asr-ab-harness: no python interpreter found");
    return 1;
  }
  const report = await runCorpus(
    {
      interpreter,
      serverScript,
      corpusDir: args.corpus,
      engineName: args.engine,
      initTimeoutMs: args.initTimeoutMs,
      requestTimeoutMs: args.requestTimeoutMs,
      damoRoot: args.damoRoot,
      reportPath: args.report,
    },
    { onLog: (line) => console.log(line) },
  );
  printRunSummary(report);
  if (args.markdown) {
    fs.mkdirSync(path.dirname(args.markdown), { recursive: true });
    fs.writeFileSync(args.markdown, `${renderMarkdownReport(report)}\n`);
    console.log(`markdown: ${args.markdown}`);
  }
  return report.summary.failedCount === 0 ? 0 : 1;
}

module.exports = {
  punctuationDiff,
  classifyHotwordCase,
  timestampDeviation,
  aggregateByDomain,
  compareReports,
  loadCorpusManifest,
  runCorpus,
  parseArgs,
  renderMarkdownReport,
  main,
  ENGINE_PRESETS,
  DEFAULT_CORPUS_DIR,
  DEFAULT_REPORT_PATH,
  DEFAULT_INIT_TIMEOUT_MS,
  DEFAULT_REQUEST_TIMEOUT_MS,
};

if (require.main === module) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(`asr-ab-harness: ${err.message}`);
      process.exit(1);
    },
  );
}
