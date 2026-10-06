# [20261002_T6b_SubChunk] Ticket #419 (spec #412 decision 2): the ONNX path
# has NO torch-style batch_size_s time batching — every generate() call feeds
# the WHOLE input through the encoder in one shot (quadratic attention
# memory), so long meetings would spike to GB-level activations. VAD speech
# regions must therefore be sub-chunked to <=60s before ASR. These tests pin
# the pure region-building contract AND the end-to-end chunking behavior of
# transcribe_file_audio (chunk count, chunk length cap, text concatenation,
# timestamp offsets) with fake funasr_onnx engines.
#
# Stdlib + numpy/soundfile only — engines are faked via sys.modules, mirroring
# test_onnx_engine_switch.py.
import contextlib
import os
import queue
import shutil
import sys
import tempfile
import types
import unittest

sys.path.insert(
    0,
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
)

os.environ.setdefault("MURMUR_DEVICE", "cpu")

import funasr_server  # noqa: E402
from funasr_server import (  # noqa: E402
    FunASRServer,
    ONNX_MODEL_DIR_NAMES,
    build_asr_regions,
)


class SequencedSeaco:
    """funasr_onnx.SeacoParaformer stand-in that emits ONE character per full
    second of the audio it received, with per-char timestamps RELATIVE to the
    chunk start (the real engine's contract). Chunk k marks its chars with
    "abc"[k], so the boundary overlap between adjacent windows becomes
    observable: without dedupe the shared 400ms buffer yields an extra char
    per chunk edge."""

    call_count = 0
    calls = []

    @classmethod
    def reset(cls):
        cls.call_count = 0
        cls.calls = []

    def __init__(self, model_or_dir="<engine>", quantize=False, **kwargs):
        pass

    def __call__(self, samples, hotwords="", **kwargs):
        SequencedSeaco.calls.append(samples)
        marker = "abc"[min(SequencedSeaco.call_count, 2)]
        SequencedSeaco.call_count += 1
        seconds = max(1, -(-len(samples) // 16000))
        return [
            {
                "preds": marker * seconds,
                "timestamp": [
                    [j * 1000, j * 1000 + 500] for j in range(seconds)
                ],
            }
        ]


class FakeSeaco:
    """funasr_onnx.SeacoParaformer stand-in recording per-chunk input."""

    instances = []
    calls = []

    @classmethod
    def reset(cls):
        cls.instances = []
        cls.calls = []

    def __init__(self, model_or_dir="<engine>", quantize=False, **kwargs):
        self.model_or_dir = model_or_dir
        self.quantize = quantize
        FakeSeaco.instances.append(self)

    def __call__(self, samples, hotwords="", **kwargs):
        FakeSeaco.calls.append(samples)
        return [
            {
                "preds": "你好世界",
                "timestamp": [[0, 400], [400, 800], [800, 1200], [1200, 1600]],
            }
        ]


class FakeFsmn:
    """funasr_onnx.Fsmn_vad stand-in.
    [20261006_Fix_421_VadWindowing] The adapter feeds <=60s windows; the
    real engine emits segments RELATIVE to each window it receives, so the
    fake does the same: a voiced window is one segment spanning the slice
    ([0, window_ms]); .segments == [] means silence (no segments). The
    adapter owns the window-start offsets."""

    instances = []
    segments = [[0, 16000]]

    @classmethod
    def reset(cls):
        cls.instances = []
        cls.segments = [[0, 16000]]

    def __init__(self, model_or_dir="<engine>", quantize=False, **kwargs):
        self.model_or_dir = model_or_dir
        FakeFsmn.instances.append(self)

    def __call__(self, samples, **kwargs):
        if not FakeFsmn.segments:
            return [list(FakeFsmn.segments)]
        window_ms = int(len(samples) / 16000.0 * 1000)
        return [[[0, window_ms]]]


class FakeCt:
    def __init__(self, model_or_dir="<engine>", quantize=False, **kwargs):
        self.model_or_dir = model_or_dir

    def __call__(self, text, split_size=20):
        return ("你好，世界。" * 1, None)


@contextlib.contextmanager
def fake_module(name, **attrs):
    module = types.ModuleType(name)
    for attr, value in attrs.items():
        setattr(module, attr, value)
    saved = sys.modules.get(name)
    sys.modules[name] = module
    try:
        yield module
    finally:
        if saved is not None:
            sys.modules[name] = saved
        else:
            sys.modules.pop(name, None)


class NeverAutoModel:
    def __init__(self, *args, **kwargs):
        raise AssertionError("torch AutoModel must not be called")


class BuildAsrRegionsTest(unittest.TestCase):
    """The pure region-builder: merge → VAD-boundary split → hard split."""

    def test_empty_input(self):
        self.assertEqual(build_asr_regions([]), [])

    def test_short_segments_merge_within_gap(self):
        # gap 200ms < 300ms merge gap → one region
        regions = build_asr_regions([[0, 10_000], [10_200, 20_000]])
        self.assertEqual(regions, [[0, 20_000]])

    def test_gap_beyond_merge_threshold_stays_separate(self):
        regions = build_asr_regions([[0, 10_000], [10_500, 20_000]])
        self.assertEqual(regions, [[0, 10_000], [10_500, 20_000]])

    def test_accumulated_boundary_split_keeps_regions_under_cap(self):
        # 10 speech segments of 8s separated by 400ms silences (> merge gap,
        # so each is its own VAD segment): boundary accumulation must keep
        # every region <= 60s without crossing a VAD boundary.
        segs = []
        t = 0
        for _ in range(10):
            segs.append([t, t + 8_000])
            t += 8_000 + 400
        regions = build_asr_regions(segs)
        self.assertGreater(len(regions), 1)
        for rs, re_ in regions:
            self.assertLessEqual(re_ - rs, 60_000)
        # regions never span a VAD boundary (they are unions of whole segs)
        covered = []
        for rs, re_ in regions:
            covered.append((rs, re_))
        self.assertEqual(covered[0][0], 0)
        self.assertEqual(covered[-1][1], t - 400)

    def test_single_continuous_segment_hard_split_into_60s_windows(self):
        # 130s of continuous speech → windows [0,60k],[60k,120k],[120k,130k]
        regions = build_asr_regions([[0, 130_000]])
        self.assertEqual(
            regions, [[0, 60_000], [60_000, 120_000], [120_000, 130_000]]
        )

    def test_hard_split_windows_are_contiguous_and_capped(self):
        regions = build_asr_regions([[5_000, 190_000]])
        self.assertEqual(regions[0][0], 5_000)
        self.assertEqual(regions[-1][1], 190_000)
        for i in range(1, len(regions)):
            # contiguous: no gap, no overlap between consecutive windows
            self.assertEqual(regions[i][0], regions[i - 1][1])
        for rs, re_ in regions:
            self.assertLessEqual(re_ - rs, 60_000)

    def test_mixed_boundary_and_hard_split(self):
        # a 70s single segment followed (after silence) by a 200s one
        regions = build_asr_regions([[0, 70_000], [80_000, 280_000]])
        self.assertEqual(regions[0], [0, 60_000])
        self.assertEqual(regions[1], [60_000, 70_000])
        # second region hard-split from 80s: 60s windows + 20s remainder
        self.assertEqual(regions[2], [80_000, 140_000])
        self.assertEqual(regions[3], [140_000, 200_000])
        self.assertEqual(regions[4], [200_000, 260_000])
        self.assertEqual(regions[5], [260_000, 280_000])


class FilterChunkToRegionTest(unittest.TestCase):
    """Unit contract of the overlap-dedupe filter: each character is owned by
    the region containing its timestamp MIDPOINT, so tiling hard-split windows
    emit every character exactly once."""

    def test_char_assigned_to_region_by_midpoint(self):
        # boundary-spanning char [59900, 60100] (mid 60000) belongs to the
        # SECOND window [60000, 120000), not the first [0, 60000).
        text, ts = funasr_server._filter_chunk_to_region(
            "甲乙", [[59800, 59900], [59900, 60100]], 0, 0, 60_000
        )
        self.assertEqual(text, "甲")
        self.assertEqual(ts, [[59800, 59900]])
        text, ts = funasr_server._filter_chunk_to_region(
            "甲乙", [[59800, 59900], [59900, 60100]], 0, 60_000, 120_000
        )
        self.assertEqual(text, "乙")
        self.assertEqual(ts, [[59900, 60100]])

    def test_offset_applies_before_region_check(self):
        # timestamps are relative to the buffered chunk start: 甲's midpoint
        # lands at 59_950 (owned by the PREVIOUS window), 乙's at 60_350
        text, ts = funasr_server._filter_chunk_to_region(
            "甲乙", [[0, 300], [300, 800]], 59_800, 60_000, 120_000
        )
        self.assertEqual(text, "乙")
        self.assertEqual(ts, [[300, 800]])

    def test_mismatched_chars_beyond_timestamps_dropped(self):
        # timestamps are the authority (same pairing _build_segments_
        # from_timestamps applies); unlocatable chars must not survive —
        # they could be overlap duplicates with no coordinates.
        text, ts = funasr_server._filter_chunk_to_region(
            "甲乙丙", [[0, 400]], 0, 0, 60_000
        )
        self.assertEqual(text, "甲")
        self.assertEqual(len(ts), 1)

    def test_no_timestamps_drops_unlocatable_chars(self):
        # the caller only filters when timestamps exist; with none, no char
        # has coordinates so nothing survives (timestamps are the authority)
        text, ts = funasr_server._filter_chunk_to_region(
            "甲乙", [], 0, 0, 60_000
        )
        self.assertEqual(text, "")
        self.assertEqual(ts, [])


class WindowRecordingFsmn:
    """funasr_onnx.Fsmn_vad stand-in recording each call's input size and
    returning a configurable per-call segment list (the [segments] shape
    the real engine's __call__ emits)."""

    calls = []  # (sample_count, engine_instance_index)
    per_call_segments = [[]]  # one entry per call, cycled

    @classmethod
    def reset(cls):
        cls.calls = []
        cls.per_call_segments = [[]]

    def __init__(self, model_or_dir="<engine>", quantize=False, **kwargs):
        pass

    def __call__(self, samples, **kwargs):
        WindowRecordingFsmn.calls.append(len(samples))
        index = (len(WindowRecordingFsmn.calls) - 1) % len(
            WindowRecordingFsmn.per_call_segments
        )
        return [list(WindowRecordingFsmn.per_call_segments[index])]


class VadWindowingTest(unittest.TestCase):
    """[20261006_Fix_421_VadWindowing] Ticket #421 review: the VAD adapter
    must feed the engine <=60s windows (independent passes with explicit
    window-start offsets) instead of the whole file in one shot — the
    whole-file pass materialized O(audio_length) buffers (~1GB transient
    RSS on a 10-minute file)."""

    def setUp(self):
        WindowRecordingFsmn.reset()

    def _adapter(self):
        return funasr_server.OnnxVadAdapter(
            WindowRecordingFsmn("<engine>", quantize=False)
        )

    def test_long_input_split_into_60s_windows_with_offsets(self):
        import numpy as np

        adapter = self._adapter()
        WindowRecordingFsmn.per_call_segments = [[[0, 500]]]
        samples = np.zeros(16000 * 130, dtype=np.float32)  # 130s

        result = adapter.generate(input=samples)

        # 130s -> 3 windows: 60s + 60s + 10s
        self.assertEqual(
            WindowRecordingFsmn.calls,
            [16000 * 60, 16000 * 60, 16000 * 10],
        )
        # each window's segments offset by its window start (ms)
        self.assertEqual(
            result[0]["value"],
            [[0, 500], [60000, 60500], [120000, 120500]],
        )

    def test_short_input_single_pass_no_offset_change(self):
        import numpy as np

        adapter = self._adapter()
        WindowRecordingFsmn.per_call_segments = [[[100, 900]]]
        samples = np.zeros(16000 * 5, dtype=np.float32)

        result = adapter.generate(input=samples)

        self.assertEqual(WindowRecordingFsmn.calls, [16000 * 5])
        self.assertEqual(result[0]["value"], [[100, 900]])

    def test_window_with_no_segments_is_skipped(self):
        import numpy as np

        adapter = self._adapter()
        # first window silent (no segments), second voiced
        WindowRecordingFsmn.per_call_segments = [[], [[10, 800]]]
        samples = np.zeros(16000 * 130, dtype=np.float32)

        result = adapter.generate(input=samples)

        self.assertEqual(
            result[0]["value"], [[60010, 60800]]
        )

    def test_empty_input_yields_empty_value_without_engine_call(self):
        import numpy as np

        adapter = self._adapter()
        result = adapter.generate(input=np.zeros(0, dtype=np.float32))
        self.assertEqual(result, [{"value": []}])
        self.assertEqual(WindowRecordingFsmn.calls, [])


class TranscribeFileSubChunkTest(unittest.TestCase):
    """End-to-end: a >60s continuous-speech file is transcribed through
    multiple <=60s ASR chunks with correct concatenation and offsets."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self._old_env = {
            key: os.environ.get(key)
            for key in ("MODELSCOPE_CACHE", "HOME", "USERPROFILE",
                        "ELECTRON_USER_DATA")
        }
        os.environ["HOME"] = self._tmp.name
        os.environ["USERPROFILE"] = self._tmp.name
        for key in ("MODELSCOPE_CACHE", "ELECTRON_USER_DATA"):
            os.environ.pop(key, None)
        self.damo_root = os.path.join(self._tmp.name, "damo-root")
        os.makedirs(self.damo_root, exist_ok=True)
        FakeSeaco.reset()
        FakeFsmn.reset()
        self.addCleanup(self._restore_env)

    def _restore_env(self):
        for key, value in self._old_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    def _make_onnx_dir(self, model_key):
        spec = funasr_server.ONNX_PIN_FILE_SPECS[model_key]
        dir_path = os.path.join(
            self.damo_root, "onnx-int8", ONNX_MODEL_DIR_NAMES[model_key]
        )
        os.makedirs(dir_path, exist_ok=True)
        self.addCleanup(shutil.rmtree, dir_path, ignore_errors=True)
        for name, size in spec.items():
            with open(os.path.join(dir_path, name), "wb") as f:
                f.truncate(size)
        return dir_path

    def _load_onnx_models(self, srv):
        self._make_onnx_dir("asr")
        self._make_onnx_dir("vad")
        with fake_module("funasr", AutoModel=NeverAutoModel), fake_module(
            "funasr_onnx", SeacoParaformer=FakeSeaco
        ):
            self.assertTrue(srv._load_asr_model())
        with fake_module("funasr", AutoModel=NeverAutoModel), fake_module(
            "funasr_onnx", Fsmn_vad=FakeFsmn
        ):
            self.assertTrue(srv._load_vad_model())
        srv.initialized = True

    def test_long_continuous_speech_transcribed_in_60s_chunks(self):
        # one giant continuous-speech VAD segment spanning the whole file
        self._run_chunked_transcription([[0, 130_000]])

    def _run_chunked_transcription(self, vad_segments):
        import numpy as np
        import soundfile as sf

        # 130s of 16k mono speech — a length no single ONNX generate() call
        # may see again (decision 2).
        duration_s = 130
        t = np.arange(16000 * duration_s, dtype=np.float64) / 16000.0
        speech = (0.05 * np.sin(2 * np.pi * 300.0 * t)).astype(np.float32)
        tmp = tempfile.NamedTemporaryFile(
            suffix=".wav", delete=False, dir=tempfile.gettempdir()
        )
        sf.write(tmp.name, speech, 16000, subtype="PCM_16")
        tmp.close()
        self.addCleanup(
            lambda: os.path.exists(tmp.name) and os.unlink(tmp.name)
        )

        FakeFsmn.segments = vad_segments

        srv = FunASRServer(damo_root=self.damo_root)
        self._load_onnx_models(srv)
        srv.response_queue = queue.Queue()

        result = srv.transcribe_file_audio(
            tmp.name, {"request_id": "r419"}
        )
        self.assertTrue(result["success"], result)

        # 3 chunks for 130s: [0,60s],[60s,120s],[120s,130s]
        self.assertEqual(len(FakeSeaco.calls), 3)
        # every chunk stays within the 60s cap + the 200ms read buffer
        max_chunk_samples = int((60_000 + 2 * 200) / 1000.0 * 16000)
        for samples in FakeSeaco.calls:
            self.assertLessEqual(len(samples), max_chunk_samples)
        # text from every chunk is concatenated, punc applied once
        self.assertEqual(result["raw_text"], "你好世界" * 3)
        # per-chunk timestamp offsets anchor at each buffered window start
        starts = [seg["start_ms"] for seg in result["raw_segments"]]
        self.assertEqual(len(starts), 3)
        self.assertEqual(starts[0], 0)
        self.assertGreater(starts[1], 55_000)
        self.assertGreater(starts[2], 115_000)
        self.assertTrue(all(
            b >= a for a, b in zip(starts, starts[1:])
        ))

    def test_no_vad_output_still_chunks_the_full_file(self):
        # [20261002_T6b_SubChunk] use_vad=False (or VAD silence): the old
        # fallback fed the WHOLE file to the engine in one shot — the exact
        # full-file single generate() this ticket removes. It must go
        # through the same ≤60s hard split.
        self._run_chunked_transcription([])

    def test_hard_window_overlap_text_appears_exactly_once(self):
        # [20261002_T6b_SubChunk review fix] Adjacent hard-split windows
        # share ±REGION_BUFFER_MS of audio (400ms of identical speech between
        # two 60s windows). The engine receives the overlap in BOTH chunks;
        # the final text must contain every second's char EXACTLY ONCE —
        # the midpoint filter drops each boundary char's duplicate copy.
        import numpy as np
        import soundfile as sf

        duration_s = 130
        t = np.arange(16000 * duration_s, dtype=np.float64) / 16000.0
        speech = (0.05 * np.sin(2 * np.pi * 300.0 * t)).astype(np.float32)
        tmp = tempfile.NamedTemporaryFile(
            suffix=".wav", delete=False, dir=tempfile.gettempdir()
        )
        sf.write(tmp.name, speech, 16000, subtype="PCM_16")
        tmp.close()
        self.addCleanup(
            lambda: os.path.exists(tmp.name) and os.unlink(tmp.name)
        )
        FakeFsmn.segments = [[0, duration_s * 1000]]
        SequencedSeaco.reset()

        srv = FunASRServer(damo_root=self.damo_root)
        self._make_onnx_dir("asr")
        self._make_onnx_dir("vad")
        with fake_module("funasr", AutoModel=NeverAutoModel), fake_module(
            "funasr_onnx", SeacoParaformer=SequencedSeaco
        ):
            self.assertTrue(srv._load_asr_model())
        with fake_module("funasr", AutoModel=NeverAutoModel), fake_module(
            "funasr_onnx", Fsmn_vad=FakeFsmn
        ):
            self.assertTrue(srv._load_vad_model())
        srv.initialized = True
        srv.response_queue = queue.Queue()

        result = srv.transcribe_file_audio(tmp.name, {"request_id": "r419"})
        self.assertTrue(result["success"], result)

        # 3 windows → chunks read [0,60.2s]/[59.8s,120.2s]/[119.8s,130s]:
        # each engine call sees 61/61/11 seconds of audio, but the final
        # text keeps exactly the 130 in-region seconds — one char per
        # second of the file, no duplicates from the shared buffers.
        self.assertEqual(len(SequencedSeaco.calls), 3)
        self.assertEqual(result["raw_text"], "a" * 60 + "b" * 60 + "c" * 10)
        # no leaked neighbor marker anywhere
        self.assertNotIn("a", result["raw_text"][60:])
        self.assertNotIn("b", result["raw_text"][:60])


if __name__ == "__main__":
    unittest.main()
