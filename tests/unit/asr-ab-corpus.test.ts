// [20261001_Feat_414_AbCorpusHarness] Ticket #414 (spec #412 T3): integrity
// gate for the committed real-speech A/B corpus (scripts/asr-corpus/). This
// runs on every CI leg without models — it pins the corpus composition the
// release A/B gate depends on (per-domain minimums, audio presence, hotword
// discriminative structure, timestamp golden set sanity, repo size budget).
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import asrAb from "../../scripts/asr-ab-harness.js";

const { loadCorpusManifest } = asrAb;

const CORPUS_DIR = path.resolve(__dirname, "../../scripts/asr-corpus");

// [20261001_Feat_414_AbCorpusHarness] Minimum viable coverage per domain —
// documented in docs/research/2026-10-01-asr-ab-corpus-torch-baseline.md.
// Lowering these means the corpus no longer covers the spec #412 domains and
// must be an explicit, documented decision.
// [20261006_Feat_443_HotwordSubdomainGates] The hotword domain is split by
// language (#412 owner verdict 2026-10-01): hotword-zh keeps the hard CER
// gate, hotword-en (the English proper-noun case) is observation-only.
const DOMAIN_MINIMUMS: Record<string, number> = {
  "real-clean": 6,
  accent: 4,
  noise: 6,
  farfield: 4,
  codeswitch: 4,
  "hotword-zh": 5,
  "hotword-en": 1,
  timestamp: 3,
};

// ~25MB of 16kHz mono FLAC ≈ 3.5h of speech: far beyond need, blocks
// accidental multi-100MB commits of raw WAV rebuilds.
const CORPUS_BYTES_BUDGET = 25 * 1024 * 1024;

describe("committed A/B corpus (scripts/asr-corpus)", () => {
  it("manifest validates and every referenced audio file exists", () => {
    const { manifest, error } = loadCorpusManifest(CORPUS_DIR);
    expect(error).toBeUndefined();
    expect(manifest).toBeTruthy();
    for (const corpusCase of manifest?.cases ?? []) {
      expect(fs.existsSync(corpusCase.audioPath)).toBe(true);
    }
  });

  it("meets the per-domain minimums", () => {
    const { manifest } = loadCorpusManifest(CORPUS_DIR);
    const counts: Record<string, number> = {};
    for (const corpusCase of manifest?.cases ?? []) {
      counts[corpusCase.domain] = (counts[corpusCase.domain] ?? 0) + 1;
    }
    for (const [domain, minimum] of Object.entries(DOMAIN_MINIMUMS)) {
      expect(counts[domain] ?? 0, `domain ${domain}`).toBeGreaterThanOrEqual(
        minimum,
      );
    }
  });

  it("hotword cases declare terms and are double-pass discriminative material", () => {
    const { manifest } = loadCorpusManifest(CORPUS_DIR);
    const hotwordCases = manifest?.cases.filter(
      (corpusCase) => corpusCase.hotword,
    );
    expect(hotwordCases?.length).toBeGreaterThanOrEqual(5);
    for (const corpusCase of hotwordCases ?? []) {
      expect(corpusCase.hotword?.terms.length).toBeGreaterThan(0);
      expect(corpusCase.hotword?.hotwordString.trim().length).toBeGreaterThan(
        0,
      );
      // every hotword term must actually appear in the reference text — a
      // term that does not occur in the utterance can never be "repaired".
      for (const term of corpusCase.hotword?.terms ?? []) {
        expect(corpusCase.reference.text).toContain(term);
      }
    }
  });

  // [20261006_Feat_443_HotwordSubdomainGates] The compare gate keys the
  // zh/en split off these domain annotations — a missing annotation would
  // silently drop a sub-domain back to unlabeled.
  it("annotates the hotword sub-domains with their language (#443)", () => {
    const { manifest } = loadCorpusManifest(CORPUS_DIR);
    const languageByDomain = new Map(
      manifest?.domains.map((domain) => [domain.id, domain.language]),
    );
    expect(languageByDomain.get("hotword-zh")).toBe("zh");
    expect(languageByDomain.get("hotword-en")).toBe("en");
    // cases must live in the sub-domain matching their material: the en
    // sub-domain holds the Latin-letter references, zh the pure-CJK ones.
    for (const corpusCase of manifest?.cases ?? []) {
      if (!corpusCase.hotword) continue;
      const hasLatin = /[A-Za-z]/.test(corpusCase.reference.text);
      const expectedDomain = hasLatin ? "hotword-en" : "hotword-zh";
      expect(corpusCase.domain).toBe(expectedDomain);
    }
  });

  it("timestamp golden cases carry sorted, sane expectedSegments", () => {
    const { manifest } = loadCorpusManifest(CORPUS_DIR);
    const tsCases = manifest?.cases.filter(
      (corpusCase) => corpusCase.expectedSegments,
    );
    expect(tsCases?.length).toBeGreaterThanOrEqual(3);
    for (const corpusCase of tsCases ?? []) {
      const segs = corpusCase.expectedSegments ?? [];
      expect(segs.length).toBeGreaterThanOrEqual(2);
      for (let i = 0; i < segs.length; i += 1) {
        expect(segs[i]?.endMs).toBeGreaterThan(segs[i]?.startMs ?? -1);
        if (i > 0) {
          expect(segs[i]?.startMs).toBeGreaterThanOrEqual(
            segs[i - 1]?.endMs ?? Number.MAX_SAFE_INTEGER,
          );
        }
      }
    }
  });

  it("stays within the repo-size budget", () => {
    const audioDir = path.join(CORPUS_DIR, "audio");
    let total = 0;
    for (const name of fs.readdirSync(audioDir)) {
      total += fs.statSync(path.join(audioDir, name)).size;
    }
    expect(total).toBeLessThan(CORPUS_BYTES_BUDGET);
  });

  it("documents its provenance for every case", () => {
    const { manifest } = loadCorpusManifest(CORPUS_DIR);
    for (const corpusCase of manifest?.cases ?? []) {
      expect(corpusCase.provenance.trim().length).toBeGreaterThan(0);
    }
  });
});
