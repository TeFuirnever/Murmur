# [20260819_T8_ThreadAdapt] Ticket #187 (spec #177 T8): inference thread
# auto-adaptation. Pure-formula unit tests + env override clamping +
# application-point contracts (env set BEFORE any torch import; torch's
# authoritative set_num_threads applied at model load). RED first.
import os
import sys
import unittest

sys.path.insert(
    0,
    os.path.dirname(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    ),
)

os.environ.setdefault("MURMUR_DEVICE", "cpu")

import funasr_server  # noqa: E402
from funasr_server import FunASRServer, compute_inference_threads  # noqa: E402


class ComputeInferenceThreadsTest(unittest.TestCase):
    def test_formula_tiers(self):
        # min(max(1, cores-2), 8) over logical cores: leaves UI headroom on
        # small machines and caps fan/heat on big ones.
        self.assertEqual(compute_inference_threads(1), 1)
        self.assertEqual(compute_inference_threads(2), 1)
        self.assertEqual(compute_inference_threads(4), 2)
        self.assertEqual(compute_inference_threads(8), 6)
        self.assertEqual(compute_inference_threads(16), 8)
        self.assertEqual(compute_inference_threads(64), 8)

    def test_override_within_bounds_wins(self):
        self.assertEqual(compute_inference_threads(16, override="6"), 6)

    def test_override_clamped_to_cores(self):
        self.assertEqual(compute_inference_threads(8, override="32"), 8)

    def test_override_invalid_falls_back_to_formula(self):
        self.assertEqual(compute_inference_threads(8, override="abc"), 6)
        self.assertEqual(compute_inference_threads(8, override="0"), 6)
        self.assertEqual(compute_inference_threads(8, override="-3"), 6)
        self.assertEqual(compute_inference_threads(8, override=None), 6)


class RuntimeEnvironmentTest(unittest.TestCase):
    def setUp(self):
        self._saved = {
            k: os.environ.get(k)
            for k in ("OMP_NUM_THREADS", "MKL_NUM_THREADS", "MURMUR_NUM_THREADS")
        }

    def tearDown(self):
        for key, value in self._saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    def test_env_vars_set_to_computed_value(self):
        os.environ["MURMUR_NUM_THREADS"] = "3"
        server = FunASRServer(damo_root="/tmp/test-damo")
        self.assertEqual(server.inference_threads, 3)
        self.assertEqual(os.environ["OMP_NUM_THREADS"], "3")
        self.assertEqual(os.environ["MKL_NUM_THREADS"], "3")

    def test_no_override_uses_formula(self):
        os.environ.pop("MURMUR_NUM_THREADS", None)
        server = FunASRServer(damo_root="/tmp/test-damo")
        expected = compute_inference_threads(os.cpu_count() or 1)
        self.assertEqual(server.inference_threads, expected)
        self.assertEqual(os.environ["OMP_NUM_THREADS"], str(expected))

    def test_bad_override_falls_back_and_still_sets_env(self):
        os.environ["MURMUR_NUM_THREADS"] = "banana"
        server = FunASRServer(damo_root="/tmp/test-damo")
        expected = compute_inference_threads(os.cpu_count() or 1)
        self.assertEqual(server.inference_threads, expected)


class ApplicationPointContractTest(unittest.TestCase):
    """Source-contract: load-bearing ordering that unit tests can't drive
    without a real torch import (same style as the T6/T7 wiring contracts)."""

    ROOT = os.path.dirname(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    )

    @classmethod
    def source(cls):
        with open(
            os.path.join(cls.ROOT, "funasr_server.py"), encoding="utf-8"
        ) as f:
            return f.read()

    def test_env_setup_runs_before_device_detection(self):
        # _detect_device imports torch when MURMUR_DEVICE is unset — the
        # OMP/MKL env vars are only effective if written BEFORE that import.
        src = self.source()
        init = src[src.index("def __init__") : src.index("def _setup_runtime_environment")]
        setup_idx = init.index("_setup_runtime_environment()")
        detect_idx = init.index("_detect_device()")
        self.assertLess(
            setup_idx,
            detect_idx,
            "thread env must be set before device detection (torch import)",
        )

    def test_torch_set_num_threads_applied_at_model_load(self):
        src = self.source()
        init_body = src[src.index("def initialize") : src.index("def run")]
        self.assertIn("self._apply_torch_thread_limit()", init_body)


class ApplyTorchThreadLimitTest(unittest.TestCase):
    def test_calls_torch_with_computed_value(self):
        import types

        calls = []
        fake_torch = types.ModuleType("torch")
        fake_torch.set_num_threads = lambda n: calls.append(n)
        real_torch = sys.modules.get("torch")
        sys.modules["torch"] = fake_torch
        try:
            server = FunASRServer(damo_root="/tmp/test-damo")
            server._apply_torch_thread_limit()
        finally:
            if real_torch is not None:
                sys.modules["torch"] = real_torch
            else:
                sys.modules.pop("torch", None)
        self.assertEqual(calls, [server.inference_threads])


if __name__ == "__main__":
    unittest.main()
