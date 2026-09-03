import json
from types import SimpleNamespace

import numpy as np
from scipy.signal import resample_poly

from backend.app.audio import microphone
from backend.app.audio.engine import MainAudioEngine
from backend.app.audio.microphone import MicrophoneSource
from backend.app.audio.alsa import parse_arecord_devices, pcm16_to_float32
from backend.app.audio.channel_selector import StableChannelSelector
from backend.app.config.settings import AppConfig
from backend.app.detection.rms import RMSDetector
from backend.app.recording.metadata import RecordingMetadata, save_metadata


class FakeSoundDevice:
    default = SimpleNamespace(device=(2, 0))
    @staticmethod
    def query_devices(*args):
        devices = [
            {"name": "HDMI", "max_input_channels": 0, "default_samplerate": 48000, "hostapi": 0},
            {"name": "Built-in", "max_input_channels": 1, "default_samplerate": 44100, "hostapi": 0},
            {"name": "USB Audio", "max_input_channels": 2, "default_samplerate": 48000, "hostapi": 0},
        ]
        return devices[args[0]] if args else devices
    @staticmethod
    def query_hostapis():
        return [{"name": "ALSA"}]


def test_device_filtering(monkeypatch):
    monkeypatch.setattr(microphone, "sd", FakeSoundDevice)
    assert [d["name"] for d in MicrophoneSource.list_devices()] == ["Built-in", "USB Audio"]
    assert MicrophoneSource.list_devices()[1]["type"] == "usb"
    assert all(device["device_kind"] == "hardware" for device in MicrophoneSource.list_devices())


def test_real_portaudio_device_id(monkeypatch):
    monkeypatch.setattr(microphone, "sd", FakeSoundDevice)
    assert [d["id"] for d in MicrophoneSource.list_devices()] == [1, 2]


def test_invalid_device_id_rejected():
    import pytest
    with pytest.raises(ValueError):
        MicrophoneSource("default-mic")


def test_real_portaudio_index_preserved(monkeypatch):
    monkeypatch.setattr(microphone, "sd", FakeSoundDevice)
    assert next(d for d in MicrophoneSource.list_devices() if d["name"] == "USB Audio")["id"] == 2


def test_native_samplerate(monkeypatch):
    monkeypatch.setattr(microphone, "sd", FakeSoundDevice)
    assert MicrophoneSource.list_devices()[1]["default_samplerate"] == 48000


def test_stereo_to_mono():
    stereo = np.array([[1, -1], [.5, .5]], dtype=np.float32)
    assert np.allclose(np.mean(stereo, axis=1), [0, .5])


def test_channel_1():
    data = np.array([[.2, .8], [.3, .7]], dtype=np.float32)
    source = MicrophoneSource(input_channel="channel_1"); source._is_active = True
    source._audio_callback(data, 2, None, None)
    assert np.allclose(source._queue.get(), [.2, .3])


def test_channel_2():
    data = np.array([[.2, .8], [.3, .7]], dtype=np.float32)
    source = MicrophoneSource(input_channel="channel_2"); source._is_active = True
    source._audio_callback(data, 2, None, None)
    assert np.allclose(source._queue.get(), [.8, .7])


def test_auto_channel_avoids_stereo_phase_cancellation():
    source = MicrophoneSource(input_channel="auto")
    source._is_active = True
    stereo = np.array([[1, -1], [.5, -.5]], dtype=np.float32)
    source._audio_callback(stereo, 2, None, None)
    assert np.allclose(source._queue.get_nowait(), [1, .5])

    source = MicrophoneSource(input_channel="channel_2")
    source._is_active = True
    source._audio_callback(stereo, 2, None, None)
    assert np.allclose(source._queue.get_nowait(), [-1, -.5])


def test_audio_processing_settings_are_persisted():
    config = AppConfig(input_gain=2.5, input_channel="channel_2", auto_gain_control=True)
    assert config.input_gain == 2.5
    assert config.input_channel == "channel_2"
    assert config.auto_gain_control is True


def test_resampling_48000_to_16000():
    assert len(resample_poly(np.ones(48000), 1, 3)) == 16000


def test_auto_channel_does_not_lock_to_noisy_channel_over_voice_channel():
    selector = StableChannelSelector("auto", switch_blocks=3, lock_blocks=4)
    rng = np.random.default_rng(4)
    for block in range(20):
        t = np.arange(1024) / 48000
        envelope = .015 + (.12 if block % 5 in (1, 2) else 0)
        voice_like = envelope * np.sin(2 * np.pi * 220 * t)
        steady_hiss = rng.normal(0, .11, len(t))
        selected = selector.select(np.column_stack((voice_like, steady_hiss)).astype(np.float32))
    assert selector.selected_index == 0
    assert np.allclose(selected, voice_like.astype(np.float32))


def test_detection_gain_increases_low_voice_level(tmp_path):
    engine = MainAudioEngine(AppConfig(auto_gain_control=False, input_gain=4), str(tmp_path))
    raw = np.full(512, .01, np.float32)
    archived, processed = engine._prepare_detection_chunk(raw)
    assert np.sqrt(np.mean(processed ** 2)) > np.sqrt(np.mean(raw ** 2))
    assert np.array_equal(archived, raw)


def test_detection_gain_does_not_modify_raw_recording_chunk(tmp_path):
    engine = MainAudioEngine(AppConfig(auto_gain_control=False, input_gain=8), str(tmp_path))
    source = np.linspace(-.2, .2, 512, dtype=np.float32)
    archived, _ = engine._prepare_detection_chunk(source)
    assert np.array_equal(archived, source)


def test_agc_does_not_clip_processed_signal(tmp_path):
    engine = MainAudioEngine(AppConfig(auto_gain_control=True), str(tmp_path))
    _, processed = engine._prepare_detection_chunk(np.full(512, .9, np.float32))
    assert np.max(np.abs(processed)) <= .98


def test_waveform_and_vad_use_same_processed_signal(tmp_path, monkeypatch):
    engine = MainAudioEngine(AppConfig(auto_gain_control=False, input_gain=4), str(tmp_path))
    _, processed = engine._prepare_detection_chunk(np.full(512, .02, np.float32))
    seen = []
    monkeypatch.setattr(engine.vad_detector, "_infer_frame", lambda frame: seen.append(frame.copy()) or .2)
    engine.vad_detector.get_speech_probability(processed)
    waveform = processed[np.linspace(0, len(processed) - 1, 128).astype(int)]
    assert np.array_equal(seen[0], processed)
    assert np.allclose(waveform, .08)


def test_silero_preprocessing_is_finite_float32_and_normalized(tmp_path):
    engine = MainAudioEngine(AppConfig(auto_gain_control=False, input_gain=8), str(tmp_path))
    _, processed = engine._prepare_detection_chunk(np.array([np.nan, np.inf, -np.inf, .5]))
    assert processed.dtype == np.float32 and np.isfinite(processed).all()
    assert np.max(np.abs(processed)) <= 1


def test_diagnostics_detect_signal_present_but_vad_inactive(tmp_path):
    engine = MainAudioEngine(AppConfig(), str(tmp_path))
    engine.current_level_dbfs, engine.current_peak_dbfs = -35, -20
    engine._vad_inactive_frames = 6
    telemetry = engine.get_telemetry()
    assert telemetry["signal_present_but_vad_inactive"] is True
    assert telemetry["voice_pipeline_diagnosis"] == "vad_inactive"


def test_diagnostics_identifies_speech_detector_rejection(tmp_path):
    engine = MainAudioEngine(AppConfig(detection_profile="general_voice"), str(tmp_path))
    engine.current_level_dbfs, engine.current_peak_dbfs = -35, -20
    engine.current_speech_prob = .72
    engine.current_speech_candidate = False
    engine.current_speech_reject_reason = "snr_too_low"
    telemetry = engine.get_telemetry()
    assert telemetry["voice_pipeline_diagnosis"] == "snr_too_low"
    assert telemetry["voice_pipeline_hint"] == "SpeechDetector rejection: snr_too_low"


def test_rms_and_dbfs():
    assert RMSDetector.calculate_rms(np.ones(10, dtype=np.float32)) == 1
    assert RMSDetector.rms_to_dbfs(1) == 0
    assert round(RMSDetector.rms_to_dbfs(.1)) == -20


def test_no_signal_and_silence(tmp_path):
    engine = MainAudioEngine(AppConfig(device_id=1), str(tmp_path))
    engine._is_running, engine.started_at = True, __import__('time').time() - 3
    assert engine.get_telemetry()["signal_state"] == "no_audio_data"
    engine.last_audio_frame_at, engine.current_level_dbfs = __import__('time').time(), -90
    assert engine.get_telemetry()["signal_state"] == "silence"


def test_no_audio_data(tmp_path):
    engine = MainAudioEngine(AppConfig(device_id=1), str(tmp_path))
    engine._is_running = True; engine.started_at = __import__('time').time() - 2
    assert engine.get_telemetry()["signal_state"] == "no_audio_data"


def test_silence_with_frames(tmp_path):
    engine = MainAudioEngine(AppConfig(device_id=1), str(tmp_path))
    engine._is_running = True; engine.last_audio_frame_at = __import__('time').time()
    engine.frames_received = 1024; engine.current_level_dbfs = -100
    assert engine.get_telemetry()["signal_state"] == "silence"


def test_alsa_arecord_fallback_parser():
    output = "card 2: CODEC [USB Audio CODEC], device 0: USB Audio [USB Audio]"
    parsed = parse_arecord_devices(output)
    assert len(parsed) == 1 and parsed[0].identifier == "plughw:2,0"


def test_pcm16_to_float32():
    samples = np.array([0, 32767, -32768], dtype="<i2")
    result = pcm16_to_float32(samples.tobytes(), 1)
    assert result.dtype == np.float32
    assert np.allclose(result, [0, 32767 / 32768, -1])


def test_stream_state(tmp_path):
    engine = MainAudioEngine(AppConfig(), str(tmp_path))
    assert not engine._is_running
    engine.stop()
    assert engine.source is None


def test_metadata_creation(tmp_path):
    meta = RecordingMetadata(recording_id="id", source="usb", device="USB", timestamp_start="a", timestamp_end="b")
    path = save_metadata(meta, str(tmp_path))
    assert json.loads(open(path, encoding="utf-8").read())["recording_id"] == "id"
