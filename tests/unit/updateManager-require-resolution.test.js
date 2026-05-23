import { describe, it, expect } from "vitest";
import path from "path";
import fs from "fs";

const SRC_HELPERS = path.resolve(__dirname, "../../src/helpers");
const IPC_CONTRACTS_PATH = path.join(SRC_HELPERS, "ipc-contracts.js");

describe("updateManager require resolution", () => {
  it("ipc-contracts.js is resolvable from updateManager.js via ./ipc-contracts", () => {
    const contracts = require(IPC_CONTRACTS_PATH);
    expect(contracts.UPDATE).toBeDefined();
    expect(contracts.UPDATE.CHECK).toBe("check-update");
    expect(contracts.UPDATE.DOWNLOAD).toBe("download-update");
  });

  it("ipc-contracts.js exists in the same directory as updateManager.js", () => {
    expect(fs.existsSync(IPC_CONTRACTS_PATH)).toBe(true);
    expect(fs.existsSync(path.join(SRC_HELPERS, "updateManager.js"))).toBe(
      true,
    );
  });

  it("updateManager.js does NOT use wrong relative path ../ipc-contracts", () => {
    const source = fs.readFileSync(
      path.join(SRC_HELPERS, "updateManager.js"),
      "utf8",
    );
    expect(source).not.toContain('require("../ipc-contracts")');
    expect(source).toContain('require("./ipc-contracts")');
  });
});
