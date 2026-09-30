# sherpa-onnx SeACo-Paraformer Hotword Spike (2026-09-26)

Question: does k2-fsa sherpa-onnx support SeACo-Paraformer HOTWORDS (contextual biasing)? Gates a hypothetical future Tauri/Rust rewrite of Murmur. Context: `docs/research/2026-09-26-onnx-migration-industry-benchmark.md` (flagged sherpa-onnx as the native off-ramp, no hotword analysis). No implementation commitment — reconnaissance only.

## Verdict table

| #   | Question                                           | Verdict                                                                         |
| --- | -------------------------------------------------- | ------------------------------------------------------------------------------- |
| 1   | sherpa-onnx Paraformer path accepts hotwords?      | **No** — API surface absent, docs + maintainer x2 + source + runnable all agree |
| 2   | Consumes FunASR/SeACo ONNX artifacts directly?     | **No** — different export shape; only plain-paraformer conversions exist        |
| 3   | Rust / Node bindings viable and maintained?        | **Yes, both first-party now** — but hotword params are transducer-only          |
| 4   | Tauri/Electron + sherpa-onnx Paraformer precedent? | **Yes** — SpeakSlow (Electron), Sona/kotone (Tauri); none ship hotwords         |
| 5   | Rust-native ASR with SeACo hotword parity?         | **NOT-VIABLE** (see verdict paragraph)                                          |

## Findings

### 1. Hotword support: none for Paraformer — confirmed at four independent layers

The official hotwords doc is categorical: _"Only transducer models support hotwords in sherpa-onnx."_ / _"only models from Offline transducer models and Online transducer models support hotwords."_ / _"All other models don't support hotwords."_ Requires `modified_beam_search` decoding. (https://k2-fsa.github.io/sherpa/onnx/hotwords/index.html)

Four-layer confirmation:

1. **Docs** (above).
2. **HEAD source**: `sherpa-onnx/csrc/offline-recognizer-paraformer-impl.h` — constructor accepts ONLY `greedy_search`, calls `SHERPA_ONNX_EXIT(-1)` for anything else; `DecodeStreams` has zero hotword/context plumbing. `sherpa-onnx/csrc/offline-paraformer-model.cc` — `Forward(features, features_length)` only; no context-list input. `offline-paraformer-model-config.h` — only `model` (+qnn/ascend paths), no contextual fields.
3. **Maintainer statements** (csukuangfj): issue #1274 (2024-08, "paraformer如何启用热词") → **"无法支持."**; issue #2982 (2026-01, FunASR-nano hotwords) → **"截止目前…这几个模型，都不支持热词"** and **"目前没计划，不支持。"** No roadmap commitment as of 2026-01.
4. **Runnable check (this spike)**: `sherpa-onnx` 1.13.8 Python wheel — `OfflineRecognizer.from_paraformer(hotwords_file=..., hotwords_score=...)` → `TypeError: unexpected keyword argument 'hotwords_file'`. The parameter does not exist on the paraformer constructor. Plain transcription DOES work: `sherpa-onnx-paraformer-zh-small-2024-03-09` int8 on Apple Silicon (Python 3.14, single thread) → `TEXT: yesterday was 星期一 today is tuesday 明天是星期三`.

Also checked: streaming paraformer (`online-stream.cc` context*graph* is transducer-only); funasr-nano (maintainer: no hotwords, no plans); a 2026-05 community issue (#3572) claims hotwords_file "works with offline Paraformer" — contradicted by layers 1–4, treat as noise.

### 2. Model format: different shape; SeACo artifact not consumable

sherpa-onnx paraformer layout (verified by extracting `sherpa-onnx-paraformer-zh-small-2024-03-09`): `model.int8.onnx` with **ONNX metadata** (`vocab_size`, `lfr_window_size`, `lfr_window_shift`, `neg_mean`, `inv_stddev`) + `tokens.txt` (id␠token). All published paraformer conversions to sherpa-onnx format are **plain** paraformer (zh-small / 2023-03-28 ← `damo/...vocab8404-pytorch` plain paraformer-large; 2024-03-09 ← `iic/...vocab8358-tensorflow1`); **no SeACo/contextual conversion exists upstream**. Murmur today runs the ModelScope PyTorch checkpoint `damo/speech_seaco_paraformer_large_asr_nat-zh-cn-16k-common-vocab8404-pytorch` (see `src/helpers/modelManager.ts:108`) through embedded-Python FunASR — a different export shape (configuration.json + FunASR export pipeline), not the sherpa metadata+tokens.txt layout. Even if re-exported, sherpa-onnx's decoder has no context-module path, so the SeACo context decoder would be dead weight.

### 3. Bindings: healthy, but hotwords stay transducer-only at every layer

| Binding                                          | Status                                                                                     | Version             | Hotword params exposed?                                                                                                  |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Node N-API `sherpa-onnx-node` (official, k2-fsa) | Active — 5 releases in 3 months                                                            | 1.13.8 (2026-09-10) | On recognizer config, transducer-only in effect                                                                          |
| Rust `sherpa-onnx` (official, k2-fsa)            | Active, lockstep w/ core, 452k downloads                                                   | 1.13.8 (2026-09-11) | `OfflineRecognizerConfig.hotwords_file/score` exists; transducer-only in effect; paraformer config has no hotword fields |
| Rust `sherpa-rs` (community, thewh1teagle)       | **Deprecated** (README "This crate is deprecated"; last commit 2026-03-08 adds the notice) | 0.6.8 (2025-10-05)  | `ParaformerConfig` = model+tokens only                                                                                   |

### 4. Precedent

- **SpeakSlow** (Jeffrey0117/SpeakSlow, 196★, updated 2026-09-26): Electron + **sherpa-onnx offline Paraformer int8**, Chinese local voice input, "講完約 0.3 秒貼上" — closest precedent to Murmur's use case, no hotwords.
- **Sona** (AirSodaz/sona): Tauri + React + sherpa-onnx, lists **Paraformer** among supported models (Qwen3-ASR, FireRedASR2, SenseVoice, Whisper, Paraformer).
- **kotone** (l1veIn/kotone): Tauri 2 + Rust + sherpa-onnx, streaming Zipformer2 transducer (X-ASR) — a transducer-based Tauri precedent (transducer DOES get hotwords).

### 5. VERDICT

**NOT-VIABLE for feature parity**: sherpa-onnx cannot reproduce Murmur's SeACo hotword biasing — the paraformer path is greedy-only with no context inputs, the parameter is absent from every binding's paraformer constructor, the official docs exclude non-transducer models, and the lead maintainer declined it twice (2024 "无法支持", 2026 "目前没计划"). Rust-native ASR _without_ hotwords is proven viable (healthy first-party Rust/Node bindings + shipping precedents like SpeakSlow/Sona/kotone), so a Tauri rewrite is not blocked by the runtime — it is blocked by the hotword feature, which Murmur gained in T15 specifically via the SeACo swap with zero CER regression. If a rewrite proceeds anyway, hotword parity requires one of: (a) substitute post-hoc correction (sherpa-onnx `rule_fsts`/HomophoneReplacer, or app-side fuzzy text correction — different mechanism: text-level, not acoustic model biasing), (b) switch to a Chinese zipformer transducer model (native hotwords via `modified_beam_search`, but a different engine/model family — needs CER re-benchmark; prior Murmur benchmarking found Paraformer family the Apple Silicon CPU optimum), or (c) custom work replicating FunASR's SeACo contextual decoding on top of FunASR's contextual ONNX export — significant, maintainer-declined upstream, effectively Murmur-owned forever after. Alternatively: keep the current embedded-Python FunASR subprocess, which remains the only zero-regression hotword path.

## Spike method / evidence class

**Runnable + primary sources.** Runnable: sherpa-onnx 1.13.8 wheel in a throwaway venv; extracted `sherpa-onnx-paraformer-zh-small-2024-03-09` (78MB int8, the smallest official paraformer); ran real transcription (correct output) and the hotword param rejection (TypeError). Not runnable-cheap: a hotword-effect A/B on full SeACo — impossible by API design, which is the finding itself. (Note: `/tmp/murmur-test.wav` did not exist on this machine; used the model's bundled test wav instead.) Did not modify repo except this file. /tmp artifacts (venv, model tarball, probe clones) were discarded after the spike.

## Sources

- Hotwords doc (transducer-only): https://k2-fsa.github.io/sherpa/onnx/hotwords/index.html
- Paraformer docs (model origins, no hotword mention): https://k2-fsa.github.io/sherpa/onnx/pretrained_models/offline-paraformer/paraformer-models.html
- HEAD source: `sherpa-onnx/csrc/offline-recognizer-paraformer-impl.h` (greedy-only + EXIT), `offline-paraformer-model.cc` (no context inputs), `offline-paraformer-model-config.h`
- Maintainer: issue #1274 comment (2024-08-22, csukuangfj "无法支持") https://github.com/k2-fsa/sherpa-onnx/issues/1274; issue #2982 comments (2026-01, "目前没计划，不支持") https://github.com/k2-fsa/sherpa-onnx/issues/2982
- Community claim (contradicted): #3572 https://github.com/k2-fsa/sherpa-onnx/issues/3572
- npm: https://registry.npmjs.org/sherpa-onnx-node (1.13.8, 2026-09-10)
- Official Rust crate: https://crates.io/crates/sherpa-onnx (1.13.8, 2026-09-11), OfflineRecognizerConfig fields: https://docs.rs/sherpa-onnx/latest/sherpa_onnx/struct.OfflineRecognizerConfig.html
- sherpa-rs deprecation: https://github.com/thewh1teagle/sherpa-rs (README, commit 857bedd 2026-03-08)
- Precedent: https://github.com/Jeffrey0117/SpeakSlow ; https://github.com/AirSodaz/sona ; https://github.com/l1veIn/kotone
- Murmur side: `src/helpers/modelManager.ts` (SeACo PyTorch checkpoint), `docs/research/2026-09-26-onnx-migration-industry-benchmark.md`
