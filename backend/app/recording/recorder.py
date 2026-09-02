import os
import wave
from collections import deque
from datetime import datetime, timezone
from typing import Optional, Callable

import numpy as np

from .metadata import RecordingMetadata, save_metadata
from .segmenter import SpeechSegmenter
from .trimmer import trim_to_speech
from ..config.settings import AppConfig

try:
    import soundfile as sf
except ImportError:  # pragma: no cover
    sf = None


class AudioRecorderEngine:
    """Transmission state machine that always archives unprocessed input samples."""
    def __init__(self, config: AppConfig, recordings_dir="recordings", on_recording_finished=None):
        self.config, self.recordings_dir = config, recordings_dir
        self.on_recording_finished: Optional[Callable] = on_recording_finished
        os.makedirs(recordings_dir, exist_ok=True)
        self.sample_rate = config.sample_rate
        self.pre_buffer = deque()
        self.pre_buffer_samples = 0
        self.recorded_chunks = []
        self.segmenter = SpeechSegmenter()
        self.is_recording = False
        self.current_status = "idle"
        self.recording_start_iso = ""
        self.total_samples = self.silence_samples = 0
        self.metrics = []

    def update_config(self, config): self.config, self.sample_rate = config, config.sample_rate

    def _push_prebuffer(self, chunk):
        self.pre_buffer.append(chunk.copy()); self.pre_buffer_samples += len(chunk)
        limit = int(self.config.preroll_seconds * self.sample_rate)
        while self.pre_buffer and self.pre_buffer_samples - len(self.pre_buffer[0]) >= limit:
            self.pre_buffer_samples -= len(self.pre_buffer.popleft())

    def process_frame(self, chunk, level_dbfs, speech_prob, *, speech_confirmed=None,
                      candidate=False, radio_activity=False, confidence=None, metrics=None,
                      vad_backend="unknown"):
        chunk = np.asarray(chunk, dtype=np.float32)
        if speech_confirmed is None:  # backwards-compatible legacy caller
            speech_confirmed = level_dbfs >= self.config.threshold_dbfs and speech_prob >= self.config.vad_threshold
        confidence = speech_prob if confidence is None else confidence
        self._push_prebuffer(chunk)

        if not self.is_recording:
            if speech_confirmed:
                self.is_recording = True
                self.current_status = "voice_confirmed"
                self.recording_start_iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
                self.recorded_chunks = [x.copy() for x in self.pre_buffer]
                self.total_samples = sum(map(len, self.recorded_chunks))
                self.segmenter.reset()
                # Pre-roll is conservatively non-speech; current confirmed frame is last.
                start = max(0, self.total_samples - len(chunk))
                self.segmenter.add(start, self.total_samples, True, confidence)
                self.silence_samples = 0
                self.metrics = []
                self._vad_backend = vad_backend
            elif candidate or radio_activity:
                self.current_status = "signal_candidate"
            else:
                self.current_status = "listening"
            return self.current_status, bool(speech_confirmed), self.is_recording

        # Trigger chunk was already copied from pre-buffer; later frames append once.
        self.recorded_chunks.append(chunk.copy())
        start, end = self.total_samples, self.total_samples + len(chunk)
        self.total_samples = end
        self.segmenter.add(start, end, speech_confirmed, confidence)
        if metrics: self.metrics.append(metrics)
        if speech_confirmed:
            self.silence_samples = 0
            self.current_status = "recording"
        else:
            self.silence_samples += len(chunk)
            self.current_status = "hangover"
            if self.silence_samples >= int(self.config.transmission_hangover_seconds * self.sample_rate):
                self.current_status = "finalizing"
                self._save_active_recording()
                self.is_recording = False
                self.current_status = "listening"
        return self.current_status, bool(speech_confirmed), self.is_recording

    def _save_active_recording(self):
        if not self.recorded_chunks: return
        raw = np.concatenate(self.recorded_chunks)
        speech_samples = self.segmenter.speech_samples
        if speech_samples < int(self.config.minimum_total_speech_ms * self.sample_rate / 1000):
            self._clear(); return
        segments = self.segmenter.segments()
        result = trim_to_speech(raw, segments, self.sample_rate, self.config.trim_margin_seconds) if self.config.auto_trim_silence else trim_to_speech(raw, [[0, len(raw)]], self.sample_rate, 0)
        if not len(result.samples): self._clear(); return
        self.current_status = "trimming"
        stamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S-%f")[:-3]
        wav_path = os.path.join(self.recordings_dir, stamp + ".wav")
        pcm = (np.clip(result.samples, -1, 1) * 32767).astype(np.int16)
        self.current_status = "saving"
        if sf is not None: sf.write(wav_path, pcm, self.sample_rate, subtype="PCM_16")
        else:
            with wave.open(wav_path, "wb") as wf:
                wf.setparams((1, 2, self.sample_rate, 0, "NONE", "not compressed")); wf.writeframes(pcm.tobytes())
        def avg(key):
            values = [float(m[key]) for m in self.metrics if key in m]
            return round(sum(values) / len(values), 2) if values else None
        meta = RecordingMetadata(
            recording_id=stamp, source=self.config.source, device=self.config.device_name or "Audio Device",
            sample_rate=self.sample_rate, channels=1, timestamp_start=self.recording_start_iso,
            timestamp_end=datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"), duration_seconds=round(len(result.samples)/self.sample_rate, 3),
            trigger_mode=self.config.trigger_mode, trigger_threshold_dbfs=self.config.threshold_dbfs,
            vad_threshold=self.config.vad_threshold, frequency_hz=self.config.frequency_hz if self.config.source == "gnuradio" else None,
            modulation=self.config.modulation if self.config.source == "gnuradio" else None,
            station_id=self.config.station_id if self.config.source == "gnuradio" else None,
            profile=self.config.detection_profile, noise_floor_dbfs=avg("noise_floor_dbfs"),
            dynamic_threshold_dbfs=avg("dynamic_threshold_dbfs"), average_snr_db=avg("snr_db"),
            speech_band_snr_db=avg("speech_band_snr_db"), vad_backend=getattr(self, "_vad_backend", "unknown"),
            vad_start_threshold=self.config.vad_start_threshold, vad_stop_threshold=self.config.vad_stop_threshold,
            speech_duration_seconds=round(speech_samples/self.sample_rate, 3), raw_event_duration_seconds=round(len(raw)/self.sample_rate, 3),
            saved_duration_seconds=round(len(result.samples)/self.sample_rate, 3), trimmed_leading_seconds=round(result.leading_seconds, 3),
            trimmed_trailing_seconds=round(result.trailing_seconds, 3), speech_segment_count=len(segments),
        )
        save_metadata(meta, self.recordings_dir)
        self._clear()
        if self.on_recording_finished: self.on_recording_finished(meta, wav_path)

    def _clear(self):
        self.recorded_chunks = []; self.segmenter.reset(); self.total_samples = self.silence_samples = 0; self.metrics = []

    def stop_and_flush(self):
        if self.is_recording: self._save_active_recording()
        self.is_recording = False; self.pre_buffer.clear(); self.pre_buffer_samples = 0; self._clear(); self.current_status = "idle"
