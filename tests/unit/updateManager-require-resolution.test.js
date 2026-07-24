// [20260724_TS_BigBang_TestFix] Adapt for .ts migration: read .ts if exists,
// check both require() and import syntax for ipc-contracts resolution.
import { describe, it, expect } from "vitest";
import path from "path";
import fs from "fs";

const SRC_HELPERS = path.resolve(__dirname, "../../src/helpers");

// Resolve ipc-contracts whether .ts or .js
function resolveContractsPath() {
  const ts = path.join(SRC_HELPERS, "ipc-contracts.ts");
  const js = path.join(SRC_HELPERS, "ipc-contracts.js");
  return fs.existsSync(ts) ? ts : js;
}
function resolveUpdateManagerPath() {
  const ts = path.join(SRC_HELPERS, "updateManager.ts");
  const js = path.join(SRC_HELPERS, "updateManager.js");
  return fs.existsSync(ts) ? ts : js;
}
// [20260724_TS_BigBang_TestFix] END

describe("updateManager require resolution", () => {
  it("ipc-contracts is resolvable from updateManager via ./ipc-contracts", () => {
    // [20260724_TS_BigBang_TestFix] Use extensionless require so vitest
    // resolves .ts first (after migration) or .js (before), returning
    // the correct export shape in both cases.
    const contracts = require("../../src/helpers/ipc-contracts");
    // [20260724_TS_BigBang_TestFix] END
    expect(contracts.UPDATE).toBeDefined();
    expect(contracts.UPDATE.CHECK).toBe("check-update");
    expect(contracts.UPDATE.DOWNLOAD).toBe("download-update");
  });

  it("ipc-contracts exists in the same directory as updateManager", () => {
    expect(fs.existsSync(resolveContractsPath())).toBe(true);
    expect(fs.existsSync(resolveUpdateManagerPath())).toBe(true);
  });

  it("updateManager does NOT use wrong relative path ../ipc-contracts", () => {
    const source = fs.readFileSync(resolveUpdateManagerPath(), "utf8");
    // Must not use the wrong parent-directory path
    expect(source).not.toContain('require("../ipc-contracts")');
    expect(source).not.toContain('from "../ipc-contracts"');
    // Must use correct same-directory path (require or import)
    expect(
      source.includes('require("./ipc-contracts")') ||
        source.includes('from "./ipc-contracts"'),
    ).toBe(true);
  });
});
