# ONNX Migration: Industry Benchmark (2026-09-26)

Question: is "fp32 PyTorch → ONNX int8, quantized models downloaded on first run from hub + own mirror" industry best practice for a local-ASR Electron app (FunASR Paraformer, embedded Python)?

## Verdict table

| #   | Question                                                    | Verdict                                                       |
| --- | ----------------------------------------------------------- | ------------------------------------------------------------- |
| 1   | funasr-onnx = FunASR team's recommended deployment runtime? | Matches industry practice                                     |
| 2   | int8 quantized default for local inference?                 | Matches industry practice                                     |
| 3   | Not bundled; first-run download from hub + mirror?          | Matches industry practice (checksums are our addition — keep) |
| 4   | Third-party/community quantization trust?                   | Documented risk — pin to official conversions + checksums     |
| 5   | Python subprocess vs native binding?                        | Deviates, acceptable; sherpa-onnx is the native off-ramp      |

## Evidence

**1. funasr-onnx is first-party.** PyPI `funasr-onnx` is maintained by the FunASR community (author: Alibaba DAMO Speech Lab); supports Paraformer offline/online, FSMN-VAD, CT-Transformer punctuation, with `quantize=True` loading `model_quant.onnx` (int8). FunASR also ships a C++ ONNX runtime-SDK under `runtime/` (repo docs: `benchmark_onnx_cpp.md`), and ModelScope's official paraformer-large ONNX card points to it. ONNX is FunASR's own deployment path.

**2. Quantized-by-default is the norm.** faster-whisper defaults to int8 on CPU (CTranslate2, ~4x less memory); whisper.cpp ships q5_0 as its standard model variant; Ollama's library defaults to Q4_K_M GGUF; LM Studio distributes quantized GGUF/MLX with hardware-fit hints. Staying on fp32 PyTorch is the industry outlier, not the migration.

**3. Download-on-first-run is dominant.** superwhisper: ~600MB model download on first launch, then fully offline; MacWhisper and Aiko download models in-app; Ollama auto-pulls on first `run` from its registry; LM Studio is built around in-app discovery + download. No major product bundles large models in the installer. Mirrors are standard in China (`HF_ENDPOINT=https://hf-mirror.com`, works with `hf_transfer`). Per-file SHA-256 verification at download time is stricter than most peers — recommended, not just acceptable.

**4. Counter-pattern: community quantizations are a documented attack surface.** JFrog (2024) found malicious HF models evading scanners; ReversingLabs "nullifAI" bypassed picklescan via broken pickles; HiddenLayer hijacked HF's own safetensors conversion bot ("Silent Sabotage"); community GGUF uploads rank low-medium trust; Ollama's GGUF loader had a memory-disclosure CVE (2026-7482). Consequence: distribute only official ModelScope `iic/*-onnx` conversions (or self-quantize from verified fp32), verify checksums client-side, never point users at arbitrary community quantizations.

**5. Python subprocess: peers are native-first.** whisper-ecosystem apps embed whisper.cpp natively (MacWhisper, superwhisper, Aiko); LM Studio ships llama.cpp native; Ollama is native. FunASR's own non-Python option is a C++ WebSocket _server_ SDK (docker-oriented, not a linkable lib). However k2-fsa's sherpa-onnx ships native Node addons (N-API) supporting Paraformer — so a proven native path exists without touching onnxruntime bindings ourselves. Keep Python subprocess now; record sherpa-onnx as the exit strategy if subprocess costs grow.

## Net verdict

All three pillars (runtime, quantization, distribution) match industry practice. Two hardening requirements from evidence: (a) trust boundary = official `iic/` conversions + self-computed checksums, never community quantizations; (b) record sherpa-onnx as the native alternative.

## Sources

- https://pypi.org/project/funasr-onnx/ — first-party ONNX runtime, quantize flag
- https://github.com/modelscope/FunASR (runtime/ docs incl. benchmark_onnx_cpp.md)
- https://modelscope.cn/models/iic/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-onnx
- https://github.com/SYSTRAN/faster-whisper — int8 CPU default
- https://github.com/ggml-org/whisper.cpp — q5_0 variants
- https://docs.ollama.com/cli — pull/auto-pull; Q4_K_M library default
- https://superwhisper.com ; MacWhisper/Aiko in-app model downloads
- https://hf-mirror.com — HF_ENDPOINT mirror + hf_transfer
- https://www.jfrog.com (malicious HF models, 2024); ReversingLabs nullifAI; HiddenLayer Silent Sabotage; CVE-2026-7482 (Ollama GGUF loader)
- https://github.com/k2-fsa/sherpa-onnx — native Node bindings w/ Paraformer
