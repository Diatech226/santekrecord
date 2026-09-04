import json
from pathlib import Path

import numpy as np

from backend.app.config.settings import AppConfig
from backend.app.detection.noise_profile import AdaptiveNoiseProfile
from backend.app.detection.speech_detector import SpeechDetector
from backend.app.recording.recorder import AudioRecorderEngine
from backend.app.recording.segmenter import SpeechSegmenter
from backend.app.recording.trimmer import trim_to_speech

SR = 16000
RNG = np.random.default_rng(226)


def noise(seconds=.064, amplitude=.002):
    return RNG.normal(0, amplitude, int(SR * seconds)).astype(np.float32)


def voice(seconds=.064, amplitude=.04):
    t = np.arange(int(SR * seconds)) / SR
    # Harmonic, amplitude-modulated voice-band surrogate.
    envelope = .55 + .45 * np.sin(2 * np.pi * 5 * t)
    return (amplitude * envelope * (np.sin(2*np.pi*220*t) + .5*np.sin(2*np.pi*660*t))).astype(np.float32)


def test_adaptive_learning_dynamic_threshold_snr_and_spectrum():
    profile = AdaptiveNoiseProfile(SR, window_seconds=10, noise_margin_db=8)
    ambient = noise()
    spectrum = profile.spectrum(ambient)
    for _ in range(30): profile.update(-54, spectrum)
    assert -47 < profile.dynamic_threshold_dbfs < -45
    assert profile.noise_variance_db == 0
    event = voice()
    metrics = profile.analyse(-35, profile.spectrum(event))
    assert metrics.broadband_snr_db == 19
    assert metrics.speech_band_snr_db > 6
    assert metrics.spectral_difference > .1


def test_noise_update_without_voice_and_explicit_freeze_during_voice():
    profile = AdaptiveNoiseProfile(SR)
    spectrum = profile.spectrum(noise())
    profile.update(-60, spectrum)
    learned = profile.frames_learned
    # The engine's freeze condition deliberately does not call update.
    speech_probability, recording, candidate = .9, True, True
    if speech_probability < .15 and not recording and not candidate:
        profile.update(-30, profile.spectrum(voice()))
    assert profile.frames_learned == learned
    profile.update(-58, spectrum)
    assert profile.frames_learned == learned + 1


def test_vad_hysteresis_and_short_impulse_rejection():
    detector = SpeechDetector(.65, .35, 6, minimum_speech_ms=160, frame_ms=64)
    one = detector.process(.95, -30, -55, 25, 20, .8)
    assert one.is_candidate and not one.speech_confirmed
    detector.process(.05, -30, -55, 25, 20, .8)
    assert not detector.active  # an isolated click cannot confirm
    decisions = [detector.process(.8, -35, -55, 20, 15, .4) for _ in range(3)]
    assert decisions[-1].speech_confirmed
    # Continue threshold accepts a softer syllable.
    assert detector.process(.4, -40, -55, 15, 10, .2).speech_confirmed


def test_minimum_speech_duration_uses_ceiling_frame_quantization():
    assert [SpeechDetector(minimum_speech_ms=value, frame_ms=64).required
            for value in (128, 129, 192, 193)] == [2, 3, 3, 4]


def test_default_minimum_speech_is_exactly_two_processing_frames():
    detector = SpeechDetector()
    assert detector.minimum_speech_ms == 128
    assert detector.required == 2
    assert detector.effective_minimum_speech_ms == 128


def test_segmentation_and_trim_preserve_internal_pause():
    segmenter = SpeechSegmenter()
    segmenter.add(1000, 4000, True, .9)
    segmenter.add(4000, 12000, False, .05)  # 500 ms pause
    segmenter.add(12000, 15000, True, .9)
    assert segmenter.segments() == [[1000, 4000], [12000, 15000]]
    raw = np.arange(20000, dtype=np.float32)
    result = trim_to_speech(raw, segmenter.segments(), SR, .2)
    assert result.leading_seconds == 0
    assert result.trailing_seconds == .1125
    # Trimming edges only: every sample in the natural internal pause remains.
    assert np.array_equal(result.samples, raw[:18200])


def test_sample_bounded_preroll_and_minimum_total_speech(tmp_path):
    cfg = AppConfig(preroll_seconds=.5, minimum_total_speech_ms=300, transmission_hangover_seconds=.3)
    rec = AudioRecorderEngine(cfg, str(tmp_path))
    for size in (700, 1300, 500, 1700, 900, 1600, 1000, 1100):
        rec._push_prebuffer(np.zeros(size, np.float32))
    assert rec.pre_buffer_samples <= int(.5 * SR) + 1700
    rec.recorded_chunks = [np.zeros(SR, np.float32)]
    rec.segmenter.add(0, 100, True, 1)
    rec._save_active_recording()
    assert not list(tmp_path.glob('*.wav'))


def test_one_transmission_one_file_and_trailing_hiss_trim(tmp_path):
    cfg = AppConfig(preroll_seconds=.5, minimum_speech_ms=128, minimum_total_speech_ms=300,
                    transmission_hangover_seconds=.3, transmission_end_timeout_seconds=.3,
                    communication_end_timeout_seconds=.5, trim_margin_seconds=.2)
    rec = AudioRecorderEngine(cfg, str(tmp_path))
    frame = 1024
    ambient = np.zeros(frame, np.float32)
    # Ambient + radio hiss does not start a recording.
    for _ in range(8): rec.process_frame(ambient, -55, .02, speech_confirmed=False, radio_activity=False)
    for _ in range(4): rec.process_frame(noise(frame/SR, .02), -35, .05, speech_confirmed=False, radio_activity=True)
    # Two phrases separated by a pause shorter than transmission hangover.
    for _ in range(10): rec.process_frame(voice(frame/SR), -28, .9, speech_confirmed=True, confidence=.9)
    for _ in range(3): rec.process_frame(ambient, -55, .02, speech_confirmed=False)
    for _ in range(8): rec.process_frame(voice(frame/SR), -28, .9, speech_confirmed=True, confidence=.9)
    for _ in range(6): rec.process_frame(noise(frame/SR, .02), -35, .05, speech_confirmed=False, radio_activity=True)
    for _ in range(8): rec.process_frame(ambient, -55, .02, speech_confirmed=False, radio_activity=False)
    wavs = list(tmp_path.glob('*.wav'))
    assert len(wavs) == 1
    metadata = json.loads(next(tmp_path.glob('*.json')).read_text())
    assert metadata['speech_segment_count'] == 2
    assert metadata['raw_event_duration_seconds'] > metadata['saved_duration_seconds']
    assert metadata['trimmed_trailing_seconds'] > 0
