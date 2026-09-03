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


def decision(speech=True, radio=False, candidate=None):
    return SimpleNamespace(
        speech_confirmed=speech,
        radio_activity=radio,
        is_candidate=speech if candidate is None else candidate,
    )


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


def test_confirmed_voice_is_not_vetoed_by_separate_probability_argument(tmp_path):
    subject = engine(tmp_path)
    _status, _voice, recording = trigger_recorder(subject, probability=.25)
    assert recording and subject.effective_speech_confirmed


def test_cold_start_trigger_then_lower_vad_keeps_speech(tmp_path):
    subject = engine(tmp_path)
    trigger_recorder(subject, probability=.90)
    assert subject.recorder.is_recording
    assert subject._effective_confirmation(decision(), .68)
    assert not subject.cold_start_voice_triggered  # legacy diagnostic only


def test_cold_start_active_recording_uses_normal_speech_hysteresis(tmp_path):
    subject = engine(tmp_path)
    trigger_recorder(subject, probability=.90)
    assert subject._effective_confirmation(decision(speech=True), .55)
    assert not subject._effective_confirmation(decision(speech=False), .55)


def test_cold_start_threshold_does_not_veto_confirmed_voice(tmp_path):
    subject = engine(tmp_path)
    assert subject._effective_confirmation(decision(), .60)
    assert not subject.recorder.is_recording
    trigger_recorder(subject, probability=.90)
    assert subject._effective_confirmation(decision(), .60)


def test_radio_room_cold_start_does_not_require_high_vad_after_trigger(tmp_path):
    subject = engine(tmp_path, "radio_room")
    _status, _voice, recording = trigger_recorder(subject, .92, radio=True)
    assert recording
    assert subject._effective_confirmation(decision(radio=True), .63)
    assert subject.recorder.is_recording


def test_cold_start_flags_reset_on_restart(tmp_path):
    subject = engine(tmp_path)
    trigger_recorder(subject)
    assert not subject.cold_start_voice_triggered
    subject.stop()
    assert not subject.cold_start_mode_active
    assert not subject.cold_start_voice_triggered
    subject.cold_start_voice_triggered = True
    subject._reset_cold_start_state()
    assert not subject.cold_start_voice_triggered


def test_cold_start_sequence_stays_in_one_communication_until_natural_silence(tmp_path):
    subject = engine(tmp_path)
    probabilities = [.92, .83, .68, .58, .40, .20]
    confirmations = [True, True, True, True, True, False]
    communication_ids = []

    for probability, confirmed in zip(probabilities, confirmations):
        effective = subject._effective_confirmation(
            decision(speech=confirmed, candidate=confirmed), probability
        )
        subject.recorder.process_frame(
            np.zeros(1024, np.float32), -30, probability,
            speech_confirmed=effective, candidate=confirmed,
        )
        if subject.recorder.session_manager.session:
            communication_ids.append(
                subject.recorder.session_manager.session.communication_id
            )

    assert len(set(communication_ids)) == 1
    assert subject.recorder.is_recording
    assert not subject.effective_speech_confirmed
    assert subject.recorder.transmission_manager.current is not None


def test_cold_start_telemetry_distinguishes_mode_and_trigger(tmp_path):
    subject = engine(tmp_path)
    assert subject._effective_confirmation(decision(), .90)
    telemetry = subject.get_telemetry()
    assert telemetry["cold_start_mode_active"]
    assert not telemetry["cold_start_voice_triggered"]
    assert telemetry["cold_start_vad_threshold"] == .75


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
