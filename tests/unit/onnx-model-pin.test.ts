// [20260930_T413_OnnxExportPipeline] Ticket #413 (spec #412 T1): in-repo
// contract test for the ONNX int8 model pin (scripts/onnx-export/
// model-pin.json). The pin is the trust-chain record: official iic
// checkpoint identity (repo + revision + 40-hex commit), export tool
// versions, our GitHub Release mirror location, and the FULL per-file
// sha256 manifest of every file the funasr-onnx runtime reads.
//
// This file fails on a fresh clone until the pin is committed — that is
// intentional: CI must never merge main without the pinned record (the
// Python twin in tests/python/test_onnx_export_common.py skips instead,
// because it also runs inside the export pipeline itself).
//
// Runtime file sets are source-verified against funasr-onnx 0.4.3:
//   - SeacoParaformer/ContextualParaformer: paraformer_bin.py
//     (model[_eb]_quant.onnx + config.yaml + am.mvn + tokens.json);
//     seg_dict ships alongside (marxyz parity, hotword segmentation
//     reserve).
//   - Fsmn_vad: vad_bin.py (model_quant.onnx + config.yaml + am.mvn).
//   - CT_Transformer: punc_bin.py (model_quant.onnx + config.yaml +
//     tokens.json; jieba_usr_dict is optional upstream and not shipped).
//   - CAMPPlus: no funasr-onnx loader exists (T-later server ticket loads
//     the ONNX directly) — quantized graph + config.yaml.
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const EXPORT_DIR = path.resolve(__dirname, "../../scripts/onnx-export");
const PIN_PATH = path.join(EXPORT_DIR, "model-pin.json");
const COMMON_PY_PATH = path.join(EXPORT_DIR, "onnx_export_common.py");

const EXPECTED_RUNTIME_FILES: Record<string, string[]> = {
  asr: [
    "model_quant.onnx",
    "model_eb_quant.onnx",
    "config.yaml",
    "am.mvn",
    "tokens.json",
    "seg_dict",
  ],
  vad: ["model_quant.onnx", "config.yaml", "am.mvn"],
  punc: ["model_quant.onnx", "config.yaml", "tokens.json"],
  speaker: ["model_quant.onnx", "config.yaml"],
};

const EXPECTED_REPOS: Record<string, string> = {
  asr: "iic/speech_seaco_paraformer_large_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
  vad: "iic/speech_fsmn_vad_zh-cn-16k-common-pytorch",
  punc: "iic/punc_ct-transformer_zh-cn-common-vocab272727-pytorch",
  speaker: "iic/speech_campplus_sv_zh-cn_16k-common",
};

const SHA256_RE = /^[0-9a-f]{64}$/;
const COMMIT_SHA_RE = /^[0-9a-f]{40}$/;

type PinFile = {
  path: string;
  sha256: string;
  size_bytes: number;
  asset: string;
  asset_parts?: string[];
};

type PinModel = {
  name: string;
  modelscope_repo: string;
  modelscope_repo_alias?: string;
  model_revision: string;
  checkpoint_commit: string;
  export: Record<string, string | number>;
  files: PinFile[];
};

type ModelPin = {
  schema_version: number;
  generated_utc: string;
  license: string;
  attribution: string;
  release: { tag: string; url: string; asset_base_url: string };
  models: Record<string, PinModel>;
};

/** Parse the MODEL_SPECS python literal entries as text (anchor-parity
 * pattern from tests/unit/modelManager-anchor-parity.test.ts): the Python
 * pipeline and the committed JSON pin must never drift apart silently. */
function parsePythonSpecField(key: string, field: string): string {
  const source = fs.readFileSync(COMMON_PY_PATH, "utf8");
  const blockMatch = source.match(
    new RegExp(`"${key}":\\s*\\{([\\s\\S]*?)\\n\\s{4}\\}`, "m"),
  );
  if (!blockMatch) throw new Error(`MODEL_SPECS["${key}"] not found`);
  const fieldMatch = blockMatch[1]!.match(
    new RegExp(`"${field}":\\s*"([^"]+)"`),
  );
  if (!fieldMatch) throw new Error(`field ${field} missing for ${key}`);
  return fieldMatch[1]!;
}

function loadPin(): ModelPin {
  return JSON.parse(fs.readFileSync(PIN_PATH, "utf8")) as ModelPin;
}

describe("onnx model pin (ticket #413)", () => {
  it("model-pin.json is committed", () => {
    expect(fs.existsSync(PIN_PATH)).toBe(true);
  });

  it("pins exactly the four models of spec #412", () => {
    const pin = loadPin();
    expect(Object.keys(pin.models).sort()).toEqual([
      "asr",
      "punc",
      "speaker",
      "vad",
    ]);
    expect(pin.schema_version).toBeGreaterThan(0);
    expect(pin.license).toBe("Apache-2.0");
    // Apache-2.0 §4: redistribution must carry upstream attribution.
    expect(pin.attribution.length).toBeGreaterThan(0);
    expect(pin.attribution).toMatch(/FunASR|ModelScope|iic/);
  });

  it.each(Object.keys(EXPECTED_REPOS))(
    "%s pins the official iic checkpoint with 40-hex commit",
    (key) => {
      const pin = loadPin();
      const model = pin.models[key];
      if (!model) throw new Error(`pin missing model ${key}`);
      expect(model.modelscope_repo).toBe(EXPECTED_REPOS[key]);
      expect(model.modelscope_repo.startsWith("iic/")).toBe(true);
      expect(model.model_revision).toMatch(/^v\d+\.\d+\.\d+$/);
      expect(model.checkpoint_commit).toMatch(COMMIT_SHA_RE);
    },
  );

  it.each(Object.keys(EXPECTED_RUNTIME_FILES))(
    "%s manifest covers exactly the funasr-onnx runtime file set",
    (key) => {
      const pin = loadPin();
      const entry = pin.models[key];
      if (!entry) throw new Error(`pin missing model ${key}`);
      const files = entry.files;
      expect(files.map((f) => f.path).sort()).toEqual(
        [...EXPECTED_RUNTIME_FILES[key]!].sort(),
      );
      for (const file of files) {
        expect(file.sha256, `${key}/${file.path} sha256`).toMatch(SHA256_RE);
        expect(file.size_bytes).toBeGreaterThan(0);
        // Release asset naming convention: <model>__<path> (GitHub asset
        // names cannot contain "/").
        expect(file.asset).toBe(`${entry.name}__${file.path}`);
        // Large graphs may be mirrored as ordered split parts (uplink
        // stalls kill single 300MB+ request bodies). Integrity stays
        // anchored on the assembled file's sha256 above — parts are only
        // a transport layout.
        if (file.asset_parts !== undefined) {
          expect(file.asset_parts.length).toBeGreaterThan(0);
          for (const part of file.asset_parts) {
            expect(part).toMatch(new RegExp(`^${file.asset}\\.part\\d{2}$`));
          }
        }
      }
    },
  );

  it("records the export toolchain versions (SBOM pin discipline)", () => {
    const pin = loadPin();
    for (const key of Object.keys(pin.models)) {
      const entry = pin.models[key];
      if (!entry) throw new Error(`pin missing model ${key}`);
      const exported = entry.export;
      expect(String(exported.funasr)).toMatch(/^\d+\.\d+/);
      expect(String(exported.torch)).toMatch(/^\d+\.\d+/);
      expect(String(exported.onnx)).toMatch(/^\d+\./);
      expect(String(exported.onnxruntime)).toMatch(/^\d+\./);
      expect(Number(exported.opset)).toBeGreaterThan(0);
    }
  });

  it("release mirror tag never triggers installer builds (non-v*)", () => {
    const pin = loadPin();
    const { tag, url, asset_base_url } = pin.release;
    expect(tag).toMatch(/^models-onnx-int8-\d+$/);
    expect(tag.startsWith("v")).toBe(false);
    expect(url).toBe(
      `https://github.com/TeFuirnever/Murmur/releases/tags/${tag}`,
    );
    expect(asset_base_url).toBe(
      `https://github.com/TeFuirnever/Murmur/releases/download/${tag}/`,
    );
  });

  it("MODEL_SPECS (python) and the pin agree on repo + revision", () => {
    const pin = loadPin();
    for (const key of Object.keys(EXPECTED_REPOS)) {
      const entry = pin.models[key];
      if (!entry) throw new Error(`pin missing model ${key}`);
      expect(parsePythonSpecField(key, "modelscope_repo")).toBe(
        entry.modelscope_repo,
      );
      expect(parsePythonSpecField(key, "model_revision")).toBe(
        entry.model_revision,
      );
      expect(parsePythonSpecField(key, "name")).toBe(entry.name);
    }
  });
});
