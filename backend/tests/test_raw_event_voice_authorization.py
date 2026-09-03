from types import SimpleNamespace

import numpy as np

from backend.app.audio.engine import MainAudioEngine
from backend.app.config.settings import AppConfig
from backend.app.detection.audio_event_gate import AudioEventGate
from backend.app.recording.recorder import AudioRecorderEngine


FRAME = 1024


def test_confirmed_voice_records_even_if_event_gate_is_inactive(tmp_path):
    recorder = AudioRecorderEngine(AppConfig(), str(tmp_path))
    _status, voice, recording = recorder.process_frame(
        np.full(FRAME, .01, np.float32), -41, .92,
        speech_confirmed=True, event_active=False)
    assert voice and recording


def test_quiet_confirmed_voice_is_not_blocked_by_level_gate(tmp_path):
    event = AudioEventGate(start_margin_db=8).process(-41, -46)
    recorder = AudioRecorderEngine(AppConfig(), str(tmp_path))
    _status, voice, recording = recorder.process_frame(
        np.full(FRAME, .009, np.float32), -41, .90,
        speech_confirmed=True, event_active=event.event_active)
    assert not event.event_active
    assert voice and recording


def test_confirmed_voice_without_event_still_gets_preroll(tmp_path):
    recorder = AudioRecorderEngine(
        AppConfig(preroll_seconds=1.5, auto_trim_silence=False), str(tmp_path))
    prefix = np.full(FRAME, .003, np.float32)
    recorder.process_frame(prefix, -50, .02, speech_confirmed=False, event_active=False)
    recorder.process_frame(np.full(FRAME, .009, np.float32), -41, .90,
                           speech_confirmed=True, event_active=False)
    assert np.array_equal(recorder.recorded_chunks[0], prefix)


def test_event_gate_uses_raw_level_not_agc_processed_level(tmp_path):
    engine = MainAudioEngine(AppConfig(auto_gain_control=True), str(tmp_path))
    engine._raw_ambient_levels.extend([-55.0] * 20)
    raw = np.full(FRAME, 10 ** (-43 / 20), np.float32)
    _archive, processed = engine._prepare_detection_chunk(raw)
    processed_dbfs = engine.rms_detector.process_chunk(processed)[1]
    event = engine.event_gate.process(engine.raw_level_dbfs, engine._raw_ambient_baseline(-43))
    assert event.event_active
    assert engine.raw_level_dbfs != round(processed_dbfs, 1)


def test_raw_archive_processed_vad_and_raw_gate_are_separate(tmp_path):
    engine = MainAudioEngine(AppConfig(auto_gain_control=False, input_gain=4), str(tmp_path))
    raw_input = np.full(FRAME, .01, np.float32)
    archive, detection = engine._prepare_detection_chunk(raw_input)
    engine._raw_ambient_levels.extend([-60.0] * 20)
    event = engine.event_gate.process(engine.raw_level_dbfs, engine._raw_ambient_baseline(-40))
    recorder = AudioRecorderEngine(AppConfig(), str(tmp_path / "recordings"))
    recorder.process_frame(archive, engine.raw_level_dbfs, .9,
                           speech_confirmed=True, event_active=event.event_active)
    assert np.array_equal(archive, raw_input)
    assert np.allclose(detection, raw_input * 4)
    assert np.array_equal(recorder.recorded_chunks[-1], raw_input)
    assert event.level_dbfs == engine.raw_level_dbfs


def test_calibration_result_changes_event_gate_margin_or_threshold(tmp_path):
    engine = MainAudioEngine(AppConfig(noise_margin_db=8), str(tmp_path))
    before = engine.event_gate.process(-46, -55).event_active
    result = {"noise_floor_dbfs": -55.0, "recommended_threshold_dbfs": -43.0}
    result["margin_db"] = result["recommended_threshold_dbfs"] - result["noise_floor_dbfs"]
    engine.update_config(AppConfig(noise_margin_db=result["margin_db"]))
    after = engine.event_gate.process(-46, -55).event_active
    assert before and not after


def test_effective_confirmation_is_exact_confirmed_voice_alias(tmp_path):
    engine = MainAudioEngine(AppConfig(cold_start_vad_threshold=.99), str(tmp_path))
    decision = SimpleNamespace(speech_confirmed=True, is_candidate=True)
    assert engine._effective_confirmation(decision, .5)
    assert engine.effective_speech_confirmed


def quiet_decision():
    return SimpleNamespace(is_candidate=False, speech_confirmed=False)


def voice_decision():
    return SimpleNamespace(is_candidate=True, speech_confirmed=True)


def test_raw_ambient_bootstrap_ignores_voice_frames(tmp_path):
    engine = MainAudioEngine(AppConfig(), str(tmp_path))
    for probability in (.80, .90, .70):
        engine._learn_raw_ambient(-28, probability, voice_decision(), event_active=True)
    assert not engine._raw_ambient_levels

    for _ in range(8):
        engine._learn_raw_ambient(-58, .02, quiet_decision(), event_active=False)
    assert len(engine._raw_ambient_levels) == 8
    assert engine.raw_noise_floor_dbfs == -58


def test_voice_immediately_after_start_is_not_learned_as_ambient(tmp_path):
    engine = MainAudioEngine(AppConfig(), str(tmp_path))
    decision = voice_decision()
    engine._learn_raw_ambient(-25, .90, decision, event_active=True)
    authorized = engine._effective_confirmation(decision, .90)
    _status, voice, recording = engine.recorder.process_frame(
        np.full(FRAME, .05, np.float32), -25, .90,
        speech_confirmed=authorized, event_active=True,
    )
    assert not engine._raw_ambient_levels
    assert authorized and voice and recording
