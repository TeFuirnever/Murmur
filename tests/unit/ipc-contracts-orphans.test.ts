// [20260726_Tier3_IpcContractsOrphansMigrate] Migrated from .js to .ts as
// part of Tier 3 batch 2. Pattern: type the destructured require() binding C
// via `typeof import("<module>")` so the namespace reuses src/helpers/
// ipc-contracts.ts's own `as const` shapes (no `any`). The recursive walker
// `walk` needs an explicit `string[]` return type (TS7023 — it self-references)
// and a typed `dir: string` param (TS7006). The generic `flatten` helper
// operates over the contract's nested-but-heterogeneous shape, so it uses
// `Record<string, unknown>` for both input and output and an explicit return
// annotation; the accumulator is declared `Record<string, unknown>` so the
// `out[key] = v` assignment satisfies TS7053. No `let`-bare bindings. Template
// reference: phase4-i18n.test.ts (commit d52f2e0).
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// [20260726_Tier3_IpcContractsOrphansMigrate] require() under esbuild CJS
// interop returns the module namespace, so this aligns with the named
// `export const FUNASR/MODELS/...` members of ipc-contracts.ts.
const C: typeof import("../../src/helpers/ipc-contracts") = require("../../src/helpers/ipc-contracts");

// [20260726_Tier3_IpcContractsOrphansMigrate] Recursive walker needs an
// explicit `string[]` return type (TS7023) and `dir: string` (TS7006).
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    // [20260724_TS_BigBang_TestFix] Include .ts (post-migration) alongside
    // .js so the orphan scan covers the migrated TypeScript source.
    else if (entry.isFile() && (full.endsWith(".js") || full.endsWith(".ts")))
      out.push(full);
  }
  return out;
}

// [20260726_Tier3_IpcContractsOrphansMigrate] The contract namespace is
// heterogeneous (objects, arrays, strings), so model it as
// `Record<string, unknown>` and recurse. Explicit return annotation lets the
// caller's Object.keys iterate over a known shape.
function flatten(
  obj: Record<string, unknown>,
  prefix = "",
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "object" && v !== null) {
      Object.assign(
        out,
        flatten(v as Record<string, unknown>, prefix ? `${prefix}.${k}` : k),
      );
    } else {
      out[prefix ? `${prefix}.${k}` : k] = v;
    }
  }
  return out;
}

// AUDIO_EXTENSIONS array entries are not IPC channels.
const KNOWN_ORPHANS = new Set([
  "AUDIO_EXTENSIONS.0",
  "AUDIO_EXTENSIONS.1",
  "AUDIO_EXTENSIONS.2",
  "AUDIO_EXTENSIONS.3",
  "AUDIO_EXTENSIONS.4",
  "AUDIO_EXTENSIONS.5",
  "AUDIO_EXTENSIONS.6",
]);

describe("ipc-contracts orphans", () => {
  it("every channel is referenced by either a handler or preload, or whitelisted", () => {
    // Collect all source text from handlers + preload
    const helperFiles = walk(path.join(process.cwd(), "src", "helpers"));
    // [20260724_TS_BigBang_TestFix] Read .ts entry points (post-migration).
    const preloadFile = path.join(process.cwd(), "preload.ts");
    const mainFile = path.join(process.cwd(), "main.ts");
    const allFiles = [...helperFiles, preloadFile, mainFile];
    const haystack = allFiles.map((f) => fs.readFileSync(f, "utf8")).join("\n");

    const flat = flatten(C);
    const orphans = [];
    for (const dotted of Object.keys(flat)) {
      const ref = `C.${dotted}`;
      const count = haystack.split(ref).length - 1;
      // A constant is "used" if it appears in any place other than its
      // own definition file. We need ≥1 occurrence anywhere in the
      // haystack — the ipc-contracts.js file itself uses string values,
      // not C.X.Y notation, so any hit means a real consumer.
      if (count === 0) orphans.push(dotted);
    }

    const unexpected = orphans.filter((o) => !KNOWN_ORPHANS.has(o));
    expect(
      unexpected,
      `New orphan constants (not in KNOWN_ORPHANS whitelist):\n${unexpected.join("\n")}\n\nEither use them or delete from ipc-contracts.js.`,
    ).toEqual([]);
  });
});
