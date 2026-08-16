// [20260816_Fix_WinBindingsHelper] Regression test for issue #157: the
// packaged Windows app crashed at startup with MODULE_NOT_FOUND because
// electron-builder copied `bindings` into app.asar but omitted its runtime
// helper `file-uri-to-path` (a pnpm-layout transitive dependency). Declaring
// it as a direct production dependency (package.json) makes electron-builder
// include it; this test locks that contract so it cannot silently regress.
// Credit: fix authored by LauraGPT in PR #158, re-applied on post-#165 main.
// [20260816_Fix_WinBindingsHelper] END
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const PROJECT_ROOT = path.resolve(__dirname, "../..");

// [20260816_Fix_WinBindingsHelper] electron-builder packages the top-level
// node_modules tree, so the helper must exist there — not only in .pnpm.
describe("packaged runtime dependencies", () => {
  it("includes the bindings helper in the top-level app dependency tree", () => {
    const helperEntry = path.join(
      PROJECT_ROOT,
      "node_modules",
      "file-uri-to-path",
      "index.js",
    );

    expect(fs.existsSync(helperEntry)).toBe(true);
  });
});
// [20260816_Fix_WinBindingsHelper] END
