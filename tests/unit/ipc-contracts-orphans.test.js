import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
const C = require("../../src/helpers/ipc-contracts");

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile() && full.endsWith(".js")) out.push(full);
  }
  return out;
}

function flatten(obj, prefix = "") {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "object" && v !== null) {
      Object.assign(out, flatten(v, prefix ? `${prefix}.${k}` : k));
    } else {
      out[prefix ? `${prefix}.${k}` : k] = v;
    }
  }
  return out;
}

// Channels that are known-orphan and intentionally retained while we
// decide on cleanup. Each entry should have a docs/follow-ups.md TODO.
const KNOWN_ORPHANS = new Set([
  // Environment
  "ENVIRONMENT.GET_CONFIG",
  "ENVIRONMENT.VALIDATE",
  // Python
  "PYTHON.CHECK",
  "PYTHON.INSTALL",
  "PYTHON.TEST_ENV",
  // FunASR
  "FUNASR.CHECK",
  "FUNASR.SERVER_STATUS",
  "FUNASR.GET_LOGS",
  // Transcription
  "TRANSCRIPTION.GET",
  "TRANSCRIPTION.SEARCH",
  "TRANSCRIPTION.STATS",
  // Clipboard
  "CLIPBOARD.INSERT",
  "CLIPBOARD.MACOS_A11Y",
  // System
  "SYSTEM.SHOW_ITEM",
  "SYSTEM.GET_APP_PATH",
  "SYSTEM.GET_APP_LOGS",
  "SYSTEM.GET_LOG_PATH",
  "SYSTEM.OPEN_LOG",
  // Window
  "WINDOW.CLOSE_APP",
]);

describe("ipc-contracts orphans", () => {
  it("every channel is referenced by either a handler or preload, or whitelisted", () => {
    // Collect all source text from handlers + preload
    const helperFiles = walk(path.join(process.cwd(), "src", "helpers"));
    const preloadFile = path.join(process.cwd(), "preload.js");
    const mainFile = path.join(process.cwd(), "main.js");
    const allFiles = [...helperFiles, preloadFile, mainFile];
    const haystack = allFiles
      .map((f) => fs.readFileSync(f, "utf8"))
      .join("\n");

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
