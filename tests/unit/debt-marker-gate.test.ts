// [20260918_Ci_DebtMarkerGate] Contract tests for the ADHA-2 debt-marker
// gate: scripts/check-debt-markers.js must FAIL when a scanned file gains a
// debt-marker comment and PASS on a clean tree (including the current repo,
// where zero markers is the documented policy — see ADHA-1). Fixture roots
// are synthesized under os.tmpdir() and passed via the script's [root]
// argument so the real tree is never touched.
import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

const REPO_ROOT = path.resolve(__dirname, "../..");
const SCRIPT = path.join(REPO_ROOT, "scripts", "check-debt-markers.js");

// Assembled at runtime so this file stays out of the way of repo-wide
// marker searches (tests/ is outside the gate's scanned scope, but hygiene
// audits still read these hits and should not have to judge them).
const MARKER = "TO" + "DO";

function runGate(root?: string) {
  const args = root ? [SCRIPT, root] : [SCRIPT];
  return spawnSync(process.execPath, args, { encoding: "utf8" });
}

describe("debt-marker gate (scripts/check-debt-markers.js)", () => {
  const tempRoots: string[] = [];

  function makeTempRoot(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "debt-marker-gate-"));
    tempRoots.push(dir);
    return dir;
  }

  function writeFixture(root: string, rel: string, content: string) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }

  afterEach(() => {
    while (tempRoots.length) {
      const dir = tempRoots.pop();
      if (dir) fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("passes on the current repo tree (zero-marker policy holds)", () => {
    const res = runGate();
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("No debt markers found");
  });

  it("fails with file:line detail when a scanned src/ file gains a marker", () => {
    const root = makeTempRoot();
    writeFixture(
      root,
      "src/example.ts",
      `// ${MARKER} injected\nconst x = 1;\n`,
    );
    const res = runGate(root);
    expect(res.status).toBe(1);
    // Paths are reported with forward slashes on both platforms.
    expect(res.stdout).toContain("src/example.ts:1");
  });

  it("fails when a root-level entry/config file gains a marker", () => {
    const root = makeTempRoot();
    writeFixture(root, "main.ts", `// ${MARKER} injected\n`);
    const res = runGate(root);
    expect(res.status).toBe(1);
    expect(res.stdout).toContain("main.ts:1");
  });

  it("ignores markers in excluded directories (node_modules, dist, python, out)", () => {
    const root = makeTempRoot();
    writeFixture(root, "src/dist/bundle.js", `// ${MARKER}\n`);
    writeFixture(root, "src/node_modules/dep/index.js", `// ${MARKER}\n`);
    writeFixture(root, "node_modules/dep/index.js", `// ${MARKER}\n`);
    writeFixture(root, "python/lib/x.py", `# ${MARKER}\n`);
    writeFixture(root, "out/bundle.js", `// ${MARKER}\n`);
    writeFixture(root, "website/src/x.ts", `// ${MARKER}\n`);
    const res = runGate(root);
    expect(res.status).toBe(0);
  });

  it("ignores markers in non-code extensions (json/md)", () => {
    const root = makeTempRoot();
    writeFixture(root, "src/data.json", `{ "note": "${MARKER} prose" }\n`);
    writeFixture(root, "src/readme.md", `# ${MARKER} prose\n`);
    const res = runGate(root);
    expect(res.status).toBe(0);
  });

  it("package.json exposes the check:debt-markers script", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"),
    );
    expect(pkg.scripts["check:debt-markers"]).toContain(
      "check-debt-markers.js",
    );
  });

  it("ci-check.js wires the gate into the stage-1 checks", () => {
    const ci = fs.readFileSync(
      path.join(REPO_ROOT, "scripts", "ci-check.js"),
      "utf8",
    );
    expect(ci).toContain("check:debt-markers");
  });

  it("ci.yml mirrors the gate as a CI step", () => {
    const ci = fs.readFileSync(
      path.join(REPO_ROOT, ".github", "workflows", "ci.yml"),
      "utf8",
    );
    expect(ci).toContain("check:debt-markers");
  });
});
