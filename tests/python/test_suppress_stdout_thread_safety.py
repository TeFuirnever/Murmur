# [20260820_Fix_SuppressStdoutRace] Regression test for a long-latent race
# found by a local `pnpm run dev` smoke: the three model loaders
# (_load_asr_model / _load_vad_model / _load_punc_model) run in PARALLEL
# threads (introduced 2025-09 f21a4c1) and each wraps its AutoModel call in
# suppress_stdout(). The old implementation saved/restored the PROCESS-GLOBAL
# sys.stdout per-thread with no synchronization, so with N threads inside at
# once, each thread's "old" stdout was actually the previous thread's devnull.
# After the threads interleaved their restores, sys.stdout could end up
# pointing at a devnull file that its own `with` had already closed — and the
# very next protocol print (run()'s init_result) died with
# "ValueError: I/O operation on closed file", killing the server process
# AFTER all models had loaded successfully.
#
# The race only manifests when models exist on disk (parallel loaders run);
# CI runners have no models, so the boot smoke could never see it. This test
# makes the interleaving deterministic with a barrier so all threads are
# inside the context simultaneously, then asserts sys.stdout is restored to
# the original object and remains writable.
# [20260820_Fix_SuppressStdoutRace] END
import io
import os
import sys
import threading
import unittest

# funasr_server imports heavy deps lazily, so importing the module for the
# helper is cheap and works with only numpy/soundfile installed. Resolve the
# repo root from this file's location so the suite also works when invoked
# from inside tests/python/ (sibling tests use the same preamble).
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
import funasr_server  # noqa: E402


# Number of concurrent loader threads to simulate (mirrors the 3 real model
# loaders; 4 adds margin so the race window is essentially always hit).
CONCURRENT_THREADS = 4
# Rounds of enter/exit; each round is one barrier-synchronized interleave.
ROUNDS = 20


class TestSuppressStdoutThreadSafety(unittest.TestCase):
    def setUp(self):
        # Capture the real stdout object; tests must leave it untouched.
        self.real_stdout = sys.stdout

    def tearDown(self):
        # Belt and braces: if a test fails mid-way, restore stdout so the
        # test runner itself can keep printing.
        sys.stdout = self.real_stdout

    def test_concurrent_suppress_restores_original_stdout(self):
        """All threads inside simultaneously must not corrupt sys.stdout."""
        for _ in range(ROUNDS):
            # Barrier timeout turns a dead worker into a clean test failure
            # (BrokenBarrierError) instead of hanging CI until job timeout.
            barrier = threading.Barrier(CONCURRENT_THREADS, timeout=10)

            def worker():
                with funasr_server.suppress_stdout():
                    # Wait until EVERY thread is inside the context at the
                    # same time — the exact shape of the parallel model
                    # loading. Without synchronization this window is timing
                    # dependent; the barrier makes it deterministic.
                    barrier.wait()

            threads = [threading.Thread(target=worker) for _ in range(CONCURRENT_THREADS)]
            for t in threads:
                t.start()
            for t in threads:
                t.join()

            self.assertIs(
                sys.stdout,
                self.real_stdout,
                "sys.stdout was not restored to the original object "
                "after concurrent suppress_stdout() exited",
            )

    def test_stdout_writable_after_concurrent_suppress(self):
        """The restored stdout must not be a closed devnull file."""
        for _ in range(ROUNDS):
            barrier = threading.Barrier(CONCURRENT_THREADS, timeout=10)

            def worker():
                with funasr_server.suppress_stdout():
                    barrier.wait()

            threads = [threading.Thread(target=worker) for _ in range(CONCURRENT_THREADS)]
            for t in threads:
                t.start()
            for t in threads:
                t.join()

            # The production failure mode: print() raising
            # "ValueError: I/O operation on closed file" because sys.stdout
            # was a devnull closed by another thread's context exit.
            try:
                sys.stdout.write("")
                sys.stdout.flush()
            except ValueError as e:
                self.fail(f"sys.stdout unusable after concurrent suppress: {e}")

    def test_single_thread_suppress_still_swallows_and_restores(self):
        """Sequential usage (pre-parallel behavior) keeps working."""
        captured = io.StringIO()
        sys.stdout = captured
        try:
            with funasr_server.suppress_stdout():
                # A print inside the context must NOT reach the captured
                # stdout — it goes to the suppression sink.
                print("library noise")
            sys.stdout = self.real_stdout
            self.assertEqual(
                captured.getvalue(),
                "",
                "output leaked past suppress_stdout()",
            )
        finally:
            sys.stdout = self.real_stdout

    def test_same_thread_nested_suppress_restores(self):
        """Nested usage on one thread (import wrap + model wrap) restores."""
        outer_captured = io.StringIO()
        sys.stdout = outer_captured
        try:
            with funasr_server.suppress_stdout():
                with funasr_server.suppress_stdout():
                    print("inner noise")
                # Still suppressed after the inner context exits.
                print("outer noise")
            sys.stdout = self.real_stdout
            self.assertEqual(outer_captured.getvalue(), "")
        finally:
            sys.stdout = self.real_stdout


if __name__ == "__main__":
    unittest.main()
