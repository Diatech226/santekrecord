import os
import time
import wave
import collections
from datetime import datetime
from typing import Optional, List, Callable, Tuple
import numpy as np

from .metadata import RecordingMetadata, save_metadata
from ..config.settings import AppConfig

try:
    import soundfile as sf
except ImportError:
    sf = None


class AudioRecorderEngine:
    """
    Manages circular pre-buffer, active recording session, silence hang-time counter,
    and automatic writing of 16kHz mono PCM16 WAV + JSON files to recordings/ directory.
    """

    def __init__(
        self,
        config: AppConfig,
        recordings_dir: str = "recordings",
        on_recording_finished: Optional[Callable[[RecordingMetadata, str], None]] = None,
    ):
        self.config = config
        self.recordings_dir = recordings_dir
        self.on_recording_finished = on_recording_finished
        os.makedirs(self.recordings_dir, exist_ok=True)

        self.sample_rate = config.sample_rate or 16000
        self.is_recording = False
        self.current_status = "idle"

        # Circular pre-buffer
        self.pre_buffer: collections.deque[np.ndarray] = collections.deque()
        self._update_prebuffer_size()

        # Recorded chunks
        self.recorded_chunks: List[np.ndarray] = []
        self.recording_start_iso = ""
        self.recording_start_time = 0.0
        self.last_voice_time = 0.0

        # Smoothing window (2 out of 3)
        self.recent_hits: collections.deque[bool] = collections.deque([False, False, False], maxlen=3)

    def _update_prebuffer_size(self):
        # 1024 samples @ 16kHz is ~64ms
        chunks_per_sec = self.sample_rate / 1024.0
        max_chunks = max(2, int(chunks_per_sec * max(0.5, self.config.preroll_seconds)))
        self.pre_buffer = collections.deque(maxlen=max_chunks)

    def update_config(self, config: AppConfig):
        self.config = config
        self._update_prebuffer_size()

    def process_frame(
        self,
        chunk: np.ndarray,
        level_dbfs: float,
        speech_prob: float,
    ) -> Tuple[str, bool, bool]:
        """
        Processes one chunk of 16kHz float32 audio.
        Returns (status_label, voice_detected, is_recording).
        """
        now = time.time()

        # Evaluate condition based on trigger mode
        is_db_ok = level_dbfs >= self.config.threshold_dbfs
        is_vad_ok = speech_prob >= self.config.vad_threshold

        if self.config.trigger_mode == "db_vad":
            frame_positive = is_db_ok and is_vad_ok
        elif self.config.trigger_mode == "db_only":
            frame_positive = is_db_ok
        else:  # vad_only
            frame_positive = is_vad_ok

        # 2 out of 3 smoothing
        self.recent_hits.append(frame_positive)
        voice_detected = sum(self.recent_hits) >= 2

        # Add to circular pre-buffer
        self.pre_buffer.append(chunk.copy())

        # State machine
        if voice_detected:
            self.last_voice_time = now
            if not self.is_recording:
                # Start new recording
                self.is_recording = True
                self.recording_start_time = now
                self.recording_start_iso = datetime.utcnow().isoformat() + "Z"
                # Seed recording with all chunks currently in circular pre-buffer
                self.recorded_chunks = list(self.pre_buffer)
                self.current_status = "voice_detected"
            else:
                self.recorded_chunks.append(chunk.copy())
                self.current_status = "recording"
        elif self.is_recording:
            self.recorded_chunks.append(chunk.copy())
            silence_elapsed = now - self.last_voice_time
            if silence_elapsed >= self.config.silence_seconds:
                # Silence threshold reached -> finish and save recording
                self.current_status = "saving"
                self._save_active_recording()
                self.is_recording = False
                self.current_status = "listening"
            else:
                self.current_status = "silence"
        else:
            self.current_status = "listening"

        return self.current_status, voice_detected, self.is_recording

    def _save_active_recording(self):
        if not self.recorded_chunks:
            return

        # Merge all chunks
        all_samples = np.concatenate(self.recorded_chunks, axis=0)
        total_samples = len(all_samples)
        duration_sec = round(total_samples / float(self.sample_rate), 2)

        # Minimum duration filter (e.g. at least 0.4s)
        if duration_sec < 0.4:
            self.recorded_chunks = []
            return

        now_dt = datetime.now()
        timestamp_str = now_dt.strftime("%Y-%m-%d_%H-%M-%S")
        wav_path = os.path.join(self.recordings_dir, f"{timestamp_str}.wav")

        # Convert float32 [-1.0, 1.0] to int16 PCM
        int16_samples = (np.clip(all_samples, -1.0, 1.0) * 32767).astype(np.int16)

        try:
            if sf is not None:
                sf.write(wav_path, int16_samples, self.sample_rate, subtype="PCM_16")
            else:
                with wave.open(wav_path, "wb") as wf:
                    wf.setnchannels(1)
                    wf.setsampwidth(2)  # 16-bit
                    wf.setframerate(self.sample_rate)
                    wf.writeframes(int16_samples.tobytes())
        except Exception as e:
            print(f"[Recorder] Error writing WAV {wav_path}: {e}")
            self.recorded_chunks = []
            return

        # Prepare and save JSON metadata
        meta = RecordingMetadata(
            recording_id=timestamp_str,
            source=self.config.source,
            device=self.config.device_name or "Audio Device",
            sample_rate=self.sample_rate,
            channels=1,
            timestamp_start=self.recording_start_iso or datetime.utcnow().isoformat() + "Z",
            timestamp_end=datetime.utcnow().isoformat() + "Z",
            duration_seconds=duration_sec,
            trigger_mode=self.config.trigger_mode,
            trigger_threshold_dbfs=self.config.threshold_dbfs,
            vad_threshold=self.config.vad_threshold,
            annotation_status="pending",
            upload_status="pending",
            frequency_hz=self.config.frequency_hz if self.config.source == "gnuradio" else None,
            modulation=self.config.modulation if self.config.source == "gnuradio" else None,
            station_id=self.config.station_id if self.config.source == "gnuradio" else None,
        )
        json_path = save_metadata(meta, self.recordings_dir)
        print(f"[Recorder] Saved recording {timestamp_str} ({duration_sec}s) -> {wav_path} and {json_path}")

        self.recorded_chunks = []

        if self.on_recording_finished:
            self.on_recording_finished(meta, wav_path)

    def stop_and_flush(self):
        if self.is_recording:
            self._save_active_recording()
            self.is_recording = False
        self.pre_buffer.clear()
        self.recorded_chunks = []
        self.current_status = "idle"
