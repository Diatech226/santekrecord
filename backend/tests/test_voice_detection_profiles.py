import numpy as np

from backend.app.audio.engine import MainAudioEngine
from backend.app.config.settings import AppConfig
from backend.app.detection.speech_detector import SpeechDetector
from backend.app.detection.vad import SileroVADDetector


def decide(profile, vad, snr, frames=3):
    detector = SpeechDetector(.65, .35, 6, 160, 64, profile=profile)
    return [detector.process(vad, -51, -55, snr, snr, .10) for _ in range(frames)][-1]


def test_voice_during_ambient_learning_not_added_to_noise_profile():
    engine = MainAudioEngine(AppConfig(ambient_learning_vad_max=.15))
    before = engine.noise_profile.frames_learned
    if engine.should_learn_ambient(.90):
        engine.noise_profile.update(-30, engine.noise_profile.spectrum(np.ones(1024)))
    assert engine.noise_profile.frames_learned == before


def test_ambient_learning_accumulates_only_non_voice():
    engine = MainAudioEngine(AppConfig(ambient_learning_vad_max=.15))
    learned = sum(1024 for probability in (.8, .05, .7, .02) if engine.should_learn_ambient(probability))
    assert learned == 2048


def test_general_voice_low_snr_high_vad():
    assert decide("general_voice", .90, 1).speech_confirmed


def test_general_voice_normal_conversation():
    assert decide("general_voice", .72, 4).speech_confirmed


def test_radio_room_remains_stricter():
    assert not decide("radio_room", .72, 4).is_candidate


def test_silero_backend_status(monkeypatch, tmp_path):
    class Session:
        def __init__(self, *_args, **_kwargs): pass
    model = tmp_path / "vad.onnx"
    model.write_bytes(b"model")
    monkeypatch.setenv("SILERO_VAD_MODEL", str(model))
    monkeypatch.setattr("backend.app.detection.vad.ort.InferenceSession", Session)
    vad = SileroVADDetector()
    assert vad.diagnostics()["vad_backend"] == "silero_onnx"
    assert vad.diagnostics()["vad_model_loaded"] is True


def test_acoustic_fallback_status(monkeypatch, tmp_path):
    monkeypatch.setenv("SILERO_VAD_MODEL", str(tmp_path / "missing.onnx"))
    monkeypatch.setattr("backend.app.detection.vad.torch", None)
    status = SileroVADDetector().diagnostics()
    assert status["vad_backend"] == "acoustic_fallback"
    assert status["vad_model_loaded"] is False and status["vad_error"]


def test_reject_reason_vad_low():
    assert decide("general_voice", .2, 10).reject_reason == "vad_too_low"


def test_reject_reason_snr_low():
    assert decide("general_voice", .72, 1).reject_reason == "snr_too_low"


def test_profile_switch_changes_detector_behavior():
    assert decide("general_voice", .72, 4).speech_confirmed
    assert not decide("radio_room", .72, 4).speech_confirmed
