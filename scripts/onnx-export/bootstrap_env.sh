#!/usr/bin/env bash
# [20260930_T413_OnnxExportPipeline] Bootstrap the ONNX export pipeline
# venv (ticket #413). Python 3.11 — torch 2.0.1 (the pinned export
# toolchain generation) ships no 3.12+ wheels. Uses uv when available
# (falls back to python3 -m venv + pip). A China PyPI mirror is honored
# via PIP_INDEX_URL when the default route is slow — the pipeline was
# originally built behind one.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV="$HERE/.venv"

if [ -x "$VENV/bin/python" ]; then
  echo "[bootstrap] $VENV already exists, reusing (delete it to rebuild)"
else
  if command -v uv >/dev/null 2>&1; then
    uv venv --python 3.11 "$VENV"
  else
    python3.11 -m venv "$VENV"
  fi
fi

"$VENV/bin/python" -m ensurepip --upgrade >/dev/null 2>&1 || true

if command -v uv >/dev/null 2>&1; then
  uv pip install --python "$VENV/bin/python" -r "$HERE/requirements-export.txt" \
    ${PIP_INDEX_URL:+--index-url "$PIP_INDEX_URL"}
else
  "$VENV/bin/python" -m pip install -r "$HERE/requirements-export.txt"
fi

"$VENV/bin/python" - <<'EOF'
import funasr, torch, onnx, onnxruntime, funasr_onnx, modelscope
print("[bootstrap] ready:",
      "funasr", funasr.__version__, "| torch", torch.__version__,
      "| onnx", onnx.__version__, "| onnxruntime", onnxruntime.__version__)
EOF
