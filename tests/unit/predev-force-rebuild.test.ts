import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// [20260905_Fix_PredevForcedRebuild] pnpm dev crashed at startup with
// "SQLite 原生模块版本不匹配" (NODE_MODULE_VERSION 137 vs 140): predev ran a
// bare `npx electron-rebuild`, which silently no-ops when the module already
// looks built — so a system-Node ABI left behind by `pnpm rebuild
// better-sqlite3` (what the vitest suite requires) never got flipped to the
// Electron ABI. AGENTS.md and the release gates already prescribe the forced
// form (`@electron/rebuild -f -w better-sqlite3`); this pin keeps predev on
// that prescription.

const root = fileURLToPath(new URL("../../", import.meta.url));
const pkg = JSON.parse(readFileSync(root + "package.json", "utf8")) as {
  scripts: Record<string, string>;
};

describe("predev force-rebuilds better-sqlite3 for Electron", () => {
  it("uses @electron/rebuild with -f and -w better-sqlite3", () => {
    const predev = pkg.scripts.predev ?? "";
    expect(predev).toContain("@electron/rebuild");
    expect(predev).toContain("-f");
    expect(predev).toContain("-w better-sqlite3");
  });

  it("still builds the preload bundle after the rebuild", () => {
    expect(pkg.scripts.predev).toContain("build:preload");
  });
});
