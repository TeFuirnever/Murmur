import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// [20260905_Feat_NodeSqlite] This file previously pinned the predev
// workaround (forced @electron/rebuild for better-sqlite3) that stopped the
// pnpm dev boot crash of 2026-09-05 (commit 0f2c617). The engine migration
// (spec #226) removed the native addon entirely, so the pin now guards the
// cleanup: no script may reintroduce a native-module rebuild step — that
// choreography was the root cause of the recurring ABI incidents
// (v1.3.0 packaged crash, ci:check ordering failures, dev/test flip-flops).

const root = fileURLToPath(new URL("../../", import.meta.url));
const pkg = JSON.parse(readFileSync(root + "package.json", "utf8")) as {
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

// [20260905_Feat_NodeSqlite] review fix: the bare /electron-rebuild/ regex
// does NOT match the scoped @electron/rebuild form (slash, not hyphen) — the
// exact command shape that once shipped broken installers. Cover both, and
// scan the places the rebuild steps actually lived (scripts/, workflows),
// not just package.json.
const REBUILD_RE = /@?electron[/-]rebuild/;
const NATIVE_SQLITE_RE = /better-sqlite3|check-native-abi/;

// strip comment lines so historical annotations ("better-sqlite3 was
// replaced by...") don't trip the pin — only live configuration matters
const stripComments = (text: string): string =>
  text
    .split("\n")
    .filter((line) => !/^\s*(\/\/|#)/.test(line))
    .join("\n");

const scannedSurfaces: Array<[string, string]> = [
  ...Object.entries(pkg.scripts).map(
    ([name, body]) => [`script:${name}`, body] as [string, string],
  ),
  [
    "scripts/ci-check.js",
    stripComments(readFileSync(root + "scripts/ci-check.js", "utf8")),
  ],
  [
    ".github/workflows/build.yml",
    stripComments(readFileSync(root + ".github/workflows/build.yml", "utf8")),
  ],
  [
    ".github/workflows/ci.yml",
    stripComments(readFileSync(root + ".github/workflows/ci.yml", "utf8")),
  ],
];

describe("no native-module ABI choreography in scripts", () => {
  it("has no better-sqlite3 dependency or rebuild step anywhere", () => {
    for (const dep of [
      "better-sqlite3",
      "@types/better-sqlite3",
      "bindings",
      "file-uri-to-path",
      "@electron/rebuild",
      "node-gyp",
    ]) {
      expect(pkg.dependencies[dep], `dependencies:${dep}`).toBeUndefined();
      expect(
        pkg.devDependencies[dep],
        `devDependencies:${dep}`,
      ).toBeUndefined();
    }
    for (const [name, body] of scannedSurfaces) {
      expect(body, `${name} rebuild`).not.toMatch(REBUILD_RE);
      expect(body, `${name} native-sqlite`).not.toMatch(NATIVE_SQLITE_RE);
    }
  });

  it("predev only builds the preload bundle (no rebuild hook)", () => {
    expect(pkg.scripts.predev).toBe("npm run build:preload");
  });
});
