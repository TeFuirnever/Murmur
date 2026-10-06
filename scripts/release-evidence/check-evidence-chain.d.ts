// [20261006_T11_EvidenceChainChecklist] Type surface for the CJS release
// evidence chain evaluator so vitest tests (typechecked via
// tsconfig.test.json) can import it safely — same pattern as
// scripts/asr-ab-harness.d.ts.
export declare interface EvidenceRunRef {
  id: number;
  html_url?: string;
  head_sha?: string;
  created_at?: string;
}

export declare interface RunLookup {
  found: boolean;
  run?: EvidenceRunRef;
  reason?: string;
}

export declare interface EvidenceItemResult {
  id: string;
  ticket: number;
  title: string;
  status: "green" | "red";
  details: string[];
}

export declare interface EvidenceChainReport {
  passed: boolean;
  items: EvidenceItemResult[];
}

export declare interface EvidenceChainOptions {
  repoRoot: string;
  artifacts?: { mac?: string | null; win?: string | null };
  fetchRuns?: (workflowFile: string) => Promise<RunLookup>;
}

export declare const INSTALLER_BUDGET_MB: {
  readonly mac: number;
  readonly win: number;
};

declare const exports: {
  INSTALLER_BUDGET_MB: typeof INSTALLER_BUDGET_MB;
  checkEvidenceChain: (
    options: EvidenceChainOptions,
  ) => Promise<EvidenceChainReport>;
  makeDefaultRunsFetcher: (
    repoRoot: string,
  ) => (workflowFile: string) => Promise<RunLookup>;
  renderText: (report: EvidenceChainReport) => string;
  main: (argv?: string[]) => Promise<number>;
};
export default exports;
