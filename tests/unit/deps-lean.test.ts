// [20260815_Refactor_DepsLean] Contract test: the packaged app ships every
// production dependency (electron-builder files: node_modules/**/*), so any
// dependency with zero runtime imports is pure installer bloat. This suite
// locks in the 2026-08-15 ponytail removals so they cannot silently re-enter
// via `pnpm add` or a bad merge.
//
// Grounds for each removal (verified by repo-wide import grep):
//   - axios / form-data / mime-types / unzipper / shadcn-ui / tw-animate-css:
//     zero imports anywhere (src/, main.ts, preload.ts, scripts/, tests/).
//   - @radix-ui/react-dialog / -dropdown-menu / -select / -label / -tabs:
//     only ever imported by the deleted dead shadcn primitives
//     (ui/{dialog-less} card/input/label/tabs/etc. had zero runtime importers).
//   - osascript: npm package was require()d into a ClipboardManager field
//     that was never read; real AppleScript calls go through spawn("osascript").
//   - tar: used only by scripts/prepare-embedded-python.js (pre-packaging),
//     so it belongs in devDependencies and out of the shipped app.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const pkg = JSON.parse(
  readFileSync(path.join(repoRoot, "package.json"), "utf8"),
) as {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

const REMOVED_RUNTIME_DEPS = [
  "axios",
  "form-data",
  "mime-types",
  "unzipper",
  "shadcn-ui",
  "tw-animate-css",
  "osascript",
  // [20260815_Refactor_DotenvRemoval] replaced by a minimal parser in
  // src/helpers/environment.ts (see tests/unit/environment.test.ts).
  "dotenv",
  "@radix-ui/react-dialog",
  "@radix-ui/react-dropdown-menu",
  "@radix-ui/react-select",
  "@radix-ui/react-label",
  "@radix-ui/react-tabs",
  // zero imports anywhere once the dead shadcn primitives were deleted.
  "@radix-ui/react-progress",
] as const;

describe("[20260815_Refactor_DepsLean] runtime dependencies", () => {
  // [20260905_Feat_NodeSqlite] The two keep-pins below are INVERTED with the
  // engine swap (spec #226): bindings was better-sqlite3's native loader and
  // @electron/rebuild was the Windows CI rebuild shim — both lost their
  // consumer when the addon left the tree. They must now STAY OUT so the
  // installers stop shipping dead native tooling.
  it("does not declare the retired native loader (bindings)", () => {
    expect(pkg.dependencies).not.toHaveProperty("bindings");
  });

  it("does not declare the retired rebuild shim (@electron/rebuild)", () => {
    expect(pkg.devDependencies).not.toHaveProperty("@electron/rebuild");
  });

  it.each(REMOVED_RUNTIME_DEPS)("%s is not a production dependency", (name) => {
    expect(pkg.dependencies).not.toHaveProperty(name);
  });

  it("keeps tar out of production dependencies (build-script-only)", () => {
    expect(pkg.dependencies).not.toHaveProperty("tar");
    expect(pkg.devDependencies).toHaveProperty("tar");
  });

  // [20260815_Refactor_DepsLean] tailwindcss-animate is loaded by
  // tailwind.config.js at CSS build time only — never bundled into the app.
  it("keeps tailwindcss-animate out of production dependencies (css-build-only)", () => {
    expect(pkg.dependencies).not.toHaveProperty("tailwindcss-animate");
    expect(pkg.devDependencies).toHaveProperty("tailwindcss-animate");
  });
});
