# ONNX int8 Model Self-Export Pipeline (ticket #413, spec #412 T1)

> Trust-chain root for the ASR inference-stack migration: Murmur exports
> its own ONNX int8 models from OFFICIAL iic Apache-2.0 torch checkpoints
> and mirrors them on its own GitHub Release. Community repos (marxyz,
> pofice, manyeyes) are **cross-validation samples only — never download
> sources**.

## What it produces

Four models, each in `work/artifacts/<name>/` with the EXACT file set the
funasr-onnx runtime reads (source-verified against funasr-onnx 0.4.3 —
`paraformer_bin.py` / `vad_bin.py` / `punc_bin.py`):

| model                        | official iic checkpoint (revision)                                                      | shipped files                                                                                 |
| ---------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `asr-seaco-paraformer`       | `iic/speech_seaco_paraformer_large_asr_nat-zh-cn-16k-common-vocab8404-pytorch` @ v2.0.4 | `model_quant.onnx`, `model_eb_quant.onnx`, `config.yaml`, `am.mvn`, `tokens.json`, `seg_dict` |
| `vad-fsmn`                   | `iic/speech_fsmn_vad_zh-cn-16k-common-pytorch` @ v2.0.4                                 | `model_quant.onnx`, `config.yaml`, `am.mvn`                                                   |
| `punc-ct-transformer-272727` | `iic/punc_ct-transformer_zh-cn-common-vocab272727-pytorch` @ v2.0.4                     | `model_quant.onnx`, `config.yaml`, `tokens.json`                                              |
| `speaker-campplus`           | `iic/speech_campplus_sv_zh-cn_16k-common` @ v2.0.2\*                                    | `model_quant.onnx`, `config.yaml`                                                             |

\* the campplus repo has no `v2.0.4` tag (only v1.0.0/v2.0.0/v2.0.2 —
`funasr_server.py`'s `model_revision="v2.0.4"` silently falls back
upstream). The pin records the newest REAL tag so exports are
reproducible against actual bytes.

Two committed trust-chain records:

- **`scripts/onnx-export/model-pin.json`** — per model: ModelScope repo +
  revision + 40-hex checkpoint commit, export toolchain versions, GitHub
  Release mirror URL/tag, and the full per-file sha256 manifest with the
  release asset name of every file. The downloader tickets (T-series)
  consume this; `tests/unit/onnx-model-pin.test.ts` gates it in CI.
- **Release `models-onnx-int8-1`** on this repo — one asset per file
  (`<model>__<file>` naming; GitHub asset names cannot contain `/`), plus
  `manifest.json` and the upstream Apache-2.0 `LICENSE.upstream`.
  The tag is deliberately NOT `v*` so `build.yml` installers never fire.

**Split-part layout:** files larger than 64 MiB (the two big graphs) are
mirrored as ordered parts `<asset>.partNN` because single 300MB+ request
bodies repeatedly died on this uplink (GitHub upload-inactivity 408; no
resume for release assets). The pin lists `files[].asset_parts` for
those; downloader contract: fetch parts in order, concatenate, and the
assembled bytes MUST hash to the same `files[].sha256` — integrity stays
anchored on the per-file manifest, parts are only a transport layout.

## How to run

```bash
# 1. one-time environment (python 3.11, pinned wheels — see
#    requirements-export.txt; PIP_INDEX_URL honored for slow routes):
bash scripts/onnx-export/bootstrap_env.sh

# 2. export all four models (idempotent — snapshots are cached, exports
#    re-run deterministic, artifacts re-verified, pin rewritten):
scripts/onnx-export/.venv/bin/python scripts/onnx-export/export_onnx_models.py

# 3. acceptance smoke (40s wav, hotword path, RTF/RSS):
scripts/onnx-export/.venv/bin/python scripts/onnx-export/smoke_inference.py

# 4. marxyz community cross-validation (bytes + behavior):
scripts/onnx-export/.venv/bin/python scripts/onnx-export/cross_validate_marxyz.py

# 5. verify local artifacts against the pin:
scripts/onnx-export/.venv/bin/python scripts/onnx-export/verify_artifacts.py
# ...or verify the RELEASE mirror without downloading (GitHub's
# server-side asset sha256 digests):
scripts/onnx-export/.venv/bin/python scripts/onnx-export/verify_artifacts.py --via-api
# ...or download every asset (incl. split-part reassembly) and hash-check:
scripts/onnx-export/.venv/bin/python scripts/onnx-export/verify_artifacts.py \
    --from-release --download-dir /tmp/mirror-check

# 6. publish artifacts to the release mirror (idempotent, records the
#    split-part layout into the pin):
scripts/onnx-export/.venv/bin/python scripts/onnx-export/publish_assets.py
```

## Pipeline guarantees (and how each is enforced)

1. **Export inputs are the official checkpoints.** `snapshot_download`
   pins the revision; the revision's HEAD commit (40-hex) is captured via
   the ModelScope commits API and recorded in the pin. Every consumed
   checkpoint file is additionally cross-checked against the hub's own
   per-file sha256 listing (`verify_snapshot_files`).
2. **Quantization is the funasr recipe.** `quantize_dynamic`,
   `op_types_to_quantize=["MatMul"]`, per-channel, QUInt8 — the same
   parameters funasr's `export_utils._onnx` uses, so our artifacts match
   what `funasr-onnx(quantize=True)` expects (`model_quant.onnx` naming,
   `model_eb_quant.onnx` hotword branch).
3. **CAMPPlus is exported manually** (funasr has no export_meta for it —
   verified 1.2.7/1.3.1). Its `seg_pooling` ceil-mode pooling is not
   ONNX-exportable; the pipeline substitutes an equivalent static-pad +
   valid-count-mask formulation whose numerics are verified IDENTICAL to
   upstream at export time (torch-level allclose gate), and the exported
   fp32 graph is checked against the torch module (embedding cosine
   gate) before anything ships.
4. **The manifest covers every runtime-read file.** Strict set semantics:
   a missing file, a hash mismatch, or an UNLISTED extra file all fail
   (`check_manifest`) — inside the export, in `verify_artifacts.py`, and
   (from the T-series tickets) in the runtime ready gate.
5. **config.yaml is safe_load-parseable.** Upstream `funasr_onnx`
   `read_yaml` uses unsafe `yaml.Loader` (RCE surface); the export
   refuses to ship a config that does not parse with `yaml.safe_load`.

## Verification evidence

Run artifacts (gitignored, regenerated by the scripts above):
`work/artifacts/manifest.json`, `work/smoke_results.json`,
`work/cross_validation.json`. The committed record is
`model-pin.json`; release assets are byte-verified by
`verify_artifacts.py --from-release`.

## Known deltas (explained)

- **`model_eb_quant.onnx` stays fp32-sized (~34 MB).** Upstream funasr
  quantization excludes the hotword embedding branch's non-MatMul ops; every
  community export (marxyz/pofice) shows the same size. Spec #412 accepts
  this as an upstream-behavior delta.
- **CAMPPlus int8 barely shrinks (29 MB vs 28 MB fp32).** The network is
  Conv1d-dominated; the MatMul-only dynamic-quantization recipe keeps
  conv weights fp32. The quantization-delta measurement
  (`smoke_inference.py` → `campplus.int8_fp32_cosine`) quantifies the
  accuracy cost; revisit a conv-inclusive recipe in the runtime ticket if
  the size win justifies it (today it does not — the model is small).
- **ONNX graph bytes differ from marxyz's.** Export toolchain versions
  and trace environments are not pinned upstream, so byte equality of the
  graphs is not expected; the cross-validation therefore checks (a) all
  non-onnx runtime files are byte-identical (both sides copy the same
  official checkpoint files) and (b) both models produce the same
  transcript on the same input (`cross_validate_marxyz.py`).
