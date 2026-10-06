# [20261001_Fix_414_NoNetworkGuard] Ticket #414 review fixup: regression
# test for the --no-network build path. build_cases(include_network=False)
# crashed with IndexError because the noise/farfield loops indexed the
# AISHELL `usable` list without an include_network guard, while the flag is
# advertised in three places (module docstring, argparse help, and the
# non-darwin refusal message pointing users at --no-network). RED first:
# this test raised IndexError before the guards were added.
#
# Safety: say_to_wav is replaced with a deterministic tone writer (no
# `say`/`ffmpeg` subprocess) and write_flac with a recorder, so the test
# never touches the committed corpus under scripts/asr-corpus/.
import importlib.util
import os
import unittest

import numpy as np
import soundfile as sf

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
)
BUILDER_PATH = os.path.join(REPO_ROOT, "scripts", "build-asr-corpus.py")

# Tone parameters chosen so measure_speech_spans sees one contiguous speech
# span per rendered sentence: 1s of 220Hz sine well above the energy
# threshold, separated by the builder's 900ms synthesized gaps.
TONE_HZ = 220.0
TONE_AMPLITUDE = 0.3

# [20261006_Feat_443_HotwordSubdomainGates] Ticket #443 (spec #412 T4a):
# the builder's hotword domain is split by language — hotword-zh (5 cases,
# hard CER gate) + hotword-en (hw_jedediah, observation-only in the A/B
# compare gate, #412 owner verdict 2026-10-01).
EXPECTED_TTS_ONLY_COUNTS = {
    "accent": 6,
    "codeswitch": 6,
    "hotword-zh": 5,
    "hotword-en": 1,
    "timestamp": 3,
}
NETWORK_DOMAINS = ("real-clean", "noise", "farfield")


def load_builder():
    spec = importlib.util.spec_from_file_location(
        "build_asr_corpus", BUILDER_PATH
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class BuildAsrCorpusNoNetworkTest(unittest.TestCase):
    def test_no_network_builds_only_tts_domains(self):
        module = load_builder()

        def fake_say_to_wav(voice, text, wav_path):
            samples = int(module.SR * 1.0)
            t = np.arange(samples) / module.SR
            tone = TONE_AMPLITUDE * np.sin(2 * np.pi * TONE_HZ * t)
            sf.write(wav_path, tone.astype(np.float32), module.SR,
                     subtype="PCM_16")

        written = []

        def fake_write_flac(name, data):
            written.append(name)
            return os.path.join("/nonexistent", name + ".flac")

        # Patch on the freshly loaded module instance; build_cases looks
        # these up as module globals.
        module.say_to_wav = fake_say_to_wav
        module.write_flac = fake_write_flac
        cases = module.build_cases(include_network=False)

        counts = {}
        for case in cases:
            counts[case["domain"]] = counts.get(case["domain"], 0) + 1
            self.assertIn("reference", case)
            self.assertIn("audio", case)
        self.assertEqual(counts, EXPECTED_TTS_ONLY_COUNTS)
        for domain in NETWORK_DOMAINS:
            self.assertNotIn(domain, counts)
        # Every TTS case must have produced an audio artifact (mocked).
        self.assertEqual(len(written), len(cases))


if __name__ == "__main__":
    unittest.main()
