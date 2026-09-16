// [20260816_Fix_WinBindingsHelper]→[20260905_Feat_NodeSqlite] Historical
// note: this file guarded issue #157's fix — electron-builder omitting
// `file-uri-to-path` (bindings' runtime helper) from app.asar crashed
// packaged Windows builds (PR #158). The whole contract is RETIRED with the
// better-sqlite3 engine swap (spec #226): sqlite comes from node:sqlite
// inside the runtime, the loader pair left the dependency tree, and the
// packaged app must now ship NEITHER helper. The pin is inverted so a future
// re-introduction is a conscious act, not silent drift.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const PROJECT_ROOT = path.resolve(__dirname, "../..");

describe("packaged runtime dependencies", () => {
  it("ships no native-addon loader pair (bindings / file-uri-to-path)", () => {
    expect(
      fs.existsSync(path.join(PROJECT_ROOT, "node_modules", "bindings")),
    ).toBe(false);
    expect(
      fs.existsSync(
        path.join(PROJECT_ROOT, "node_modules", "file-uri-to-path"),
      ),
    ).toBe(false);
  });
});
