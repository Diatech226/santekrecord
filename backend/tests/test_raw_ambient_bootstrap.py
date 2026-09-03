from types import SimpleNamespace

import numpy as np

from backend.app.audio.engine import MainAudioEngine
from backend.app.config.settings import AppConfig


FRAME = 1024


def quiet_decision():
    return SimpleNamespace(is_candidate=False, speech_confirmed=False)


def voice_decision(confirmed=True):
    return SimpleNamespace(is_candidate=True, speech_confirmed=confirmed)


def feed(engine, levels, probabilities, decisions=None):
    decisions = decisions or [quiet_decision()] * len(levels)
    for level, probability, decision in zip(levels, probabilities, decisions):
        engine._learn_raw_ambient(level, probability, decision, event_active=False)


def test_raw_bootstrap_rejects_voice_vad_ramp_up(tmp_path):
    engine = MainAudioEngine(AppConfig(), str(tmp_path))
    levels = [-29, -28, -28, -27, -28, -28, -27]
    probabilities = [.02, .05, .08, .12, .30, .67, .91]
    decisions = [quiet_decision()] * 4 + [voice_decision(False)] * 2 + [voice_decision()]
    feed(engine, levels, probabilities, decisions)
    assert not engine.raw_ambient_ready
    assert engine.raw_noise_floor_dbfs is None
    assert not engine._raw_ambient_levels


def test_raw_ambient_not_ready_until_verified_quiet_window(tmp_path):
    engine = MainAudioEngine(AppConfig(), str(tmp_path))
    feed(engine, [-58] * 7, [.02] * 7)
    assert not engine.raw_ambient_ready
    assert engine.get_telemetry()["raw_noise_floor_dbfs"] is None


def test_raw_ambient_ready_after_verified_quiet_window(tmp_path):
    engine = MainAudioEngine(AppConfig(), str(tmp_path))
    feed(engine, [-58, -57, -59, -58, -58, -57, -59, -58], [.02] * 8)
    assert engine.raw_ambient_ready
    assert -59 <= engine.raw_noise_floor_dbfs <= -57


def test_voice_records_while_raw_ambient_is_not_ready(tmp_path):
    engine = MainAudioEngine(AppConfig(), str(tmp_path))
    decision = voice_decision()
    authorized = engine._effective_confirmation(decision, .93)
    _, voice, recording = engine.recorder.process_frame(
        np.full(FRAME, .04, np.float32), -28, .93,
        speech_confirmed=authorized, event_active=False,
    )
    assert not engine.raw_ambient_ready
    assert authorized and voice and recording


def test_voice_does_not_pollute_raw_baseline_during_vad_ramp(tmp_path):
    engine = MainAudioEngine(AppConfig(), str(tmp_path))
    levels = [-28, -27, -29, -27, -28, -27]
    probabilities = [.02, .06, .12, .35, .72, .93]
    decisions = [quiet_decision()] * 3 + [voice_decision(False)] * 2 + [voice_decision()]
    feed(engine, levels, probabilities, decisions)
    assert not engine._raw_ambient_levels

    feed(engine, [-58, -57, -59, -58, -58, -57, -59, -58], [.02] * 8)
    assert engine.raw_ambient_ready
    assert -59 <= engine.raw_noise_floor_dbfs <= -57


def test_unstable_low_vad_window_is_not_verified_quiet(tmp_path):
    engine = MainAudioEngine(AppConfig(), str(tmp_path))
    feed(engine, [-34, -28, -33, -27, -35, -29, -34, -28], [.02] * 8)
    assert not engine.raw_ambient_ready
