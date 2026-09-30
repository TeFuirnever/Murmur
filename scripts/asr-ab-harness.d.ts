// [20261001_Feat_414_AbCorpusHarness] Type surface for the CJS A/B harness
// so vitest tests (typechecked via tsconfig.test.json) can import it safely
// — same pattern as scripts/asr-regression.d.ts.
export declare interface PuncDiffResult {
  insertions: number;
  deletions: number;
  matched: number;
}

export declare interface HotwordTermResult {
  term: string;
  withoutHotwordCorrect: boolean;
  withHotwordCorrect: boolean;
  verdict: "repaired" | "still-wrong" | "always-right" | "regressed";
}

export declare interface HotwordCaseClassification {
  reference: string;
  terms: HotwordTermResult[];
  counts: {
    repaired: number;
    stillWrong: number;
    alwaysRight: number;
    regressed: number;
  };
  repairRate: number | null;
}

export declare interface GoldenSegment {
  startMs: number;
  endMs: number;
  text: string;
}

export declare interface TimestampDeviationResult {
  matched: {
    expectedIndex: number;
    actualIndex: number;
    overlapRatio: number;
    dStartMs: number;
    dEndMs: number;
  }[];
  missingExpected: number[];
  extraActual: number[];
  meanAbsDevMs: number;
  medianAbsDevMs: number;
  p95AbsDevMs: number;
  maxAbsDevMs: number;
}

export declare interface DomainAggregate {
  count: number;
  meanCer: number;
  medianCer: number;
  maxCer: number;
  puncInsertions: number;
  puncDeletions: number;
}

export declare interface CorpusHotwordSpec {
  terms: string[];
  hotwordString: string;
}

export declare interface CorpusCase {
  id: string;
  audio: string;
  audioPath: string;
  domain: string;
  provenance: string;
  source?: Record<string, unknown>;
  augmentation: Record<string, unknown> | null;
  reference: { text: string; punctuatedText: string | null };
  hotword: CorpusHotwordSpec | null;
  expectedSegments: GoldenSegment[] | null;
}

export declare interface CorpusManifest {
  version: number;
  name: string;
  description?: string;
  domains: { id: string; label: string; description: string }[];
  cases: CorpusCase[];
}

export declare interface ScoredCase {
  id: string;
  domain: string;
  provenance: string;
  reference: string;
  hypothesis: string;
  hypothesisWithoutHotword: string;
  rawHypothesis: string;
  segments: GoldenSegment[];
  success: boolean;
  serverError?: string;
  cer: number;
  punc: PuncDiffResult | null;
  hotword: HotwordCaseClassification | null;
  timestamp: TimestampDeviationResult | null;
  cerNoHotword?: number;
  elapsedMs?: number;
}

export declare interface AbReport {
  generatedAt: string;
  engine: {
    name: string;
    interpreter: string;
    serverScript: string;
    protocol: string;
  };
  corpus: {
    dir: string;
    name: string;
    manifestVersion: number;
    caseCount: number;
  };
  cases: ScoredCase[];
  domains: Record<string, DomainAggregate>;
  hotword: {
    counts: HotwordCaseClassification["counts"];
    repairRate: number | null;
    cases: {
      id: string;
      reference: string;
      hypothesisWithoutHotword: string;
      hypothesisWithHotword: string;
      terms: HotwordTermResult[];
    }[];
  };
  timestampSummary: {
    pooledBoundaryCount: number;
    meanAbsDevMs: number;
    medianAbsDevMs: number;
    p95AbsDevMs: number;
    maxAbsDevMs: number;
    missingSegmentCount: number;
    extraSegmentCount: number;
  };
  summary: {
    caseCount: number;
    failedCount: number;
    meanCer: number | null;
  };
  elapsedMs: number;
  reportPath: string;
}

export declare interface CompareResult {
  baseline: { engine?: string; generatedAt?: string };
  candidate: { engine?: string; generatedAt?: string };
  perDomain: {
    domain: string;
    baselineMeanCer: number | null;
    candidateMeanCer: number | null;
    cerDelta: number | null;
    passed: boolean;
    note?: string;
  }[];
  hotword: {
    baselineRepairRate: number | null;
    candidateRepairRate: number | null;
    repairRateDelta: number | null;
    passed: boolean;
  };
  timestamp: {
    baselineMeanAbsDevMs: number;
    candidateMeanAbsDevMs: number;
    deltaMs: number;
    passed: boolean;
  };
  punc: {
    baselineInsertions: number;
    candidateInsertions: number;
    baselineDeletions: number;
    candidateDeletions: number;
  };
  gates: {
    cerDeltaTolerance: number;
    repairRateMustNotRegress: boolean;
    timestampDeltaToleranceMs: number;
  };
  passed: boolean;
}

export declare interface RunCorpusOptions {
  interpreter: string;
  serverScript: string;
  corpusDir?: string;
  engineName?: string;
  initTimeoutMs?: number;
  requestTimeoutMs?: number;
  damoRoot?: string | null;
  reportPath?: string;
  env?: Record<string, string>;
}

export declare type ParsedArgsResult =
  | {
      args: {
        engine: string;
        corpus: string;
        report: string;
        markdown: string | null;
        serverScript: string | null;
        interpreter: string | null;
        initTimeoutMs: number;
        requestTimeoutMs: number;
        damoRoot: string | null;
        compare: [string, string] | null;
      };
      error?: never;
    }
  | { args?: undefined; error: string };

declare const asrAb: {
  punctuationDiff(reference: unknown, hypothesis: unknown): PuncDiffResult;
  classifyHotwordCase(input: {
    reference: string;
    terms: string[];
    hypothesisWithoutHotword: string;
    hypothesisWithHotword: string;
  }): HotwordCaseClassification;
  timestampDeviation(
    expectedSegments: GoldenSegment[],
    actualSegments: GoldenSegment[],
  ): TimestampDeviationResult;
  aggregateByDomain(
    cases: {
      domain: string;
      cer: number;
      punc?: PuncDiffResult;
    }[],
  ): Record<string, DomainAggregate>;
  compareReports(baseline: unknown, candidate: unknown): CompareResult;
  loadCorpusManifest(
    corpusDir: string,
  ):
    | { manifest?: CorpusManifest; error?: never }
    | { manifest?: undefined; error: string };
  runCorpus(
    options: RunCorpusOptions,
    callbacks?: { onLog?: (line: string) => void },
  ): Promise<AbReport>;
  parseArgs(argv: string[]): ParsedArgsResult;
  renderMarkdownReport(report: AbReport): string;
  main(argv?: string[]): Promise<number>;
  ENGINE_PRESETS: Record<string, { serverScript: string; description: string }>;
  DEFAULT_CORPUS_DIR: string;
  DEFAULT_REPORT_PATH: string;
  DEFAULT_INIT_TIMEOUT_MS: number;
  DEFAULT_REQUEST_TIMEOUT_MS: number;
};
export default asrAb;
