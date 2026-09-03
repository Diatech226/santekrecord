import os
import wave
from collections import deque
from datetime import datetime, timezone
from typing import Optional, Callable

import numpy as np

from .metadata import RecordingMetadata, save_metadata
from .models import SessionState
from .session_manager import CommunicationSessionManager
from .transmission_manager import TransmissionManager
from .trimmer import trim_to_speech
from .segmenter import SpeechSegmenter
from ..config.settings import AppConfig

try:
    import soundfile as sf
except ImportError:  # pragma: no cover
    sf = None


class AudioRecorderEngine:
    """Groups confirmed voice into transmissions and one conversation archive."""
    def __init__(self, config: AppConfig, recordings_dir="recordings", on_recording_finished=None):
        self.config, self.recordings_dir = config, recordings_dir
        self.on_recording_finished: Optional[Callable] = on_recording_finished
        os.makedirs(recordings_dir, exist_ok=True)
        self.sample_rate = config.sample_rate
        self.pre_buffer, self.recorded_chunks = deque(), []
        self.pre_buffer_samples = self.total_samples = 0
        self.event_buffer_samples = 0
        self.is_recording = False
        self.current_status = "idle"
        self.metrics = []
        self.segmenter = SpeechSegmenter()  # compatibility for legacy integrations
        self.radio_activity_samples = 0
        self.meaningful_radio_samples = 0
        self._sequence_stamp = ""
        self._sequence = 0
        self._configure_managers()

    def _configure_managers(self):
        self.transmission_manager = TransmissionManager(
            self.sample_rate, self.config.intra_phrase_pause_seconds,
            self.config.transmission_end_timeout_seconds, self.config.ambient_confirm_ms)
        self.session_manager = CommunicationSessionManager(
            self.sample_rate, self.config.communication_end_timeout_seconds,
            self.config.max_communication_seconds, self.config.ambient_confirm_ms)

    def update_config(self, config):
        self.config, self.sample_rate = config, config.sample_rate
        if not self.is_recording:
            self._configure_managers()

    def _new_id(self):
        now = datetime.now(timezone.utc)
        stamp = now.strftime("COM-%Y%m%d-%H%M%S")
        if stamp != self._sequence_stamp:
            self._sequence_stamp, self._sequence = stamp, 0
        self._sequence += 1
        return f"{stamp}-{self._sequence:03d}", now.isoformat().replace("+00:00", "Z")

    def _push_prebuffer(self, chunk):
        self.pre_buffer.append(chunk.copy()); self.pre_buffer_samples += len(chunk)
        limit = int(self.config.preroll_seconds * self.sample_rate)
        while self.pre_buffer and self.pre_buffer_samples - len(self.pre_buffer[0]) >= limit:
            self.pre_buffer_samples -= len(self.pre_buffer.popleft())

    def process_frame(self, chunk, level_dbfs, speech_prob, *, speech_confirmed=None,
                      candidate=False, event_active=False, radio_activity=False, confidence=None, metrics=None,
                      vad_backend="unknown", return_to_ambient=None):
        chunk = np.asarray(chunk, dtype=np.float32)
        if speech_confirmed is None:
            speech_confirmed = False
        if return_to_ambient is None:
            return_to_ambient = not speech_confirmed and speech_prob <= self.config.vad_stop_threshold
        self._push_prebuffer(chunk)

        if not self.is_recording:
            if not speech_confirmed:
                # The circular pre-roll is the temporary event buffer. It is
                # promoted only by confirmed human voice and otherwise expires.
                self.event_buffer_samples = self.event_buffer_samples + len(chunk) if event_active else 0
                timeout = int(3.0 * self.sample_rate)
                self.current_status = ("event_discarded" if self.event_buffer_samples >= timeout
                                       else "event_active" if event_active else "listening")
                return self.current_status, False, False
            communication_id, start_iso = self._new_id()
            self.recorded_chunks = [x.copy() for x in self.pre_buffer]
            self.total_samples = sum(map(len, self.recorded_chunks))
            self.session_start_sample = 0
            self.session_manager.open(communication_id, start_iso, 0)
            self.is_recording = True
            self.event_buffer_samples = 0
            self.metrics = []
            self._vad_backend = vad_backend
            start, end = self.total_samples - len(chunk), self.total_samples
            self.transmission_manager.process(start, end, True, radio_activity, False, 1)
            self.current_status = "communication_active"
            return self.current_status, True, True

        self.recorded_chunks.append(chunk.copy())
        start, end = self.total_samples, self.total_samples + len(chunk)
        self.total_samples = end
        if metrics:
            self.metrics.append(metrics)
        if radio_activity:
            self.radio_activity_samples += len(chunk)
        spectral_change = float((metrics or {}).get("spectral_change", 0.0))
        snr_db = float((metrics or {}).get("snr_db", 0.0))
        radio_evidence = radio_activity and (not metrics or (
            spectral_change >= self.config.ambient_return_spectral_threshold and
            snr_db >= self.config.minimum_snr_db))
        self.meaningful_radio_samples = self.meaningful_radio_samples + len(chunk) if radio_evidence else 0
        meaningful_radio_activity = bool(speech_confirmed)
        transmission_id = len(self.session_manager.session.transmissions) + 1
        closed = self.transmission_manager.process(
            start, end, bool(speech_confirmed), False, return_to_ambient, transmission_id)
        if closed:
            self.session_manager.add(closed)
        elif speech_confirmed:
            self.session_manager.state = SessionState.TRANSMISSION_ACTIVE

        reason = self.session_manager.observe(
            end, bool(speech_confirmed), False, return_to_ambient, self.session_start_sample,
            meaningful_radio_activity=meaningful_radio_activity,
            transmission_active=self.transmission_manager.current is not None)
        if reason:
            pending = self.transmission_manager.flush()
            if pending:
                self.session_manager.add(pending)
            self._save_active_session(reason)
            self.current_status = "listening"
        elif self.transmission_manager.current:
            self.current_status = {
                "speech": "voice",
                "intra_phrase_pause": "pause",
                "transmission_hangover": "transmission_hangover",
            }.get(self.transmission_manager.state.value, "communication_active")
        else:
            self.current_status = "waiting_reply"
        return self.current_status, bool(speech_confirmed), self.is_recording

    def _save_active_session(self, reason="ambient_timeout"):
        session = self.session_manager.finish(reason)
        if not session or not self.recorded_chunks:
            self._clear(); return
        raw = np.concatenate(self.recorded_chunks)
        speech_samples = sum(t.speech_samples for t in session.transmissions)
        if speech_samples < int(self.config.minimum_total_speech_ms * self.sample_rate / 1000):
            self._clear(); return
        all_segments = [[s.start_sample, s.end_sample] for t in session.transmissions for s in t.speech_segments]
        # Retain the circular lead-in so delayed VAD confirmation cannot clip
        # the beginning of a word or phrase.
        trim_margin = max(self.config.trim_margin_seconds, self.config.preroll_seconds)
        result = (trim_to_speech(raw, all_segments, self.sample_rate, trim_margin)
                  if self.config.auto_trim_silence else trim_to_speech(raw, [[0, len(raw)]], self.sample_rate, 0))
        if not len(result.samples):
            self._clear(); return
        trim_offset = round(result.leading_seconds * self.sample_rate)
        wav_path = os.path.join(self.recordings_dir, session.communication_id + ".wav")
        pcm = (np.clip(result.samples, -1, 1) * 32767).astype(np.int16)
        self.current_status = "saving_communication"
        if sf is not None:
            sf.write(wav_path, pcm, self.sample_rate, subtype="PCM_16")
        else:
            with wave.open(wav_path, "wb") as wf:
                wf.setparams((1, 2, self.sample_rate, 0, "NONE", "not compressed")); wf.writeframes(pcm.tobytes())
        def avg(key):
            values = [float(m[key]) for m in self.metrics if m.get(key) is not None]
            return round(sum(values) / len(values), 2) if values else None
        transmissions = [t.as_dict(self.sample_rate, trim_offset) for t in session.transmissions]
        gaps = [round(transmissions[i]["start_sec"] - transmissions[i-1]["end_sec"], 3)
                for i in range(1, len(transmissions))]
        meta = RecordingMetadata(
            recording_id=session.communication_id, communication_id=session.communication_id,
            source=self.config.source, device=self.config.device_name or "Audio Device",
            sample_rate=self.sample_rate, channels=1, timestamp_start=session.start_iso,
            timestamp_end=datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            duration_seconds=round(len(result.samples)/self.sample_rate, 3), trigger_mode="confirmed_voice",
            trigger_threshold_dbfs=avg("dynamic_threshold_dbfs"),
            vad_threshold=self.config.vad_start_threshold,
            frequency_hz=self.config.frequency_hz if self.config.source == "gnuradio" else None,
            modulation=self.config.modulation if self.config.source == "gnuradio" else None,
            station_id=self.config.station_id if self.config.source == "gnuradio" else None,
            profile=self.config.detection_profile, noise_floor_dbfs=avg("noise_floor_dbfs"),
            dynamic_threshold_dbfs=avg("dynamic_threshold_dbfs"), average_snr_db=avg("snr_db"),
            speech_band_snr_db=avg("speech_band_snr_db"), vad_backend=getattr(self, "_vad_backend", "unknown"),
            vad_start_threshold=self.config.vad_start_threshold, vad_stop_threshold=self.config.vad_stop_threshold,
            speech_duration_seconds=round(speech_samples/self.sample_rate, 3),
            total_speech_duration_seconds=round(speech_samples/self.sample_rate, 3),
            total_radio_activity_seconds=round(self.radio_activity_samples/self.sample_rate, 3),
            raw_event_duration_seconds=round(len(raw)/self.sample_rate, 3), saved_duration_seconds=round(len(result.samples)/self.sample_rate, 3),
            trimmed_leading_seconds=round(result.leading_seconds, 3), trimmed_trailing_seconds=round(result.trailing_seconds, 3),
            speech_segment_count=len(all_segments), transmission_count=len(transmissions), transmissions=transmissions,
            inter_transmission_gap_seconds=gaps, communication_end_reason=reason)
        save_metadata(meta, self.recordings_dir)
        self._clear()
        if self.on_recording_finished:
            self.on_recording_finished(meta, wav_path)

    # Kept as a private compatibility hook for older tests/integrations.
    def _save_active_recording(self):
        pending = self.transmission_manager.flush()
        if pending and self.session_manager.session:
            self.session_manager.add(pending)
        self._save_active_session("manual_stop")

    def _clear(self):
        self.recorded_chunks = []; self.total_samples = 0; self.metrics = []
        self.transmission_manager.reset(); self.segmenter.reset(); self.radio_activity_samples = 0
        self.meaningful_radio_samples = 0; self.is_recording = False
        self.event_buffer_samples = 0

    def session_telemetry(self):
        session = self.session_manager.session
        current = 1 + len(session.transmissions) if session else 0
        last = self.transmission_manager.last_speech_end
        return {
            "communication_active": bool(session),
            "communication_id": session.communication_id if session else None,
            "current_transmission": current if session else 0,
            "transmission_count": (len(session.transmissions) + bool(self.transmission_manager.current)) if session else 0,
            "communication_duration_seconds": round(self.total_samples / self.sample_rate, 2) if session else 0,
            "time_since_last_speech": round((self.total_samples - last) / self.sample_rate, 2) if session and last is not None else None,
            "session_state": self.session_manager.state.value if session else "ambient",
            "transmission_state": self.transmission_manager.state.value,
            "return_to_ambient": bool(self.transmission_manager.ambient_samples),
            "ambient_confirm_ms": round(self.transmission_manager.ambient_samples * 1000 / self.sample_rate),
            "quiet_seconds": round(self.transmission_manager.quiet_samples / self.sample_rate, 3),
        }

    def stop_and_flush(self):
        if self.is_recording:
            pending = self.transmission_manager.flush()
            if pending:
                self.session_manager.add(pending)
            self._save_active_session("manual_stop")
        self.pre_buffer.clear(); self.pre_buffer_samples = 0; self._clear(); self.current_status = "idle"
