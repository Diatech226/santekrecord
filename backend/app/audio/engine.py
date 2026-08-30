import asyncio
import threading
import time
from typing import Optional, Set, Callable, Dict, Any, List
import numpy as np

from .base import AudioSource
from .microphone import MicrophoneSource
from .soundcard import SoundCardSource
from .gnuradio import GNURadioSource
from ..detection.rms import RMSDetector
from ..detection.vad import SileroVADDetector
from ..recording.recorder import AudioRecorderEngine
from ..recording.metadata import RecordingMetadata
from ..config.settings import AppConfig, load_config


class MainAudioEngine:
    """
    Core orchestrator that runs the background audio capture loop,
    performs RMS/VAD analysis, controls the recorder, and broadcasts
    metrics via WebSocket callbacks.
    """

    def __init__(self, config: Optional[AppConfig] = None, recordings_dir: str = "recordings"):
        self.config = config or load_config()
        self.recordings_dir = recordings_dir

        self.source: Optional[AudioSource] = None
        self.rms_detector = RMSDetector()
        self.vad_detector = SileroVADDetector(sample_rate=self.config.sample_rate)
        self.recorder = AudioRecorderEngine(
            config=self.config,
            recordings_dir=self.recordings_dir,
            on_recording_finished=self._on_recording_finished,
        )

        self._is_running = False
        self._thread: Optional[threading.Thread] = None

        # Metrics for monitoring
        self.current_level_dbfs = -90.0
        self.current_speech_prob = 0.0
        self.current_voice_detected = False
        self.current_status = "idle"
        self.current_error: Optional[str] = None

        # Subscribers (e.g. WebSocket broadcast queues)
        self._listeners: List[Callable[[Dict[str, Any]], None]] = []

        # Calibration state
        self._is_calibrating = False
        self._calibration_levels: List[float] = []

    def subscribe(self, callback: Callable[[Dict[str, Any]], None]):
        if callback not in self._listeners:
            self._listeners.append(callback)

    def unsubscribe(self, callback: Callable[[Dict[str, Any]], None]):
        if callback in self._listeners:
            self._listeners.remove(callback)

    def _broadcast(self, data: Dict[str, Any]):
        for listener in self._listeners:
            try:
                listener(data)
            except Exception:
                pass

    def _on_recording_finished(self, meta: RecordingMetadata, wav_path: str):
        # Broadcast recording event
        self._broadcast({
            "event": "recording_saved",
            "metadata": meta.model_dump(),
        })

    def update_config(self, new_config: AppConfig):
        self.config = new_config
        self.recorder.update_config(new_config)
        if self._is_running:
            # Recreate audio source if source type changed
            self.stop()
            self.start()

    def _create_source(self) -> AudioSource:
        if self.config.source == "microphone":
            return MicrophoneSource(device_id=self.config.device_id, sample_rate=self.config.sample_rate)
        elif self.config.source == "usb":
            return SoundCardSource(device_id=self.config.device_id, sample_rate=self.config.sample_rate)
        elif self.config.source == "gnuradio":
            return GNURadioSource(fifo_path=self.config.fifo_path, sample_rate=self.config.sample_rate)
        return MicrophoneSource(device_id=None, sample_rate=self.config.sample_rate)

    def start(self) -> bool:
        if self._is_running:
            return True

        self.current_error = None
        try:
            self.source = self._create_source()
            self.source.start()
        except Exception as e:
            self.current_error = f"Audio source error: {e}"
            self.current_status = "error"
            print(f"[MainAudioEngine] Start failed: {e}")
            return False

        self._is_running = True
        self.current_status = "listening"
        self._thread = threading.Thread(target=self._audio_loop, daemon=True)
        self._thread.start()
        print(f"[MainAudioEngine] Started audio engine on source: {self.config.source}")
        return True

    def stop(self) -> None:
        self._is_running = False
        if self._thread is not None:
            self._thread.join(timeout=1.0)
            self._thread = None

        if self.source is not None:
            try:
                self.source.stop()
            except Exception:
                pass
            self.source = None

        self.recorder.stop_and_flush()
        self.current_status = "idle"
        self.current_level_dbfs = -90.0
        self.current_speech_prob = 0.0
        self.current_voice_detected = False

        self._broadcast(self.get_telemetry())
        print("[MainAudioEngine] Audio engine stopped.")

    def _audio_loop(self):
        last_broadcast_time = 0.0

        while self._is_running and self.source is not None:
            try:
                chunk = self.source.read_chunk(chunk_size=1024)
                if chunk is None or len(chunk) == 0:
                    time.sleep(0.01)
                    continue

                # 1. Compute RMS & dBFS
                _, dbfs = self.rms_detector.process_chunk(chunk)
                self.current_level_dbfs = round(dbfs, 1)

                # Calibration accumulation
                if self._is_calibrating:
                    self._calibration_levels.append(dbfs)

                # 2. Compute Voice Activity Detection (Silero VAD)
                speech_prob = self.vad_detector.get_speech_probability(chunk)
                self.current_speech_prob = round(speech_prob, 2)

                # 3. Process recorder state machine
                status, voice_detected, is_recording = self.recorder.process_frame(
                    chunk, self.current_level_dbfs, self.current_speech_prob
                )
                self.current_status = status
                self.current_voice_detected = voice_detected

                # 4. Rate-limited WebSocket broadcast (~8 Hz)
                now = time.time()
                if now - last_broadcast_time >= 0.12:
                    self._broadcast(self.get_telemetry())
                    last_broadcast_time = now

            except Exception as e:
                print(f"[MainAudioEngine] Loop error: {e}")
                self.current_error = str(e)
                self.current_status = "error"
                time.sleep(0.1)

    def get_telemetry(self) -> Dict[str, Any]:
        return {
            "level_dbfs": self.current_level_dbfs,
            "speech_probability": self.current_speech_prob,
            "voice_detected": self.current_voice_detected,
            "recording": self.recorder.is_recording,
            "status": self.current_status,
            "error_message": self.current_error,
        }

    def calibrate_noise_floor(self, duration_sec: float = 5.0) -> Dict[str, Any]:
        """
        Listens to ambient noise for duration_sec, calculates average noise floor dBFS,
        and returns recommended trigger threshold.
        """
        was_running = self._is_running
        if not was_running:
            self.start()

        self._calibration_levels = []
        self._is_calibrating = True

        time.sleep(duration_sec)

        self._is_calibrating = False
        valid_samples = [x for x in self._calibration_levels if x > -95.0]

        if valid_samples:
            noise_floor = float(np.mean(valid_samples))
        else:
            noise_floor = -58.0

        recommended = float(np.clip(noise_floor + 14.0, -55.0, -20.0))

        if not was_running:
            self.stop()

        return {
            "noise_floor_dbfs": round(noise_floor, 1),
            "recommended_threshold_dbfs": round(recommended, 1),
            "margin_db": 14.0,
            "sample_count": len(valid_samples),
        }
