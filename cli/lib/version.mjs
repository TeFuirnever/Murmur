// [20260912_Feat_CliSkeleton] --version support for the murmur CLI
// (ticket #264). Resolves the repo/package version by walking up from the
// CLI script directory to the nearest package.json. Under a packaged app the
// script lives inside app.asar, so the nearest package.json is the app's own
// (Electron's fs transparently reads asar archives); under `pnpm dev` / git
// checkout it is the repository package.json. Kept dependency-free and
// bounded: the walk stops at the filesystem root.
import fs from "node:fs";
import path from "node:path";

/**
 * Read the nearest package.json version walking up from startDir.
 * Returns "" when no package.json is found or it carries no version — the
 * caller renders that as "unknown".
 */
export function resolveCliVersion(startDir) {
  let dir = path.resolve(startDir);
  for (;;) {
    const candidate = path.join(dir, "package.json");
    try {
      const raw = fs.readFileSync(candidate, "utf-8");
      const parsed = JSON.parse(raw);
      if (typeof parsed.version === "string" && parsed.version.length > 0) {
        return parsed.version;
      }
    } catch {
      // No readable package.json here — keep walking up.
    }
    const parent = path.dirname(dir);
    if (parent === dir) return "";
    dir = parent;
  }
}
