// [20260906_Spec259_T4] Spec #259 T4 (#276): two-arm behavior tests for the
// Python coverage runner. child_process.spawnSync is mocked at the module
// boundary so both arms (suite green + report above floor / report below
// floor) are exercised deterministically without a real interpreter.
// [20260906_Spec259_T4_ReviewFix] The runner is plain CJS whose
// require("child_process") is not reliably intercepted by vi.mock after
// module resets — so instead of vi.mock, the runner accepts an injected
// spawnSync and the tests pass a stub directly.
import { describe, it, expect, vi } from "vitest";
import runner from "../../scripts/run-python-tests";

describe("[20260906_Spec259_T4] python coverage runner", () => {
  function script(interpreterStatus = 0, runStatus = 0, reportStatus = 0) {
    // spawn args shape: [interpreter, "-m", "coverage", <verb>, ...]
    return (cmd: unknown, args: string[]) => {
      const argv = args as string[];
      if (argv.includes("--version")) {
        return { status: interpreterStatus, error: null };
      }
      if (argv.includes("run")) {
        return { status: runStatus, error: null };
      }
      if (argv.includes("report")) {
        return { status: reportStatus, error: null };
      }
      return { status: 0, error: null };
    };
  }

  it("green arm: suite passes and the report meets the floor -> exit 0", () => {
    const spawnSync = vi.fn(script(0, 0, 0));
    expect(runner.run("python3", { spawnSync })).toBe(0);
    // run under coverage with branch measurement, then a fail-under report
    const runCall = spawnSync.mock.calls.find((c) =>
      (c[1] as string[]).includes("run"),
    );
    expect(runCall).toBeDefined();
    const reportCall = spawnSync.mock.calls.find((c) =>
      (c[1] as string[]).includes("report"),
    );
    expect(reportCall).toBeDefined();
    expect((reportCall![1] as string[]).join(" ")).toContain(
      `--fail-under=${runner.PYTHON_FAIL_UNDER}`,
    );
  });

  it("red arm: report below the fail-under floor -> non-zero exit", () => {
    const exit = runner.run("python3", { spawnSync: vi.fn(script(0, 0, 2)) });
    expect(exit).toBe(1);
  });

  it("unittest failure propagates its exit code instead of the floor", () => {
    const exit = runner.run("python3", { spawnSync: vi.fn(script(0, 3, 0)) });
    expect(exit).toBe(3);
  });

  it("missing coverage module -> actionable error, exit 1", () => {
    const exit = runner.run("python3", { spawnSync: vi.fn(script(1, 0, 0)) });
    expect(exit).toBe(1);
  });

  it("pins the fail-under floor to the measured value", () => {
    // First measured 2026-09-07 (embedded python 3.11 + coverage 7.16):
    // TOTAL 43% (funasr_server 34 / audio_preprocessing 87 / download_models 90).
    // [20260907_Fix_317_PythonBranchFill] raised 43→46 after the protocol/
    // lifecycle branch tests lifted funasr_server 34%→39% (TOTAL 47%).
    expect(runner.PYTHON_FAIL_UNDER).toBe(46);
    expect(runner.COVERAGE_INCLUDE).toContain("funasr_server.py");
  });
});
