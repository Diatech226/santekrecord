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


def test_resolver_matches_same_alsa_card_when_portaudio_name_changes():
    expected = AudioDeviceIdentity.from_device(
        device(8, "USB Audio CODEC: Audio (hw:2,0)", "CODEC"))
    resolved, matched = resolve_configured_device(
        [device(11, "USB Audio CODEC: Audio (hw:3,0)", "CODEC")], 8, expected)
    assert matched is True
    assert resolved["id"] == 11


def test_resolver_does_not_match_different_alsa_card_with_similar_name():
    expected = AudioDeviceIdentity.from_device(device(8, "USB Audio CODEC", "CODEC_A"))
    resolved, matched = resolve_configured_device(
        [device(11, "USB Audio CODEC", "CODEC_B")], 8, expected)
    assert resolved is None
    assert matched is False


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

    def start(*, from_reconnect=False, generation=None):
        attempts.append(True)
        if len(attempts) < 3:
            return False
        engine.resolved_device_id = 11
        engine.resolved_device_name = "USB Audio CODEC"
        engine._is_running = True
        engine.current_status = "listening"
        return True

    with patch.object(engine, "_start_locked", side_effect=start), patch("time.sleep"):
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

    def failed_start(*, from_reconnect=False, generation=None):
        attempted.set()
        return False

    with patch.object(engine, "_start_locked", side_effect=failed_start):
        thread = threading.Thread(target=engine._reconnect_loop)
        engine._reconnect_thread = thread
        thread.start()
        assert attempted.wait(timeout=3)
        engine.stop()
        thread.join(timeout=3)
    assert engine._monitor_requested is False
    assert not thread.is_alive()
    assert engine._is_running is False


def test_disconnect_clears_resolved_device_but_preserves_configured_identity(tmp_path):
    engine = MainAudioEngine(AppConfig(device_id=8, device_name="USB Audio CODEC"), str(tmp_path))
    engine.resolved_device_id = 8
    engine.resolved_device_name = "USB Audio CODEC"
    engine.device_identity_match = True
    engine.source = type("Source", (), {"stop": lambda self: None, "is_active": False})()
    engine._handle_device_disconnect("unplugged")
    telemetry = engine.get_telemetry()
    assert telemetry["configured_device_name"] == "USB Audio CODEC"
    assert telemetry["resolved_device_id"] is None
    assert telemetry["resolved_device_name"] is None
    assert telemetry["selected_device_available"] is False
    assert engine._reconnect_device_id == 8


def test_stop_between_reconnect_check_and_start_never_reopens_stream(tmp_path):
    engine = MainAudioEngine(AppConfig(device_id=8, device_name="USB Audio CODEC"), str(tmp_path))
    engine._monitor_requested = True
    reached_sleep, continue_reconnect = threading.Event(), threading.Event()
    opened = []

    def controlled_sleep(_seconds):
        reached_sleep.set()
        assert continue_reconnect.wait(2)

    with patch("backend.app.audio.engine.time.sleep", side_effect=controlled_sleep), \
            patch.object(engine, "_create_source", side_effect=lambda: opened.append(True)):
        thread = threading.Thread(target=engine._reconnect_loop, args=(engine._monitor_generation,))
        engine._reconnect_thread = thread
        thread.start()
        assert reached_sleep.wait(2)
        stop_thread = threading.Thread(target=engine.stop)
        stop_thread.start()
        # stop() invalidates the generation before waiting for reconnect cleanup.
        deadline = time.monotonic() + 2
        while engine._monitor_requested and time.monotonic() < deadline:
            threading.Event().wait(.01)
        continue_reconnect.set()
        stop_thread.join(2)
        thread.join(2)
    assert not opened
    assert engine._monitor_requested is False
    assert engine._is_running is False


def test_multiple_disconnect_events_create_only_one_reconnect_thread(tmp_path):
    engine = MainAudioEngine(AppConfig(device_id=8, device_name="USB"), str(tmp_path))
    engine._monitor_requested = True
    release = threading.Event()
    with patch.object(engine, "_reconnect_loop", side_effect=lambda generation: release.wait(2)) as loop:
        engine._handle_device_disconnect("lost once")
        first = engine._reconnect_thread
        engine._handle_device_disconnect("lost twice")
        assert engine._reconnect_thread is first
        release.set()
        first.join(2)
    assert loop.call_count == 1


def test_concurrent_start_calls_open_only_one_audio_stream(tmp_path):
    engine = MainAudioEngine(AppConfig(device_id=8, device_name="USB"), str(tmp_path))
    source = type("Source", (), {"start": lambda self: None, "stop": lambda self: None,
                                  "is_active": True, "device_name": "USB"})()
    with patch.object(engine, "_resolve_capture_device"), \
            patch.object(engine, "_create_source", return_value=source) as create, \
            patch.object(engine, "_audio_loop"):
        threads = [threading.Thread(target=engine.start) for _ in range(2)]
        for thread in threads: thread.start()
        for thread in threads: thread.join(2)
        engine.stop()
    assert create.call_count == 1


def test_selected_device_available_requires_running_matching_resolution(tmp_path):
    engine = MainAudioEngine(AppConfig(device_id=8, device_name="USB"), str(tmp_path))
    engine.resolved_device_id = 8
    engine.device_identity_match = True
    for status, running, reconnecting, expected in [
        ("idle", False, False, False), ("opening", False, False, False),
        ("reconnecting", False, True, False), ("listening", True, False, True),
        ("reconnect_failed", False, False, False),
    ]:
        engine.current_status, engine._is_running, engine.device_reconnecting = status, running, reconnecting
        assert engine.get_telemetry()["selected_device_available"] is expected


def test_successful_reconnect_sets_new_resolved_device_id(tmp_path):
    config = AppConfig(device_id=8, device_name="USB Audio CODEC: Audio (hw:2,0)",
                       device_alsa_card_id="CODEC", device_alsa_device=0)
    engine = MainAudioEngine(config, str(tmp_path))
    engine._monitor_requested = True
    engine.device_reconnecting = True
    engine._reconnect_identity = engine._configured_identity()
    engine._reconnect_device_id = 8
    source = type("Source", (), {"start": lambda self: None, "stop": lambda self: None,
                                  "is_active": True, "device_name": "USB Audio CODEC"})()
    with patch("backend.app.audio.engine.MicrophoneSource.list_devices", return_value=[
            device(11, "USB Audio CODEC: Audio (hw:3,0)", "CODEC")]), \
            patch.object(engine, "_create_source", return_value=source), \
            patch.object(engine, "_audio_loop"):
        with engine._capture_lock:
            assert engine._start_locked(from_reconnect=True, generation=engine._monitor_generation)
        assert engine.resolved_device_id == 11
        assert engine.get_telemetry()["selected_device_available"] is True
        engine.stop()


def test_stop_during_device_open_closes_late_source(tmp_path):
    engine = MainAudioEngine(AppConfig(device_id=8, device_name="USB"), str(tmp_path))
    engine._monitor_requested = True
    opening, release, closed = threading.Event(), threading.Event(), threading.Event()

    class SlowSource:
        is_active = True
        device_name = "USB"
        def start(self):
            opening.set()
            assert release.wait(2)
        def stop(self):
            self.is_active = False
            closed.set()

    with patch.object(engine, "_resolve_capture_device"), \
            patch.object(engine, "_create_source", return_value=SlowSource()), \
            patch.object(engine, "_audio_loop"):
        def reconnect_start():
            with engine._capture_lock:
                engine._start_locked(
                    from_reconnect=True, generation=engine._monitor_generation)

        # Exercise the real reconnect start path while its device open is slow.
        reconnect = threading.Thread(target=reconnect_start)
        reconnect.start()
        assert opening.wait(2)
        stopper = threading.Thread(target=engine.stop)
        stopper.start()
        release.set()
        reconnect.join(2)
        stopper.join(2)
    assert closed.is_set()
    assert engine._monitor_requested is False
    assert engine._is_running is False


def test_manual_device_change_cancels_old_reconnect_generation(tmp_path):
    engine = MainAudioEngine(AppConfig(device_id=8, device_name="Old USB"), str(tmp_path))
    engine._monitor_requested = True
    old_generation = engine._monitor_generation
    engine.stop()
    engine.config = engine.config.model_copy(update={"device_id": 21, "device_name": "New USB"})
    source = type("Source", (), {"start": lambda self: None, "stop": lambda self: None,
                                  "is_active": True, "device_name": "New USB"})()
    with patch.object(engine, "_resolve_capture_device"), \
            patch.object(engine, "_create_source", return_value=source), \
            patch.object(engine, "_audio_loop"):
        assert engine.start()
        with engine._capture_lock:
            assert engine._start_locked(
                from_reconnect=True, generation=old_generation) is False
        assert engine._is_running is True
        assert engine.config.device_id == 21
        engine.stop()


def test_alsa_prefers_stable_card_id_and_remaps_card_number():
    devices = [ALSADevice(3, 0, "CODEC", "USB Audio CODEC"), ALSADevice(0, 0, "PCH", "Built-in")]
    with patch("backend.app.audio.alsa.list_alsa_devices", return_value=devices):
        assert match_alsa_device("irrelevant old name", "CODEC", 0).identifier == "plughw:3,0"


def test_alsa_ambiguous_name_is_not_guessed():
    devices = [ALSADevice(2, 0, "A", "USB Audio"), ALSADevice(3, 0, "B", "USB Audio")]
    with patch("backend.app.audio.alsa.list_alsa_devices", return_value=devices):
        assert match_alsa_device("USB Audio") is None
