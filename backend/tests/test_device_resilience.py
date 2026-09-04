import threading
import time
from unittest.mock import patch

from backend.app.audio.alsa import ALSADevice, match_alsa_device
from backend.app.audio.device_resolver import AudioDeviceIdentity, resolve_configured_device
from backend.app.audio.engine import MainAudioEngine
from backend.app.config.settings import AppConfig


def device(index, name, card_id=None):
    return {"id": index, "name": name, "hostapi": "ALSA", "max_input_channels": 2,
            "default_samplerate": 48000, "alsa_card_id": card_id, "alsa_device": 0}


def test_resolver_follows_same_device_to_new_portaudio_id():
    expected = AudioDeviceIdentity.from_device(device(8, "USB Audio CODEC", "CODEC"))
    resolved, matched = resolve_configured_device([device(11, "USB Audio CODEC", "CODEC")], 8, expected)
    assert matched and resolved["id"] == 11


def test_resolver_rejects_reused_id_and_finds_expected_device():
    expected = AudioDeviceIdentity.from_device(device(8, "USB Audio CODEC", "CODEC"))
    fresh = [device(8, "Built-in Mic", "PCH"), device(11, "USB Audio CODEC", "CODEC")]
    resolved, _ = resolve_configured_device(fresh, 8, expected)
    assert resolved["id"] == 11


def test_resolver_does_not_guess_ambiguous_name():
    expected = AudioDeviceIdentity(name="USB Audio CODEC")
    resolved, matched = resolve_configured_device(
        [device(10, "USB Audio CODEC"), device(11, "USB Audio CODEC")], 8, expected)
    assert resolved is None and not matched


def test_live_setting_does_not_restart_capture(tmp_path):
    engine = MainAudioEngine(AppConfig(device_id=8, device_name="USB"), str(tmp_path))
    engine._is_running = True
    with patch.object(engine, "stop") as stop, patch.object(engine, "start") as start:
        engine.update_config(engine.config.model_copy(update={"input_gain": 2.0}))
    stop.assert_not_called(); start.assert_not_called()


def test_live_gain_does_not_reconfigure_detection(tmp_path):
    engine = MainAudioEngine(AppConfig(device_id=8, device_name="USB"), str(tmp_path))
    engine._is_running = True
    with patch.object(engine, "_configure_detection_pipeline") as configure, \
            patch.object(engine, "stop") as stop, patch.object(engine, "start") as start:
        engine.update_config(engine.config.model_copy(update={"input_gain": 2.0}))
    configure.assert_not_called(); stop.assert_not_called(); start.assert_not_called()


def test_vad_setting_reconfigures_detection_without_capture_restart(tmp_path):
    engine = MainAudioEngine(AppConfig(device_id=8, device_name="USB"), str(tmp_path))
    engine._is_running = True
    with patch.object(engine, "_configure_detection_pipeline") as configure, \
            patch.object(engine, "stop") as stop, patch.object(engine, "start") as start:
        engine.update_config(engine.config.model_copy(update={"vad_start_threshold": .55}))
    configure.assert_called_once(); stop.assert_not_called(); start.assert_not_called()


def test_capture_setting_performs_controlled_restart(tmp_path):
    engine = MainAudioEngine(AppConfig(device_id=8, device_name="USB"), str(tmp_path))
    engine._is_running = True
    with patch.object(engine, "stop") as stop, patch.object(engine, "start") as start:
        engine.update_config(engine.config.model_copy(update={"device_id": 11}))
    stop.assert_called_once(); start.assert_called_once()


def test_disconnect_finalizes_recording_and_publishes_stopped_engine(tmp_path):
    engine = MainAudioEngine(AppConfig(device_id=8, device_name="USB"), str(tmp_path))
    source = engine.source = type("Source", (), {"stop": lambda self: None, "is_active": True})()
    engine._is_running = True
    engine._monitor_requested = False
    updates = []
    engine.subscribe(updates.append)
    with patch.object(engine.recorder, "stop_and_flush") as finalize:
        engine._handle_device_disconnect("lost")
    finalize.assert_called_once()
    assert source is engine.source
    assert updates[-1]["engine_running"] is False
    assert updates[-1]["device_connected"] is False
    assert updates[-1]["status"] == "device_disconnected"


def test_telemetry_distinguishes_requested_monitor_from_running_engine(tmp_path):
    engine = MainAudioEngine(AppConfig(device_id=8, device_name="USB"), str(tmp_path))
    engine._monitor_requested = True
    engine._is_running = False
    engine.device_reconnecting = True
    telemetry = engine.get_telemetry()
    assert telemetry["monitor_requested"] is True
    assert telemetry["engine_running"] is False
    assert telemetry["device_reconnecting"] is True
    assert telemetry["selected_device_available"] is False


def test_reconnect_loop_remaps_device_and_clears_error(tmp_path):
    engine = MainAudioEngine(AppConfig(device_id=8, device_name="USB Audio CODEC"), str(tmp_path))
    engine._monitor_requested = True
    engine.current_error = "Audio device disconnected"
    attempts = []

    def start():
        attempts.append(True)
        if len(attempts) < 3:
            return False
        engine.resolved_device_id = 11
        engine.resolved_device_name = "USB Audio CODEC"
        engine._is_running = True
        engine.current_status = "listening"
        return True

    with patch.object(engine, "start", side_effect=start), patch("time.sleep"):
        engine._reconnect_loop()
    assert len(attempts) == 3
    assert engine.resolved_device_id == 11
    assert engine._is_running is True
    assert engine.device_reconnecting is False
    assert engine.current_error is None


def test_stop_during_reconnect_prevents_stream_reopen(tmp_path):
    engine = MainAudioEngine(AppConfig(device_id=8, device_name="USB Audio CODEC"), str(tmp_path))
    engine._monitor_requested = True
    attempted = threading.Event()

    def failed_start():
        attempted.set()
        return False

    with patch.object(engine, "start", side_effect=failed_start):
        thread = threading.Thread(target=engine._reconnect_loop)
        engine._reconnect_thread = thread
        thread.start()
        assert attempted.wait(timeout=3)
        engine.stop()
        thread.join(timeout=3)
    assert engine._monitor_requested is False
    assert not thread.is_alive()
    assert engine._is_running is False


def test_alsa_prefers_stable_card_id_and_remaps_card_number():
    devices = [ALSADevice(3, 0, "CODEC", "USB Audio CODEC"), ALSADevice(0, 0, "PCH", "Built-in")]
    with patch("backend.app.audio.alsa.list_alsa_devices", return_value=devices):
        assert match_alsa_device("irrelevant old name", "CODEC", 0).identifier == "plughw:3,0"


def test_alsa_ambiguous_name_is_not_guessed():
    devices = [ALSADevice(2, 0, "A", "USB Audio"), ALSADevice(3, 0, "B", "USB Audio")]
    with patch("backend.app.audio.alsa.list_alsa_devices", return_value=devices):
        assert match_alsa_device("USB Audio") is None
