# Windows x64 ONNX spike (ticket #415, spec #412 T2)

> Release-evidence-chain gate: proves the four SELF-EXPORTED ONNX int8 models
> (T1, `scripts/onnx-export/`) load and transcribe on **win x64 onnxruntime**,
> and records the three evidence numbers the pre-tag chain requires —
> install size, inference RSS, cold-start time (multi-sample). Spec #412
> decision 13: this spike plus the real-corpus A/B must both be green before
> any dual-platform release.

## What runs

| phase        | what it measures                                                                                                                                |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| verify       | the model dir is re-checked against `model-pin.json` (per-file sha256, strict set) BEFORE any inference — the spike only ever runs pinned bytes |
| install size | recursive size of the running interpreter's site-packages (the funasr-onnx stack, **no torch**), with a per-package breakdown                   |
| cold start   | N fresh subprocesses (`--samples`, default 5): spawn → import → load the FOUR models → first 40s-wav transcript; min/median/max reported        |
| measure      | one fresh subprocess: per-model load timings + RSS snapshots, 40s wav through ASR (plain + hotword), VAD, Punc, CAMPPlus graph run, RTF ×3      |
| acceptance   | ticket gate: transcribed text non-empty (+ pinned sanity: ≥30 chars, similarity ≥0.60, ≥1 VAD segment, speaker graph executed)                  |

The 40s input is the committed `fixtures/onnx-spike-40s.wav` — the T1 smoke
wav (macOS Tingting render of the reference text, 16k mono s16, 40.83s), so
every platform measures byte-identical input and numbers are comparable
(mac baseline: similarity 0.9213, see
`scripts/onnx-export/work/smoke_results.json` when regenerated).

## Run it

```bash
# 1. pinned runtime env (python 3.11; versions mirror the T1 export pin)
python -m venv .venv && .venv/bin/python -m pip install -r requirements-runtime.txt

# 2. fetch + verify the self-exported model bytes from OUR release mirror
.venv/bin/python ../onnx-export/verify_artifacts.py --from-release \
    --download-dir work/models

# 3. run the spike
.venv/bin/python win_spike.py run \
    --models-dir work/models --samples 5 \
    --out-json work/win_spike_results.json --out-md work/win_spike_report.md
```

Exit code 0 = PASS (all acceptance gates green); the JSON carries every
sample, the pip freeze of the measured env, and the pin release tag. `work/`
and `.venv/` are gitignored — CI uploads its copies as workflow artifacts,
and the archived evidence lands in
`docs/research/2026-10-01-onnx-win-x64-spike.md`.

## CI

`.github/workflows/onnx-win-spike.yml` — `workflow_dispatch` (repeatable,
`samples` input) + paths-filtered push on `agent/onnx-415`; runs on
`windows-latest`. It is an evidence gate, not a PR gate (same policy as
`asr-ab.yml`: ~700MB of model bytes is far too heavy for per-PR CI).

## Tests

- `tests/python/test_onnx_win_spike.py` — stdlib-only unit tests for the
  pure core (acceptance gate, cold-start stats, install-size helpers,
  pin-verification wrapper, markdown renderer, fixture contract).
- `tests/unit/onnx-win-spike.test.ts` — fresh-clone gate: workflow shape,
  trust-chain wiring, fixture format, pinned requirements, and the archived
  docs/research report.
