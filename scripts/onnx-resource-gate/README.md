# ONNX resource gates (ticket #421, spec #412 T7)

Resource acceptance gates measured against the **production**
`funasr_server.py` over its stdin/stdout JSON protocol (the S1 seam) — the
release evidence chain's resource items:

| Gate                   | Threshold                                                                                                           | Measured by                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Long audio (≥10 min)   | peak RSS ≤ 1700 MB, ASR-phase RTF ≤ 0.1                                                                             | `measure_long_audio`                              |
| Mic + file concurrency | no deadlock (both results in deadline, ping answered), RSS bounded                                                  | `measure_concurrency`                             |
| Cold start             | p95 of N fresh-process startups < TS startup-watchdog cap (600 s, parity-locked with `src/helpers/funasrServer.ts`) | `measure_cold_start`                              |
| Protocol schema        | field sets / timestamp structure locked                                                                             | `tests/python/test_protocol_schema_regression.py` |

## Two entry points, one implementation

1. **Python test entry** (default suite, CI green — resource arms self-skip
   without `MURMUR_RESOURCE_GATES=1` + models):

   ```sh
   # routine (CI-identical): gate logic + schema regression only
   pnpm run test:python:unit

   # evidence run on a machine with the ONNX asr+vad models:
   MURMUR_RESOURCE_GATES=1 \
   MURMUR_GATE_DAMO_ROOT="$HOME/Library/Application Support/Murmur/models" \
     pnpm run test:python:unit
   ```

2. **Evidence runner** (what the dispatch workflow
   `.github/workflows/onnx-resource-gate.yml` runs on CI runners):

   ```sh
   python scripts/onnx-resource-gate/resource_gate.py run \
       --damo-root <dir containing onnx-int8/> \
       --wav scripts/onnx-spike/fixtures/onnx-spike-40s.wav \
       --samples 5 \
       --out-json work/resource_gate_results.json \
       --out-md work/resource_gate_report.md
   ```

## Notes

- `resource_gate.py` is stdlib-only at import time; heavy deps load only
  inside the spawned server children. RSS sampling is stdlib (`ps` on
  posix, ctypes psapi on Windows).
- The gate constants (1700 MB / RTF 0.1 / 600 s / watchdog parity) are
  pinned by `tests/python/test_resource_gates.py` — do not loosen them
  without a spec decision; the numbers are release-evidence items.
- 2026-10-06 macOS arm64 first measurement (10 logical cores, embedded
  python 3.11): long-audio RTF 0.011–0.016 (PASS), cold-start p95 2.2 s
  warm-cache (PASS), **long-audio peak RSS ≈ 2.8–3.9 GB (FAIL vs 1700 MB)**
  and dual-task peak ≈ 1.73 GB (marginal FAIL). Attribution runs (punc
  removed, VAD disabled) point at the chunked-ASR loop's ORT arena
  ratcheting across chunks, not at a single phase — engine-scope follow-up
  needed before the RSS item can go green; see the ticket's evidence report.
