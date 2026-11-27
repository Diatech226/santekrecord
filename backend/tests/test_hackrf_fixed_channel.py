import io
import time
import wave

from fastapi import FastAPI, WebSocket
from fastapi.testclient import TestClient
import numpy as np
import pytest

from backend.app.api import routes
from backend.app.api.websocket import websocket_monitor_endpoint
from backend.app.audio.engine import MainAudioEngine
from backend.app.audio.hackrf import HackRFSource
from backend.app.config.settings import AppConfig
from backend.app.recording.recorder import AudioRecorderEngine


def radio_config():
    return AppConfig(source="hackrf", hackrf_serial="0000aabb", frequency_hz=145_500_000)


def test_fixed_channel_live_and_manual_recording(tmp_path, monkeypatch):
    class QuietHackRF(HackRFSource):
        def start(self):
            self._is_active = True

        def read_chunk(self, chunk_size):
            time.sleep(0.02)
            return np.zeros(chunk_size, dtype=np.float32) if self.is_active else None

    engine = MainAudioEngine(radio_config(), recordings_dir=str(tmp_path))
    monkeypatch.setattr("backend.app.audio.engine.HackRFSource", QuietHackRF)
    monkeypatch.setattr(routes, "save_config", lambda config: config)
    app = FastAPI()
    app.include_router(routes.router)
    app.dependency_overrides[routes.get_engine] = lambda: engine

    @app.websocket("/ws/audio")
    async def audio(websocket: WebSocket):
        await websocket_monitor_endpoint(websocket, engine, audio=True)

    try:
        with TestClient(app) as client:
            started = client.post("/api/monitor/start")
            assert started.status_code == 200
            assert started.json()["applied_frequency_hz"] == 145_500_000
            with client.websocket_connect("/ws/audio") as socket:
                assert client.post("/api/recording/start").json()["manual_recording"]
                assert len(socket.receive_bytes()) == 1024 * 4
                assert len(socket.receive_bytes()) == 1024 * 4
            # Closing the only live audio listener leaves capture running.
            changed = radio_config().model_copy(update={"frequency_hz": 145_600_000})
            assert client.post("/api/monitor/start", json=changed.model_dump()).status_code == 409
            stopped = client.post("/api/recording/stop").json()
            assert not stopped["manual_recording"]
            assert stopped["applied_frequency_hz"] == 145_500_000
            [recording] = client.get("/api/recordings").json()
            assert (recording["frequency_hz"], recording["modulation"], recording["trigger_mode"]) == (
                145_500_000, "NFM", "manual",
            )
            with wave.open(io.BytesIO(client.get(recording["audio_url"]).content)) as saved:
                assert saved.getparams()[:3] == (1, 2, 16000)
                assert saved.getnframes() > 0
            retuned = client.post("/api/monitor/start", json=changed.model_dump())
            assert retuned.json()["applied_frequency_hz"] == 145_600_000
    finally:
        engine.stop()


def test_manual_takeover_keeps_voice_preroll_and_quiet_tail(tmp_path):
    saved = []
    recorder = AudioRecorderEngine(radio_config(), str(tmp_path), lambda meta, path: saved.append((meta, path)))
    lead = np.full(1024, 0.125, dtype=np.float32)
    speech = np.full(1024, 0.25, dtype=np.float32)
    quiet = np.zeros(1024, dtype=np.float32)
    recorder.process_frame(lead, -30, 0, speech_confirmed=False)
    recorder.process_frame(speech, -10, 1, speech_confirmed=True)
    recorder.start_manual()
    for _ in range(170):
        recorder.process_frame(quiet, -90, 0, speech_confirmed=False)
    assert recorder.manual_recording and not saved
    recorder.stop_recording()
    [(meta, path)] = saved
    assert meta.trigger_mode == "voice_then_manual"
    assert meta.frequency_hz == 145_500_000 and meta.modulation == "NFM"
    with wave.open(path) as wav:
        assert wav.getnframes() == 172 * 1024
        pcm = np.frombuffer(wav.readframes(wav.getnframes()), dtype="<i2")
    assert np.all(pcm[:1024] == 4095)
    assert np.all(pcm[1024:2048] == 8191)
    assert not pcm[2048:].any()


def test_absent_hackrf_is_reported_before_opening_worker(monkeypatch):
    monkeypatch.setattr("backend.app.audio.hackrf.list_hackrf_devices", lambda: [])
    source = HackRFSource("0000aabb", 145_500_000, 16000)
    with pytest.raises(RuntimeError, match="HackRF One absent"):
        source.start()
    assert not source.is_active
