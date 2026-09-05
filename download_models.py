#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
FunASR模型下载脚本
并行下载所有模型文件

[20260905_Fix_212_DownloadProgress] Rewritten around modelscope's
snapshot_download:
  - REAL incremental progress: the old script called AutoModel(), which
    blocks for the entire multi-GB download emitting nothing until 100% —
    the UI sat at 0% for many minutes and users (issue #212) read it as a
    hang. snapshot_download accepts per-file ProgressCallback hooks, so we
    stream byte-level updates throttled to whole percent steps.
  - The resolved canonical cache root is included in the final JSON
    (`cache_root`) so the host learns where the models actually landed.
  - AutoModel() was ALSO wasteful: it instantiates the full model in RAM
    just to fetch files. snapshot_download fetches exactly the files the
    server's AutoModel will later consume (same cache, same layout).
"""

import sys
import json
import threading
import time

# 进度输出最小间隔（秒）：避免海量回调行淹没 stdout 协议通道
PROGRESS_EMIT_INTERVAL = 1.0
# 单文件进度回调期间的锁：多个文件线程并发更新同一 model 的计数
_LOCK = threading.Lock()


class ProtocolProgressCallback:
    """modelscope ProgressCallback 适配：聚合字节数，按整数百分比节流输出

    modelscope 为每个文件实例化一个回调对象（构造参数 filename/file_size，
    方法 update(size) / end()）。同一模型的多个文件共享本模型槽位的计数器。
    """

    def __init__(self, filename, file_size, state, model_type):
        self._state = state
        self._model_type = model_type
        self._file_size = file_size if file_size and file_size > 0 else 0

    def update(self, size: int):
        with _LOCK:
            self._state["downloaded"] += size
            self._maybe_emit(force=False)

    def end(self):
        with _LOCK:
            self._maybe_emit(force=True)

    def _maybe_emit(self, force: bool):
        state = self._state
        total = state["total_bytes"]
        downloaded = state["downloaded"]
        if total > 0:
            percent = min(99.0, round(downloaded * 100.0 / total, 1))
        else:
            # total unknown (server did not send content-length): show an
            # indeterminate but non-zero value so the UI does not look hung.
            percent = 1.0 if downloaded > 0 else 0.0
        now = time.monotonic()
        if not force and (
            percent - state["last_percent"] < 1.0
            and now - state["last_emit"] < PROGRESS_EMIT_INTERVAL
        ):
            return
        state["last_percent"] = percent
        state["last_emit"] = now
        emit_progress(self._model_type, "downloading", percent)


def emit_progress(model_type, stage, percent, error=None):
    """输出一行进度 JSON（协议通道：每行一个 JSON 对象）"""
    overall = round(
        sum(m["percent"] for m in MODEL_STATES.values()) / len(MODEL_STATES), 1
    )
    status = {
        "stage": stage,
        "model": model_type,
        "progress": percent,
        "overall_progress": overall,
        "completed": sum(1 for m in MODEL_STATES.values() if m["done"]),
        "total": len(MODEL_STATES),
    }
    if error:
        status["error"] = error
    print(json.dumps(status, ensure_ascii=False))
    sys.stdout.flush()


# 每个模型的进度槽位（main() 中初始化）
MODEL_STATES = {}


def download_model(model_config):
    """下载单个模型（snapshot_download：仅取文件，不构建模型）"""
    model_name = model_config["name"]
    model_type = model_config["type"]

    try:
        from modelscope.hub.snapshot_download import snapshot_download
        from modelscope.hub.callback import ProgressCallback

        state = MODEL_STATES[model_type]
        emit_progress(model_type, "downloading", 0)

        class Callback(ProgressCallback):
            def __init__(self, filename, file_size):
                super().__init__(filename, file_size)
                self._inner = ProtocolProgressCallback(
                    filename, file_size, state, model_type
                )

            def update(self, size):
                self._inner.update(size)

            def end(self):
                self._inner.end()

        snapshot_download(
            model_name,
            revision="v2.0.4",
            progress_callbacks=[Callback],
        )

        state["percent"] = 100.0
        state["done"] = True
        emit_progress(model_type, "completed", 100)
        return {"success": True, "model": model_type}
    except Exception as e:
        MODEL_STATES[model_type]["done"] = True
        MODEL_STATES[model_type]["percent"] = 0.0
        emit_progress(model_type, "error", 0, str(e))
        return {"success": False, "model": model_type, "error": str(e)}


def resolved_cache_root():
    """modelscope 实际使用的模型缓存根（含新布局的 models 层）"""
    try:
        from modelscope.utils.file_utils import get_model_cache_root

        return get_model_cache_root()
    except Exception:
        return None


def main():
    """主函数：并行下载所有模型"""

    # 模型配置
    models = [
        # [20260820_T15_SeacoSwap] Hotword-capable SeACo variant (T13:
        # zero CER regression, timestamps intact). The old paraformer is
        # NOT downloaded fresh — it remains on disk as the rollback for
        # upgrading users.
        {
            "name": "damo/speech_seaco_paraformer_large_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
            "type": "asr"
        },
        {
            "name": "damo/speech_fsmn_vad_zh-cn-16k-common-pytorch",
            "type": "vad"
        },
        {
            "name": "damo/punc_ct-transformer_zh-cn-common-vocab272727-pytorch",
            "type": "punc"
        }
    ]

    # 进度槽位初始化
    for model_config in models:
        MODEL_STATES[model_config["type"]] = {
            "percent": 0.0,
            "done": False,
            "downloaded": 0,
            "total_bytes": 0,
            "last_percent": -1.0,
            "last_emit": 0.0,
        }

    # 启动并行下载线程
    threads = []
    results = {}
    for model_config in models:
        thread = threading.Thread(
            target=lambda config=model_config: results.update({
                config["type"]: download_model(config)
            })
        )
        thread.start()
        threads.append(thread)

    # 等待所有线程完成
    for thread in threads:
        thread.join()

    # 检查结果
    failed_models = [model_type for model_type, result in results.items() if not result["success"]]

    if failed_models:
        final_result = {
            "success": False,
            "error": f"以下模型下载失败: {', '.join(failed_models)}",
            "failed_models": failed_models,
            "results": results
        }
    else:
        final_result = {
            "success": True,
            "message": "所有模型下载完成",
            "cache_root": resolved_cache_root(),
            "results": results
        }

    print(json.dumps(final_result, ensure_ascii=False))
    sys.stdout.flush()


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        error_result = {
            "success": False,
            "error": str(e)
        }
        print(json.dumps(error_result, ensure_ascii=False))
        sys.exit(1)
