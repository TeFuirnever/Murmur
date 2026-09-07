// [20260906_Test_AsrRegressionHarness] Type surface for the CJS harness so
// vitest tests (typechecked via tsconfig.test.json) can import it safely.
export declare interface GoldenCase {
  name: string;
  audioPath: string;
  reference: string;
}

export declare interface ScoredCase {
  name: string;
  cer: number;
  passed: boolean;
  reference: string;
  hypothesis: string;
  serverError?: string;
}

export declare interface AsrRegressionReport {
  generatedAt: string;
  goldenDir: string;
  includeVariants: boolean;
  interpreter: string;
  cases: ScoredCase[];
  summary: {
    total: number;
    failed: number;
    threshold: number;
    meanCer: number;
    maxCer: number;
  };
  passed: boolean;
  elapsedMs: number;
  reportPath?: string;
}

export declare interface RunGoldenSetOptions {
  interpreter: string;
  serverPath: string;
  goldenDir?: string;
  threshold?: number;
  includeVariants?: boolean;
  initTimeoutMs?: number;
  requestTimeoutMs?: number;
  damoRoot?: string | null;
  reportPath?: string;
}

// [20260906_Test_AsrRegressionHarness_ReviewFix] Discriminated union: when
// error is set, args is absent — callers can narrow without optional chains.
export declare interface ParsedArgs {
  includeVariants: boolean;
  threshold: number;
  goldenDir: string;
  reportPath: string;
  initTimeoutMs: number;
  requestTimeoutMs: number;
  damoRoot: string | null;
}

export declare type ParseArgsResult =
  | { args: ParsedArgs; error?: never }
  | { args?: undefined; error: string };

declare const asr: {
  normalizeForCer(text: unknown): string;
  charErrorRate(reference: unknown, hypothesis: unknown): number;
  discoverGoldenCases(
    goldenDir: string,
    opts?: { includeVariants?: boolean },
  ): GoldenCase[];
  evaluateCases(
    scored: { name: string; cer: number }[],
    threshold: number,
  ): {
    summary: {
      total: number;
      failed: number;
      threshold: number;
      meanCer: number;
      maxCer: number;
    };
    passed: boolean;
  };
  runGoldenSet(
    options: RunGoldenSetOptions,
    callbacks?: {
      onLog?: (line: string) => void;
      onCaseDone?: (scored: ScoredCase) => void;
    },
  ): Promise<AsrRegressionReport>;
  parseArgs(argv: string[]): ParseArgsResult;
  main(argv?: string[]): Promise<number>;
  DEFAULT_CER_THRESHOLD: number;
  DEFAULT_GOLDEN_DIR: string;
  DEFAULT_REPORT_PATH: string;
};
export default asr;
