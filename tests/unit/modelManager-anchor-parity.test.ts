// [20260913_Fix_256_AnchorParity] Cross-language contract test for the model
// readiness anchors. funasr_server.py's _repo_ready() is the AUTHORITATIVE
// gate (Python is the actual model loader); Node's _verifyModel() directory
// branch must accept exactly the same name set, otherwise a repo whose only
// marker is one Node lacks reads "ready" to Python and "missing" to Node —
// the state-flap failure class from #256/#336.
//
// Approach: read funasr_server.py as TEXT, regex-extract the module-level
// _READY_PATTERNS list literal, parse the quoted items, classify each into
// exact-name vs fnmatch glob (suffix "*.x" / prefix "x*"), and assert:
//   1. Node's READY_ANCHOR_EXACT ≡ the Python exact-name set.
//   2. Node's READY_ANCHOR_SUFFIXES/PREFIXES ≡ the Python glob patterns.
//   3. Behavioral parity: _verifyModel accepts every parsed anchor and
//      rejects names outside the Python set (including "config.yaml", the
//      old Node-only marker Python never matched).
// If Python ever adds/removes a pattern, assertions 1-2 force Node to catch
// up (and vice versa) at unit-test time.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import ModelManager, {
  READY_ANCHOR_EXACT,
  READY_ANCHOR_PREFIXES,
  READY_ANCHOR_SUFFIXES,
} from "../../src/helpers/modelManager";

const PY_SERVER_PATH = path.resolve(__dirname, "../../funasr_server.py");

// fnmatch metacharacters (Python glob/fnmatch syntax).
const GLOB_METACHARS = /[*?[\]]/;

type ExactAnchor = { kind: "exact"; name: string };
type SuffixAnchor = { kind: "suffix"; value: string };
type PrefixAnchor = { kind: "prefix"; value: string };
type ParsedAnchor = ExactAnchor | SuffixAnchor | PrefixAnchor;

/** Decode one Python pattern into the Node-side matching rule it implies. */
function parsePythonPattern(pattern: string): ParsedAnchor {
  if (!GLOB_METACHARS.test(pattern)) {
    return { kind: "exact", name: pattern };
  }
  // "*.onnx" → fnmatch tail glob → Node endsWith(".onnx").
  const suffix = pattern.match(/^\*([^*?]*)$/);
  if (suffix) return { kind: "suffix", value: suffix[1]! };
  // "vocab*" → fnmatch head glob → Node startsWith("vocab").
  const prefix = pattern.match(/^([^*?]*)\*$/);
  if (prefix) return { kind: "prefix", value: prefix[1]! };
  // An exotic glob (character classes, embedded wildcards) has no Node
  // counterpart — fail loudly so the parity gap is visible, not silent.
  throw new Error(
    `Python readiness pattern "${pattern}" has no Node-side rule`,
  );
}

/** Extract + parse the _READY_PATTERNS list literal from the Python source. */
function parsePythonReadyPatterns(): ParsedAnchor[] {
  const source = fs.readFileSync(PY_SERVER_PATH, "utf8");
  const listMatch = source.match(/_READY_PATTERNS\s*=\s*\[([^\]]*)\]/);
  if (!listMatch) {
    throw new Error(
      "_READY_PATTERNS list literal not found in funasr_server.py",
    );
  }
  const items = [...listMatch[1]!.matchAll(/"([^"]*)"/g)].map((m) => m[1]!);
  if (items.length === 0) {
    throw new Error("_READY_PATTERNS parsed as empty — parse target moved?");
  }
  return items.map(parsePythonPattern);
}

// Module-scope parse — shared by both describes below. A missing/moved
// Python literal throws at collection time, which fails the file loudly.
const pythonAnchors = parsePythonReadyPatterns();
const pythonExact = pythonAnchors
  .filter((a): a is ExactAnchor => a.kind === "exact")
  .map((a) => a.name)
  .sort();
const pythonSuffixes = pythonAnchors
  .filter((a): a is SuffixAnchor => a.kind === "suffix")
  .map((a) => a.value)
  .sort();
const pythonPrefixes = pythonAnchors
  .filter((a): a is PrefixAnchor => a.kind === "prefix")
  .map((a) => a.value)
  .sort();

function makeManager(): ModelManager {
  return new ModelManager({
    info: () => {},
    warn: () => {},
    error: () => {},
  });
}

describe("[20260913_Fix_256_AnchorParity] Node/Python ready-anchor contract", () => {
  it("parses a non-empty Python pattern list with all three rule kinds", () => {
    // Parse sanity: the extraction must have found the real gate, not an
    // empty/moved literal. The known gate has exact names AND globs.
    expect(pythonExact.length).toBeGreaterThan(0);
    expect(pythonSuffixes.length + pythonPrefixes.length).toBeGreaterThan(0);
  });

  it("READY_ANCHOR_EXACT ≡ the Python exact-name set", () => {
    expect([...READY_ANCHOR_EXACT].sort()).toEqual(pythonExact);
  });

  it("READY_ANCHOR_SUFFIXES/PREFIXES ≡ the Python glob patterns", () => {
    expect([...READY_ANCHOR_SUFFIXES].sort()).toEqual(pythonSuffixes);
    expect([...READY_ANCHOR_PREFIXES].sort()).toEqual(pythonPrefixes);
  });
});

describe("[20260913_Fix_256_AnchorParity] behavioral parity via _verifyModel", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mm-anchor-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function dirWithOnly(...names: string[]): string {
    const dir = path.join(tmpDir, names.join("_"));
    fs.mkdirSync(dir, { recursive: true });
    for (const name of names) {
      fs.writeFileSync(path.join(dir, name), "x");
    }
    return dir;
  }

  function verify(dir: string): boolean {
    return makeManager()._verifyModel(dir, {
      name: "n",
      cache_path: "c",
      expected_size: 100,
      required: true,
    });
  }

  it("accepts every exact anchor name the Python gate accepts", () => {
    for (const name of pythonExact) {
      expect(verify(dirWithOnly(name))).toBe(true);
    }
  });

  it("accepts the fnmatch-derived suffix matches (*.onnx)", () => {
    for (const suffix of pythonSuffixes) {
      expect(verify(dirWithOnly(`weights${suffix}`))).toBe(true);
    }
  });

  it("accepts the fnmatch-derived prefix matches (vocab*)", () => {
    for (const prefix of pythonPrefixes) {
      expect(verify(dirWithOnly(`${prefix}.txt`))).toBe(true);
    }
  });

  it("rejects names outside the Python pattern set (incl. the old Node-only config.yaml)", () => {
    // config.yaml was accepted by Node's OLD inline set but never matched by
    // Python — exactly the ready-here/not-ready-there flap this contract
    // forbids. Suffix/prefix rules must not over-accept either.
    expect(verify(dirWithOnly("config.yaml"))).toBe(false);
    expect(verify(dirWithOnly("onnx"))).toBe(false); // no ".onnx" suffix
    expect(verify(dirWithOnly("cvocab.txt"))).toBe(false); // no "vocab" prefix
    expect(verify(dirWithOnly("notes.txt"))).toBe(false);
  });
});
