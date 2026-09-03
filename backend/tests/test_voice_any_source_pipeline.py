import numpy as np

from backend.app.config.settings import AppConfig
from backend.app.detection.audio_event_gate import AudioEventGate
from backend.app.detection.speech_detector import SpeechDetector
from backend.app.recording.recorder import AudioRecorderEngine


SR = 16000
FRAME = 1024


def _detector():
    return SpeechDetector(.65, .35, 6, 128, 64, "voice_any_source")


def _confirmed(probability=.9, snr=1):
    detector = _detector()
    decision = None
    for _ in range(2):
        decision = detector.process(probability, -45, -58, snr, snr, 0)
    return decision


def test_local_voice_triggers_recording(tmp_path):
    decision = _confirmed()
    recorder = AudioRecorderEngine(AppConfig(), str(tmp_path))
    _, voice, recording = recorder.process_frame(
        np.ones(FRAME) * .01, -40, .9, speech_confirmed=decision.speech_confirmed,
        event_active=True, radio_activity=False)
    assert decision.speech_confirmed and voice and recording


def test_radio_loudspeaker_voice_triggers_recording(tmp_path):
    decision = _confirmed()
    recorder = AudioRecorderEngine(AppConfig(), str(tmp_path))
    _, voice, recording = recorder.process_frame(
        np.ones(FRAME) * .01, -40, .9, speech_confirmed=decision.speech_confirmed,
        event_active=True, radio_activity=True)
    assert decision.speech_confirmed and voice and recording


def test_radio_hiss_does_not_create_voice_recording(tmp_path):
    recorder = AudioRecorderEngine(AppConfig(), str(tmp_path))
    for _ in range(50):
        recorder.process_frame(np.ones(FRAME) * .01, -40, .05,
                               speech_confirmed=False, event_active=True,
                               radio_activity=True)
    recorder.stop_and_flush()
    assert not list(tmp_path.glob("*.wav"))


def test_loud_noise_does_not_create_voice_recording(tmp_path):
    gate = AudioEventGate(frame_ms=64)
    event = gate.process(-35, -58)
    recorder = AudioRecorderEngine(AppConfig(), str(tmp_path))
    recorder.process_frame(np.ones(FRAME) * .1, -35, .02,
                           speech_confirmed=False, event_active=event.event_active)
    recorder.stop_and_flush()
    assert event.event_active and not list(tmp_path.glob("*.wav"))


def test_voice_above_ambient_triggers_vad_analysis_and_recording(tmp_path):
    gate = AudioEventGate(frame_ms=64)
    event = gate.process(-49, -58)
    decision = _confirmed(.81, snr=9)
    recorder = AudioRecorderEngine(AppConfig(), str(tmp_path))
    _, voice, recording = recorder.process_frame(
        np.ones(FRAME) * .004, -49, .81,
        speech_confirmed=decision.speech_confirmed, event_active=event.event_active)
    assert event.event_active and voice and recording


def test_voice_recording_contains_audio_before_vad_confirmation(tmp_path):
    config = AppConfig(preroll_seconds=1.5, minimum_total_speech_ms=50,
                       auto_trim_silence=False)
    recorder = AudioRecorderEngine(config, str(tmp_path))
    prefix = np.full(FRAME, .123, dtype=np.float32)
    recorder.process_frame(prefix, -40, .2, speech_confirmed=False, event_active=True)
    recorder.process_frame(np.full(FRAME, .2), -35, .9,
                           speech_confirmed=True, event_active=True)
    assert np.array_equal(recorder.recorded_chunks[0], prefix)


def test_non_voice_event_buffer_is_discarded(tmp_path):
    recorder = AudioRecorderEngine(AppConfig(), str(tmp_path))
    for _ in range(48):
        status, _, _ = recorder.process_frame(
            np.ones(FRAME), -30, .01, speech_confirmed=False, event_active=True)
    assert status == "event_discarded" and not recorder.is_recording
    assert not list(tmp_path.glob("*.wav"))


def test_event_gate_hysteresis_and_thresholds():
    gate = AudioEventGate(frame_ms=100, end_hold_ms=300)
    start = gate.process(-49, -58)
    assert start.event_active and start.event_start_threshold == -50
    assert gate.process(-53, -58).event_active  # below START, above KEEP
    assert gate.process(-57, -58).event_active
    assert gate.process(-57, -58).event_active
    assert not gate.process(-57, -58).event_active
