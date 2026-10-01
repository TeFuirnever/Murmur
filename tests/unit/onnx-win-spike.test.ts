// [20261001_T415_OnnxWinSpike] Ticket #415 (spec #412 T2): in-repo gate for
// the Windows x64 ONNX spike deliverables. This is the fresh-clone gate that
// keeps the release evidence chain intact on main (the Python twin in
// tests/python/test_onnx_win_spike.py covers the spike runner's logic and
// skips nothing — it is stdlib-only by contract).
//
// What this file pins:
//   1. The CI entry point exists and is REPEATABLE (workflow_dispatch) on a
//      windows-latest runner, fetches model bytes via the T1 trust chain
//      (verify_artifacts.py --from-release: our own GitHub Release mirror +
//      per-file sha256 strict-set check), and drives win_spike.py.
//   2. The committed 40s wav fixture exists and is a 16kHz mono s16 RIFF wav
//      of 35-45s — the ticket's "40s wav inference" input must be identical
//      bytes on every run so numbers are comparable across platforms.
//   3. The runtime env is pinned (requirements file) — evidence must name
//      the exact wheel versions it measured.
//   4. The archival evidence report exists under docs/research/ with the
//      three acceptance-criteria measurements (install size / RSS / cold
//      start) and a CI run link.
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "../..");
const SPIKE_DIR = path.join(ROOT, "scripts", "onnx-spike");
const WORKFLOW_PATH = path.join(ROOT, ".github/workflows/onnx-win-spike.yml");
const FIXTURE_WAV = path.join(SPIKE_DIR, "fixtures", "onnx-spike-40s.wav");
const REQUIREMENTS = path.join(SPIKE_DIR, "requirements-runtime.txt");
const REPORT_PATH = path.join(
  ROOT,
  "docs/research/2026-10-01-onnx-win-x64-spike.md",
);

type WavFacts = {
  audioFormat: number;
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
  durationSeconds: number;
};

// Minimal RIFF/WAVE parser (stdlib-free, std sections only): walk the chunk
// list for "fmt " and "data". The fixture is PCM s16 so no exotic chunks.
function parseRiffWav(file: string): WavFacts {
  const bytes = fs.readFileSync(file);
  const ascii = (offset: number, length: number): string =>
    bytes.subarray(offset, offset + length).toString("ascii");
  const uint32 = (offset: number): number => bytes.readUInt32LE(offset);
  const uint16 = (offset: number): number => bytes.readUInt16LE(offset);

  if (ascii(0, 4) !== "RIFF" || ascii(8, 4) !== "WAVE") {
    throw new Error(`${file} is not a RIFF/WAVE file`);
  }
  let offset = 12;
  let facts: WavFacts | null = null;
  while (offset + 8 <= bytes.length) {
    const chunkId = ascii(offset, 4);
    const chunkSize = uint32(offset + 4);
    if (chunkId === "fmt ") {
      facts = {
        audioFormat: uint16(offset + 8),
        channels: uint16(offset + 10),
        sampleRate: uint32(offset + 12),
        bitsPerSample: uint16(offset + 22),
        durationSeconds: 0,
      };
    } else if (chunkId === "data" && facts) {
      const bytesPerFrame =
        (facts.bitsPerSample / 8) * Math.max(facts.channels, 1);
      facts.durationSeconds =
        bytesPerFrame > 0 ? chunkSize / bytesPerFrame / facts.sampleRate : 0;
    }
    offset += 8 + chunkSize + (chunkSize % 2);
  }
  if (!facts) throw new Error(`${file} has no fmt chunk`);
  return facts;
}

describe("ONNX win x64 spike (ticket #415, spec #412 T2)", () => {
  it("spike runner and child entrypoint exist", () => {
    expect(fs.existsSync(path.join(SPIKE_DIR, "win_spike.py"))).toBe(true);
    const source = fs.readFileSync(
      path.join(SPIKE_DIR, "win_spike.py"),
      "utf8",
    );
    // Cold-start sampling must spawn fresh processes (true cold start), not
    // reuse one warm process.
    expect(source).toContain("cold-child");
    expect(source).toContain("measure-child");
  });

  it("workflow is repeatable (workflow_dispatch) on a Windows runner", () => {
    const workflow = fs.readFileSync(WORKFLOW_PATH, "utf8");
    expect(workflow).toContain("workflow_dispatch");
    expect(workflow).toContain("windows-latest");
    // Repo convention: pin the actions runner to Node 24.
    expect(workflow).toContain("FORCE_JAVASCRIPT_ACTIONS_TO_NODE24");
  });

  it("workflow fetches models through the T1 trust chain, not community repos", () => {
    const workflow = fs.readFileSync(WORKFLOW_PATH, "utf8");
    expect(workflow).toContain("verify_artifacts.py");
    expect(workflow).toContain("--from-release");
    expect(workflow).toContain("win_spike.py");
    // The spike must never download from a community mirror.
    expect(workflow).not.toContain("marxyz");
  });

  it("committed 40s wav fixture is 16kHz mono s16 PCM of 35-45s", () => {
    expect(fs.existsSync(FIXTURE_WAV)).toBe(true);
    const facts = parseRiffWav(FIXTURE_WAV);
    expect(facts.audioFormat).toBe(1); // PCM
    expect(facts.sampleRate).toBe(16000);
    expect(facts.channels).toBe(1);
    expect(facts.bitsPerSample).toBe(16);
    expect(facts.durationSeconds).toBeGreaterThanOrEqual(35);
    expect(facts.durationSeconds).toBeLessThanOrEqual(45);
  });

  it("runtime requirements pin the measured wheel versions", () => {
    const requirements = fs.readFileSync(REQUIREMENTS, "utf8");
    // funasr-onnx 0.4.3 is the version the T1 runtime file sets were
    // source-verified against; ORT mirrors the export pin.
    expect(requirements).toContain("funasr-onnx==0.4.3");
    expect(requirements).toMatch(/onnxruntime==\d/);
    expect(requirements).toContain("psutil==");
  });

  it("archival evidence report exists with the three required measurements", () => {
    const report = fs.readFileSync(REPORT_PATH, "utf8");
    // Acceptance criteria: 安装体积 / 推理 RSS / 冷启动时间（多次采样）.
    expect(report).toMatch(/安装体积/);
    expect(report).toMatch(/RSS/);
    expect(report).toMatch(/冷启动/);
    // The report must point at the CI evidence run (repeatable proof).
    expect(report).toMatch(/https:\/\/github\.com\/.*\/actions\/runs\/\d+/);
    // The report must reference the parent spec issue (#412).
    expect(report).toContain("#412");
  });
});
