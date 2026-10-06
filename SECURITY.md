# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 1.0.x   | ✅        |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, please report them via:

- **GitHub Security Advisory**: [Create a new security advisory](https://github.com/TeFuirnever/Murmur/security/advisories/new)
- **Email**: Send details to the maintainer

Please include:

- Description of the vulnerability
- Steps to reproduce
- Affected versions
- Suggested fix (if any)

We will acknowledge your report within 48 hours and aim to provide a fix within 7 days.

## Security Measures

Murmur implements the following security measures:

- **Content Security Policy (CSP)** — Restricts script/style/connect sources; `connect-src: https:` for AI API calls
- **Context Isolation** — Electron `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` on all BrowserWindows
- **API Key Encryption** — Sensitive settings (API keys) encrypted at rest via `electron.safeStorage` (backed by OS keychain)
- **SSRF Protection** — AI base URL validated to be `https:` with RFC1918/loopback blocking in handler layer
- **URL Validation** — External links restricted to `https:` protocol
- **IPC Input Validation** — File paths and IDs validated in handlers
- **Local Processing** — All audio processed locally, no data uploaded

## Known Security Considerations

- `com.apple.security.cs.allow-unsigned-executable-memory` entitlement required for FunASR/PyTorch JIT
- macOS App Sandbox (`com.apple.security.app-sandbox`) is disabled due to Python subprocess requirements; Electron-level `sandbox: true` remains enabled on all BrowserWindows
- API keys are encrypted via `electron.safeStorage` before storage in SQLite; a plaintext migration runs once on first load of older databases

## Model Supply Chain (模型供应链)

<!-- [20261006_Docs_423_T10] Ticket #423 (spec #412 decision 15): the ASR
     engine switched from fp32 torch to funasr-onnx (ONNX int8). Models are
     self-exported from official iic Apache-2.0 checkpoints and distributed
     through Murmur-owned mirrors. This section is the public record of that
     trust chain; the decisions live in docs/adr/016, 017 and 018, and the
     integrity claims here are pinned by tests/unit/onnx-docs-sync.test.ts. -->

Since the ONNX engine migration (spec #412), Murmur's speech recognition runs
a quantized ONNX int8 stack. The model weights are **not** fetched from
third-party model hubs at runtime. This section documents where they come
from and exactly what our integrity guarantees cover — and do not.

### Source of the weights

- All four models (SeACo-Paraformer ASR, fsmn-vad VAD, CT-Transformer punc,
  CAM++ speaker embedding) are **exported by us** from the official
  ModelScope `iic/` Apache-2.0 checkpoints (FunASR / Alibaba DAMO Speech Lab)
  via the FunASR export pipeline, then quantized to ONNX int8. The export
  tooling lives in `scripts/onnx-export/`.
- The upstream identity of every model is pinned individually: repo id +
  revision + a 40-hex `checkpoint_commit`, recorded in
  `scripts/onnx-export/model-pin.json`.
- Community re-uploads (e.g. `marxyz/*`) are used as cross-validation
  samples only and are **never** download sources.

### Pin policy and hash guarantees

- Every file the funasr-onnx runtime reads — config, tokens, seg_dict,
  normalization stats, and both ONNX graphs, not just the weights — is
  recorded in `scripts/onnx-export/model-pin.json` with its full sha256 and
  byte size. The pin's integrity claims are enforced in-repo by
  `scripts/onnx-export/verify_artifacts.py` and
  `tests/unit/onnx-model-pin.test.ts`.
- The app verifies the **whole manifest** after download and refuses to
  serve a model set with any missing, tampered, or unexpected file. A failed
  check surfaces an explicit "model corrupted, please re-download" error and
  never silently re-fetches from the network (`src/helpers/modelDownloader.ts`).
- `config.yaml` is parsed with a safe loader and a key-set assertion before
  it reaches the runtime (upstream FunASR uses an unsafe YAML loader).

**What this guarantees:** the bytes on your disk are byte-identical to the
artifacts we exported, verified, and recorded in this repository's git
history.

**What this does NOT guarantee:** this is not a vendor signature chain.
ModelScope does not provide signed releases, so the trust anchor for the
export step is the pinned `checkpoint_commit` plus the reproducibility of
our export (re-running the pinned export pipeline reproduces the pinned
artifacts byte-for-byte), **not** a cryptographic signature from the
upstream vendor.

### Mirrors and download sources

Downloads try the sources below in order, with automatic failover and no
geo-detection. All sources serve byte-identical artifacts verified against
the same sha256 manifest:

1. **ModelScope** (`modelscope.cn`, mirror repo
   `murmur-asr/murmur-models-onnx-int8`) — primary, fast within mainland
   China.
2. **GitHub Release mirror** (this repository, release
   `models-onnx-int8-1`) — the source of record for the exported artifacts.
3. **Optional self-hosted OSS bucket** — operators can set
   `MURMUR_OSS_MIRROR_URL` to add a third source, tried after both defaults.

### Signing posture (honest statement)

Model artifacts are **not signed**: no GPG, no Sigstore/cosign. No signing of
model files or release assets happens today. Integrity rests entirely on
the sha256 manifest pinned in this repository plus HTTPS transport. If a
stronger anchor is ever needed, signing the GitHub Release assets is the
natural next step; until then, absence of signatures is a fact, not an
omission.

### License and attribution (Apache-2.0)

The upstream checkpoints are licensed Apache-2.0. Our mirror distribution
fulfills the Apache-2.0 §4 attribution obligations by shipping the upstream
license text (`LICENSE.upstream` asset alongside the model files in the
release) and the attribution statement recorded in the `license` and
`attribution` fields of `scripts/onnx-export/model-pin.json`.

### Provenance

- Spec: #412 (ASR inference stack migration). Decisions: ADR
  `docs/adr/016-onnx-int8-engine-switch.md` (engine switch),
  `docs/adr/017-self-export-model-trust-chain.md` (trust chain),
  `docs/adr/018-sherpa-onnx-native-exit.md` (native-runtime long-term exit).
- Evidence: `docs/research/2026-09-26-seaco-onnx-feasibility-spike.md`
  (feasibility), `docs/research/2026-10-01-onnx-ab-verdict.md` (quality
  gates), `docs/research/2026-10-06-fp32-hotword-diagnosis.md` (fp32-vs-int8
  diagnosis; known English-hotword limitation is a runtime tokenization gap,
  not quantization).
