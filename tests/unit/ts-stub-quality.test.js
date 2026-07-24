// [20260724_Fix_RemoveDeadTsStubs] Regression test: .ts files that are pure
// re-export shims (export * from "./x.js") provide zero type safety because
// the .js source has no JSDoc. These files should be deleted — they add
// maintenance overhead (Middle Man smell) without value.
// Only .ts files with actual typed content should exist.
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const rootDir = path.resolve(__dirname, "../..");

/** Check if a .ts file is a pure re-export stub (3 lines or fewer, just export *) */
function isPureReexportStub(filePath) {
  const content = fs.readFileSync(filePath, "utf8").trim();
  const lines = content
    .split("\n")
    .filter((l) => l.trim() && !l.trim().startsWith("//"));
  // A pure stub has only an export statement and nothing else
  return lines.length <= 1 && /^export\s+\*/m.test(content);
}

describe("TS migration quality — no dead stubs", () => {
  it("no .ts file in src/helpers/ipc/ is a pure re-export stub", () => {
    const ipcDir = path.join(rootDir, "src/helpers/ipc");
    if (!fs.existsSync(ipcDir)) return;
    const tsFiles = fs.readdirSync(ipcDir).filter((f) => f.endsWith(".ts"));
    const stubs = tsFiles.filter((f) =>
      isPureReexportStub(path.join(ipcDir, f)),
    );
    expect(stubs).toEqual([]);
  });

  it("no top-level helper .ts is a pure re-export stub", () => {
    const helpers = [
      "clipboard",
      "tray",
      "windowManager",
      "hotkeyManager",
      "funasrManager",
      "modelManager",
      "pythonEnvironment",
      "pythonInstaller",
      "updateManager",
    ];
    const stubs = helpers.filter((h) => {
      const p = path.join(rootDir, `src/helpers/${h}.ts`);
      return fs.existsSync(p) && isPureReexportStub(p);
    });
    expect(stubs).toEqual([]);
  });

  it("main.ts and preload.ts should not exist (entry points stay .js)", () => {
    expect(fs.existsSync(path.join(rootDir, "main.ts"))).toBe(false);
    expect(fs.existsSync(path.join(rootDir, "preload.ts"))).toBe(false);
  });
});
