import { describe, it, expect } from "vitest";

// [20260726_CodeReview_ModuleIdentity] Regression guard: code review of
// PR #103 flagged that removing vi.resetModules() from files using dynamic
// import() (e.g. ipc-contract-completeness.test.ts) could silently leak
// module-level mutations across tests. This test asserts the baseline
// contract: without explicit vi.resetModules(), Node's module cache returns
// the SAME module instance on repeated dynamic imports. If this breaks,
// the cache-leak risk becomes real and we need to re-add resetModules.
describe("[Code Review] module identity without vi.resetModules", () => {
  it("repeated dynamic import returns the same module instance", async () => {
    const mod1 = await import("../../src/helpers/ipc-contracts");
    const mod2 = await import("../../src/helpers/ipc-contracts");
    // Same namespace object means mutations on one are visible to the other.
    expect(mod1).toBe(mod2);
  });

  it("a class exported from a module is the same constructor on re-import", async () => {
    const mod1 = await import("../../src/helpers/logManager");
    const mod2 = await import("../../src/helpers/logManager");
    expect(mod1.default).toBe(mod2.default);
  });
});
