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
- 2026-10-06 review round (ticket #421): the first measurement round showed
  ~2.8–3.9 GB long-audio peaks. Root-caused to two whole-file pipeline
  transients — the DSP high-pass ran ONE global float64 rfft over the full
  signal (~1 GB), and the VAD adapter fed the WHOLE file to funasr_onnx in
  one shot (~1 GB) — both now bounded (block overlap-add FIR HPF in
  `audio_preprocessing.py`; per-60s-window VAD passes with explicit offsets
  in `OnnxVadAdapter`, regions re-merge identically downstream). Post-fix
  macOS arm64 (10 logical cores, embedded python 3.11, production protocol
  path, 4–5 runs each): long-audio peak **1658–1682 MB** (gate 1700 — thin
  margin), RTF 0.010–0.016; dual-task concurrency **1455–1473 MB**, no
  deadlock; cold-start p95 ≈ 2 s. Occasional ~+300–500 MB allocator-layout
  excursions are observed on some runs (also load-order dependent in
  hand-rolled harnesses — the production `initialize()` path measures
  stable). Residual structural fact for the envelope decision: the three
  pinned ONNX models co-resident idle at ~1.3 GB (protocol path), the punc
  session alone holding ~880–920 MB for a 283 MB int8 file — verified
  ORT-version-independent (1.24.1 / 1.27.0 / 1.30.0) and immune to every
  ORT session-config lever; `enable_cpu_mem_arena` is already disabled by
  funasr-onnx itself. If a platform exceeds the gate, the remaining
  in-engine option is a punc/ASR phase-swap lifecycle (latency +
  check_status semantics cost — needs its own spec decision), otherwise the
  envelope number needs revisiting with this evidence.
