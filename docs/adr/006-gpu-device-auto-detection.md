# ADR 006: Auto-detect GPU device for FunASR inference

**Status**: Accepted
**Date**: 2026-05-23

## Context

`funasr_server.py` hardcoded `device="cpu"` in all 3 model loads (ASR, VAD, punctuation). This prevents GPU acceleration on machines with CUDA or Apple Metal support, creating an artificial performance ceiling.

## Decision

Auto-detect the best available device at startup using PyTorch detection:

1. `torch.cuda.is_available()` → `"cuda"` (NVIDIA GPUs)
2. `torch.backends.mps.is_available()` → `"mps"` (Apple Silicon)
3. Fallback → `"cpu"`

Override via `MURMUR_DEVICE` environment variable for manual control.

## Consequences

- Users with NVIDIA GPUs or Apple Silicon get faster inference automatically
- Zero config needed — detection is automatic
- `MURMUR_DEVICE` env var allows forcing a specific device for debugging
- No behavior change for CPU-only machines
