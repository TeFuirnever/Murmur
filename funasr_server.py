#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
FunASR模型服务器
保持模型在内存中，通过stdin/stdout进行通信
"""

import sys
import json
import os
import logging
import traceback
import signal
import contextlib
import io
import argparse
import unicodedata
import glob
import threading
import queue
from pathlib import Path

# 设置日志
import tempfile


# 获取日志文件路径
def get_log_path():
    # 尝试从环境变量获取用户数据目录
    if "ELECTRON_USER_DATA" in os.environ:
        log_dir = os.path.join(os.environ["ELECTRON_USER_DATA"], "logs")
    else:
        # 回退到临时目录
        log_dir = os.path.join(tempfile.gettempdir(), "murmur_logs")

    # 确保日志目录存在
    os.makedirs(log_dir, exist_ok=True)
    return os.path.join(log_dir, "funasr_server.log")


log_file_path = get_log_path()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    handlers=[
        logging.FileHandler(log_file_path, encoding="utf-8"),
        logging.StreamHandler(),  # 同时输出到控制台
    ],
)
logger = logging.getLogger(__name__)

# 记录日志文件位置
logger.info(f"FunASR服务器日志文件: {log_file_path}")


@contextlib.contextmanager
def suppress_stdout():
    """上下文管理器：临时重定向stdout到devnull，避免FunASR库的非JSON输出干扰IPC通信"""
    old_stdout = sys.stdout
    devnull = open(os.devnull, "w")
    try:
        sys.stdout = devnull
        yield
    finally:
        sys.stdout = old_stdout
        devnull.close()


# [20260819_T8_ThreadAdapt] Ticket #187 (spec #177 T8): inference thread
# auto-adaptation. Formula over LOGICAL cores leaves UI headroom on small
# machines and caps fan/heat on big ones; the old code hard-coded
# OMP_NUM_THREADS=4 (no headroom on 4-core, over-subscription on 2-core).
THREAD_UI_HEADROOM = 2
THREAD_CAP = 8

# [20260820_T14_Hotwords] Ticket #183: Python-side defense-in-depth cap
# for the hotword option (TS boundary validation is the primary gate; this
# catches corrupted-DB / renderer-bug payloads that reach the protocol).
HOTWORD_MAX_CHARS = 4096


def sanitize_hotword(value):
    """Coerce a protocol hotword to a safe string ('' on non-string).

    [T14 review MINOR] Logs degradation/truncation (defense must be
    observable) and strips Cc control characters so caller-supplied
    garbage cannot reach generate() unfiltered.
    """
    if not isinstance(value, str):
        if value:
            logger.warning(f"热词类型非法({type(value).__name__})，降级为空串")
        return ""
    cleaned = "".join(
        ch for ch in value if unicodedata.category(ch) != "Cc"
    )[:HOTWORD_MAX_CHARS]
    if len(cleaned) != len(value):
        logger.warning("热词含控制字符或超长，已清洗/截断")
    return cleaned


def compute_inference_threads(cores, override=None):
    """min(max(1, cores - THREAD_UI_HEADROOM), THREAD_CAP) over logical cores.

    override comes from MURMUR_NUM_THREADS (mirrors the MURMUR_DEVICE
    pattern from ADR-006): must parse as an INTEGER, clamped to
    [1, cores]; anything else (non-integer like "2.5", < 1, None) falls
    back to the computed value.
    """
    auto = min(max(1, cores - THREAD_UI_HEADROOM), THREAD_CAP)
    if override is None:
        return auto
    try:
        requested = int(str(override).strip())
    except (TypeError, ValueError):
        return auto
    if requested < 1:
        return auto
    return max(1, min(requested, cores))


class FunASRServer:
    def __init__(self, damo_root=None):
        self.asr_model = None
        self.vad_model = None
        self.punc_model = None
        self.cam_model = None
        self.initialized = False
        self.running = True
        self.transcription_count = 0
        self.total_audio_duration = 0.0

        self.request_queue = queue.Queue()
        self.response_queue = queue.Queue()
        self.cancel_event = threading.Event()
        self._inference_thread = None
        self._output_thread = None

        # 外部传入的 damo 根目录（例如 /Volumes/APFS/AI/models/damo）
        self.damo_root = damo_root or os.environ.get("DAMO_ROOT")

        # [20260819_T8_ThreadAdapt] Thread env FIRST: _detect_device imports
        # torch when MURMUR_DEVICE is unset, and OMP/MKL env vars only take
        # effect if written BEFORE torch's first import. The old order set
        # them after detection, which silently voided them.
        self.inference_threads = 1
        self._setup_runtime_environment()

        self.device = os.environ.get("MURMUR_DEVICE") or self._detect_device()
        logger.info(f"推理设备: {self.device}")

        signal.signal(signal.SIGTERM, self._signal_handler)
        signal.signal(signal.SIGINT, self._signal_handler)

    def _setup_runtime_environment(self):
        """设置推理线程环境变量（必须在 torch 首次导入之前调用）

        [20260819_T8_ThreadAdapt] Replaces the OMP_NUM_THREADS="4" hardcode
        with the computed value. OMP covers gcc/openmp builds, MKL covers
        Windows torch's MKL backend; macOS Accelerate ignores both env vars,
        which is why torch.set_num_threads (applied at model load) is the
        authoritative convergence point on every platform. Under a CUDA
        device the limit still constrains CPU-side preprocessing (DSP /
        feature extraction) — GPU kernels are unaffected.
        """
        try:
            cores = os.cpu_count() or 1
            override = os.environ.get("MURMUR_NUM_THREADS")
            self.inference_threads = compute_inference_threads(cores, override)
            os.environ["OMP_NUM_THREADS"] = str(self.inference_threads)
            os.environ["MKL_NUM_THREADS"] = str(self.inference_threads)
            source = "MURMUR_NUM_THREADS" if override else "auto"
            logger.info(
                f"推理线程数: {self.inference_threads} (逻辑核={cores}, 来源={source}, "
                f"公式=min(max(1,核-{THREAD_UI_HEADROOM}),{THREAD_CAP}), 覆盖钳制[1,核])"
            )
        except Exception as e:
            logger.warning(f"线程环境设置失败: {str(e)}")

    # [20260819_T8_ThreadAdapt] Authoritative torch-side limit; applied at
    # model load (after torch import) — see _setup_runtime_environment.
    def _apply_torch_thread_limit(self):
        try:
            import torch

            torch.set_num_threads(self.inference_threads)
            logger.info(f"torch.set_num_threads({self.inference_threads})")
        except ImportError:
            logger.warning("torch 不可用，跳过 torch 线程上限设置")

    @staticmethod
    def _detect_device():
        """Auto-detect best available compute device: CUDA > CPU

        MPS (Apple GPU) is intentionally skipped because FunASR uses float64
        in cif_predictor.py and complex_utils.py, which MPS does not support.
        M-series CPU performance is sufficient for Paraformer-large inference.
        """
        try:
            import torch
            if torch.cuda.is_available():
                return "cuda"
            # MPS skipped: FunASR uses torch.float64 in CIF predictor and
            # complex_utils, which triggers:
            #   TypeError: Cannot convert a MPS Tensor to float64 dtype
            # as the MPS framework doesn't support float64
        except ImportError:
            pass
        return "cpu"

    ALLOWED_EXTENSIONS = {'.wav', '.mp3', '.m4a', '.flac', '.ogg', '.wma', '.aac'}

    def _validate_audio_path(self, audio_path):
        """验证音频文件路径安全性"""
        if not audio_path or not isinstance(audio_path, str):
            return False, "无效的音频路径"

        # 解析符号链接
        real_path = os.path.realpath(audio_path)

        # 检查扩展名
        ext = os.path.splitext(real_path)[1].lower()
        if ext not in self.ALLOWED_EXTENSIONS:
            return False, f"不支持的音频格式: {ext}"

        # 检查文件存在且可读
        if not os.path.isfile(real_path):
            return False, f"文件不存在: {audio_path}"

        if not os.access(real_path, os.R_OK):
            return False, f"文件不可读: {audio_path}"

        return True, real_path

    def _merge_segments(self, raw_segments):
        """基于标点合并短segments为完整句子"""
        if not raw_segments:
            return []

        merged = []
        current = None

        for seg in raw_segments:
            if current is None:
                current = {"start_ms": seg["start_ms"], "end_ms": seg["end_ms"], "text": seg["text"]}
            else:
                text = current["text"]
                # 如果当前文本以句末标点结尾，或者是长segment，开始新的
                if (text and text[-1] in '。！？；\n') or (current["end_ms"] - current["start_ms"]) >= 5000:
                    merged.append(current)
                    current = {"start_ms": seg["start_ms"], "end_ms": seg["end_ms"], "text": seg["text"]}
                else:
                    # 合并
                    current["text"] = text + seg["text"]
                    current["end_ms"] = seg["end_ms"]

        if current:
            merged.append(current)

        return merged

    def _signal_handler(self, signum, frame):
        """处理退出信号"""
        logger.info(f"收到信号 {signum}，准备退出...")
        self.running = False

    def _load_asr_model(self):
        """加载ASR模型"""
        try:
            logger.info("开始加载ASR模型...")
            with suppress_stdout():
                from funasr import AutoModel

                self.asr_model = AutoModel(
                    model="damo/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
                    model_revision="v2.0.4",
                    disable_update=True,
                    device=self.device,
                )
            logger.info("ASR模型加载完成")
            return True
        except Exception as e:
            logger.error(f"ASR模型加载失败: {str(e)}")
            return False

    def _load_vad_model(self):
        """加载VAD模型"""
        try:
            logger.info("开始加载VAD模型...")
            with suppress_stdout():
                from funasr import AutoModel

                self.vad_model = AutoModel(
                    model="damo/speech_fsmn_vad_zh-cn-16k-common-pytorch",
                    model_revision="v2.0.4",
                    disable_update=True,
                    device=self.device,
                )
            logger.info("VAD模型加载完成")
            return True
        except Exception as e:
            logger.error(f"VAD模型加载失败: {str(e)}")
            return False

    def _load_punc_model(self):
        """加载标点恢复模型"""
        try:
            import time

            start_time = time.time()
            logger.info("开始加载标点恢复模型...")

            # 记录导入时间
            import_start = time.time()
            with suppress_stdout():
                from funasr import AutoModel
            import_time = time.time() - import_start
            logger.info(f"FunASR导入耗时: {import_time:.2f}秒")

            # 记录模型创建时间
            model_start = time.time()
            with suppress_stdout():
                self.punc_model = AutoModel(
                    model="damo/punc_ct-transformer_zh-cn-common-vocab272727-pytorch",
                    model_revision="v2.0.4",
                    disable_update=True,
                    device=self.device,
                )
            model_time = time.time() - model_start
            total_time = time.time() - start_time

            logger.info(
                f"标点恢复模型加载完成 - 模型创建耗时: {model_time:.2f}秒, 总耗时: {total_time:.2f}秒"
            )
            return True
        except Exception as e:
            logger.error(f"标点恢复模型加载失败: {str(e)}")
            return False

    def initialize(self):
        """并行初始化FunASR模型（标点模型为可选）"""
        if self.initialized:
            return {"success": True, "message": "模型已初始化"}

        try:
            import threading
            import time

            logger.info("正在并行初始化FunASR模型...")
            start_time = time.time()

            # [20260819_T8_ThreadAdapt] torch is imported by the model
            # loaders below — apply the authoritative thread limit first.
            self._apply_torch_thread_limit()

            # 创建加载结果存储
            results = {}

            def load_model_thread(model_name, load_func):
                """模型加载线程包装函数"""
                thread_start = time.time()
                results[model_name] = load_func()
                thread_time = time.time() - thread_start
                logger.info(f"{model_name}模型加载线程耗时: {thread_time:.2f}秒")

            # 创建并启动三个并行线程
            threads = [
                threading.Thread(
                    target=load_model_thread, args=("asr", self._load_asr_model)
                ),
                threading.Thread(
                    target=load_model_thread, args=("vad", self._load_vad_model)
                ),
                threading.Thread(
                    target=load_model_thread, args=("punc", self._load_punc_model)
                ),
            ]

            # 启动所有线程
            for thread in threads:
                thread.start()

            # 等待所有线程完成，设置超时
            for thread in threads:
                thread.join(timeout=300)  # 5分钟超时
                if thread.is_alive():
                    logger.error(f"模型加载线程超时")
                    return {
                        "success": False,
                        "error": "模型加载超时",
                        "type": "timeout_error",
                    }

            # ASR和VAD是必需的，标点模型可选
            required_models = ["asr", "vad"]
            failed_required = [name for name in required_models if not results.get(name)]
            punc_ok = results.get("punc", False)

            if failed_required:
                error_msg = f"以下必需模型加载失败: {', '.join(failed_required)}"
                logger.error(error_msg)
                return {"success": False, "error": error_msg, "type": "init_error"}

            total_time = time.time() - start_time
            self.initialized = True
            status = "所有" if punc_ok else "核心（标点模型未加载）"
            logger.info(
                f"FunASR{status}模型初始化完成，总耗时: {total_time:.2f}秒"
            )
            return {
                "success": True,
                "message": f"FunASR{status}模型初始化成功，耗时: {total_time:.2f}秒",
                "punc_loaded": punc_ok,
            }

        except ImportError as e:
            error_msg = "FunASR未安装，请先安装FunASR: pip install funasr"
            logger.error(error_msg)
            return {"success": False, "error": error_msg, "type": "import_error"}

        except Exception as e:
            error_msg = f"FunASR模型初始化失败: {str(e)}"
            logger.error(error_msg)
            logger.error(traceback.format_exc())
            return {"success": False, "error": error_msg, "type": "init_error"}

    def transcribe_audio(self, audio_path, options=None):
        """转录音频文件"""
        # [20260819_T7_MicPreprocess] Default = original path: overwritten
        # by the DSP output inside the try; a raise BEFORE that point (e.g.
        # non-finite input rejection) must not hit an unbound name in the
        # finally cleanup.
        infer_path = audio_path
        if not self.initialized:
            init_result = self.initialize()
            if not init_result["success"]:
                return init_result

        try:
            # 检查音频文件是否存在
            if not os.path.exists(audio_path):
                return {"success": False, "error": f"音频文件不存在: {audio_path}"}

            logger.info(f"开始转录音频文件: {audio_path}")

            # 设置默认选项
            default_options = {
                "batch_size_s": 60,
                "hotword": "",
                "use_vad": True,
                "use_punc": True,  # 使用FunASR自带的标点恢复
                "language": "zh",
            }

            if options:
                default_options.update(options)

            # [20260820_T14_Hotwords] Defense-in-depth: coerce the hotword
            # option to a safe string before it reaches generate().
            default_options["hotword"] = sanitize_hotword(
                default_options.get("hotword", "")
            )

            # [20260819_T7_MicPreprocess] Ticket #186 (spec #177 T7): run the
            # DSP module on the push-to-talk path too. The renderer delivers
            # a 16k mono WAV temp (created/cleaned by the TS side); the DSP
            # output below is OUR temp and is unlinked in the finally block.
            # Fallback policy mirrors the file path (see _apply_preprocessing).
            infer_path = self._apply_preprocessing(audio_path)

            # 执行语音识别
            if default_options["use_vad"]:
                vad_result = self.vad_model.generate(
                    input=infer_path, batch_size_s=default_options["batch_size_s"]
                )
                logger.info("VAD处理完成")

            # 执行ASR识别
            asr_result = self.asr_model.generate(
                input=infer_path,
                batch_size_s=default_options["batch_size_s"],
                hotword=default_options["hotword"],
                cache={},
            )

            # 提取识别文本
            if isinstance(asr_result, list) and len(asr_result) > 0:
                if isinstance(asr_result[0], dict) and "text" in asr_result[0]:
                    raw_text = asr_result[0]["text"]
                else:
                    raw_text = str(asr_result[0])
            else:
                raw_text = str(asr_result)

            logger.info(f"ASR识别完成，原始文本: {raw_text[:100]}...")

            # 使用FunASR进行标点恢复
            final_text = raw_text
            if default_options["use_punc"] and self.punc_model and raw_text.strip():
                try:
                    punc_result = self.punc_model.generate(input=raw_text)
                    if isinstance(punc_result, list) and len(punc_result) > 0:
                        if (
                            isinstance(punc_result[0], dict)
                            and "text" in punc_result[0]
                        ):
                            final_text = punc_result[0]["text"]
                        else:
                            final_text = str(punc_result[0])
                    logger.info("FunASR标点恢复完成")
                except Exception as e:
                    logger.warning(f"FunASR标点恢复失败，使用原始文本: {str(e)}")

            duration = self._get_audio_duration(infer_path)
            self.transcription_count += 1

            result = {
                "success": True,
                "text": final_text,
                "raw_text": raw_text,
                "confidence": (
                    getattr(asr_result[0], "confidence", 0.0)
                    if isinstance(asr_result, list)
                    else 0.0
                ),
                "duration": duration,
                "language": "zh-CN",
                "model_type": "pytorch",  # 标识使用的是pytorch版本
            }

            # 生产环境：每10次转录后进行内存清理
            if self.transcription_count % 10 == 0:
                self._cleanup_memory()
                logger.info(f"已完成 {self.transcription_count} 次转录，执行内存清理")

            logger.info(f"转录完成，最终文本: {final_text[:100]}...")
            return result

        except Exception as e:
            error_msg = f"音频转录失败: {str(e)}"
            logger.error(error_msg)
            logger.error(traceback.format_exc())
            return {"success": False, "error": error_msg, "type": "transcription_error"}
        finally:
            # [20260819_T7_MicPreprocess] Clean OUR temp only — the original
            # mic temp belongs to the TS side (close-then-unlink discipline
            # lives in audioFileHelpers); fallback returns the original path,
            # which the != audio_path guard leaves untouched.
            if infer_path != audio_path:
                try:
                    os.unlink(infer_path)
                except Exception:
                    pass

    def transcribe_file_audio(self, audio_path, options=None):
        """带时间戳的文件转录，用于 transcribe_file 命令"""
        if options is None:
            options = {}

        request_id = options.get("request_id", "")
        # [20260820_T14_Hotwords] Defense-in-depth (file path).
        hotword = sanitize_hotword(options.get("hotword", ""))
        self.cancel_event.clear()
        import time
        _t0 = time.time()
        logger.info(f"transcribe_file_audio START request_id={request_id} path={audio_path}")

        wav_path = audio_path
        was_converted = False
        # [20260818_T6_AudioPreprocess] Temp files to clean in finally:
        # converted_path = format-conversion temp (None on wav/flac
        # passthrough); dsp_path = preprocessing output (may equal the
        # input when preprocessing fell back).
        converted_path = None
        dsp_path = None

        try:
            # 路径验证
            valid, result = self._validate_audio_path(audio_path)
            if not valid:
                return {"success": False, "error": result}
            audio_path = result

            # 使用 librosa 将非 WAV 转为 16kHz 单声道 WAV
            # 注意：格式列表需与 _convert_to_wav() 保持同步
            ext = os.path.splitext(audio_path)[1].lower()
            needs_convert = ext not in ('.wav', '.flac')
            if needs_convert:
                logger.info(f"convert phase START request_id={request_id} ext={ext}")
                self.response_queue.put({
                    "request_id": request_id,
                    "type": "progress",
                    "phase": "convert",
                    "message": f"正在转换 {ext} 音频...",
                    "progress_pct": 0,
                })
            wav_path, was_converted = self._convert_to_wav(audio_path)
            if was_converted:
                logger.info(f"convert phase END request_id={request_id} elapsed={time.time()-_t0:.2f}s")

            # [20260818_T6_AudioPreprocess] DSP runs AFTER conversion, so it
            # covers BOTH branches: converted temp wavs AND the native
            # wav/flac passthrough (which previously reached the model raw).
            converted_path = wav_path if was_converted else None
            dsp_path = self._apply_preprocessing(wav_path)
            if dsp_path != wav_path:
                wav_path = dsp_path

            # 获取音频时长（从转换后的 WAV 获取更准确）
            duration = self._get_audio_duration(wav_path)

            # 发送进度：VAD阶段
            _t_vad = time.time()
            logger.info(f"VAD phase START request_id={request_id} duration={duration:.2f}s")
            self.response_queue.put({
                "request_id": request_id,
                "type": "progress",
                "phase": "vad",
                "message": "语音检测中...",
                "progress_pct": 5,
            })

            # VAD 处理
            use_vad = options.get("use_vad", True)
            raw_text = ""
            raw_segments = []

            vad_segments = []
            if use_vad and self.vad_model:
                vad_result = self.vad_model.generate(input=wav_path)
                if vad_result and len(vad_result) > 0:
                    vad_segments = vad_result[0].get("value", [])
            logger.info(f"VAD phase END request_id={request_id} elapsed={time.time()-_t_vad:.2f}s segments={len(vad_segments)}")

            # ASR 阶段 — VAD 分段推理（回退：全文件单次推理）
            _t_asr = time.time()
            total_ms = int(duration * 1000) if duration else 0
            rtf_estimate = 0.08 if self.device == "cuda" else 0.5

            self.response_queue.put({
                "request_id": request_id,
                "type": "progress",
                "phase": "asr",
                "message": "语音识别中...",
                "total_ms": total_ms,
                "progress_pct": 10,
            })

            if self.cancel_event.is_set():
                return {"success": False, "canceled": True, "error": "转录已取消", "request_id": request_id}

            # --- Helper: 从 ASR 时间戳构建 segments ---
            def _build_segments_from_timestamps(asr_text, asr_timestamps, time_offset_ms=0):
                """将 ASR 返回的字级时间戳切分为 segments"""
                segs = []
                if not asr_timestamps or not asr_text:
                    return segs
                chars = list(asr_text.replace(" ", ""))
                seg_text = ""
                seg_start = asr_timestamps[0][0] + time_offset_ms
                seg_end = asr_timestamps[0][1] + time_offset_ms
                char_idx = 0

                for ts in asr_timestamps:
                    seg_end = ts[1] + time_offset_ms
                    if char_idx < len(chars):
                        seg_text += chars[char_idx]
                        char_idx += 1
                    if seg_text and (seg_text[-1] in "。！？；\n" or len(seg_text) >= 20):
                        segs.append({
                            "start_ms": seg_start,
                            "end_ms": seg_end,
                            "text": seg_text
                        })
                        seg_text = ""
                        seg_start = ts[1] + time_offset_ms if char_idx < len(asr_timestamps) else seg_end
                if seg_text:
                    segs.append({
                        "start_ms": seg_start,
                        "end_ms": seg_end,
                        "text": seg_text
                    })
                return segs

            # --- VAD 分段推理 ---
            if vad_segments:
                logger.info(f"ASR phase START (VAD-segmented) request_id={request_id} vad_segments={len(vad_segments)}")

                # 合并相邻/重叠 VAD 段（间隔 < 300ms）为连续语音区域
                MERGE_GAP_MS = 300
                MAX_REGION_MS = 300_000  # 300s 上限
                BUFFER_MS = 200  # 每侧缓冲
                SR = 16000  # 采样率

                regions = []
                cur_start = vad_segments[0][0]
                cur_end = vad_segments[0][1]
                for vs, ve in vad_segments[1:]:
                    if vs - cur_end < MERGE_GAP_MS:
                        cur_end = max(cur_end, ve)
                    else:
                        regions.append([cur_start, cur_end])
                        cur_start = vs
                        cur_end = ve
                regions.append([cur_start, cur_end])

                # 在 VAD 边界处拆分超长区域
                split_regions = []
                for rs, re_ in regions:
                    if re_ - rs <= MAX_REGION_MS:
                        split_regions.append([rs, re_])
                    else:
                        # 从原始 vad_segments 中找到属于该区域的子段
                        sub_segs = []
                        for vs, ve in vad_segments:
                            if vs >= rs and ve <= re_:
                                sub_segs.append([vs, ve])
                        # 累加合并直到超过上限
                        chunk_start = sub_segs[0][0]
                        chunk_end = sub_segs[0][1]
                        for ss, se in sub_segs[1:]:
                            if se - chunk_start > MAX_REGION_MS:
                                split_regions.append([chunk_start, chunk_end])
                                chunk_start = ss
                                chunk_end = se
                            else:
                                chunk_end = se
                        split_regions.append([chunk_start, chunk_end])
                regions = split_regions

                total_chunks = len(regions)
                chunk_temp_files = []

                try:
                    import soundfile as sf

                    # 获取 WAV 信息用于帧级读取
                    wav_info = sf.info(wav_path)
                    wav_sr = wav_info.samplerate
                    wav_frames = wav_info.frames

                    for chunk_idx, (region_start, region_end) in enumerate(regions):
                        if self.cancel_event.is_set():
                            logger.info(f"ASR phase CANCELLED request_id={request_id} chunk={chunk_idx}/{total_chunks}")
                            break

                        # 添加缓冲，但不超出音频边界
                        buf_start_ms = max(0, region_start - BUFFER_MS)
                        buf_end_ms = min(total_ms, region_end + BUFFER_MS)

                        # 帧级读取
                        start_frame = int(buf_start_ms / 1000.0 * wav_sr)
                        end_frame = int(buf_end_ms / 1000.0 * wav_sr)
                        start_frame = max(0, start_frame)
                        end_frame = min(wav_frames, end_frame)

                        # 读取该区域音频
                        audio_chunk, _ = sf.read(wav_path, start=start_frame, stop=end_frame)

                        # 写入临时 WAV
                        chunk_tmp = tempfile.NamedTemporaryFile(
                            suffix='.wav', delete=False,
                            prefix='murmur_chunk_', dir=tempfile.gettempdir()
                        )
                        sf.write(chunk_tmp.name, audio_chunk, wav_sr)
                        chunk_tmp.close()
                        chunk_temp_files.append(chunk_tmp.name)

                        # ASR 推理
                        asr_result = self.asr_model.generate(
                            input=chunk_tmp.name,
                            batch_size_s=60,
                            hotword=hotword,
                        )

                        if asr_result and len(asr_result) > 0:
                            chunk_text = asr_result[0].get("text", "")
                            if chunk_text:
                                raw_text += chunk_text

                            timestamps = asr_result[0].get("timestamp")
                            if timestamps and chunk_text:
                                # 时间戳偏移：chunk 内偏移 + 缓冲区域起始
                                offset_ms = buf_start_ms
                                chunk_segs = _build_segments_from_timestamps(
                                    chunk_text, timestamps, time_offset_ms=offset_ms
                                )
                                raw_segments.extend(chunk_segs)
                            elif chunk_text:
                                # 无时间戳，用区域范围
                                raw_segments.append({
                                    "start_ms": region_start,
                                    "end_ms": region_end,
                                    "text": chunk_text
                                })

                        # 报告进度
                        pct = 10 + (chunk_idx + 1) / total_chunks * 85
                        self.response_queue.put({
                            "request_id": request_id,
                            "type": "progress",
                            "phase": "asr",
                            "message": f"语音识别中... {int(pct)}%",
                            "total_ms": total_ms,
                            "progress_pct": round(min(pct, 95), 1),
                        })
                        logger.debug(f"ASR chunk {chunk_idx+1}/{total_chunks} done "
                                     f"region=[{region_start},{region_end}] text_len={len(asr_result[0].get('text','')) if asr_result else 0}")
                finally:
                    for f in chunk_temp_files:
                        try:
                            os.unlink(f)
                        except Exception:
                            pass

                logger.info(f"ASR phase END (VAD-segmented) request_id={request_id} "
                            f"elapsed={time.time()-_t_asr:.2f}s chunks={total_chunks} text_len={len(raw_text)}")

            # --- 回退：全文件单次推理 ---
            else:
                logger.info(f"ASR phase START (fallback full-file) request_id={request_id} total_ms={total_ms}")
                estimated_time_s = max(total_ms * rtf_estimate / 1000, 2)

                # 后台线程定时报告 RTF 估算进度
                timer_stop = threading.Event()

                def asr_progress_timer():
                    start = time.time()
                    while not timer_stop.is_set() and not self.cancel_event.is_set():
                        elapsed = time.time() - start
                        pct = min(10 + elapsed / estimated_time_s * 85, 95)
                        self.response_queue.put({
                            "request_id": request_id,
                            "type": "progress",
                            "phase": "asr",
                            "message": f"语音识别中... {int(pct)}%",
                            "total_ms": total_ms,
                            "progress_pct": round(pct, 1),
                        })
                        timer_stop.wait(0.5)

                timer_thread = threading.Thread(target=asr_progress_timer, daemon=True)
                timer_thread.start()

                try:
                    asr_result = self.asr_model.generate(
                        input=wav_path,
                        batch_size_s=60,
                        hotword=hotword,
                    )
                finally:
                    timer_stop.set()
                    timer_thread.join(timeout=1)

                if asr_result and len(asr_result) > 0:
                    raw_text = asr_result[0].get("text", "")
                    timestamps = asr_result[0].get("timestamp")
                    if timestamps and raw_text:
                        raw_segments = _build_segments_from_timestamps(raw_text, timestamps)
                    elif vad_segments:
                        total_vad_ms = sum(e - s for s, e in vad_segments)
                        per_ms_text = len(raw_text) / total_vad_ms if total_vad_ms > 0 else 0
                        offset = 0
                        for start_ms, end_ms in vad_segments:
                            seg_len = max(1, int((end_ms - start_ms) * per_ms_text))
                            seg_text = raw_text[offset:offset + seg_len]
                            if seg_text:
                                raw_segments.append({
                                    "start_ms": start_ms,
                                    "end_ms": end_ms,
                                    "text": seg_text
                                })
                            offset += seg_len

                logger.info(f"ASR phase END (fallback) request_id={request_id} "
                            f"elapsed={time.time()-_t_asr:.2f}s text_len={len(raw_text)}")

            # 标点恢复
            _t_punc = time.time()
            if self.cancel_event.is_set():
                logger.info(f"PUNC phase SKIPPED (cancelled) request_id={request_id}")
                return {"success": False, "canceled": True, "error": "转录已取消", "request_id": request_id}

            self.response_queue.put({
                "request_id": request_id,
                "type": "progress",
                "phase": "punc",
                "message": "标点恢复中...",
                "progress_pct": 96,
            })

            text = raw_text
            if self.punc_model and text:
                logger.info(f"PUNC phase START request_id={request_id} text_len={len(text)}")
                punc_result = self.punc_model.generate(input=text)
                logger.info(f"PUNC phase END request_id={request_id} elapsed={time.time()-_t_punc:.2f}s")
                if punc_result and len(punc_result) > 0:
                    text = punc_result[0].get("text", raw_text)
            else:
                logger.info(f"PUNC phase SKIP (no model or empty text) request_id={request_id}")

            # 智能合并 segments
            segments = self._merge_segments(raw_segments) if raw_segments else []

            # GC
            self.transcription_count += 1
            if self.transcription_count % 5 == 0:
                self._cleanup_memory()

            result = {
                "success": True,
                "text": text,
                "raw_text": raw_text,
                "segments": segments,
                "raw_segments": raw_segments,
                "duration": duration,
                "confidence": 0.9,
                "language": "zh-CN"
            }
            logger.info(f"transcribe_file_audio COMPLETE request_id={request_id} total_elapsed={time.time()-_t0:.2f}s")
        except Exception as e:
            logger.error(f"文件转录异常: {str(e)}\n{traceback.format_exc()}")
            result = {
                "success": False,
                "error": str(e),
                "request_id": request_id
            }
        finally:
            # [20260818_T6_AudioPreprocess] Unlink BOTH temps (the
            # format-converted file and the DSP output); never the user's
            # original, never twice.
            if dsp_path and dsp_path != audio_path:
                try:
                    os.unlink(dsp_path)
                except Exception:
                    pass
            if (
                converted_path
                and converted_path != audio_path
                and converted_path != dsp_path
            ):
                try:
                    os.unlink(converted_path)
                except Exception:
                    pass
        return result

    # [20260818_T6_AudioPreprocess] Ticket #185 (spec #177 T6): run the DSP
    # module (80Hz HPF + segmented RMS normalization) on the transcribe-file
    # path. Fallback policy (review fixup): a DSP *bug* (any non-ValueError)
    # warns and returns the original path — preprocessing must never block
    # transcription. ValueError means the INPUT is illegal (non-finite
    # samples); it propagates so transcription FAILS with a clear message
    # instead of feeding known-bad audio to the model.
    def _apply_preprocessing(self, wav_path):
        try:
            import audio_preprocessing
            return audio_preprocessing.preprocess_audio_file(wav_path)
        except ValueError:
            raise
        except Exception as e:
            logger.warning(f"音频预处理失败，使用原始音频: {e}")
            return wav_path

    def _convert_to_wav(self, audio_path):
        """使用 librosa/soundfile 将非 WAV 音频转为 16kHz 单声道 WAV 临时文件

        FLAC 直接返回，依赖 FunASR/soundfile 原生支持。
        WAV 以外的格式转换失败时抛出 RuntimeError。
        """
        ext = os.path.splitext(audio_path)[1].lower()
        if ext in ('.wav', '.flac'):
            return audio_path, False

        try:
            import librosa
            import soundfile as sf

            y, sr = librosa.load(audio_path, sr=16000, mono=True)
            tmp = tempfile.NamedTemporaryFile(
                suffix='.wav', delete=False,
                prefix='murmur_conv_', dir=tempfile.gettempdir()
            )
            sf.write(tmp.name, y, 16000)
            tmp.close()
            logger.info(f"librosa 转换完成: {audio_path} -> {tmp.name}")
            return tmp.name, True
        except Exception as e:
            logger.warning(f"librosa 转换失败: {e}")
            raise RuntimeError(f"音频格式转换失败（{ext}）: {e}。请确认已安装 librosa 和 soundfile") from e

    def _get_audio_duration(self, audio_path):
        """获取音频时长"""
        try:
            import librosa

            duration = librosa.get_duration(filename=audio_path)
            self.total_audio_duration += duration  # 累计音频时长
            return duration
        except Exception as e:
            logger.warning(f"获取音频时长失败: {e}")
            return 0.0

    def _cleanup_memory(self):
        """生产环境内存清理"""
        try:
            import gc

            gc.collect()
            logger.info("内存清理完成")
        except Exception as e:
            logger.warning(f"内存清理失败: {str(e)}")

    def get_performance_stats(self):
        """获取性能统计信息"""
        return {
            "transcription_count": self.transcription_count,
            "total_audio_duration": round(self.total_audio_duration, 2),
            "average_duration": round(
                self.total_audio_duration / max(1, self.transcription_count), 2
            ),
            "initialized": self.initialized,
            "models_loaded": {
                "asr": self.asr_model is not None,
                "vad": self.vad_model is not None,
                "punc": self.punc_model is not None,
            },
        }

    def check_status(self):
        """检查FunASR状态"""
        try:
            import funasr

            return {
                "success": True,
                "installed": True,
                "initialized": self.initialized,
                "version": getattr(funasr, "__version__", "unknown"),
                "models": {
                    "asr": self.asr_model is not None,
                    "vad": self.vad_model is not None,
                    "punc": self.punc_model is not None,  # FunASR标点恢复模型状态
                },
            }
        except ImportError:
            return {
                "success": False,
                "installed": False,
                "initialized": False,
                "error": "FunASR未安装",
            }

    def _inference_worker(self):
        """推理线程：从 request_queue 取任务，执行推理"""
        while self.running:
            try:
                task = self.request_queue.get(timeout=1.0)
                if task is None:
                    break

                request_id = task.get("request_id", "")
                action = task.get("action")

                try:
                    if action == "transcribe_file":
                        opts = task.get("options", {})
                        opts["request_id"] = request_id
                        result = self.transcribe_file_audio(
                            task.get("audio_path"),
                            opts,
                        )
                    else:
                        result = {"success": False, "error": f"推理线程不支持的动作: {action}"}

                    result["request_id"] = request_id
                    result["type"] = "result"
                    self.response_queue.put(result)
                except Exception as e:
                    self.response_queue.put({
                        "request_id": request_id,
                        "type": "result",
                        "success": False,
                        "error": str(e)
                    })
            except queue.Empty:
                continue

        logger.info("推理线程退出")

    def _output_worker(self):
        """输出线程：从 response_queue 取结果，写入 stdout"""
        while self.running:
            try:
                msg = self.response_queue.get(timeout=0.5)
                print(json.dumps(msg, ensure_ascii=False))
                sys.stdout.flush()
            except queue.Empty:
                continue

        logger.info("输出线程退出")

    def _load_cam_model(self):
        """懒加载CAM++声纹模型（仅在首次diarize调用时加载）"""
        if self.cam_model is not None:
            return

        import psutil

        mem = psutil.virtual_memory()
        avail_gb = mem.available / (1024 ** 3)
        if avail_gb < 2.0:
            raise RuntimeError(
                f"内存不足，需要至少2GB可用内存，当前可用: {avail_gb:.1f}GB"
            )

        import time

        from funasr import AutoModel

        logger.info("正在加载CAM++声纹模型...")
        start = time.time()
        self.cam_model = AutoModel(
            model="damo/speech_campplus_sv_zh-cn_16k-common",
            model_revision="v2.0.4",
        )
        elapsed = time.time() - start
        logger.info(f"CAM++模型加载完成，耗时: {elapsed:.2f}秒")

    def diarize_audio(self, audio_path, segments):
        """
        对已有segments进行说话人识别。
        参数:
            audio_path: 音频文件路径
            segments: [{start_ms, end_ms, text}, ...]
        返回:
            segments列表，每个元素增加speaker字段
        """
        import librosa
        import numpy as np

        if not segments or len(segments) == 0:
            return {"success": False, "error": "无分段数据"}

        try:
            self._load_cam_model()
        except RuntimeError as e:
            return {"success": False, "error": str(e)}

        # 加载整个音频文件到内存
        audio, sr = librosa.load(audio_path, sr=16000, mono=True)

        embeddings = []
        valid_indices = []
        for i, seg in enumerate(segments):
            start_sample = int(seg["start_ms"] / 1000.0 * sr)
            end_sample = int(seg["end_ms"] / 1000.0 * sr)
            start_sample = max(0, start_sample)
            end_sample = min(len(audio), end_sample)

            if end_sample - start_sample < sr * 0.1:
                continue  # 跳过大短的片段（<100ms）

            chunk = audio[start_sample:end_sample]
            # 使用CAM++提取声纹嵌入
            result = self.cam_model(chunk, output_dir=None)
            if result and len(result) > 0:
                emb = result[0].get("spk_embedding") or result[0].get("embedding")
                if emb is not None:
                    embeddings.append(np.array(emb).flatten())
                    valid_indices.append(i)

        if len(embeddings) == 0:
            for seg in segments:
                seg["speaker"] = "Speaker"
            return {"success": True, "segments": segments}

        # 余弦相似度聚类
        embeddings = np.stack(embeddings)  # (N, D)
        N = len(embeddings)
        threshold = 0.7
        labels = list(range(N))  # 初始每个embedding一个cluster

        for i in range(N):
            for j in range(i + 1, N):
                sim = np.dot(embeddings[i], embeddings[j]) / (
                    np.linalg.norm(embeddings[i]) * np.linalg.norm(embeddings[j]) + 1e-8
                )
                if sim > threshold:
                    # 合并cluster
                    root_i = labels[i]
                    root_j = labels[j]
                    new_label = min(root_i, root_j)
                    for k in range(N):
                        if labels[k] == root_i or labels[k] == root_j:
                            labels[k] = new_label

        # 重映射label到连续编号
        unique_labels = sorted(set(labels))
        label_map = {old: f"Speaker {chr(65 + idx)}" for idx, old in enumerate(unique_labels)}
        if len(unique_labels) == 1:
            label_map[unique_labels[0]] = "Speaker"

        speaker_for_index = {}
        for vi, label_id in zip(valid_indices, labels):
            speaker_for_index[vi] = label_map[label_id]

        for i, seg in enumerate(segments):
            seg["speaker"] = speaker_for_index.get(i, "Speaker")

        return {"success": True, "segments": segments}

    # [20260817_T5_HandleCommand] Ticket #181 (spec #177 T5): the stdin
    # command dispatch, extracted verbatim from run()'s read loop so it is
    # unit-testable without spawning the process (protocol extensions for
    # idle-unload/hotwords must extend tests/python accordingly).
    # Returns (result, keep_running):
    #   result is None     -> action was queued (transcribe_file); the read
    #                         loop must NOT print anything for it
    #   keep_running False -> stop the read loop after printing (exit)
    def handle_command(self, command):
        if command.get("action") == "transcribe":
            audio_path = command.get("audio_path")
            options = command.get("options", {})
            return self.transcribe_audio(audio_path, options), True
        elif command.get("action") == "status":
            return self.check_status(), True
        elif command.get("action") == "stats":
            return {"success": True, "stats": self.get_performance_stats()}, True
        elif command.get("action") == "cleanup":
            self._cleanup_memory()
            return {"success": True, "message": "内存清理完成"}, True
        elif command.get("action") == "transcribe_file":
            # 放入推理队列，不立即返回确认
            # 推理结果和进度通过 response_queue → output_worker → stdout 发送
            self.request_queue.put({
                "request_id": command.get("request_id", ""),
                "action": "transcribe_file",
                "audio_path": command.get("audio_path"),
                "options": command.get("options", {})
            })
            return None, True
        elif command.get("action") == "cancel_transcription":
            self.cancel_event.set()
            return {"success": True, "message": "取消信号已发送"}, True
        elif command.get("action") == "diarize":
            audio_path = command.get("audio_path")
            segments = command.get("segments", [])
            return self.diarize_audio(audio_path, segments), True
        elif command.get("action") == "ping":
            return {"success": True, "action": "pong"}, True
        elif command.get("action") == "exit":
            return {"success": True, "message": "服务器退出"}, False
        else:
            return {
                "success": False,
                "error": f"未知命令: {command.get('action')}",
            }, True

    def run(self):
        """运行服务器主循环"""
        logger.info("FunASR服务器启动")

        # 解析 damo 根目录
        def _default_damo_root():
            # 允许通过 MODELSCOPE_CACHE 指定根；常见是 ~/.cache/modelscope/hub/damo
            root = os.environ.get("MODELSCOPE_CACHE")
            if root:
                # 兼容两种布局：<cache>/damo 或 <cache>/hub/damo
                if os.path.isdir(os.path.join(root, "damo")):
                    return os.path.join(root, "damo")
                if os.path.isdir(os.path.join(root, "hub", "damo")):
                    return os.path.join(root, "hub", "damo")
                # 像 Node 一样自定义到 /Volumes/APFS/AI/models/damo，就直接传入 --damo-root
            # 默认回到用户主目录的 modelscope/hub/damo
            home_dir = os.path.expanduser("~")
            return os.path.join(home_dir, ".cache", "modelscope", "hub", "damo")

        cache_path = self.damo_root if self.damo_root else _default_damo_root()
        logger.info(f"使用的模型根目录(damo root): {cache_path}")

        repos = [
            "speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
            "speech_fsmn_vad_zh-cn-16k-common-pytorch",
            "punc_ct-transformer_zh-cn-common-vocab272727-pytorch",
        ]
        required_repos = repos[:2]  # ASR + VAD are required; punc is optional

        def _repo_ready(repo_dir):
            # 目录存在且包含任意常见权重/配置文件即认为已就绪
            if not os.path.isdir(repo_dir):
                return False
            patterns = [
                "model.pt", "pytorch_model.bin", "*.onnx",
                "config.json", "configuration.json", "model.yaml", "vocab*"
            ]
            for pat in patterns:
                if glob.glob(os.path.join(repo_dir, pat)):
                    return True
            return False

        missing_required = []
        for r in required_repos:
            rd = os.path.join(cache_path, r)
            if not _repo_ready(rd):
                missing_required.append(r)

        if not missing_required:
            logger.info("模型文件存在，开始初始化")
            init_result = self.initialize()
        else:
            logger.info(f"必需模型文件不存在或不完整：{', '.join(missing_required)}，跳过初始化")
            init_result = {
                "success": False,
                "error": "模型文件未下载，请先下载模型",
                "type": "models_not_downloaded"
            }
        print(json.dumps(init_result, ensure_ascii=False))
        sys.stdout.flush()

        # 启动推理线程和输出线程
        self._inference_thread = threading.Thread(target=self._inference_worker, daemon=True)
        self._output_thread = threading.Thread(target=self._output_worker, daemon=True)
        self._inference_thread.start()
        self._output_thread.start()

        while self.running:
            try:
                # 读取命令
                line = sys.stdin.readline()
                if not line:
                    break

                line = line.strip()
                if not line:
                    continue

                try:
                    command = json.loads(line)
                except json.JSONDecodeError:
                    result = {"success": False, "error": "无效的JSON命令"}
                    print(json.dumps(result, ensure_ascii=False))
                    sys.stdout.flush()
                    continue

                # 提取 request_id 用于响应关联
                request_id = command.get("request_id", "")

                # Dispatch the command. [20260817_T5_HandleCommand] The
                # dispatch logic now lives in handle_command (unit-testable);
                # this loop keeps only the read/print cycle.
                result, keep_running = self.handle_command(command)

                # Print the result with request_id attached. result=None
                # means the action was queued — output_worker prints it
                # asynchronously, so the read loop must not print here.
                if result is not None:
                    if request_id:
                        result["request_id"] = request_id
                    print(json.dumps(result, ensure_ascii=False))
                    sys.stdout.flush()

                if not keep_running:
                    break

            except KeyboardInterrupt:
                break
            except Exception as e:
                error_result = {
                    "success": False,
                    "error": str(e),
                    "traceback": traceback.format_exc(),
                }
                print(json.dumps(error_result, ensure_ascii=False))
                sys.stdout.flush()

        logger.info("FunASR服务器退出")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--damo-root", type=str, default=None,
                        help="damo 模型根目录，例如 /Volumes/APFS/AI/models/damo")
    args = parser.parse_args()

    server = FunASRServer(damo_root=args.damo_root)
    server.run()