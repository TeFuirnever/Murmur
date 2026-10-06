#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
[20261001_Feat_414_AbCorpusHarness] Ticket #414 (spec #412 T3): builds the
real-speech A/B corpus under scripts/asr-corpus/ (audio/*.flac +
manifest.json). The committed corpus is the source of truth; this builder
exists so the set is reproducible and extendable.

Composition (domains, all provenance-labeled in the manifest):
  real-clean  real recorded read speech — AISHELL-1 test split (Apache-2.0),
              fetched row-by-row from the HF mirror AudioLLMs/aishell_1_zh_test
  accent      regional-accented Mandarin TTS (macOS say: Meijia zh_TW,
              Sinji zh_HK) — accent simulation, honestly labeled
  noise       real AISHELL-1 speech + additive noise (babble / pink) at a
              documented SNR
  farfield    real AISHELL-1 speech + synthetic room: RIR convolution +
              6.5kHz LPF + -12dB distance attenuation + noise floor
  codeswitch  mixed zh/en dictation-style sentences (stitched Tingting +
              Samantha renders, and whole-sentence Tingting renders)
  hotword     rare-noun sentences (张晗玥/龚燊/刘翀 class) — the A/B harness
              transcribes each twice (hotword off/on) for the repair rate;
              split by language into hotword-zh / hotword-en (#443, spec
              #412 T4a verdict caliber)
  timestamp   multi-sentence clips with 900ms inter-sentence silence; golden
              boundaries are measured from the constructed waveform (energy
              threshold), independent of any ASR engine

Requirements: macOS with `say` (TTS domains), ffmpeg on PATH, python with
numpy + soundfile (the embedded env works). Network for the AISHELL fetch.
Deterministic: RNG seeded with a fixed constant; HF row offsets are fixed.

Usage:
  python/bin/python3.11 scripts/build-asr-corpus.py            # full build
  python/bin/python3.11 scripts/build-asr-corpus.py --no-network  # TTS-only domains
"""

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.request

import numpy as np
import soundfile as sf

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CORPUS_DIR = os.path.join(ROOT, "scripts", "asr-corpus")
AUDIO_DIR = os.path.join(CORPUS_DIR, "audio")

SR = 16000
SEED = 414
RNG = np.random.default_rng(SEED)

# [20261001_Feat_414_AbCorpusHarness] AISHELL-1 test row offsets, fixed for
# reproducibility. Spread across the 6920-row split so speakers differ.
# 18 bases: 8 real-clean, 6 noise (3 bases × 2 variants), 4 farfield.
AISHELL_DATASET = "AudioLLMs/aishell_1_zh_test"
AISHELL_ROW_OFFSETS = [0, 500, 1000, 1500, 2000, 2600, 3200, 3800,
                       4400, 4900, 5400, 5700, 5900, 6300, 6600, 6750,
                       6820, 6850]
AISHELL_BASE_COUNT = 18
AISHELL_MIN_S, AISHELL_MAX_S = 2.0, 12.0
AISHELL_PROVENANCE = (
    "AISHELL-1 test split (Apache-2.0), fetched from HF mirror "
    "AudioLLMs/aishell_1_zh_test"
)

# --- TTS domain sentence sets (authored; references carry punctuation) ----
ACCENT_SENTENCES = [
    "我们这一季度的重点，是把会议记录的整理时间缩短一半。",
    "这份名单里面有好几个名字，我从来没有见过。",
    "下一版产品要在移动端支持离线转写，对吧？",
]
ACCENT_VOICES = [
    ("Meijia", "zh_TW", "macOS say voice Meijia (zh-TW) — Taiwan-accented Mandarin TTS"),
    ("Sinji", "zh_HK", "macOS say voice Sinji (zh-HK) — Hong Kong-accented Mandarin TTS"),
]

CODESWITCH_STITCHED = [
    # (chinese prefix, english fragment, chinese suffix, full reference)
    ("我们先把", "demo", "跑一遍，再讨论兼容性的问题。",
     "我们先把demo跑一遍，再讨论API的兼容性问题。"),
    ("这份文档里，", "deadline", "定在下周五，负责人是小王。",
     "这份PRD里，deadline定在下周五，owner是小王。"),
    ("帮我查一下进度，顺便预约一个", "one on one", "会议。",
     "帮我查一下OKR的进度，顺便预约一个one-on-one。"),
]
CODESWITCH_TINGTING = [
    ("客户的feedback说要支持dark mode，优先级是P1。",
     "whole-sentence Tingting render (zh speaker reading English words)"),
    ("把这段meeting notes翻译成英文，发给整个team。",
     "whole-sentence Tingting render (zh speaker reading English words)"),
    ("下次standup的时候，同步一下release plan的进展。",
     "whole-sentence Tingting render (zh speaker reading English words)"),
]

# Rare nouns: 张晗玥/龚燊/刘翀 come from the SeACo spike (seaco_spike.py);
# 宓淑娟/笪志远/贠云飞 extend the same class (rare-surname names).
HOTWORD_CASES = [
    ("hw_zhanghanyue", "请把会议纪要发给张晗玥和刘翀。", ["张晗玥", "刘翀"]),
    ("hw_gongshen", "下周由龚燊带队去深圳湾总部。", ["龚燊"]),
    ("hw_jedediah", "这个项目的负责人是Jedediah Kellerberg。", ["Jedediah Kellerberg"]),
    ("hw_mishujuan", "把宓淑娟的工位调整到靠窗的位置。", ["宓淑娟"]),
    ("hw_dazhiyuan", "联系笪志远确认明天的评审时间。", ["笪志远"]),
    ("hw_yunyunfei", "帮我把贠云飞的行程改到周四下午。", ["贠云飞"]),
]

TIMESTAMP_CASES = [
    ("ts_roadmap", [
        "今天我们讨论第三季度的产品路线图。",
        "会议纪要需要在周五之前发给所有参会人员。",
        "下周一上午十点在三号会议室进行评审。",
    ]),
    ("ts_budget", [
        "语音识别的准确率直接影响用户体验。",
        "这个方案的预算超出了原定计划的百分之十五。",
        "客户端支持视窗和苹果双平台运行。",
    ]),
    ("ts_daily", [
        "晚上的航班大概十点半落地。",
        "记得提醒我给客户回电话。",
        "报告的最后一段还需要润色。",
    ]),
]

# Babble sources: unrelated sentences mixed into the noise floor (never
# corpus references themselves).
BABBLE_SENTENCES = [
    "窗外的小猫趴在阳光下面睡觉。",
    "他慢悠悠地泡了一壶龙井茶。",
    "超市门口的桂花开了很香。",
    "周末的市场上人来人往非常热闹。",
    "小朋友们在楼下的院子里跳绳。",
    "雨后的空气特别的清新。",
]

# --- augmentation parameters (documented in the manifest per case) --------
NOISE_VARIANTS = [
    ("babble_snr05", "babble", 5.0),
    ("pink_snr10", "pink", 10.0),
]
FARFIELD_T60_S = 0.35
FARFIELD_LP_HZ = 6500.0
FARFIELD_ATTEN_DB = 12.0
FARFIELD_FLOOR_SNR_DB = 25.0

# --- timestamp clip construction / measurement ----------------------------
TS_LEAD_S = 0.2
TS_GAP_S = 0.9
TS_TAIL_S = 0.2
TS_ENERGY_WINDOW_MS = 20
TS_ENERGY_RATIO = 0.03
TS_MIN_GAP_MS = 400


def sh(cmd, **kw):
    return subprocess.run(cmd, check=True, capture_output=True, **kw)


def say_to_wav(voice, text, wav_path):
    """Render text with a macOS voice, transcode to 16k mono wav via ffmpeg."""
    with tempfile.NamedTemporaryFile(suffix=".aiff", delete=False) as t:
        aiff = t.name
    try:
        sh(["say", "-v", voice, text, "-o", aiff])
        sh(["ffmpeg", "-y", "-loglevel", "error", "-i", aiff,
            "-ar", str(SR), "-ac", "1", "-sample_fmt", "s16", wav_path])
    finally:
        os.unlink(aiff)


def load_audio(path):
    data, sr = sf.read(path, dtype="float64", always_2d=False)
    if data.ndim > 1:
        data = data.mean(axis=1)
    if sr != SR:
        raise RuntimeError(f"unexpected sample rate {sr} in {path}")
    return data


def write_flac(name, data):
    """Write float samples as 16-bit FLAC into the corpus audio dir."""
    os.makedirs(AUDIO_DIR, exist_ok=True)
    out = os.path.join(AUDIO_DIR, name + ".flac")
    clipped = np.clip(data, -1.0, 1.0)
    sf.write(out, clipped.astype(np.float32), SR, subtype="PCM_16",
             format="FLAC")
    return out


def rms(x):
    return float(np.sqrt(np.mean(np.square(x)))) if len(x) else 0.0


def mix_at_snr(speech, noise, snr_db):
    """Scale noise so speech_rms/noise_rms == 10^(snr/20)."""
    noise = np.resize(noise, len(speech))
    s_rms, n_rms = rms(speech), rms(noise)
    if n_rms == 0 or s_rms == 0:
        raise RuntimeError("cannot mix at SNR: zero-energy component")
    target = s_rms / (10 ** (snr_db / 20))
    return speech + noise * (target / n_rms)


def pink_noise(n):
    """FFT-shaped 1/f noise, deterministic via the module RNG."""
    spectrum = RNG.standard_normal(n // 2 + 1) + 1j * RNG.standard_normal(n // 2 + 1)
    freqs = np.fft.rfftfreq(n, 1.0 / SR)
    freqs[0] = freqs[1]
    spectrum /= np.sqrt(freqs)
    x = np.fft.irfft(spectrum, n)
    return x / (np.max(np.abs(x)) + 1e-12) * 0.5


def fft_lowpass(x, cutoff_hz):
    spectrum = np.fft.rfft(x)
    freqs = np.fft.rfftfreq(len(x), 1.0 / SR)
    spectrum[freqs > cutoff_hz] = 0.0
    return np.fft.irfft(spectrum, len(x))


def synthetic_rir():
    """Direct path + exponential-decay tail + one early reflection."""
    length = int(0.25 * SR)
    decay = int(FARFIELD_T60_S / 6.9 * SR)  # exp(-k/decay), T60 = 6.9*tau
    h = RNG.standard_normal(length) * np.exp(-np.arange(length) / decay)
    h[0] = 1.0
    h[int(0.030 * SR)] += 0.3
    return h / np.sqrt(np.sum(np.square(h)))  # unit energy


# datasets-server answers are cached jobs; 5xx happens on cold cache entries
FETCH_ATTEMPTS = 4
FETCH_BACKOFF_S = 5.0


def http_get_json(url, timeout=60):
    last_error = None
    for attempt in range(FETCH_ATTEMPTS):
        try:
            with urllib.request.urlopen(url, timeout=timeout) as resp:
                return json.load(resp)
        except urllib.error.HTTPError as err:
            if err.code < 500:
                raise
            last_error = err
            print(f"  transient {err.code} on {url.rsplit('?', 1)[0]}, retrying…")
            time.sleep(FETCH_BACKOFF_S * (attempt + 1))
    raise last_error


def fetch_aishell_rows(offsets):
    """Fetch (offset, transcript, wav bytes) for each row offset."""
    rows = []
    for offset in offsets:
        url = (
            "https://datasets-server.huggingface.co/rows"
            f"?dataset=AudioLLMs%2Faishell_1_zh_test&config=default&split=test"
            f"&offset={offset}&length=1"
        )
        payload = http_get_json(url)
        row = payload["rows"][0]["row"]
        transcript = row["answer"].strip()
        src = row["context"][0]["src"]
        with urllib.request.urlopen(src, timeout=120) as audio_resp:
            wav_bytes = audio_resp.read()
        rows.append((offset, transcript, wav_bytes))
        print(f"  fetched aishell row {offset}: {transcript[:24]}… ({len(wav_bytes)//1024}KB)")
    return rows


def wav_bytes_to_array(wav_bytes):
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as t:
        t.write(wav_bytes)
        path = t.name
    try:
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as t2:
            conv = t2.name
        try:
            sh(["ffmpeg", "-y", "-loglevel", "error", "-i", path,
                "-ar", str(SR), "-ac", "1", "-sample_fmt", "s16", conv])
            return load_audio(conv)
        finally:
            os.unlink(conv)
    finally:
        os.unlink(path)


def measure_speech_spans(data):
    """Energy-threshold sentence boundaries, engine-independent (used for
    the timestamp golden set: the gaps are synthesized, the measurement only
    reads them back from the waveform)."""
    win = int(SR * TS_ENERGY_WINDOW_MS / 1000)
    n_windows = len(data) // win
    energies = np.array(
        [rms(data[i * win:(i + 1) * win]) for i in range(n_windows)]
    )
    threshold = max(float(np.max(energies)) * TS_ENERGY_RATIO, 1e-4)
    speech = energies > threshold
    spans = []
    start = None
    for i, is_speech in enumerate(speech):
        if is_speech and start is None:
            start = i
        elif not is_speech and start is not None:
            spans.append((start, i))
            start = None
    if start is not None:
        spans.append((start, n_windows))
    # merge spans separated by less than the minimum gap
    merged = []
    for span in spans:
        if merged and (span[0] - merged[-1][1]) * TS_ENERGY_WINDOW_MS < TS_MIN_GAP_MS:
            merged[-1] = (merged[-1][0], span[1])
        else:
            merged.append(span)
    return [
        {"startMs": int(s * TS_ENERGY_WINDOW_MS),
         "endMs": int(e * TS_ENERGY_WINDOW_MS)}
        for s, e in merged
    ]


def build_cases(include_network=True):
    cases = []

    def add(case):
        cases.append(case)

    # ---- 1. real-clean / noise / farfield from AISHELL-1 ----------------
    aishell = []
    if include_network:
        print("fetching AISHELL-1 rows…")
        aishell = fetch_aishell_rows(AISHELL_ROW_OFFSETS)
    usable = []
    for offset, transcript, wav_bytes in aishell:
        data = wav_bytes_to_array(wav_bytes)
        dur = len(data) / SR
        if AISHELL_MIN_S <= dur <= AISHELL_MAX_S:
            usable.append((offset, transcript, data))
        if len(usable) == AISHELL_BASE_COUNT:
            break
    if include_network and len(usable) < AISHELL_BASE_COUNT:
        raise RuntimeError(
            f"only {len(usable)} usable AISHELL clips (need {AISHELL_BASE_COUNT})")

    for idx, (offset, transcript, data) in enumerate(usable[:8]):  # 8 real-clean
        write_flac(f"real_aishell_{offset:04d}", data)
        add({
            "id": f"real_aishell_{offset:04d}",
            "audio": f"audio/real_aishell_{offset:04d}.flac",
            "domain": "real-clean",
            "provenance": f"{AISHELL_PROVENANCE}, row offset {offset}",
            "source": {"dataset": AISHELL_DATASET, "split": "test", "rowOffset": offset},
            "augmentation": None,
            "reference": {"text": transcript, "punctuatedText": None},
            "hotword": None,
            "expectedSegments": None,
        })

    # [20261001_Fix_414_NoNetworkGuard] Review fixup for #414: with
    # include_network=False the AISHELL `usable` list is empty, and the
    # noise/farfield loops below indexed it unconditionally — the
    # --no-network build (advertised in the module docstring, argparse
    # help, and the non-darwin refusal message) crashed 100% with
    # IndexError. Guard both loops like the real-clean slice above, which
    # already no-ops safely on the empty list.
    if include_network:
        # noise: bases 8..11 × 2 variants
        babble_pool = None
        for base_i, variant in [(8, NOISE_VARIANTS[0]), (9, NOISE_VARIANTS[1]),
                                (10, NOISE_VARIANTS[0]), (11, NOISE_VARIANTS[1]),
                                (12, NOISE_VARIANTS[0]), (13, NOISE_VARIANTS[1])]:
            offset, transcript, data = usable[base_i]
            kind, snr = variant[1], variant[2]
            if kind == "babble":
                if babble_pool is None:
                    renders = []
                    for sent in BABBLE_SENTENCES:
                        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as t:
                            w = t.name
                        say_to_wav("Tingting", sent, w)
                        renders.append(load_audio(w) / (rms(load_audio(w)) + 1e-12))
                        os.unlink(w)
                    # overlap 4 talkers at random offsets into 30s of babble
                    babble_pool = np.zeros(SR * 30)
                    for r in renders:
                        start = int(RNG.integers(0, len(babble_pool) - len(r)))
                        babble_pool[start:start + len(r)] += r
                noise = babble_pool
            else:
                noise = pink_noise(len(data))
            mixed = mix_at_snr(data, noise, snr)
            name = f"noise_{kind}_snr{int(snr):02d}_{offset:04d}"
            write_flac(name, mixed)
            add({
                "id": name,
                "audio": f"audio/{name}.flac",
                "domain": "noise",
                "provenance": f"{AISHELL_PROVENANCE} row {offset} + {kind} noise @{snr:.0f}dB SNR",
                "source": {"dataset": AISHELL_DATASET, "split": "test", "rowOffset": offset},
                "augmentation": {"type": f"additive-{kind}", "snrDb": snr},
                "reference": {"text": transcript, "punctuatedText": None},
                "hotword": None,
                "expectedSegments": None,
            })

        # [20261001_Fix_414_NoNetworkGuard] farfield shares the same
        # AISHELL-derived bases — same guard, same rationale as noise.
        # farfield: bases 12..15
        for base_i in range(14, 18):  # 4 farfield bases
            offset, transcript, data = usable[base_i]
            reverbed = np.convolve(data, synthetic_rir())[:len(data)]
            muffled = fft_lowpass(reverbed, FARFIELD_LP_HZ)
            attenuated = muffled * (10 ** (-FARFIELD_ATTEN_DB / 20))
            floored = mix_at_snr(attenuated, pink_noise(len(data)),
                                 FARFIELD_FLOOR_SNR_DB)
            name = f"farfield_sim_{offset:04d}"
            write_flac(name, floored)
            add({
                "id": name,
                "audio": f"audio/{name}.flac",
                "domain": "farfield",
                "provenance": (
                    f"{AISHELL_PROVENANCE} row {offset} + simulated far-field "
                    f"(synthetic RIR T60≈{FARFIELD_T60_S}s, LPF {int(FARFIELD_LP_HZ)}Hz, "
                    f"-{FARFIELD_ATTEN_DB:.0f}dB, noise floor @{FARFIELD_FLOOR_SNR_DB:.0f}dB SNR)"
                ),
                "source": {"dataset": AISHELL_DATASET, "split": "test", "rowOffset": offset},
                "augmentation": {
                    "type": "farfield-sim",
                    "rirT60S": FARFIELD_T60_S,
                    "lowpassHz": FARFIELD_LP_HZ,
                    "attenuationDb": FARFIELD_ATTEN_DB,
                    "floorSnrDb": FARFIELD_FLOOR_SNR_DB,
                },
                "reference": {"text": transcript, "punctuatedText": None},
                "hotword": None,
                "expectedSegments": None,
            })
    # [20261001_Fix_414_NoNetworkGuard] END

    # ---- 2. accent (TTS accent simulation) ------------------------------
    for voice, region, note in ACCENT_VOICES:
        for sent_i, sentence in enumerate(ACCENT_SENTENCES):
            name = f"accent_{region.lower()}_{sent_i:02d}"
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as t:
                w = t.name
            say_to_wav(voice, sentence, w)
            data = load_audio(w)
            os.unlink(w)
            write_flac(name, data)
            add({
                "id": name,
                "audio": f"audio/{name}.flac",
                "domain": "accent",
                "provenance": note,
                "source": None,
                "augmentation": None,
                "reference": {"text": sentence, "punctuatedText": sentence},
                "hotword": None,
                "expectedSegments": None,
            })

    # ---- 3. codeswitch ----------------------------------------------------
    for idx, (zh_pre, en_mid, zh_post, reference) in enumerate(CODESWITCH_STITCHED):
        name = f"cs_stitch_{idx:02d}"
        parts = []
        with tempfile.TemporaryDirectory() as td:
            for part_i, (voice, text) in enumerate([
                ("Tingting", zh_pre), ("Samantha", en_mid), ("Tingting", zh_post),
            ]):
                w = os.path.join(td, f"p{part_i}.wav")
                say_to_wav(voice, text, w)
                parts.append(load_audio(w))
        gap = np.zeros(int(0.25 * SR))
        data = np.concatenate([parts[0], gap, parts[1], gap, parts[2]])
        write_flac(name, data)
        add({
            "id": name,
            "audio": f"audio/{name}.flac",
            "domain": "codeswitch",
            "provenance": "macOS say stitched render (Tingting zh + Samantha en), 250ms phrase gaps",
            "source": None,
            "augmentation": None,
            "reference": {"text": reference, "punctuatedText": reference},
            "hotword": None,
            "expectedSegments": None,
        })
    for idx, (reference, note) in enumerate(CODESWITCH_TINGTING):
        name = f"cs_tts_{idx:02d}"
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as t:
            w = t.name
        say_to_wav("Tingting", reference, w)
        data = load_audio(w)
        os.unlink(w)
        write_flac(name, data)
        add({
            "id": name,
            "audio": f"audio/{name}.flac",
            "domain": "codeswitch",
            "provenance": f"macOS say {note}",
            "source": None,
            "augmentation": None,
            "reference": {"text": reference, "punctuatedText": reference},
            "hotword": None,
            "expectedSegments": None,
        })

    # ---- 4. hotword --------------------------------------------------------
    # [20261006_Feat_443_HotwordSubdomainGates] Ticket #443 (spec #412 T4a):
    # the hotword domain is split by language — hotword-zh (hard CER gate)
    # vs hotword-en (English proper-noun case, observation-only in the A/B
    # compare gate per the #412 owner verdict 2026-10-01). Cases land in the
    # sub-domain matching their material: Latin letters in the reference
    # mean the en sub-domain, exactly like the harness's legacy-report
    # fallback (asr-ab-harness.js hotwordCaseLanguage).
    for name, sentence, terms in HOTWORD_CASES:
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as t:
            w = t.name
        say_to_wav("Tingting", sentence, w)
        data = load_audio(w)
        os.unlink(w)
        write_flac(name, data)
        hotword_domain = (
            "hotword-en" if re.search(r"[A-Za-z]", sentence) else "hotword-zh"
        )
        add({
            "id": name,
            "audio": f"audio/{name}.flac",
            "domain": hotword_domain,
            "provenance": "macOS say Tingting render (rare-noun hotword discrimination, SeACo spike class)",
            "source": None,
            "augmentation": None,
            "reference": {"text": sentence, "punctuatedText": sentence},
            "hotword": {"terms": terms, "hotwordString": " ".join(terms)},
            "expectedSegments": None,
        })

    # ---- 5. timestamp golden set ------------------------------------------
    for name, sentences in TIMESTAMP_CASES:
        renders = []
        with tempfile.TemporaryDirectory() as td:
            for sentence in sentences:
                w = os.path.join(td, f"s{len(renders)}.wav")
                say_to_wav("Tingting", sentence, w)
                renders.append((sentence, load_audio(w)))
        lead = np.zeros(int(TS_LEAD_S * SR))
        gap = np.zeros(int(TS_GAP_S * SR))
        tail = np.zeros(int(TS_TAIL_S * SR))
        data = np.concatenate(
            [lead, renders[0][1]]
            + [part for pair in renders[1:] for part in (gap, pair[1])]
            + [tail]
        )
        spans = measure_speech_spans(data)
        if len(spans) != len(sentences):
            raise RuntimeError(
                f"{name}: measured {len(spans)} spans for {len(sentences)} sentences")
        expected_segments = [
            {"startMs": span["startMs"], "endMs": span["endMs"],
             "text": sentence}
            for span, (sentence, _) in zip(spans, renders)
        ]
        write_flac(name, data)
        add({
            "id": name,
            "audio": f"audio/{name}.flac",
            "domain": "timestamp",
            "provenance": (
                "macOS say Tingting multi-sentence render, "
                f"{int(TS_GAP_S*1000)}ms inter-sentence silence; golden boundaries "
                "measured from the waveform (energy threshold)"
            ),
            "source": None,
            "augmentation": {
                "type": "constructed-timestamp",
                "gapMs": int(TS_GAP_S * 1000),
                "measurement": f"rms>{TS_ENERGY_RATIO}*max per {TS_ENERGY_WINDOW_MS}ms window",
            },
            "reference": {"text": "".join(sentences), "punctuatedText": "".join(sentences)},
            "hotword": None,
            "expectedSegments": expected_segments,
        })

    return cases


DOMAINS = [
    {"id": "real-clean", "label": "真实朗读(干净)",
     "description": "AISHELL-1 test (Apache-2.0) real recorded read speech"},
    {"id": "accent", "label": "口音",
     "description": "regional-accented Mandarin (zh_TW/zh_HK TTS simulation, provenance-labeled)"},
    {"id": "noise", "label": "噪声",
     "description": "real speech + additive babble/pink noise at documented SNR"},
    {"id": "farfield", "label": "远场",
     "description": "real speech + simulated room (synthetic RIR + LPF + attenuation + floor)"},
    {"id": "codeswitch", "label": "中英混说",
     "description": "mixed zh/en dictation sentences (stitched bilingual TTS and whole-sentence zh TTS)"},
    # [20261006_Feat_443_HotwordSubdomainGates] hotword is split by language
    # (hotword-zh hard-gated / hotword-en observation-only, #412 2026-10-01).
    {"id": "hotword-zh", "label": "热词判别(中文)",
     "description": "Chinese rare-noun sentences transcribed twice (hotword off/on) by the harness; hard CER gate",
     "language": "zh"},
    {"id": "hotword-en", "label": "热词判别(英文)",
     "description": "English proper-noun hotword case transcribed twice (hotword off/on); observation-only in the A/B compare gate (#412 owner verdict 2026-10-01)",
     "language": "en"},
    {"id": "timestamp", "label": "时间戳黄金集",
     "description": "multi-sentence clips with waveform-measured golden boundaries"},
]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--no-network", action="store_true",
                        help="skip AISHELL fetch; build only TTS-based domains")
    args = parser.parse_args()
    if sys.platform != "darwin" and not args.no_network:
        print("refusing: TTS domains need macOS `say`; use --no-network elsewhere",
              file=sys.stderr)
        return 2

    cases = build_cases(include_network=not args.no_network)
    manifest = {
        "version": 1,
        "name": "murmur-asr-ab-corpus-v1",
        "description": (
            "Real-speech A/B corpus for spec #412 (torch vs ONNX engine "
            "comparison). Built by scripts/build-asr-corpus.py; composition "
            "documented in docs/research/2026-10-01-asr-ab-corpus-torch-baseline.md."
        ),
        "domains": DOMAINS,
        "generator": {
            "script": "scripts/build-asr-corpus.py",
            "seed": SEED,
            "sampleRateHz": SR,
        },
        "cases": cases,
    }
    os.makedirs(CORPUS_DIR, exist_ok=True)
    out = os.path.join(CORPUS_DIR, "manifest.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
        f.write("\n")
    counts = {}
    for c in cases:
        counts[c["domain"]] = counts.get(c["domain"], 0) + 1
    total_bytes = sum(
        os.path.getsize(os.path.join(CORPUS_DIR, c["audio"]))
        for c in cases
    )
    print(f"manifest: {out}")
    print(f"cases: {len(cases)} | per-domain: {json.dumps(counts, ensure_ascii=False)}")
    print(f"audio total: {total_bytes / 1024 / 1024:.1f}MB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
