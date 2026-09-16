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
// [20260726_Tier32_IpcContractsOrphans] Convert CJS require() → ESM namespace
// import. `flatten(C)` etc. unchanged.
import * as C from "../../src/helpers/ipc-contracts";

// [20260726_Tier3_IpcContractsOrphansMigrate] Recursive walker needs an
// explicit `string[]` return type (TS7023) and `dir: string` (TS7006).
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    // [20260724_TS_BigBang_TestFix] Include .ts (post-migration) alongside
    // .js so the orphan scan covers the migrated TypeScript source.
    // [20260906_Test_OrphansRendererDim] .tsx too — every renderer surface
    // (App/settings/history windows, hooks components) is .tsx; without it
    // the renderer-caller scan misses most callers and over-reports orphans.
    else if (
      entry.isFile() &&
      (full.endsWith(".js") || full.endsWith(".ts") || full.endsWith(".tsx"))
    )
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

// [20260906_Test_OrphansRendererDim] Spec #266 T05b (#252): the test above
// passes a channel the moment EITHER a handler or preload mentions it — a
// channel with no renderer caller is invisible and dead channels accumulate
// (research doc G4: 4 dead events + semi-orphan handlers). This dimension
// maps preload API methods → channels and scans the renderer source for
// `electronAPI.<method>` callers. A channel that preloads but nobody calls
// lands on an explicit YELLOW LIST (bidirectional assert: unknown channels
// fail until added consciously; yellow entries that regain a caller fail
// until removed — the list can only shrink via a cleanup ticket).
describe("ipc-contracts renderer-caller dimension", () => {
  // Renderer side = src/** minus the main-process helpers and the ambient
  // declaration (electronAPI.d.ts declares every method, so counting it
  // would mark every channel as called).
  function collectRendererSource(): string {
    const rootDir = path.join(process.cwd(), "src");
    const files = walk(rootDir).filter(
      (f) =>
        !f.includes(`${path.sep}helpers${path.sep}`) &&
        // src/dist holds gitignored vite build artifacts whose minified
        // bundles bake in stale electronAPI calls — counting them would
        // mask newly-orphaned channels on dev machines (review finding).
        !f.includes(`${path.sep}dist${path.sep}`) &&
        !f.endsWith(".d.ts"),
    );
    return files.map((f) => fs.readFileSync(f, "utf8")).join("\n");
  }

  // channel dotted key (e.g. "TRANSCRIPTION.AUDIO") → preload method names
  // that surface it. Walks preload.ts line-wise: object keys (`  name:`)
  // set the "current method"; every `C.NS.KEY` occurrence inside the value
  // maps that method to the channel (covers single-line arrows, multiline
  // arrows and makeListener(C.EVENTS.X, …) registrations).
  function buildPreloadSurfaceMap(): Map<string, Set<string>> {
    const preload = fs.readFileSync(
      path.join(process.cwd(), "preload.ts"),
      "utf8",
    );
    const map = new Map<string, Set<string>>();
    let currentMethod = "";
    for (const line of preload.split("\n")) {
      // Exactly two leading spaces: the preloadApi object surface. Nested
      // parameter destructurings (4-space `callback: (...)`) and multiline
      // signatures (`  onXxx: (` ending the line) must not steal the
      // current-method attribution.
      const method = /^ {2}(\w+):/.exec(line);
      if (method) currentMethod = method[1] ?? "";
      for (const m of line.matchAll(/C\.([A-Z_]+)\.([A-Z_0-9]+)/g)) {
        const key = `${m[1]}.${m[2]}`;
        if (!map.has(key)) map.set(key, new Set());
        map.get(key)?.add(currentMethod);
      }
    }
    return map;
  }

  it("every preloaded channel has a renderer caller, or is on the yellow list", () => {
    const rendererSource = collectRendererSource();
    const calledMethods = new Set(
      // Covers both window.electronAPI.method and electronAPI?.method —
      // the renderer uses optional chaining heavily.
      [...rendererSource.matchAll(/\belectronAPI\s*\??\.\s*(\w+)/g)].map(
        (m) => m[1] ?? "",
      ),
    );
    const surface = buildPreloadSurfaceMap();

    const flat = flatten(C);
    const yellow: string[] = [];
    for (const dotted of Object.keys(flat)) {
      if (KNOWN_ORPHANS.has(dotted)) continue; // AUDIO_EXTENSIONS entries
      const methods = surface.get(dotted);
      const isCalled =
        methods !== undefined && [...methods].some((m) => calledMethods.has(m));
      if (!isCalled) yellow.push(dotted);
    }

    // [20260906_Refactor_DeadChannelCleanup] Ticket #250 deleted all 20
    // channels the first honest scan (2026-09-06) pinned here — each was
    // grep-verified to have ZERO renderer callers (the preload method name
    // never appeared after `electronAPI.` / `electronAPI?.` in any renderer
    // source; note usePermissions shadows the name `testAccessibilityPermission`
    // with a hook-local callback that uses pasteText, and useRecording
    // shadows `checkPermissions` with a navigator.permissions probe — neither
    // ever called the preload method). EVENTS.PROCESSING_UPDATE went too,
    // with its one live subscriber (useModelStatus) removed by the same
    // ticket. The set is kept EMPTY and non-deleted so the bidirectional
    // asserts below now enforce the net-zero invariant directly: any
    // channel that preloads without a renderer caller fails immediately.
    // [20260907_Feat_235_StreamPipeline] T8 ships the preload surface;
    // the renderer UI consumers land with T9 (#236) — consciously yellow
    // until then. Stale entries fail the stale check above, so these must
    // be removed when T9 wires the callers.
    // [20260907_Feat_236_StreamingUi] T9 ① wired abortPolish
    // (usePolishStream.cancel) — removed from the conscious yellow list.
    const KNOWN_RENDERER_ORPHANS = new Set<string>(["EVENTS.AI_POLISH_CHUNK"]);

    const unexpected = yellow.filter((c) => !KNOWN_RENDERER_ORPHANS.has(c));
    const stale = [...KNOWN_RENDERER_ORPHANS].filter(
      (c) => !yellow.includes(c),
    );

    expect(
      unexpected,
      `Channels without a renderer caller (add to KNOWN_RENDERER_ORPHANS consciously, or wire a caller):\n${unexpected.join("\n")}`,
    ).toEqual([]);
    expect(
      stale,
      `Yellow-list entries that now HAVE a renderer caller (remove them from KNOWN_RENDERER_ORPHANS):\n${stale.join("\n")}`,
    ).toEqual([]);
  });
});
