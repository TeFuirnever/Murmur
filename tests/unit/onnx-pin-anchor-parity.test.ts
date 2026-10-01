// [20261001_T5_OnnxGateParity] Ticket #417 (spec #412 decision 8): the
// Python readiness gate (funasr_server.py ONNX_PIN_FILE_SPECS — the AUTHORITATIVE
// loader side) and the committed trust-chain record
// (scripts/onnx-export/model-pin.json — the source the Node v2 downloader
// consumes) must never drift apart. The anchor-parity pattern from
// tests/unit/modelManager-anchor-parity.test.ts: parse the Python source
// text and assert set equality with the pin JSON — names AND sizes.
//
// A pin regeneration (new mirror release) therefore FAILS this test until
// the Python gate constants are synced — the supply chain cannot fork.
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "../..");
const SERVER_PY = path.join(ROOT, "funasr_server.py");
const PIN_PATH = path.join(ROOT, "scripts/onnx-export/model-pin.json");

type PinFile = { path: string; sha256: string; size_bytes: number };
type Pin = {
  models: Record<string, { name: string; files: PinFile[] }>;
};

function loadPin(): Pin {
  return JSON.parse(fs.readFileSync(PIN_PATH, "utf8")) as Pin;
}

/** Parse the ONNX_PIN_FILE_SPECS dict literal out of the Python source.
 * The block is flat {\"model\": {\"file\": size, ...}, ...} — the regex
 * walk is anchored on the tag comment so a rename cannot pass silently. */
function parsePythonSpecs(): Record<string, Record<string, number>> {
  const source = fs.readFileSync(SERVER_PY, "utf8");
  const blockMatch = source.match(/ONNX_PIN_FILE_SPECS = \{([\s\S]*?)\n\}/);
  if (!blockMatch) {
    throw new Error("ONNX_PIN_FILE_SPECS not found in funasr_server.py");
  }
  const block = blockMatch[1]!;
  const specs: Record<string, Record<string, number>> = {};
  // Split into per-model sub-blocks: "asr": { ... },
  const modelRe = /"(\w+)":\s*\{([^}]*)\}/g;
  let modelMatch: RegExpExecArray | null;
  while ((modelMatch = modelRe.exec(block)) !== null) {
    const [, modelKey, body] = modelMatch;
    if (!modelKey || body === undefined) continue;
    const files: Record<string, number> = {};
    const fileRe = /"([^"]+)":\s*(\d+)/g;
    let fileMatch: RegExpExecArray | null;
    while ((fileMatch = fileRe.exec(body)) !== null) {
      if (fileMatch[1] && fileMatch[2]) {
        files[fileMatch[1]] = Number(fileMatch[2]);
      }
    }
    specs[modelKey] = files;
  }
  return specs;
}

function parsePythonPartialSuffixes(): string[] {
  const source = fs.readFileSync(SERVER_PY, "utf8");
  const match = source.match(/_PARTIAL_TMP_SUFFIXES = \(([^)]*)\)/);
  if (!match || !match[1]) {
    throw new Error("_PARTIAL_TMP_SUFFIXES not found in funasr_server.py");
  }
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
}

// [20261001_T6a_OnnxEngine] Ticket #418: the Python server resolves the ONNX
// generation under the SAME subdir the Node v2 downloader writes
// (modelDownloader.ONNX_MODELS_DIRNAME). Anchor-parity: parse the Python
// constant so a rename on either side trips this test.
function parsePythonOnnxSubdir(): string {
  const source = fs.readFileSync(SERVER_PY, "utf8");
  const match = source.match(/ONNX_MODELS_SUBDIR = "([^"]+)"/);
  if (!match || !match[1]) {
    throw new Error("ONNX_MODELS_SUBDIR not found in funasr_server.py");
  }
  return match[1]!;
}

describe("[20261001_T5_OnnxGateParity] funasr_server.py gate ↔ model-pin.json", () => {
  it("Python gate covers exactly the pin's models", () => {
    const pin = loadPin();
    const specs = parsePythonSpecs();
    expect(Object.keys(specs).sort()).toEqual(Object.keys(pin.models).sort());
  });

  it.each(Object.keys(loadPin().models))(
    "%s: Python gate set == pin file set (names + sizes)",
    (modelKey) => {
      const pin = loadPin();
      const entry = pin.models[modelKey];
      if (!entry) throw new Error(`pin missing model ${modelKey}`);
      const pinSet: Record<string, number> = {};
      for (const file of entry.files) {
        pinSet[file.path] = file.size_bytes;
      }
      const pythonSet = parsePythonSpecs()[modelKey];
      expect(pythonSet).toBeDefined();
      expect(pythonSet).toEqual(pinSet);
    },
  );

  it("Python temp-name exclusion covers the Node downloader's partial suffix", () => {
    // modelDownloader.ts PARTIAL_SUFFIX — keep the import as the source of
    // truth so a rename on either side trips this test.
    return import("../../src/helpers/modelDownloader").then(
      ({ PARTIAL_SUFFIX }) => {
        expect(parsePythonPartialSuffixes()).toContain(PARTIAL_SUFFIX);
      },
    );
  });

  // [20261001_T6a_OnnxEngine] The server's ONNX generation root subdir must
  // equal the downloader's layout constant (T5 layout, one name only).
  it("Python ONNX models subdir == Node downloader's ONNX_MODELS_DIRNAME", () => {
    return import("../../src/helpers/modelDownloader").then(
      ({ ONNX_MODELS_DIRNAME }) => {
        expect(parsePythonOnnxSubdir()).toBe(ONNX_MODELS_DIRNAME);
      },
    );
  });
});
