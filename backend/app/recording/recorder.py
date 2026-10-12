import os
import json
import threading
import time
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


SPOOL_FSYNC_INTERVAL_SECONDS = 300


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
        self._lock = threading.RLock()
        self._accepting_frames = True
        self._spool_path = None
        self._spool_file = None
        self._last_spool_fsync = None
        self._recover_interrupted_recordings()
        self._configure_managers()

    def _recover_interrupted_recordings(self):
        """Turn durable raw spools left by a crash into valid, visible WAVs."""
        for manifest_path in sorted(os.path.join(self.recordings_dir, name)
                                    for name in os.listdir(self.recordings_dir)
                                    if name.endswith(".recording.json.part")):
            raw_path = manifest_path.removesuffix(".recording.json.part") + ".pcm.part"
            if not os.path.exists(raw_path):
                continue
            try:
                with open(manifest_path, encoding="utf-8") as handle:
                    manifest = json.load(handle)
                count = os.path.getsize(raw_path) // np.dtype(np.float32).itemsize
                if count <= 0:
                    continue
                raw = np.memmap(raw_path, dtype=np.float32, mode="r", shape=(count,))
                recording_id = manifest["recording_id"] + "-recovered"
                wav_path = os.path.join(self.recordings_dir, recording_id + ".wav")
                self._write_wav_atomic(wav_path, raw, int(manifest["sample_rate"]))
                meta = RecordingMetadata(
                    recording_id=recording_id, communication_id=recording_id,
                    source=manifest.get("source", "microphone"),
                    device=manifest.get("device", "Audio Device"),
                    sample_rate=int(manifest["sample_rate"]), channels=1,
                    timestamp_start=manifest["timestamp_start"],
                    timestamp_end=datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                    duration_seconds=round(count / int(manifest["sample_rate"]), 3),
                    saved_duration_seconds=round(count / int(manifest["sample_rate"]), 3),
                    raw_event_duration_seconds=round(count / int(manifest["sample_rate"]), 3),
                    communication_end_reason="interrupted_recovery",
                )
                save_metadata(meta, self.recordings_dir)
                del raw
                os.remove(raw_path)
                os.remove(manifest_path)
            except (OSError, ValueError, KeyError, json.JSONDecodeError) as exc:
                # A potentially recoverable spool is evidence, never startup trash.
                print(f"[RECORDER] Preserving unrecoverable spool {raw_path}: {exc}")

    def resume(self):
        with self._lock:
            self._accepting_frames = True

    def _open_spool(self, recording_id, start_iso):
        self._spool_path = os.path.join(self.recordings_dir, recording_id + ".pcm.part")
        manifest_path = os.path.join(self.recordings_dir, recording_id + ".recording.json.part")
        with open(manifest_path, "w", encoding="utf-8") as handle:
            json.dump({"recording_id": recording_id, "timestamp_start": start_iso,
                       "sample_rate": self.sample_rate, "source": self.config.source,
                       "device": self.config.device_name or "Audio Device"}, handle)
            handle.flush(); os.fsync(handle.fileno())
        self._spool_file = open(self._spool_path, "wb")
        # Each communication gets its own durability interval. A monotonic
        # clock prevents wall-clock corrections from delaying synchronization.
        self._last_spool_fsync = time.monotonic()

    def _append_spool(self, chunks):
        if self._spool_file is None:
            return
        for chunk in chunks:
            np.asarray(chunk, dtype=np.float32).tofile(self._spool_file)
        # Python's buffer is flushed for every capture frame. The OS can then
        # persist it progressively rather than keeping a whole session in RAM.
        self._spool_file.flush()
        now = time.monotonic()
        if (self._last_spool_fsync is not None and
                now - self._last_spool_fsync >= SPOOL_FSYNC_INTERVAL_SECONDS):
            try:
                os.fsync(self._spool_file.fileno())
            except OSError as exc:
                # Keep recording and preserve the spool for recovery. Advance
                # the interval so a failing disk is not hammered every frame.
                print(f"[RECORDER] Periodic spool fsync failed for {self._spool_path}: {exc}")
            finally:
                self._last_spool_fsync = now

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
        # Always retain the current frame: even with preroll disabled it is the
        # trigger frame and therefore already captured voice.
        while len(self.pre_buffer) > 1 and self.pre_buffer_samples - len(self.pre_buffer[0]) >= limit:
            self.pre_buffer_samples -= len(self.pre_buffer.popleft())

    def process_frame(self, chunk, level_dbfs, speech_prob, *, speech_confirmed=None,
                      candidate=False, event_active=False, radio_activity=False, confidence=None, metrics=None,
                      vad_backend="unknown", return_to_ambient=None):
        with self._lock:
            if not self._accepting_frames:
                return self.current_status, False, self.is_recording
            return self._process_frame_locked(
                chunk, level_dbfs, speech_prob, speech_confirmed=speech_confirmed,
                candidate=candidate, event_active=event_active, radio_activity=radio_activity,
                confidence=confidence, metrics=metrics, vad_backend=vad_backend,
                return_to_ambient=return_to_ambient)

    def _process_frame_locked(self, chunk, level_dbfs, speech_prob, *, speech_confirmed=None,
                              candidate=False, event_active=False, radio_activity=False,
                              confidence=None, metrics=None, vad_backend="unknown",
                              return_to_ambient=None):
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
            self._open_spool(communication_id, start_iso)
            self._append_spool(self.recorded_chunks)
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
        # Keep only a small compatibility/debug window; the spool is canonical.
        if len(self.recorded_chunks) > 64:
            self.recorded_chunks.pop(0)
        self._append_spool([chunk])
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
        if not session or self.total_samples <= 0:
            self._clear(); return
        if self._spool_file is not None:
            try:
                # Finalization always has its own durability barrier, even if
                # a periodic fsync happened only moments ago.
                self._spool_file.flush()
                os.fsync(self._spool_file.fileno())
            except OSError as exc:
                print(f"[RECORDER] Final spool fsync failed; preserving {self._spool_path}: {exc}")
                self._spool_file.close()
                self._spool_file = None
                self._clear()
                return
            self._spool_file.close()
            self._spool_file = None
        if self._spool_path and os.path.exists(self._spool_path):
            count = os.path.getsize(self._spool_path) // np.dtype(np.float32).itemsize
            raw = np.memmap(self._spool_path, dtype=np.float32, mode="r", shape=(count,))
        else:
            raw = np.concatenate(self.recorded_chunks)
        speech_samples = sum(t.speech_samples for t in session.transmissions)
        if (reason != "manual_stop" and
                speech_samples < int(self.config.minimum_total_speech_ms * self.sample_rate / 1000)):
            if isinstance(raw, np.memmap):
                del raw
            self._discard_spool(session.communication_id)
            self._clear(); return
        all_segments = [[s.start_sample, s.end_sample] for t in session.transmissions for s in t.speech_segments]
        # Retain the circular lead-in so delayed VAD confirmation cannot clip
        # the beginning of a word or phrase.
        trim_margin = max(self.config.trim_margin_seconds, self.config.preroll_seconds)
        result = (trim_to_speech(raw, all_segments, self.sample_rate, trim_margin)
                  if self.config.auto_trim_silence else trim_to_speech(raw, [[0, len(raw)]], self.sample_rate, 0))
        if not len(result.samples):
            if isinstance(raw, np.memmap):
                del raw
            self._discard_spool(session.communication_id)
            self._clear(); return
        trim_offset = round(result.leading_seconds * self.sample_rate)
        wav_path = os.path.join(self.recordings_dir, session.communication_id + ".wav")
        pcm = (np.clip(result.samples, -1, 1) * 32767).astype(np.int16)
        self.current_status = "saving_communication"
        self._write_wav_atomic(wav_path, pcm, self.sample_rate, pcm16=True)
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
        if isinstance(raw, np.memmap):
            del raw
        self._discard_spool(session.communication_id)
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
        if self._spool_file is not None:
            self._spool_file.close(); self._spool_file = None
        self.recorded_chunks = []; self.total_samples = 0; self.metrics = []
        self.transmission_manager.reset(); self.segmenter.reset(); self.radio_activity_samples = 0
        self.meaningful_radio_samples = 0; self.is_recording = False
        self.event_buffer_samples = 0
        self._last_spool_fsync = None

    def _discard_spool(self, recording_id=None):
        paths = [self._spool_path]
        if recording_id:
            paths.append(os.path.join(self.recordings_dir, recording_id + ".recording.json.part"))
        for path in paths:
            if path and os.path.exists(path):
                os.remove(path)
        self._spool_path = None

    @staticmethod
    def _write_wav_atomic(wav_path, samples, sample_rate, pcm16=False):
        temporary = wav_path + ".part"
        pcm = samples if pcm16 else (np.clip(samples, -1, 1) * 32767).astype(np.int16)
        if sf is not None:
            sf.write(temporary, pcm, sample_rate, subtype="PCM_16", format="WAV")
        else:
            with wave.open(temporary, "wb") as wf:
                wf.setparams((1, 2, sample_rate, 0, "NONE", "not compressed"))
                wf.writeframes(np.asarray(pcm, dtype=np.int16).tobytes())
        os.replace(temporary, wav_path)

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
        with self._lock:
            self._accepting_frames = False
            if self.is_recording:
                pending = self.transmission_manager.flush()
                if pending:
                    self.session_manager.add(pending)
                self._save_active_session("manual_stop")
            self.pre_buffer.clear(); self.pre_buffer_samples = 0; self._clear(); self.current_status = "idle"
