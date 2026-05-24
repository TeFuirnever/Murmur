# ADR 011: Quick Experience Mode — Optional Punc Model & Per-Model Download Progress

## Status
Accepted

## Context
First-time users must download ~1.1GB of models (ASR 840MB + VAD 1.6MB + Punc 278MB) before they can transcribe. The download progress UI showed only an overall percentage, giving users no visibility into which model was downloading or how far along each one was.

Additionally, the FunASR server required all 3 models to be present and loaded before it would start. The punc (punctuation recovery) model is non-essential — transcription works without it, just without automatic punctuation.

## Decision
1. **Make punc model optional** — FunASR server now initializes with ASR + VAD only. Punc loads in parallel and is used when available.
2. **Per-model download progress** — Frontend shows individual progress bars for ASR, VAD, and Punc models.
3. **`minimum_ready` concept** — modelManager reports both `models_downloaded` (all) and `minimum_ready` (ASR + VAD). Server start decisions use `minimum_ready`.
4. **Model configs have `required` flag** — ASR and VAD are `required: true`, Punc is `required: false`.

## Consequences
- Users can start transcribing once ASR + VAD are loaded (punc downloads in parallel)
- Download progress is transparent — users see exactly which model is downloading
- Punc model failure no longer blocks server initialization
- `checkModelFiles()` result gains `minimum_ready` field (backward compatible)
