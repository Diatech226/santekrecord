from types import SimpleNamespace

import numpy as np

from backend.app.audio.engine import MainAudioEngine
from backend.app.config.settings import AppConfig


def engine(tmp_path, profile="general_voice"):
    result = MainAudioEngine(
        AppConfig(detection_profile=profile, cold_start_vad_threshold=.75),
        recordings_dir=str(tmp_path / "recordings"),
        ambient_profiles_dir=str(tmp_path / "profiles"),
    )
    result.ambient_learning = True
    return result


def decision(speech=True, radio=False):
    return SimpleNamespace(speech_confirmed=speech, radio_activity=radio)


def trigger_recorder(subject, probability=.90, radio=False):
    effective = subject._effective_confirmation(decision(radio=radio), probability)
    return subject.recorder.process_frame(
        np.zeros(1024, np.float32), -30, probability,
        speech_confirmed=effective, radio_activity=radio,
    )


def test_voice_can_start_recording_during_ambient_learning(tmp_path):
    subject = engine(tmp_path)
    learned = subject.noise_profile.frames_learned
    _status, _voice, recording = trigger_recorder(subject)
    assert recording and subject.ambient_learning
    assert subject.noise_profile.frames_learned == learned


def test_general_voice_cold_start_records_immediate_speech(tmp_path):
    _status, voice, recording = trigger_recorder(engine(tmp_path, "general_voice"))
    assert voice and recording


def test_radio_room_cold_start_records_radio_voice(tmp_path):
    status, voice, recording = trigger_recorder(engine(tmp_path, "radio_room"), radio=True)
    assert status == "communication_active" and voice and recording


def test_cold_start_low_vad_does_not_trigger(tmp_path):
    subject = engine(tmp_path)
    _status, _voice, recording = trigger_recorder(subject, probability=.25)
    assert not recording and not subject.effective_speech_confirmed


def test_ambient_learning_resumes_after_cold_start_communication(tmp_path):
    subject = engine(tmp_path)
    trigger_recorder(subject)
    assert subject.ambient_learning_paused_for_voice
    subject.recorder.stop_and_flush()
    subject._effective_confirmation(decision(speech=False), .02)
    assert not subject.ambient_learning_paused_for_voice
    spectrum = subject.noise_profile.spectrum(np.zeros(1024, np.float32))
    subject.noise_profile.update(-60, spectrum)
    subject.ambient_learned_samples += 1024
    assert subject.ambient_learned_samples > 0


def test_cold_start_voice_does_not_contaminate_noise_profile(tmp_path):
    subject = engine(tmp_path)
    before = subject.noise_profile.frames_learned
    trigger_recorder(subject)
    if not subject.ambient_learning_paused_for_voice:
        subject.noise_profile.update(-30, subject.noise_profile.spectrum(np.ones(1024)))
    assert subject.noise_profile.frames_learned == before
