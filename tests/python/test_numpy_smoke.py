# [20260817_T4_PythonTestRunner] Ticket #180 infrastructure evidence: proves
# the runner resolves an interpreter WITH numpy on the current platform.
# The DSP suite (T6, #185) builds on this guarantee — a missing numpy here
# must fail the gate, not silently skip.
import unittest

import numpy as np


class NumpySmokeTest(unittest.TestCase):
    def test_numpy_array_math(self):
        waveform = np.array([16384, -16384, 0], dtype=np.int16)
        normalized = waveform.astype(np.float32) / 32768.0
        self.assertAlmostEqual(float(normalized.sum()), 0.0)

    def test_numpy_essential_functions(self):
        # RMS + isfinite — the exact primitives the T6 DSP module will use.
        samples = np.ones(160, dtype=np.float32)
        rms = float(np.sqrt(np.mean(np.square(samples))))
        self.assertAlmostEqual(rms, 1.0)
        self.assertTrue(bool(np.all(np.isfinite(samples))))


if __name__ == "__main__":
    unittest.main()
