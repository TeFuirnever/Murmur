// [20261001_Feat_414_AbCorpusHarness] Ticket #414 (spec #412 T3): unit
// coverage for the real-corpus A/B harness. Pure scoring functions are
// tested directly; the client loop is exercised end-to-end against a FAKE
// protocol server (node as interpreter, same shape as
// tests/unit/asr-regression.test.ts) so no torch/model download is needed.
import { describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import asrAb from "../../scripts/asr-ab-harness.js";

const {
  punctuationDiff,
  classifyHotwordCase,
  timestampDeviation,
  aggregateByDomain,
  compareReports,
  hotwordCaseLanguage,
  loadCorpusManifest,
  runCorpus,
  parseArgs,
  ENGINE_PRESETS,
} = asrAb;

// ---------------------------------------------------------------------------
// punctuationDiff — 标点插删差 (punctuation insert/delete diff)
// ---------------------------------------------------------------------------
describe("punctuationDiff", () => {
  it("matches identical punctuation exactly", () => {
    const r = punctuationDiff("你好，世界。", "你好，世界。");
    expect(r.insertions).toBe(0);
    expect(r.deletions).toBe(0);
    expect(r.matched).toBe(2);
  });

  it("counts deleted reference marks", () => {
    const r = punctuationDiff("今天开会，对吗？", "今天开会对吗");
    expect(r.insertions).toBe(0);
    expect(r.deletions).toBe(2);
  });

  it("counts inserted hypothesis marks", () => {
    const r = punctuationDiff("你好世界", "你好，世界。");
    expect(r.insertions).toBe(2);
    expect(r.deletions).toBe(0);
  });

  it("treats full-width and half-width equivalents as the same mark", () => {
    const r = punctuationDiff("好的，是的。", "好的,是的.");
    expect(r.insertions).toBe(0);
    expect(r.deletions).toBe(0);
    expect(r.matched).toBe(2);
  });

  it("counts a changed mark as one insertion plus one deletion", () => {
    const r = punctuationDiff("好的，行。", "好的。行");
    expect(r.insertions).toBe(1);
    expect(r.deletions).toBe(2);
  });

  it("matches marks that survive character substitutions around them", () => {
    // skeleton 你好世界 vs 你啊世界: the final 。 still aligns to the same
    // trailing gap, and ， aligns to the gap after the first char pair.
    const r = punctuationDiff("你好，世界。", "你啊，世界。");
    expect(r.insertions).toBe(0);
    expect(r.deletions).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// classifyHotwordCase — 热词修复判别
// ---------------------------------------------------------------------------
describe("classifyHotwordCase", () => {
  const base = {
    reference: "请把会议纪要发给张晗玥",
    terms: ["张晗玥"],
    hypothesisWithoutHotword: "请把会议纪要发给张含月",
    hypothesisWithHotword: "请把会议纪要发给张晗玥",
  };

  it("classifies a repaired term (wrong without → right with)", () => {
    const r = classifyHotwordCase(base);
    expect(r.terms[0]).toMatchObject({ term: "张晗玥", verdict: "repaired" });
    expect(r.counts.repaired).toBe(1);
    expect(r.repairRate).toBe(1);
  });

  it("classifies a still-wrong term (wrong in both passes)", () => {
    const r = classifyHotwordCase({
      ...base,
      terms: ["龚燊"],
      hypothesisWithoutHotword: "下周由公审带队",
      hypothesisWithHotword: "下周由龚审带队",
      reference: "下周由龚燊带队",
    });
    expect(r.terms[0]?.verdict).toBe("still-wrong");
    expect(r.repairRate).toBe(0);
  });

  it("classifies always-right and regressed terms", () => {
    const r = classifyHotwordCase({
      reference: "深圳湾总部",
      terms: ["深圳湾", "总部"],
      hypothesisWithoutHotword: "深圳湾筑部",
      hypothesisWithHotword: "深圳湾驻部",
    });
    // 深圳湾 correct in both passes.
    expect(r.terms[0]?.verdict).toBe("always-right");
    // 总部 wrong in both passes here…
    expect(r.terms[1]?.verdict).toBe("still-wrong");
    const regressed = classifyHotwordCase({
      reference: "发给刘翀",
      terms: ["刘翀"],
      hypothesisWithoutHotword: "发给刘翀",
      hypothesisWithHotword: "发给刘冲",
    });
    expect(regressed.terms[0]?.verdict).toBe("regressed");
    expect(regressed.counts.regressed).toBe(1);
  });

  it("ignores case and punctuation when matching latin terms", () => {
    const r = classifyHotwordCase({
      reference: "负责人是 Jedediah Kellerberg",
      terms: ["Jedediah Kellerberg"],
      hypothesisWithoutHotword: "负责人是 GDDA keler bert",
      hypothesisWithHotword: "负责人是 jedediah keler bert",
    });
    expect(r.terms[0]?.verdict).toBe("still-wrong");
    expect(r.terms[0]?.withHotwordCorrect).toBe(false);
  });

  it("repair rate only counts the discriminative classes", () => {
    const r = classifyHotwordCase({
      reference: "张晗玥和龚燊",
      terms: ["张晗玥", "龚燊", "和"],
      hypothesisWithoutHotword: "张含月和公审",
      hypothesisWithHotword: "张晗玥和龚审",
    });
    expect(r.counts).toEqual({
      repaired: 1,
      stillWrong: 1,
      alwaysRight: 1,
      regressed: 0,
    });
    expect(r.repairRate).toBeCloseTo(0.5);
  });
});

// ---------------------------------------------------------------------------
// timestampDeviation — 时间戳黄金集偏差
// ---------------------------------------------------------------------------
describe("timestampDeviation", () => {
  const expected = [
    { startMs: 200, endMs: 3450, text: "第一句话" },
    { startMs: 4100, endMs: 7800, text: "第二句话" },
  ];

  it("returns zero deviation for exact matches", () => {
    const r = timestampDeviation(expected, [
      { startMs: 200, endMs: 3450, text: "第一句话。" },
      { startMs: 4100, endMs: 7800, text: "第二句话。" },
    ]);
    expect(r.matched).toHaveLength(2);
    expect(r.meanAbsDevMs).toBe(0);
    expect(r.missingExpected).toHaveLength(0);
    expect(r.extraActual).toHaveLength(0);
  });

  it("computes signed and absolute deviations", () => {
    const r = timestampDeviation(expected, [
      { startMs: 320, endMs: 3570, text: "第一句话" },
      { startMs: 3990, endMs: 7900, text: "第二句话" },
    ]);
    expect(r.matched[0]).toMatchObject({ dStartMs: 120, dEndMs: 120 });
    expect(r.matched[1]).toMatchObject({ dStartMs: -110, dEndMs: 100 });
    const abs = [120, 120, 110, 100];
    expect(r.meanAbsDevMs).toBeCloseTo(
      abs.reduce((a, b) => a + b, 0) / abs.length,
    );
    expect(r.maxAbsDevMs).toBe(120);
  });

  it("reports unmatched expected/actual segments", () => {
    const r = timestampDeviation(expected, [
      { startMs: 200, endMs: 3450, text: "第一句话" },
      { startMs: 8000, endMs: 9000, text: "多余的内容" },
    ]);
    expect(r.missingExpected).toEqual([1]);
    expect(r.extraActual).toHaveLength(1);
    // deviation stats only pool the matched pair (2 boundary deltas = 0).
    expect(r.meanAbsDevMs).toBe(0);
  });

  it("matches by text overlap even when the engine merges differently", () => {
    const r = timestampDeviation(
      [
        { startMs: 0, endMs: 2000, text: "开会" },
        { startMs: 2500, endMs: 4000, text: "评审" },
      ],
      [
        { startMs: 10, endMs: 2010, text: "开会，" },
        { startMs: 2490, endMs: 3995, text: "评审。" },
      ],
    );
    expect(r.matched).toHaveLength(2);
    expect(r.maxAbsDevMs).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// aggregateByDomain — 逐域聚合
// ---------------------------------------------------------------------------
describe("aggregateByDomain", () => {
  it("aggregates CER and punctuation per domain", () => {
    const r = aggregateByDomain([
      {
        domain: "noise",
        cer: 0.1,
        punc: { insertions: 1, deletions: 0, matched: 0 },
      },
      {
        domain: "noise",
        cer: 0.3,
        punc: { insertions: 0, deletions: 2, matched: 0 },
      },
      { domain: "real-clean", cer: 0.05 },
    ]);
    expect(r.noise).toMatchObject({
      count: 2,
      meanCer: 0.2,
      medianCer: 0.2,
      maxCer: 0.3,
      puncInsertions: 1,
      puncDeletions: 2,
    });
    expect(r["real-clean"]).toMatchObject({ count: 1, meanCer: 0.05 });
    expect(r.noise).not.toHaveProperty("puncInsertions", undefined);
    expect(r["real-clean"]?.puncInsertions).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// loadCorpusManifest — manifest 校验
// ---------------------------------------------------------------------------
function writeCorpus(
  dir: string,
  manifest: Record<string, unknown>,
  withAudio = true,
) {
  fs.mkdirSync(path.join(dir, "audio"), { recursive: true });
  if (withAudio) {
    fs.writeFileSync(path.join(dir, "audio", "a1.flac"), Buffer.alloc(32));
  }
  fs.writeFileSync(
    path.join(dir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
  );
}

const MINIMAL_VALID_MANIFEST = {
  version: 1,
  name: "test-corpus",
  domains: [
    { id: "hotword", label: "热词", description: "rare nouns" },
    { id: "timestamp", label: "时间戳", description: "golden boundaries" },
  ],
  cases: [
    {
      id: "hw1",
      audio: "audio/a1.flac",
      domain: "hotword",
      provenance: "test",
      reference: { text: "发给张晗玥", punctuatedText: null },
      hotword: { terms: ["张晗玥"], hotwordString: "张晗玥" },
      expectedSegments: null,
      augmentation: null,
    },
    {
      id: "ts1",
      audio: "audio/a1.flac",
      domain: "timestamp",
      provenance: "test",
      reference: { text: "第一句 第二句", punctuatedText: "第一句。第二句。" },
      hotword: null,
      expectedSegments: [
        { startMs: 100, endMs: 900, text: "第一句" },
        { startMs: 1100, endMs: 1900, text: "第二句" },
      ],
      augmentation: null,
    },
  ],
};

describe("loadCorpusManifest", () => {
  it("loads a valid manifest and resolves audio paths", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "corpus-"));
    try {
      writeCorpus(dir, MINIMAL_VALID_MANIFEST);
      const r = loadCorpusManifest(dir);
      expect(r.error).toBeUndefined();
      expect(r.manifest?.cases).toHaveLength(2);
      expect(r.manifest?.cases[0]?.audioPath).toBe(
        path.join(dir, "audio", "a1.flac"),
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects a missing audio file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "corpus-"));
    try {
      writeCorpus(dir, MINIMAL_VALID_MANIFEST, false);
      const r = loadCorpusManifest(dir);
      expect(r.error).toBeTruthy();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects unknown domains, duplicate ids and malformed segments", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "corpus-"));
    try {
      writeCorpus(dir, {
        ...MINIMAL_VALID_MANIFEST,
        cases: [
          MINIMAL_VALID_MANIFEST.cases[0],
          { ...MINIMAL_VALID_MANIFEST.cases[0], domain: "no-such-domain" },
        ],
      });
      expect(loadCorpusManifest(dir).error).toBeTruthy();

      writeCorpus(dir, {
        ...MINIMAL_VALID_MANIFEST,
        cases: [
          MINIMAL_VALID_MANIFEST.cases[0],
          MINIMAL_VALID_MANIFEST.cases[0],
        ],
      });
      expect(loadCorpusManifest(dir).error).toBeTruthy();

      writeCorpus(dir, {
        ...MINIMAL_VALID_MANIFEST,
        cases: [
          {
            ...MINIMAL_VALID_MANIFEST.cases[1],
            expectedSegments: [{ startMs: 500, endMs: 100, text: "乱序" }],
          },
        ],
      });
      expect(loadCorpusManifest(dir).error).toBeTruthy();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// runCorpus — fake protocol server (hotword double-pass + segments)
// ---------------------------------------------------------------------------
const FAKE_SERVER = `\
let buffer = "";
process.stdout.write(JSON.stringify({ success: true }) + "\\n");
const segmentsByCase = {
  ts1: [{ start_ms: 90, end_ms: 910, text: "第一句。" },
        { start_ms: 1120, end_ms: 1880, text: "第二句。" }],
};
process.stdin.on("data", (chunk) => {
  buffer += chunk.toString();
  let idx;
  while ((idx = buffer.indexOf("\\n")) !== -1) {
    const line = buffer.slice(0, idx);
    buffer = buffer.slice(idx + 1);
    if (!line.trim()) continue;
    const cmd = JSON.parse(line);
    if (cmd.action === "exit") process.exit(0);
    if (cmd.action === "transcribe_file") {
      if (process.env.FAKE_REQUEST_LOG) {
        require("fs").appendFileSync(
          process.env.FAKE_REQUEST_LOG, line + "\\n");
      }
      // request_id carries a "#pass" suffix on hotword double passes
      const id = cmd.request_id.split("#")[0];
      const hotword = cmd.options && cmd.options.hotword || "";
      const text = id === "hw1"
        ? (hotword ? "发给张晗玥" : "发给张含月")
        : "第一句。第二句。";
      process.stdout.write(JSON.stringify({
        success: true,
        request_id: cmd.request_id,
        text,
        raw_text: text,
        segments: [],
        raw_segments: segmentsByCase[id] || [],
        duration: 2,
      }) + "\\n");
    }
  }
});
`;

describe("runCorpus (fake protocol server)", () => {
  it("runs the corpus, double-passes hotwords, scores all four dimensions", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "corpus-"));
    const fakeDir = fs.mkdtempSync(path.join(os.tmpdir(), "fake-ab-"));
    try {
      writeCorpus(dir, MINIMAL_VALID_MANIFEST);
      const fakeServerPath = path.join(fakeDir, "fake-server.js");
      fs.writeFileSync(fakeServerPath, FAKE_SERVER);
      const reportPath = path.join(fakeDir, "report.json");
      const requestLog = path.join(fakeDir, "requests.log");

      const report = await runCorpus({
        interpreter: process.execPath,
        serverScript: fakeServerPath,
        corpusDir: dir,
        initTimeoutMs: 5000,
        requestTimeoutMs: 5000,
        reportPath,
        env: { FAKE_REQUEST_LOG: requestLog },
      });

      // hw1: repaired (张含月 → 张晗玥), ts1: zero-CER + timestamp scored.
      expect(report.hotword.counts.repaired).toBe(1);
      expect(report.hotword.counts.stillWrong).toBe(0);
      expect(report.hotword.repairRate).toBe(1);
      expect(report.cases.find((c) => c.id === "hw1")?.cer).toBe(0);
      // The hotword case was driven through BOTH passes with the hotword
      // option actually forwarded to the protocol.
      const loggedHwRequests = fs
        .readFileSync(requestLog, "utf8")
        .split("\n")
        .filter((l) => l.trim())
        .map(
          (l) =>
            JSON.parse(l) as {
              request_id?: string;
              options?: { hotword?: string };
            },
        )
        .filter((r) => (r.request_id ?? "").split("#")[0] === "hw1");
      expect(loggedHwRequests.map((r) => r.options?.hotword ?? "")).toEqual([
        "",
        "张晗玥",
      ]);
      const loggedTsRequests = fs
        .readFileSync(requestLog, "utf8")
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l) as { request_id?: string })
        .filter((r) => (r.request_id ?? "").split("#")[0] === "ts1");
      expect(loggedTsRequests).toHaveLength(1);
      const ts = report.cases.find((c) => c.id === "ts1");
      expect(ts?.timestamp?.matched).toHaveLength(2);
      expect(report.timestampSummary.maxAbsDevMs).toBeGreaterThanOrEqual(10);
      // punc scoring only on cases with authored punctuatedText.
      expect(ts?.punc?.insertions).toBe(0);
      expect(ts?.punc?.deletions).toBe(0);
      expect(report.cases.find((c) => c.id === "hw1")?.punc).toBeNull();
      // engine + provenance recorded
      expect(report.engine.name).toBe("custom");
      expect(fs.existsSync(reportPath)).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(fakeDir, { recursive: true, force: true });
    }
  }, 20000);
});

// ---------------------------------------------------------------------------
// compareReports — torch vs ONNX 对照
// ---------------------------------------------------------------------------
describe("compareReports", () => {
  const mkReport = (overrides: Record<string, unknown>) => ({
    engine: { name: "torch" },
    domains: {
      noise: {
        count: 2,
        meanCer: 0.2,
        medianCer: 0.2,
        maxCer: 0.3,
        puncInsertions: 1,
        puncDeletions: 2,
      },
      hotword: {
        count: 1,
        meanCer: 0.1,
        medianCer: 0.1,
        maxCer: 0.1,
        puncInsertions: 0,
        puncDeletions: 0,
      },
    },
    hotword: {
      repairRate: 0.5,
      counts: { repaired: 1, stillWrong: 1, alwaysRight: 0, regressed: 0 },
    },
    timestampSummary: {
      meanAbsDevMs: 120,
      medianAbsDevMs: 100,
      p95AbsDevMs: 200,
      maxAbsDevMs: 240,
    },
    summary: { caseCount: 3, meanCer: 0.17 },
    ...overrides,
  });

  it("computes deltas per domain and applies the gates", () => {
    const baseline = mkReport({});
    const candidate = mkReport({
      engine: { name: "onnx" },
      domains: {
        noise: {
          count: 2,
          meanCer: 0.21,
          medianCer: 0.2,
          maxCer: 0.3,
          puncInsertions: 2,
          puncDeletions: 2,
        },
        hotword: {
          count: 1,
          meanCer: 0.1,
          medianCer: 0.1,
          maxCer: 0.1,
          puncInsertions: 0,
          puncDeletions: 0,
        },
      },
      hotword: {
        repairRate: 0.5,
        counts: { repaired: 1, stillWrong: 1, alwaysRight: 0, regressed: 0 },
      },
      timestampSummary: {
        meanAbsDevMs: 150,
        medianAbsDevMs: 130,
        p95AbsDevMs: 260,
        maxAbsDevMs: 300,
      },
    });
    const cmp = compareReports(baseline, candidate);
    const noise = cmp.perDomain.find((d) => d.domain === "noise");
    expect(noise?.cerDelta).toBeCloseTo(0.01);
    expect(noise?.passed).toBe(true); // within default tolerance
    expect(cmp.hotword.repairRateDelta).toBe(0);
    expect(cmp.hotword.passed).toBe(true);
    expect(cmp.timestamp.deltaMs).toBeCloseTo(30);
    expect(cmp.passed).toBe(true);
  });

  it("fails the gates on CER regression and hotword repair drop", () => {
    const baseline = mkReport({});
    const candidate = mkReport({
      engine: { name: "onnx" },
      domains: {
        noise: {
          count: 2,
          meanCer: 0.27,
          medianCer: 0.2,
          maxCer: 0.3,
          puncInsertions: 1,
          puncDeletions: 2,
        },
        hotword: {
          count: 1,
          meanCer: 0.1,
          medianCer: 0.1,
          maxCer: 0.1,
          puncInsertions: 0,
          puncDeletions: 0,
        },
      },
      hotword: {
        repairRate: 0,
        counts: { repaired: 0, stillWrong: 2, alwaysRight: 0, regressed: 0 },
      },
    });
    const cmp = compareReports(baseline, candidate);
    expect(cmp.passed).toBe(false);
    expect(cmp.perDomain.find((d) => d.domain === "noise")?.passed).toBe(false);
    expect(cmp.hotword.passed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// compareReports hotword zh/en sub-domain gates — #443 (spec #412 T4a, owner
// 议决 2026-10-01, https://github.com/TeFuirnever/Murmur/issues/412#issuecomment-5930346248)
// ---------------------------------------------------------------------------
describe("compareReports hotword zh/en sub-domain gates", () => {
  // Legacy T3/T4 report shape: one combined `hotword` domain plus the
  // per-case array. CERs mirror the real corpus numbers; hw_jedediah is the
  // only English hotword case (Latin letters in the reference).
  const ZH_CASES = [
    {
      id: "hw_zhanghanyue",
      cer: 0.07142857142857142,
      reference: "请把会议纪要发给张晗玥和刘翀。",
      terms: ["张晗玥", "刘翀"],
    },
    {
      id: "hw_gongshen",
      cer: 0.07692307692307693,
      reference: "下周由龚燊带队去深圳湾总部。",
      terms: ["龚燊"],
    },
    {
      id: "hw_mishujuan",
      cer: 0.06666666666666667,
      reference: "把宓淑娟的工位调整到靠窗的位置。",
      terms: ["宓淑娟"],
    },
    {
      id: "hw_dazhiyuan",
      cer: 0.07142857142857142,
      reference: "联系笪志远确认明天的评审时间。",
      terms: ["笪志远"],
    },
    {
      id: "hw_yunyunfei",
      cer: 0.06666666666666667,
      reference: "帮我把贠云飞的行程改到周四下午。",
      terms: ["贠云飞"],
    },
  ];
  const EN_CASE = {
    id: "hw_jedediah",
    cer: 0.037037037037037035,
    reference: "这个项目的负责人是Jedediah Kellerberg。",
    terms: ["Jedediah Kellerberg"],
  };
  const toScoredCases = (cases: typeof ZH_CASES, cerShift = 0) =>
    cases.map((c) => ({
      id: c.id,
      domain: "hotword",
      cer: c.cer + cerShift,
      reference: c.reference,
      hotword: { terms: c.terms.map((term) => ({ term })) },
    }));

  const mkLegacyReport = ({
    engineName,
    zhShift = 0,
    enCer,
  }: {
    engineName: string;
    zhShift?: number;
    enCer: number;
  }) => {
    const allCases = [
      ...toScoredCases(ZH_CASES, zhShift),
      { ...toScoredCases([EN_CASE])[0], cer: enCer },
    ];
    // The combined aggregate mirrors what the harness would have written for
    // these cases; under the split caliber it is re-derived from `cases`, so
    // it only needs to be consistent, not exact.
    const combinedMeanCer =
      allCases.reduce((sum, c) => sum + c.cer, 0) / allCases.length;
    return {
      engine: { name: engineName },
      domains: {
        hotword: {
          count: allCases.length,
          meanCer: combinedMeanCer,
          medianCer: combinedMeanCer,
          maxCer: combinedMeanCer,
          puncInsertions: 1,
          puncDeletions: 0,
        },
      },
      hotword: {
        repairRate: 14.29 / 100,
        counts: { repaired: 1, stillWrong: 6, alwaysRight: 0, regressed: 0 },
      },
      timestampSummary: {
        meanAbsDevMs: 64,
        medianAbsDevMs: 60,
        p95AbsDevMs: 185,
        maxAbsDevMs: 185,
      },
      cases: allCases,
    };
  };

  it("splits a legacy combined hotword domain into hotword-zh / hotword-en rows", () => {
    const cmp = compareReports(
      mkLegacyReport({ engineName: "torch", enCer: EN_CASE.cer }),
      mkLegacyReport({ engineName: "onnx", enCer: 0.2222222222222222 }),
    );
    const domains = cmp.perDomain.map((d) => d.domain);
    expect(domains).toContain("hotword-zh");
    expect(domains).toContain("hotword-en");
    expect(domains).not.toContain("hotword");
    const zh = cmp.perDomain.find((d) => d.domain === "hotword-zh");
    expect(zh?.cerDelta).toBeCloseTo(0, 10);
    expect(zh?.passed).toBe(true);
    const en = cmp.perDomain.find((d) => d.domain === "hotword-en");
    expect(en?.cerDelta).toBeCloseTo(0.2222222222222222 - EN_CASE.cer, 6);
  });

  it("downgrades the en sub-domain to observation-only (en regression never fails the verdict)", () => {
    const cmp = compareReports(
      mkLegacyReport({ engineName: "torch", enCer: EN_CASE.cer }),
      mkLegacyReport({ engineName: "onnx", enCer: 0.2222222222222222 }),
    );
    const en = cmp.perDomain.find((d) => d.domain === "hotword-en");
    expect(en?.observationOnly).toBe(true);
    expect(en?.passed).toBe(true);
    // T4 reality replay: the +3.09pp combined hotword delta came entirely
    // from hw_jedediah — under the split caliber the whole verdict is GO.
    expect(cmp.passed).toBe(true);
  });

  it("keeps the zh sub-domain hard-gated at +2pp", () => {
    const cmp = compareReports(
      mkLegacyReport({ engineName: "torch", enCer: EN_CASE.cer }),
      mkLegacyReport({ engineName: "onnx", zhShift: 0.03, enCer: EN_CASE.cer }),
    );
    const zh = cmp.perDomain.find((d) => d.domain === "hotword-zh");
    expect(zh?.observationOnly).toBe(false);
    expect(zh?.passed).toBe(false);
    expect(cmp.passed).toBe(false);
  });

  it("treats already-split hotword-zh/hotword-en domains natively (post-#443 reports)", () => {
    const domainMap = (zhMean: number, enMean: number) => ({
      "hotword-zh": {
        count: 5,
        meanCer: zhMean,
        medianCer: zhMean,
        maxCer: zhMean,
        puncInsertions: 1,
        puncDeletions: 0,
      },
      "hotword-en": {
        count: 1,
        meanCer: enMean,
        medianCer: enMean,
        maxCer: enMean,
        puncInsertions: 0,
        puncDeletions: 0,
      },
    });
    const cmp = compareReports(
      {
        engine: { name: "torch" },
        domains: domainMap(0.07062271062271062, EN_CASE.cer),
        hotword: {
          repairRate: 14.29 / 100,
          counts: { repaired: 1, stillWrong: 6, alwaysRight: 0, regressed: 0 },
        },
        timestampSummary: { meanAbsDevMs: 64 },
        cases: [],
      },
      {
        engine: { name: "onnx" },
        domains: domainMap(0.07062271062271062, 0.2222222222222222),
        hotword: {
          repairRate: 14.29 / 100,
          counts: { repaired: 1, stillWrong: 6, alwaysRight: 0, regressed: 0 },
        },
        timestampSummary: { meanAbsDevMs: 64 },
        cases: [],
      },
    );
    expect(
      cmp.perDomain.find((d) => d.domain === "hotword-en")?.observationOnly,
    ).toBe(true);
    expect(cmp.perDomain.find((d) => d.domain === "hotword-en")?.passed).toBe(
      true,
    );
    expect(cmp.perDomain.find((d) => d.domain === "hotword-zh")?.passed).toBe(
      true,
    );
    expect(cmp.passed).toBe(true);
  });

  it("falls back to hard-gating the combined hotword domain when per-case data is absent", () => {
    const mkCombined = (engineName: string, meanCer: number) => ({
      engine: { name: engineName },
      domains: {
        hotword: {
          count: 6,
          meanCer,
          medianCer: meanCer,
          maxCer: meanCer,
          puncInsertions: 1,
          puncDeletions: 0,
        },
      },
      hotword: {
        repairRate: 14.29 / 100,
        counts: { repaired: 1, stillWrong: 6, alwaysRight: 0, regressed: 0 },
      },
      timestampSummary: { meanAbsDevMs: 64 },
    });
    const cmp = compareReports(
      mkCombined("torch", 0.06502509835843169),
      mkCombined("onnx", 0.09588929588929589),
    );
    const hw = cmp.perDomain.find((d) => d.domain === "hotword");
    expect(hw?.observationOnly).toBe(false);
    expect(hw?.passed).toBe(false);
    expect(cmp.passed).toBe(false);
  });
});

describe("hotwordCaseLanguage (legacy-report fallback)", () => {
  it("marks Latin-letter references as en and pure-CJK material as zh", () => {
    expect(
      hotwordCaseLanguage({
        reference: "这个项目的负责人是Jedediah Kellerberg。",
        hotword: { terms: [{ term: "Jedediah Kellerberg" }] },
      }),
    ).toBe("en");
    expect(
      hotwordCaseLanguage({
        reference: "请把会议纪要发给张晗玥和刘翀。",
        hotword: { terms: [{ term: "张晗玥" }] },
      }),
    ).toBe("zh");
  });
});

// ---------------------------------------------------------------------------
// CLI surface
// ---------------------------------------------------------------------------
describe("parseArgs", () => {
  it("defaults to the torch engine and rejects unknown flags", () => {
    const ok = parseArgs([]);
    expect(ok.error).toBeUndefined();
    expect(ok.args?.engine).toBe("torch");
    expect(parseArgs(["--engine", "onnx"]).args?.engine).toBe("onnx");
    expect(parseArgs(["--bogus"]).error).toBeTruthy();
    expect(parseArgs(["--engine", "tensorrt"]).error).toBeTruthy();
    const cmp = parseArgs(["--compare", "a.json", "b.json"]);
    // paths are resolved against cwd for reproducible later reads
    expect(cmp.args?.compare?.map((p) => path.basename(p))).toEqual([
      "a.json",
      "b.json",
    ]);
  });
});

describe("package surface", () => {
  it("exposes test:asr:ab wired to the harness", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, "../../package.json"), "utf8"),
    );
    expect(pkg.scripts["test:asr:ab"]).toContain("asr-ab-harness.js");
  });

  it("declares engine presets for torch and onnx", () => {
    expect(Object.keys(ENGINE_PRESETS).sort()).toEqual(["onnx", "torch"]);
    expect(ENGINE_PRESETS.torch?.serverScript).toContain("funasr_server");
  });
});
