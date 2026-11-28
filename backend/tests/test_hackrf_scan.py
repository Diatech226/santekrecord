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


START = 145_500_000
CARRIER = 145_512_500
FINAL = 145_525_000
SERIAL = "0000aabb"


class SimulatedHackRF(HackRFSource):
    def start(self):
        self._is_active = True
        self.tuned = [self.frequency_hz]
        self.transition_frames = 0
        self.frames = 0
        self.voice = False
        self.carrier = True
        self.unplugged = False

    def retune(self, frequency_hz):
        self.frequency_hz = frequency_hz
        self.tuned.append(frequency_hz)
        self.transition_frames = 3

    def read_chunk(self, chunk_size):
        time.sleep(0.005)
        if self.unplugged:
            raise OSError("périphérique USB débranché")
        self.frames += 1
        self.signal_dbfs = -95
        sample = -0.6
        if self.frequency_hz == CARRIER:
            self.signal_dbfs = -25 if self.carrier else -95
            sample = 0.25 if self.voice else 0.03125
        elif self.frequency_hz == FINAL:
            self.signal_dbfs = -22
            sample = 0.0625
        if self.transition_frames:
            self.transition_frames -= 1
            sample = -0.75
        return np.full(chunk_size, sample, dtype=np.float32)


def eventually(predicate):
    end = time.monotonic() + 3
    while time.monotonic() < end:
        if predicate():
            return
        time.sleep(0.005)
    pytest.fail("État attendu non atteint par le scanner")


@pytest.fixture
def station(tmp_path, monkeypatch):
    engine = MainAudioEngine(AppConfig(adaptive_noise=False), recordings_dir=str(tmp_path),
                             ambient_profiles_dir=str(tmp_path / "profiles"))
    monkeypatch.setattr(engine.vad_detector, "get_speech_probability",
                        lambda samples: 0.98 if samples[0] == 0.25 else 0.0)
    monkeypatch.setattr("backend.app.audio.engine.HackRFSource", SimulatedHackRF)
    monkeypatch.setattr(routes, "save_config", lambda config: config)
    app = FastAPI()
    app.include_router(routes.router)
    app.dependency_overrides[routes.get_engine] = lambda: engine

    @app.websocket("/ws/audio")
    async def audio(websocket: WebSocket):
        await websocket_monitor_endpoint(websocket, engine, audio=True)

    @app.websocket("/ws/monitor")
    async def monitor(websocket: WebSocket):
        await websocket_monitor_endpoint(websocket, engine)

    try:
        with TestClient(app) as client:
            yield engine, client
    finally:
        engine.stop()


def start_scan(client, **updates):
    return client.post("/api/audio/hackrf/scan", json={
        "serial": SERIAL, "start_hz": START, "end_hz": FINAL,
        "step_hz": 12500, "hang_ms": 100, **updates,
    })


def action(client, command):
    response = client.post("/api/audio/hackrf/scan/control", json={"action": command})
    assert response.status_code == 200, response.text
    return response.json()


def test_scan_carrier_voice_takeover_and_resume(station):
    engine, client = station
    assert start_scan(client, step_hz=0).status_code == 422
    assert start_scan(client, end_hz=START - 1).status_code == 422
    assert client.put("/api/audio/hackrf/auto-recording", json={"enabled": False}).status_code == 200
    assert start_scan(client).status_code == 200
    source = engine.source
    eventually(lambda: engine.get_telemetry()["hackrf_scan"]["signal"])
    assert source.tuned == [START, CARRIER]
    assert not engine.recorder.is_recording
    with client.websocket_connect("/ws/audio") as socket:
        audio = np.frombuffer(socket.receive_bytes(), dtype="<f4")
        assert len(audio) == 1024 and np.all(audio == 0.03125)
    # A new UI connection reports the backend's hold and the real frequency.
    with client.websocket_connect("/ws/monitor") as socket:
        state = socket.receive_json()
        assert state["hackrf_scan"]["signal"]
        assert state["applied_frequency_hz"] == CARRIER
        assert not state["hackrf_auto_record"]

    source.voice = True
    eventually(lambda: engine.current_voice_detected)
    assert not engine.recorder.is_recording
    assert client.get("/api/recordings").json() == []
    assert client.put("/api/audio/hackrf/auto-recording", json={"enabled": True}).status_code == 200
    eventually(lambda: engine.recorder.is_recording)
    recording_id = engine.recorder.session_manager.session.communication_id
    assert client.post("/api/recording/start").json()["manual_recording"]
    source.voice = False
    source.carrier = False
    start_frame = source.frames
    eventually(lambda: source.frames >= start_frame + 7)
    assert source.frequency_hz == CARRIER and engine.recorder.manual_recording
    assert client.post("/api/audio/hackrf/scan/control", json={"action": "next"}).status_code == 409

    assert not client.post("/api/recording/stop").json()["manual_recording"]
    eventually(lambda: source.frequency_hz == FINAL)
    [recording] = client.get("/api/recordings").json()
    assert recording["recording_id"] == recording_id
    assert recording["frequency_hz"] == CARRIER
    assert recording["modulation"] == "NFM" and recording["trigger_mode"] == "voice_then_manual"
    with wave.open(io.BytesIO(client.get(recording["audio_url"]).content)) as wav:
        pcm = np.frombuffer(wav.readframes(wav.getnframes()), dtype="<i2")
    assert set(pcm) == {1023, 8191}
    assert pcm[0] == 1023 and pcm[-1] == 1023
    action(client, "next")
    eventually(lambda: START in source.tuned[3:] and source.frequency_hz == FINAL)
    assert client.get("/api/recordings").json() == [recording]


def test_pause_and_unplug_preserve_scan_intent_and_wav(station):
    engine, client = station
    assert start_scan(client).status_code == 200
    source = engine.source
    eventually(lambda: source.frequency_hz == CARRIER and engine.scan.heard_signal)
    assert action(client, "pause")["hackrf_scan"]["paused"]
    assert client.post("/api/recording/start").json()["manual_recording"]
    start_frame = source.frames
    eventually(lambda: source.frames >= start_frame + 4)
    assert client.post("/api/recording/stop").json()["hackrf_scan"]["paused"]
    assert source.frequency_hz == CARRIER
    action(client, "resume")
    action(client, "next")
    eventually(lambda: source.frequency_hz == FINAL and engine.scan.heard_signal)
    assert client.post("/api/recording/start").json()["manual_recording"]
    start_frame = source.frames
    eventually(lambda: source.frames >= start_frame + 4)
    source.unplugged = True
    eventually(lambda: len(client.get("/api/recordings").json()) == 2)
    state = engine.get_telemetry()
    assert not state["monitor_requested"] and state["hackrf_scan"] is None
    assert "débranché" in state["error_message"]
    assert {item["frequency_hz"] for item in client.get("/api/recordings").json()} == {CARRIER, FINAL}


def test_automatic_capture_finishes_after_carrier_hold(station):
    engine, client = station
    assert start_scan(client, hang_ms=320).status_code == 200
    source = engine.source
    eventually(lambda: engine.scan.heard_signal)
    source.voice = True
    eventually(lambda: engine.recorder.is_recording)
    start_frame = source.frames
    eventually(lambda: source.frames >= start_frame + 7)
    source.voice = False
    source.carrier = False
    fall_frame = source.frames
    eventually(lambda: source.frames >= fall_frame + 3)
    assert source.frequency_hz == CARRIER and engine.recorder.is_recording
    eventually(lambda: source.frequency_hz == FINAL)
    [recording] = client.get("/api/recordings").json()
    assert recording["frequency_hz"] == CARRIER
    assert recording["trigger_mode"] == "confirmed_voice"
    assert recording["communication_end_reason"] == "scan_end"
    assert action(client, "stop")["hackrf_scan"] is None
    assert source.frequency_hz == FINAL and source.is_active


def test_retune_discards_pcm_until_worker_boundary(monkeypatch):
    import subprocess
    import sys

    from backend.app.audio.hackrf_protocol import TUNE_MARKER

    worker = """
import os
import struct
import sys
import time

def samples(value):
    return struct.pack("<ff", value, 0.01) * 1024

os.write(1, samples(-0.5) * 2)
for _ in sys.stdin:
    os.write(1, samples(-0.5))
    marker = bytes.fromhex(sys.argv[1])
    os.write(1, marker[:3])
    time.sleep(0.015)
    os.write(1, marker[3:] + samples(0.25))
"""
    popen = subprocess.Popen
    monkeypatch.setattr("backend.app.audio.hackrf.list_hackrf_devices", lambda: [{"serial": SERIAL}])
    monkeypatch.setattr(subprocess, "Popen", lambda _, **kwargs: popen(
        [sys.executable, "-u", "-c", worker, TUNE_MARKER.hex()], **kwargs))
    source = HackRFSource(SERIAL, START, 16000)
    try:
        source.start()
        assert np.all(source.read_chunk() == -0.5)
        source.retune(CARRIER)
        assert source.frequency_hz == CARRIER
        samples = source.read_chunk()
        assert samples is not None and np.all(samples == 0.25)
        assert source.signal_dbfs == pytest.approx(-20)
    finally:
        source.stop()
