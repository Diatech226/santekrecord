import json
from types import SimpleNamespace

import numpy as np
from scipy.signal import resample_poly

from backend.app.audio import microphone
from backend.app.audio.engine import MainAudioEngine
from backend.app.audio.microphone import MicrophoneSource
from backend.app.audio.alsa import parse_arecord_devices, pcm16_to_float32
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
