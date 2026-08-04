import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const PROJECT_ROOT = path.resolve(__dirname, "../..");

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
