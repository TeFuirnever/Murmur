#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Murmur ASR 基准测试脚本
对比 Paraformer-large vs SenseVoice-Small vs Fun-ASR-Nano 在 Apple Silicon CPU 上的性能

前置条件:
  pip install funasr modelscope torch torchaudio numpy soundfile

  注意: SenseVoice 和 Fun-ASR-Nano 需要 FunASR >= 1.1.0
  如果遇到模型加载问题，可尝试从源码安装:
    pip install git+https://github.com/modelscope/FunASR.git

用法:
  python scripts/benchmark_asr.py --audio path/to/test.wav    # 使用自定义音频
  python scripts/benchmark_asr.py --audio test.wav --rounds 5  # 5 轮推理
  python scripts/benchmark_asr.py --generate-audio             # 生成测试音频（仅测延迟）

指标:
  - 首次加载时间 (s)
  - 推理延迟 (ms) — 取多轮平均值
  - 内存占用 (MB)
  - 实时率 RTFx — 音频时长 / 推理时间
  - 识别文本 (用于人工对比精度)
"""

import argparse
import json
import os
import sys
import time
import tracemalloc
from pathlib import Path


# ============================================================
# 配置
# ============================================================

MODELS = [
    {
        "name": "Paraformer-large (当前)",
        "model_id": "damo/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
        "model_revision": "v2.0.4",
        "type": "paraformer",
    },
    {
        "name": "SenseVoice-Small",
        "model_id": "iic/SenseVoiceSmall",
        "model_revision": None,
        "type": "sensevoice",
    },
    {
        "name": "Fun-ASR-Nano",
        "model_id": "FunAudioLLM/Fun-ASR-Nano-2512",
        "model_revision": None,
        "type": "funasr_nano",
    },
]


# ============================================================
# 辅助函数
# ============================================================


def get_test_audio():
    """查找可用的测试音频文件"""
    candidates = [
        Path("tests/fixtures/test_audio.wav"),
        Path("tests/fixtures/test_audio.mp3"),
        Path("test_audio.wav"),
        Path("test_audio.mp3"),
    ]
    for p in candidates:
        if p.exists():
            return str(p)
    return None


def generate_test_audio(output_path, duration_s=10, sample_rate=16000):
    """生成一段正弦波测试音频（仅用于推理管道延迟测试，不测精度）"""
    try:
        import numpy as np
        import soundfile as sf

        t = np.linspace(0, duration_s, int(sample_rate * duration_s), endpoint=False)
        audio = 0.3 * np.sin(2 * np.pi * 440 * t)
        sf.write(output_path, audio, sample_rate)
        print(f"✅ 已生成测试音频: {output_path} ({duration_s}s)")
        return output_path
    except ImportError:
        print("❌ 需要 numpy + soundfile 来生成测试音频")
        print("   pip install numpy soundfile")
        return None


def format_memory(mb):
    """格式化内存数值"""
    if mb >= 1024:
        return f"{mb / 1024:.1f} GB"
    return f"{mb:.1f} MB"


def _build_load_kwargs(model_config, device):
    """构建 AutoModel 加载参数，兼容不同 FunASR 版本"""
    model_id = model_config["model_id"]
    model_type = model_config["type"]

    kwargs = {
        "model": model_id,
        "disable_update": True,
        "device": device,
    }
    if model_config.get("model_revision"):
        kwargs["model_revision"] = model_config["model_revision"]

    if model_type in ("sensevoice", "funasr_nano"):
        # trust_remote_code 让 FunASR 从模型仓库下载自定义代码
        kwargs["trust_remote_code"] = True

    return kwargs


def load_model_with_metrics(model_config, device="cpu"):
    """加载模型并记录指标，自动处理不同模型的加载方式"""
    from funasr import AutoModel

    kwargs = _build_load_kwargs(model_config, device)
    model_type = model_config["type"]

    tracemalloc.start()
    load_start = time.time()

    try:
        # 第一次尝试: 不指定 remote_code，让 FunASR 使用内置代码
        # 新版 FunASR 已内置 SenseVoice 和 Fun-ASR-Nano 支持
        model = AutoModel(**kwargs)
    except Exception:
        # 第二次尝试: 如果内置代码不支持，尝试带 remote_code 加载
        # 需要 FunASR >= 1.1.0 且模型仓库提供 model.py
        tracemalloc.stop()
        kwargs_fallback = dict(kwargs)
        kwargs_fallback["remote_code"] = f"{model_type}_model.py"
        print("  ℹ️  内置代码加载失败，尝试 remote_code 模式...")
        tracemalloc.start()
        model = AutoModel(**kwargs_fallback)

    load_time = time.time() - load_start
    _, peak_mem = tracemalloc.get_traced_memory()
    tracemalloc.stop()

    return model, load_time, peak_mem / (1024 * 1024)


def run_inference_with_metrics(model, model_config, audio_path, device="cpu"):
    """执行推理并记录指标"""
    model_type = model_config["type"]

    gen_kwargs = {
        "input": audio_path,
        "cache": {},
    }

    if model_type == "sensevoice":
        gen_kwargs["language"] = "auto"
        gen_kwargs["use_itn"] = True
        gen_kwargs["batch_size_s"] = 60
    elif model_type == "funasr_nano":
        gen_kwargs["language"] = "中文"
        gen_kwargs["itn"] = True
        gen_kwargs["batch_size"] = 1
    # Paraformer-large 使用默认参数

    tracemalloc.start()
    infer_start = time.time()

    result = model.generate(**gen_kwargs)

    infer_time = time.time() - infer_start
    _, peak_mem = tracemalloc.get_traced_memory()
    tracemalloc.stop()

    # 提取识别文本
    # Paraformer/SenseVoice 输出: [{"key": ..., "text": "..."}]
    # Fun-ASR-Nano 输出: [{"key": ..., "text": "..."}]
    text = ""
    if result and len(result) > 0:
        first = result[0]
        if isinstance(first, dict):
            text = first.get("text", "")
        elif isinstance(first, list) and len(first) > 0:
            text = first[0].get("text", "") if isinstance(first[0], dict) else str(first)

    # SenseVoice 后处理: 去除 <|zh|><|NEUTRAL|><|Speech|><|withitn|> 等标记
    if model_type == "sensevoice" and text:
        try:
            from funasr.utils.postprocess_utils import rich_transcription_postprocess
            text = rich_transcription_postprocess(text)
        except ImportError:
            pass

    return text, infer_time, peak_mem / (1024 * 1024)


# ============================================================
# 主测试流程
# ============================================================


def run_benchmark(audio_path, device="cpu", rounds=3):
    """运行完整的基准测试"""
    print("=" * 70)
    print("Murmur ASR 基准测试")
    print("=" * 70)
    print(f"设备:     {device}")
    print(f"音频:     {audio_path}")
    print(f"推理轮次: {rounds}")

    # 检查音频时长
    try:
        import soundfile as sf
        info = sf.info(audio_path)
        audio_duration = info.duration
        print(f"音频时长: {audio_duration:.1f}s")
    except Exception:
        audio_duration = None
        print("⚠️  无法获取音频时长（soundfile 未安装或格式不支持）")

    print()
    results = []

    for i, model_config in enumerate(MODELS):
        print(f"[{i + 1}/{len(MODELS)}] 测试: {model_config['name']}")
        print("-" * 50)

        # 加载模型
        print("  加载模型...")
        try:
            model, load_time, load_mem = load_model_with_metrics(model_config, device)
            print(f"  ✅ 加载完成: {load_time:.1f}s, 峰值内存: {format_memory(load_mem)}")
        except Exception as e:
            print(f"  ❌ 加载失败: {e}")
            results.append({
                "model": model_config["name"],
                "model_id": model_config["model_id"],
                "status": "load_failed",
                "error": str(e),
            })
            print()
            continue

        # 多轮推理取平均
        infer_times = []
        infer_mems = []
        texts = []

        for round_num in range(rounds):
            print(f"  推理轮次 {round_num + 1}/{rounds}...", end=" ", flush=True)
            try:
                text, infer_time, infer_mem = run_inference_with_metrics(
                    model, model_config, audio_path, device
                )
                infer_times.append(infer_time)
                infer_mems.append(infer_mem)
                texts.append(text)
                rtf = audio_duration / infer_time if audio_duration else None
                rtf_str = f", RTFx: {rtf:.1f}x" if rtf else ""
                print(f"{infer_time * 1000:.0f}ms{rtf_str}")
            except Exception as e:
                print(f"失败: {e}")
                import traceback
                traceback.print_exc()

        # 汇总结果
        if infer_times:
            avg_infer = sum(infer_times) / len(infer_times)
            avg_mem = sum(infer_mems) / len(infer_mems)
            rtf = audio_duration / avg_infer if audio_duration else None

            result = {
                "model": model_config["name"],
                "model_id": model_config["model_id"],
                "status": "success",
                "load_time_s": round(load_time, 2),
                "load_memory_mb": round(load_mem, 1),
                "avg_inference_ms": round(avg_infer * 1000, 1),
                "avg_inference_memory_mb": round(avg_mem, 1),
                "rtfx": round(rtf, 1) if rtf else None,
                "rounds": len(infer_times),
                "text_sample": texts[0][:200] if texts else "",
            }
            results.append(result)

            rtf_display = f", RTFx: {rtf:.1f}x" if rtf else ""
            print(f"  📊 平均推理: {avg_infer * 1000:.0f}ms{rtf_display}")
            print(f"     推理内存: {format_memory(avg_mem)}")
            text_preview = texts[0][:100] if texts else ""
            ellipsis = "..." if len(texts[0]) > 100 else "" if texts else ""
            print(f"     识别结果: {text_preview}{ellipsis}")
        else:
            results.append({
                "model": model_config["name"],
                "model_id": model_config["model_id"],
                "status": "inference_failed",
            })

        print()

        # 释放模型内存
        del model
        try:
            import gc
            gc.collect()
            import torch
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except ImportError:
            pass

    return results, audio_duration


def print_summary(results, audio_duration):
    """打印汇总对比表"""
    print()
    print("=" * 70)
    print("📊 基准测试汇总")
    print("=" * 70)
    print()

    successful = [r for r in results if r["status"] == "success"]

    if not successful:
        print("❌ 所有模型测试均失败")
        return

    # 表格
    header = f"{'模型':<25} {'加载(s)':<10} {'推理(ms)':<12} {'RTFx':<10} {'推理内存':<12} {'状态'}"
    print(header)
    print("-" * len(header))

    for r in results:
        if r["status"] == "success":
            mem_str = format_memory(r["avg_inference_memory_mb"])
            rtfx_str = f"{r['rtfx']}x" if r["rtfx"] else "N/A"
            print(f"{r['model']:<25} {r['load_time_s']:<10.1f} "
                  f"{r['avg_inference_ms']:<12.0f} {rtfx_str:<10} "
                  f"{mem_str:<12} ✅")
        else:
            print(f"{r['model']:<25} {'—':<10} {'—':<12} {'—':<10} {'—':<12} ❌")

    print()

    # 识别结果对比
    print("📝 识别结果对比:")
    print("-" * 50)
    for r in results:
        if r["status"] == "success":
            text = r.get("text_sample", "")
            print(f"  {r['model']}:")
            print(f"    {text}")
            print()

    # 推荐
    if len(successful) >= 2:
        fastest = min(successful, key=lambda x: x["avg_inference_ms"])
        least_mem = min(successful, key=lambda x: x["avg_inference_memory_mb"])
        fastest_load = min(successful, key=lambda x: x["load_time_s"])

        print("🏆 推荐分析:")
        print(f"  最快推理: {fastest['model']} ({fastest['avg_inference_ms']:.0f}ms)")
        print(f"  最低内存: {least_mem['model']} ({format_memory(least_mem['avg_inference_memory_mb'])})")
        print(f"  最快加载: {fastest_load['model']} ({fastest_load['load_time_s']:.1f}s)")

        # 如果 SenseVoice 或 Fun-ASR-Nano 优于 Paraformer-large，给出明确建议
        paraformer = next((r for r in successful if "Paraformer" in r["model"]), None)
        if paraformer:
            others = [r for r in successful if "Paraformer" not in r["model"]]
            for other in others:
                speedup = paraformer["avg_inference_ms"] / other["avg_inference_ms"]
                if speedup > 1.0:
                    print(f"\n  💡 {other['model']} 推理速度是 Paraformer-large 的 {speedup:.1f}x")


def save_results(results, audio_duration, output_path="scripts/benchmark_results.json"):
    """保存结果到 JSON"""
    output = {
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        "audio_duration_s": audio_duration,
        "device": "cpu",
        "results": results,
    }
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    print(f"💾 结果已保存到: {output_path}")


# ============================================================
# 入口
# ============================================================


def main():
    parser = argparse.ArgumentParser(description="Murmur ASR 基准测试")
    parser.add_argument("--audio", type=str, help="测试音频文件路径")
    parser.add_argument("--device", type=str, default="cpu", help="推理设备 (cpu/cuda)")
    parser.add_argument("--rounds", type=int, default=3, help="每个模型的推理轮次")
    parser.add_argument("--output", type=str, default="scripts/benchmark_results.json",
                        help="结果输出路径")
    parser.add_argument("--generate-audio", action="store_true",
                        help="生成测试音频（无真实音频时，仅测延迟不测精度）")
    args = parser.parse_args()

    # 确定测试音频
    audio_path = args.audio
    if not audio_path:
        audio_path = get_test_audio()

    if not audio_path:
        if args.generate_audio:
            audio_path = generate_test_audio("scripts/test_audio.wav", duration_s=10)
        else:
            print("❌ 未找到测试音频文件")
            print()
            print("使用方法:")
            print("  python scripts/benchmark_asr.py --audio path/to/test.wav")
            print("  python scripts/benchmark_asr.py --generate-audio  # 生成测试音频（仅测延迟）")
            print()
            print("提示: 提供一段包含中文语音的音频文件（10-60s），可同时测试精度和速度")
            sys.exit(1)

    if not os.path.isfile(audio_path):
        print(f"❌ 音频文件不存在: {audio_path}")
        sys.exit(1)

    # 运行基准测试
    results, audio_duration = run_benchmark(audio_path, args.device, args.rounds)

    # 打印汇总
    print_summary(results, audio_duration)

    # 保存结果
    save_results(results, audio_duration, args.output)


if __name__ == "__main__":
    main()
