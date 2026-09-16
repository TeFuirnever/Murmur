// [20260906_Test_AsrRegressionHarness] Spec #266 T03: unit + integration
// coverage for the golden-set regression harness. Pure functions are tested
// directly; the client loop is exercised end-to-end against a FAKE protocol
// server (node as interpreter) so no torch/model download is needed.
import { describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import asr from "../../scripts/asr-regression.js";

const {
  normalizeForCer,
  charErrorRate,
  discoverGoldenCases,
  evaluateCases,
  runGoldenSet,
  parseArgs,
  DEFAULT_CER_THRESHOLD,
} = asr;

const FAKE_SERVER = `\
let buffer = "";
process.stdout.write(JSON.stringify({ success: true }) + "\\n");
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
      const hyp = { s00_base: "今天我们讨论第三季度的产品路线图。", s01_base: "完全错误的文本啊" }[cmd.request_id] || "";
      process.stdout.write(JSON.stringify({
        success: true, request_id: cmd.request_id, text: hyp,
      }) + "\\n");
    }
  }
});
`;

function makeTmpGoldenSet() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "golden-"));
  const wav = Buffer.alloc(64, 0);
  fs.writeFileSync(path.join(dir, "s00_base.wav"), wav);
  fs.writeFileSync(
    path.join(dir, "s00_ref.txt"),
    "今天我们讨论第三季度的产品路线图",
  );
  fs.writeFileSync(path.join(dir, "s01_base.wav"), wav);
  fs.writeFileSync(path.join(dir, "s01_ref.txt"), "完全不同的另一句话");
  fs.writeFileSync(path.join(dir, "s00_g010_clean.wav"), wav);
  fs.writeFileSync(path.join(dir, "ignored.txt"), "not a wav");
  return dir;
}

describe("charErrorRate", () => {
  it("is 0 for identical text regardless of punctuation and case", () => {
    expect(charErrorRate("你好，世界！", "你好世界")).toBe(0);
    expect(charErrorRate("Hello World", "hello world")).toBe(0);
  });

  it("counts substitutions, insertions and deletions", () => {
    expect(charErrorRate("abcd", "abxd")).toBe(0.25);
    expect(charErrorRate("abcd", "abcdd")).toBe(0.25);
    expect(charErrorRate("abcd", "abc")).toBe(0.25);
  });

  it("guards the empty-reference edge", () => {
    expect(charErrorRate("", "")).toBe(0);
    expect(charErrorRate("", "x")).toBe(1);
  });

  it("normalizeForCer strips punctuation, symbols and whitespace", () => {
    expect(normalizeForCer(" A-B（注）：测试…… ")).toBe("ab注测试");
  });
});

describe("discoverGoldenCases", () => {
  it("pairs wavs with their utterance reference, base-only by default", () => {
    const dir = makeTmpGoldenSet();
    try {
      const cases = discoverGoldenCases(dir);
      expect(cases.map((c) => c.name)).toEqual(["s00_base", "s01_base"]);
      expect(cases[0]?.reference).toContain("产品路线图");

      const all = discoverGoldenCases(dir, { includeVariants: true });
      expect(all.map((c) => c.name)).toContain("s00_g010_clean");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("evaluateCases", () => {
  it("fails when any case exceeds the threshold and aggregates stats", () => {
    const result = evaluateCases(
      [
        { name: "a", cer: 0.01 },
        { name: "b", cer: 0.5 },
      ],
      DEFAULT_CER_THRESHOLD,
    );
    expect(result.passed).toBe(false);
    expect(result.summary.failed).toBe(1);
    expect(result.summary.maxCer).toBeCloseTo(0.5);
    expect(result.summary.meanCer).toBeCloseTo(0.255);
  });

  it("passes on an empty run only when nothing failed", () => {
    expect(evaluateCases([], 0.15).passed).toBe(true);
  });
});

describe("runGoldenSet (fake protocol server)", () => {
  it("drives discovery → init handshake → per-case results → exit", async () => {
    const dir = makeTmpGoldenSet();
    const fakeDir = fs.mkdtempSync(path.join(os.tmpdir(), "fake-server-"));
    const fakeServerPath = path.join(fakeDir, "fake-funasr-server.js");
    fs.writeFileSync(fakeServerPath, FAKE_SERVER);
    const reportPath = path.join(fakeDir, "report.json");

    const report = await runGoldenSet({
      interpreter: process.execPath,
      serverPath: fakeServerPath,
      goldenDir: dir,
      threshold: 0.1,
      initTimeoutMs: 5000,
      requestTimeoutMs: 5000,
      reportPath,
    });

    try {
      expect(report.cases).toHaveLength(2);
      // s00 matches its reference exactly (punctuation aside) → CER 0.
      expect(report.cases[0]).toMatchObject({
        name: "s00_base",
        cer: 0,
        passed: true,
      });
      // s01 hypothesis is wrong → above threshold.
      expect(report.cases[1]?.passed).toBe(false);
      expect(report.passed).toBe(false);
      expect(fs.existsSync(reportPath)).toBe(true);
      expect(report.reportPath).toBe(reportPath);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(fakeDir, { recursive: true, force: true });
    }
  }, 15000);
});

describe("parseArgs", () => {
  it("accepts documented flags and rejects unknown ones", () => {
    const ok = parseArgs(["--all", "--threshold", "0.2"]);
    expect(ok.error).toBeUndefined();
    expect(ok.args?.includeVariants).toBe(true);
    expect(ok.args?.threshold).toBe(0.2);
    expect(parseArgs(["--bogus"]).error).toBeTruthy();
    expect(parseArgs(["--threshold", "abc"]).error).toBeTruthy();
  });
});

describe("package surface", () => {
  it("exposes test:asr wired to the harness", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, "../../package.json"), "utf8"),
    );
    expect(pkg.scripts["test:asr"]).toContain("asr-regression");
  });

  // The wav payloads are dev-machine assets (gitignored); only the corpus
  // directory and the server script are guaranteed on a fresh clone.
  it("golden_set corpus directory and server script exist", () => {
    expect(
      fs.existsSync(path.resolve(__dirname, "../../scripts/golden_set")),
    ).toBe(true);
    expect(
      fs.existsSync(path.resolve(__dirname, "../../funasr_server.py")),
    ).toBe(true);
  });
});
