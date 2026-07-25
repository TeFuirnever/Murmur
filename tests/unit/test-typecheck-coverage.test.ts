// [20260725_Autopilot_T2.1] TDD regression: tsc must cover tests/.
//
// The base tsconfig.json `include` only covers `src/**/*`, `main.ts`,
// `preload.ts` — NOT `tests/**`. So `pnpm typecheck` (tsc --noEmit) gives
// zero type-safety for the 20 `.ts`/`.tsx` test files. This test asserts
// that a tsconfig exists which extends the base AND includes `tests/**`.
//
// RED first: no such tsconfig exists yet → test fails. After US-006 adds
// `tsconfig.test.json`, the test goes GREEN.
// [20260725_Autopilot_T2.1] END
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "../..");

interface TsConfig {
  extends?: string;
  compilerOptions?: Record<string, unknown>;
  include?: string[];
  exclude?: string[];
}

function readJsonConfig(filePath: string): TsConfig | null {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, "utf8");
  // tsconfig allows JSONC with trailing commas; strip them cheaply.
  const cleaned = raw.replace(/,\s*([}\]])/g, "$1");
  try {
    return JSON.parse(cleaned) as TsConfig;
  } catch {
    return null;
  }
}

/**
 * A tsconfig "covers tests" if its include array contains a glob that
 * recursively matches the tests directory. Acceptable forms include
 * `tests/`-prefixed recursive globs. Reject forms that only include a
 * single test helper file (e.g. the _tsresolve setup alone).
 */
function includesTests(cfg: TsConfig | null): boolean {
  if (!cfg || !Array.isArray(cfg.include)) return false;
  return cfg.include.some((glob) => /^tests\/\*\*/.test(glob));
}

describe("[TDD regression] tsc covers tests/", () => {
  it("base tsconfig.json does NOT cover tests/ ( motivates the need for tsconfig.test.json)", () => {
    const base = readJsonConfig(path.join(ROOT, "tsconfig.json"));
    // Sanity: base must exist and cover source.
    expect(base, "tsconfig.json must exist").not.toBeNull();
    expect(base!.include, "tsconfig.json must have an include array").toEqual(
      expect.arrayContaining([expect.stringMatching(/^src\/\*\*/)]),
    );
    // The gap: base must NOT cover tests (this is what we are fixing).
    expect(includesTests(base)).toBe(false);
  });

  it("a tsconfig exists that extends base AND covers tests/", () => {
    const candidates = ["tsconfig.test.json", "tsconfig.tests.json"]
      .map((name) => path.join(ROOT, name))
      .map((p) => ({ path: p, cfg: readJsonConfig(p) }));

    const covering = candidates.find(({ cfg }) => includesTests(cfg));

    expect(
      covering,
      [
        "No tsconfig found that covers tests/**.",
        "Expected: tsconfig.test.json with `include: [..., 'tests/**']` extending tsconfig.json.",
        `Checked: ${candidates.map((c) => path.basename(c.path)).join(", ")}`,
      ].join(" "),
    ).toBeDefined();

    // The covering config must extend the base so it inherits strict mode.
    expect(
      covering!.cfg!.extends,
      "covering tsconfig must extend base",
    ).toMatch(/\.\/tsconfig\.json$/);
  });
});
