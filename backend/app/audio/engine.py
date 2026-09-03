import asyncio
import threading
import time
from typing import Optional, Set, Callable, Dict, Any, List
import numpy as np
import collections

from .base import AudioSource
from .microphone import MicrophoneSource
from .soundcard import SoundCardSource
from .gnuradio import GNURadioSource
from .alsa import ALSAArecordSource, match_alsa_device
from ..detection.rms import RMSDetector
from ..detection.vad import SileroVADDetector
from ..detection.noise_profile import AdaptiveNoiseProfile
from ..detection.speech_detector import SpeechDetector
from ..detection.ambient_profile_store import AmbientProfileStore
from ..detection.audio_event_gate import AudioEventDecision, AudioEventGate
from ..recording.recorder import AudioRecorderEngine
from ..recording.metadata import RecordingMetadata
from ..config.settings import AppConfig, load_config


class MainAudioEngine:
    """
    Core orchestrator that runs the background audio capture loop,
    performs RMS/VAD analysis, controls the recorder, and broadcasts
    metrics via WebSocket callbacks.
    """

    def __init__(self, config: Optional[AppConfig] = None, recordings_dir: str = "recordings",
                 ambient_profiles_dir: str = "data/ambient_profiles"):
        self.config = config or load_config()
        self.recordings_dir = recordings_dir

        self.source: Optional[AudioSource] = None
        self.rms_detector = RMSDetector()
        self.ambient_profile_store = AmbientProfileStore(ambient_profiles_dir)
        self.vad_detector = None
        self.noise_profile = None
        self.speech_detector = None
        self._configure_detection_pipeline(force_vad=True)
        self.ambient_profile_loaded = False
        self.ambient_profile_age_seconds: Optional[float] = None
        self.ambient_profile_source = "learning"
        self._ambient_profile_dirty = False
        self._ambient_profile_saved = False
        self._ambient_device_name: Optional[str] = None
        self.recorder = AudioRecorderEngine(
            config=self.config,
            recordings_dir=self.recordings_dir,
            on_recording_finished=self._on_recording_finished,
        )

        self._is_running = False
        self._thread: Optional[threading.Thread] = None

        # Metrics for monitoring
        self.current_level_dbfs = -90.0
        self.current_peak_dbfs = -90.0
        self.raw_level_dbfs = -90.0
        self.raw_peak_dbfs = -90.0
        self.noise_floor_dbfs = -90.0
        # A small, level-only ambient estimator for the raw event path.  The
        # richer AdaptiveNoiseProfile intentionally remains in the processed
        # detection domain for SNR/spectrum diagnostics.
        self.raw_noise_floor_dbfs: Optional[float] = None
        self.raw_ambient_ready = False
        self.frames_received = 0
        self.last_audio_frame_at: Optional[float] = None
        self.started_at: Optional[float] = None
        self._noise_levels = collections.deque(maxlen=240)
        self._raw_ambient_levels = collections.deque(maxlen=240)
        self._raw_ambient_quiet_bootstrap = collections.deque(maxlen=8)
        self.current_speech_prob = 0.0
        self.current_voice_detected = False
        self.current_status = "idle"
        self.current_error: Optional[str] = None
        self.effective_gain = 1.0
        self.current_waveform: List[float] = [0.0] * 128
        self.current_spectrum: List[float] = [0.0] * 64
        self.current_ambient_spectrum: List[float] = [0.0] * 64
        self.current_dynamic_threshold = -90.0
        self.current_snr = 0.0
        self.current_speech_band_snr = 0.0
        self.current_spectral_change = 0.0
        self.current_radio_activity = False
        self.current_radio_activity_score = 0.0
        self.current_event_active = False
        self.ambient_learning = False
        self.ambient_learned_samples = 0
        self.current_speech_candidate = False
        self.current_speech_confirmed = False
        self.current_speech_reject_reason = "vad_too_low"
        self.effective_speech_confirmed = False
        self.ambient_learning_paused_for_voice = False
        self._vad_inactive_frames = 0

        # Subscribers (e.g. WebSocket broadcast queues)
        self._listeners: List[Callable[[Dict[str, Any]], None]] = []

        # Calibration state
        self._is_calibrating = False
        self._calibration_levels: List[float] = []

    def _new_noise_profile(self):
        return AdaptiveNoiseProfile(
            self.config.sample_rate, window_seconds=self.config.ambient_window_seconds,
            noise_margin_db=self.config.noise_margin_db,
            speech_band_low_hz=self.config.speech_band_low_hz,
            speech_band_high_hz=self.config.speech_band_high_hz,
        )

    def _configure_detection_pipeline(self, force_vad=False):
        """Synchronize every stateful detector with the current AppConfig."""
        if force_vad or self.vad_detector is None or self.vad_detector.sample_rate != self.config.sample_rate:
            self.vad_detector = SileroVADDetector(sample_rate=self.config.sample_rate)
        self.noise_profile = self._new_noise_profile()
        self.speech_detector = SpeechDetector(
            self.config.vad_start_threshold, self.config.vad_stop_threshold,
            self.config.minimum_snr_db, self.config.minimum_speech_ms,
            frame_ms=1024 * 1000 / self.config.sample_rate,
            profile=self.config.detection_profile,
        )
        self.event_gate = AudioEventGate(
            start_margin_db=self.config.noise_margin_db,
            frame_ms=1024 * 1000 / self.config.sample_rate,
            end_hold_ms=self.config.ambient_confirm_ms,
        )

    def get_effective_detection_config(self):
        return {
            "detection_profile": self.speech_detector.profile.name,
            "configured_vad_start_threshold": self.config.vad_start_threshold,
            "configured_vad_stop_threshold": self.config.vad_stop_threshold,
            "configured_minimum_snr_db": self.config.minimum_snr_db,
            "configured_minimum_speech_ms": self.config.minimum_speech_ms,
            "effective_vad_start_threshold": self.speech_detector.start,
            "effective_vad_stop_threshold": self.speech_detector.continue_,
            "vad_continue_threshold": self.speech_detector.continue_,
            "effective_minimum_snr_db": self.speech_detector.minimum_snr,
            "effective_minimum_speech_ms": self.speech_detector.minimum_speech_ms,
        }

    def subscribe(self, callback: Callable[[Dict[str, Any]], None]):
        if callback not in self._listeners:
            self._listeners.append(callback)

    def should_learn_ambient(self, speech_probability: float, decision=None,
                             recording_active: bool | None = None) -> bool:
        """True only for audio explicitly classified as quiet calibration data."""
        if decision is None:
            return speech_probability < self.config.ambient_learning_vad_max
        return decision.ambient_update_allowed(
            speech_probability,
            self.recorder.is_recording if recording_active is None else recording_active,
            self.config.ambient_learning_vad_max,
        )

    def _effective_confirmation(self, decision, speech_probability: float) -> bool:
        """A confirmed human voice is the sole recording authorization."""
        effective = bool(decision.speech_confirmed)
        self.effective_speech_confirmed = effective
        self.ambient_learning_paused_for_voice = bool(
            self.ambient_learning and (
                decision.is_candidate or decision.speech_confirmed
            )
        )
        return effective

    def _reset_detection_state(self) -> None:
        self.effective_speech_confirmed = False
        self.ambient_learning_paused_for_voice = False

    def _prepare_detection_chunk(self, chunk):
        """Return finite gain-adjusted detection audio; never mutate archive audio."""
        raw = np.asarray(chunk, dtype=np.float32).reshape(-1).copy()
        if not np.isfinite(raw).all():
            raw = np.nan_to_num(raw, nan=0.0, posinf=1.0, neginf=-1.0)
        raw_rms, raw_dbfs = self.rms_detector.process_chunk(raw)
        raw_peak = float(np.max(np.abs(raw))) if raw.size else 0.0
        self.raw_level_dbfs = round(raw_dbfs, 1)
        self.raw_peak_dbfs = round(self.rms_detector.rms_to_dbfs(raw_peak), 1)
        if self.config.auto_gain_control:
            target = 10 ** ((-30.0 - raw_dbfs) / 20.0) if raw_rms > 1e-5 else 1.0
            target = float(np.clip(target, .25, 8.0))
            if raw_peak:
                target = min(target, .98 / raw_peak)
            rate = .25 if target > self.effective_gain else .08
            self.effective_gain += rate * (target - self.effective_gain)
        else:
            self.effective_gain = self.config.input_gain
        return raw, np.clip(raw * self.effective_gain, -1.0, 1.0).astype(np.float32)

    def _raw_ambient_baseline(self) -> Optional[float]:
        """Return the measured raw baseline, or ``None`` while it is learning."""
        if not self._raw_ambient_levels:
            return None
        # The lower half of the window follows a changing room floor but is
        # insensitive to isolated knocks and speech bursts.
        values = np.asarray(self._raw_ambient_levels, dtype=np.float32)
        return float(np.percentile(values, 40))

    def is_verified_quiet(self, speech_probability: float, decision=None,
                          event_active: bool = False) -> bool:
        """Shared definition used by automatic and manual ambient learning."""
        return bool(
            speech_probability < self.config.ambient_learning_vad_max
            and not getattr(decision, "is_candidate", False)
            and not getattr(decision, "speech_confirmed", False)
            and not self.recorder.is_recording
            and not event_active
        )

    def _learn_raw_ambient(self, raw_dbfs: float, speech_probability: float,
                           decision, event_active: bool) -> None:
        verified_quiet = self.is_verified_quiet(
            speech_probability, decision, event_active)
        if not verified_quiet:
            self._raw_ambient_quiet_bootstrap.clear()
            return

        if len(self._raw_ambient_levels) < 8:
            self._raw_ambient_quiet_bootstrap.append(float(raw_dbfs))
            if len(self._raw_ambient_quiet_bootstrap) < 8:
                return
            levels = np.asarray(self._raw_ambient_quiet_bootstrap, dtype=np.float32)
            # A half-second of quiet has little level modulation. Reject a
            # changing candidate window instead of mistaking speech onset for
            # the room floor, even when early Silero probabilities are low.
            if np.ptp(levels) > 3.0 or np.std(levels) > 1.25:
                self._raw_ambient_quiet_bootstrap.clear()
                return
            self._raw_ambient_levels.extend(self._raw_ambient_quiet_bootstrap)
            self._raw_ambient_quiet_bootstrap.clear()
            self.raw_ambient_ready = True
            self.raw_noise_floor_dbfs = round(self._raw_ambient_baseline(), 1)
            return

        baseline = self._raw_ambient_baseline()
        # Reject significant upward departures. Downward changes are safe and
        # let the estimator follow a quieter environment.
        if raw_dbfs <= baseline + 3.0:
            self._raw_ambient_levels.append(float(raw_dbfs))
            self.raw_noise_floor_dbfs = round(self._raw_ambient_baseline(), 1)

    @staticmethod
    def classify_signal(level_dbfs, peak_dbfs):
        if peak_dbfs >= -.2: return "clipping"
        if level_dbfs <= -85: return "silent"
        if level_dbfs <= -65: return "very_low"
        if level_dbfs <= -50: return "low"
        if level_dbfs <= -20: return "usable"
        return "strong"

    def _pipeline_diagnosis(self):
        # Fall back to the historical processed fields for integrations/tests
        # which populate diagnostic state directly rather than capture a frame.
        level = self.raw_level_dbfs if self.raw_level_dbfs > -90 else self.current_level_dbfs
        peak = self.raw_peak_dbfs if self.raw_peak_dbfs > -90 else self.current_peak_dbfs
        quality = self.classify_signal(level, peak)
        if quality == "silent": return "no_audio", "No usable audio samples are arriving."
        if quality in ("very_low", "low"):
            return "input_too_low", "Input is too low; check hardware level or detection gain."
        if self._vad_inactive_frames >= 6:
            return "vad_inactive", ("Audio signal detected but Silero VAD probability remains very low. "
                                    "Check channel selection, input routing or VAD preprocessing.")
        if not self.current_speech_candidate and self.current_speech_prob >= self.speech_detector.start:
            reason = self.current_speech_reject_reason
            return "vad_inactive", f"SpeechDetector rejection: {reason}"
        if self.current_speech_candidate and not self.current_speech_confirmed:
            return "minimum_duration", "Candidate is waiting for minimum speech duration."
        if self.current_speech_confirmed and not self.effective_speech_confirmed:
            return "recorder_not_started", "Confirmed voice did not reach the recorder; inspect the pipeline error."
        if self.effective_speech_confirmed and not self.recorder.is_recording:
            return "recorder_not_started", "Voice is confirmed; recorder has not activated yet."
        if self.current_speech_confirmed:
            return "voice_confirmed", "Human voice is confirmed and authorizes recording."
        if not self.raw_ambient_ready:
            return "raw_ambient_learning", "RAW ambient is waiting for a verified quiet window."
        return "ok", "Voice pipeline is operating normally."

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
        was_running = self._is_running
        if was_running:
            # Save/stop using the old identity before replacing the config.
            self.stop()
        self.config = new_config
        self.recorder.update_config(new_config)
        self._configure_detection_pipeline()
        if was_running:
            self.start()

    def _create_source(self) -> AudioSource:
        if self.config.source == "microphone":
            return MicrophoneSource(device_id=self.config.device_id, sample_rate=self.config.sample_rate,
                                    input_channel=self.config.input_channel)
        elif self.config.source == "usb":
            return SoundCardSource(device_id=self.config.device_id, sample_rate=self.config.sample_rate,
                                   input_channel=self.config.input_channel)
        elif self.config.source == "gnuradio":
            return GNURadioSource(fifo_path=self.config.fifo_path, sample_rate=self.config.sample_rate)
        return MicrophoneSource(device_id=None, sample_rate=self.config.sample_rate)

    def _try_alsa_fallback(self, failed_source: AudioSource) -> Optional[AudioSource]:
        if self.config.audio_backend not in ("auto", "alsa") or self.config.source == "gnuradio":
            return None
        device_name = getattr(failed_source, "device_name", "") or self.config.device_name or ""
        mapping = match_alsa_device(device_name)
        if mapping is None:
            self.current_error = f"No certain PortAudio to ALSA mapping for {device_name!r}"
            return None
        fallback = ALSAArecordSource(
            mapping, sample_rate=self.config.sample_rate,
            capture_sample_rate=getattr(failed_source, "capture_sample_rate", 48000),
            channels=getattr(failed_source, "capture_channels", 2),
            input_channel=self.config.input_channel,
        )
        print(f"[AUDIO START] Trying ALSA fallback: {mapping.identifier}")
        fallback.start()
        return fallback if fallback.verify_audio_stream() else (fallback.stop() or None)

    def start(self) -> bool:
        if self._is_running:
            return True

        self._reset_detection_state()
        self.current_error = None
        try:
            self.source = self._create_source()
            print(f"[AUDIO START] Requested source: {self.config.source}")
            if self.config.audio_backend == "alsa":
                original = self.source
                self.source = self._try_alsa_fallback(original)
                if self.source is None:
                    raise RuntimeError(self.current_error or "ALSA fallback unavailable")
            else:
                try:
                    self.source.start()
                except Exception:
                    failed = self.source
                    fallback = self._try_alsa_fallback(failed)
                    if fallback is None:
                        raise
                    self.source = fallback
                verifier = getattr(self.source, "verify_audio_stream", None)
                if verifier and not verifier():
                    failed = self.source
                    failed.stop()
                    fallback = None if isinstance(failed, ALSAArecordSource) else self._try_alsa_fallback(failed)
                    if fallback is None:
                        raise RuntimeError(
                            f"PortAudio opened {getattr(failed, 'device_name', self.config.device_name)} "
                            "but no audio frames were received"
                        )
                    self.source = fallback
        except Exception as e:
            self.current_error = f"Audio source error: {e}"
            self.current_status = "error"
            print(f"[MainAudioEngine] Start failed: {e}")
            return False

        self._is_running = True
        self.started_at = time.time()
        self.frames_received = 0
        self.last_audio_frame_at = None
        self.noise_profile = self._new_noise_profile()
        self.vad_detector.reset()
        self.speech_detector.reset()
        self.event_gate.reset()
        self._raw_ambient_levels.clear()
        self._raw_ambient_quiet_bootstrap.clear()
        self.raw_noise_floor_dbfs = None
        self.raw_ambient_ready = False
        self.ambient_learned_samples = 0
        self._ambient_device_name = getattr(self.source, "device_name", None) or self.config.device_name
        cached = self.ambient_profile_store.load(self.config, self._ambient_device_name)
        self.ambient_profile_loaded = bool(cached and self.noise_profile.load_profile(cached["profile"]))
        self.ambient_profile_age_seconds = cached["age_seconds"] if self.ambient_profile_loaded else None
        self.ambient_profile_source = "cached" if self.ambient_profile_loaded else "learning"
        self._ambient_profile_dirty = False
        self._ambient_profile_saved = self.ambient_profile_loaded
        self.ambient_learning = self.config.adaptive_noise and not self.ambient_profile_loaded
        self.current_status = "learning_ambient" if self.ambient_learning else "listening"
        self._thread = threading.Thread(target=self._audio_loop, daemon=True)
        self._thread.start()
        print(f"[MainAudioEngine] Started audio engine on source: {self.config.source}")
        return True

    def stop(self) -> None:
        self._is_running = False
        # Closing first unblocks a worker waiting in read_chunk and releases ALSA
        # promptly, making repeated Start/Stop safe.
        if self.source is not None:
            try:
                self.source.stop()
            except Exception as exc:
                print(f"[AUDIO ERROR] Stream close failed: {exc}")
        if self._thread is not None:
            self._thread.join(timeout=1.0)
            self._thread = None

        self._save_ambient_profile_if_valid()

        self.source = None

        self.recorder.stop_and_flush()
        self.current_status = "idle"
        self.current_level_dbfs = -90.0
        self.current_speech_prob = 0.0
        self.current_voice_detected = False
        self._reset_detection_state()

        self._broadcast(self.get_telemetry())
        print("[MainAudioEngine] Audio engine stopped.")

    def _save_ambient_profile_if_valid(self):
        if (self.config.adaptive_noise and not self.ambient_learning
                and self.noise_profile.frames_learned > 0
                and (self._ambient_profile_dirty or not self._ambient_profile_saved)):
            try:
                self.ambient_profile_store.save(
                    self.config, self.noise_profile, self._ambient_device_name)
                self._ambient_profile_dirty = False
                self._ambient_profile_saved = True
            except OSError as exc:
                print(f"[AMBIENT PROFILE] Save failed: {exc}")

    def reset_ambient_profile(self):
        """Forget this input's baseline and force verified quiet relearning."""
        deleted = self.ambient_profile_store.delete(self.config, self._ambient_device_name)
        self.noise_profile = self._new_noise_profile()
        self.ambient_profile_loaded = False
        self.ambient_profile_age_seconds = None
        self.ambient_profile_source = "learning"
        self._ambient_profile_dirty = False
        self._ambient_profile_saved = False
        self.ambient_learned_samples = 0
        self.ambient_learning = bool(self.config.adaptive_noise)
        self._reset_detection_state()
        self._raw_ambient_levels.clear()
        self._raw_ambient_quiet_bootstrap.clear()
        self.raw_noise_floor_dbfs = None
        self.raw_ambient_ready = False
        if self._is_running:
            self.current_status = "learning_ambient" if self.ambient_learning else "listening"
        return deleted

    def _audio_loop(self):
        last_broadcast_time = 0.0

        while self._is_running and self.source is not None:
            try:
                chunk = self.source.read_chunk(chunk_size=1024)
                if chunk is None or len(chunk) == 0:
                    now = time.time()
                    if self.started_at and now - self.started_at >= 2.0 and self.last_audio_frame_at is None and self.current_error is None:
                        self.current_error = "No audio callback received for 2 seconds"
                        print("[AUDIO ERROR] No audio callback received for 2 seconds")
                    elif self.last_audio_frame_at and now - self.last_audio_frame_at >= 2.0:
                        self.current_error = "Audio device disconnected or stopped delivering frames"
                        self.current_status = "error"
                        print("[AUDIO ERROR] Device disconnected: no frames for 2 seconds")
                        self._is_running = False
                        self.source.stop()
                        self._broadcast(self.get_telemetry())
                        break
                    if now - last_broadcast_time >= 0.12:
                        self._broadcast(self.get_telemetry())
                        last_broadcast_time = now
                    time.sleep(0.01)
                    continue

                # Split paths: archive remains the captured signal; gain is detection-only.
                raw_chunk, chunk = self._prepare_detection_chunk(chunk)

                # Preserve real processed samples for the realtime chart.
                indices = np.linspace(0, len(chunk) - 1, 128).astype(int)
                self.current_waveform = np.round(chunk[indices], 5).tolist()
                windowed = chunk * np.hanning(len(chunk))
                magnitudes = np.abs(np.fft.rfft(windowed)) / max(1, len(chunk) / 2)
                spectrum_db = 20 * np.log10(np.maximum(magnitudes, 1e-5))
                spectrum_indices = np.linspace(0, len(spectrum_db) - 1, 64).astype(int)
                self.current_spectrum = np.clip((spectrum_db[spectrum_indices] + 100) / 100, 0, 1).round(5).tolist()
                detection_spectrum = self.noise_profile.spectrum(chunk)

                # 1. Compute RMS & dBFS
                rms, dbfs = self.rms_detector.process_chunk(chunk)
                self.current_level_dbfs = round(dbfs, 1)
                peak = float(np.max(np.abs(chunk))) if len(chunk) else 0.0
                self.current_peak_dbfs = round(self.rms_detector.rms_to_dbfs(peak), 1)
                self.frames_received += len(chunk)
                self.last_audio_frame_at = time.time()
                if self.frames_received <= len(chunk) or self.frames_received % self.config.sample_rate < len(chunk):
                    print(f"[AUDIO ENGINE] frames_received={self.frames_received} processing_rate={self.config.sample_rate} level={self.current_level_dbfs:.1f}")
                if self.current_error == "No audio callback received for 2 seconds":
                    self.current_error = None
                # 2. Compute Voice Activity Detection (Silero VAD)
                speech_prob = self.vad_detector.get_speech_probability(chunk)
                self.current_speech_prob = round(speech_prob, 2)
                if dbfs > -50 and speech_prob < .10:
                    self._vad_inactive_frames += 1
                else:
                    self._vad_inactive_frames = 0

                noise_metrics = self.noise_profile.analyse(dbfs, detection_spectrum)
                raw_ambient = self._raw_ambient_baseline()
                if raw_ambient is None:
                    self.event_gate.reset()
                    event = AudioEventDecision(
                        False, self.raw_level_dbfs, None, None, None, None, None,
                    )
                else:
                    self.raw_noise_floor_dbfs = round(raw_ambient, 1)
                    event = self.event_gate.process(self.raw_level_dbfs, raw_ambient)
                self.current_event_active = event.event_active
                decision = self.speech_detector.process(
                    speech_prob, dbfs, noise_metrics.noise_floor_dbfs,
                    noise_metrics.broadband_snr_db, noise_metrics.speech_band_snr_db,
                    noise_metrics.spectral_difference,
                )
                effective_speech_confirmed = self._effective_confirmation(decision, speech_prob)
                # Product invariant: a confirmed human voice is the complete
                # recording authorization. The raw event gate is diagnostic.
                human_voice_confirmed = bool(decision.speech_confirmed)
                record_authorized = human_voice_confirmed
                effective_speech_confirmed = record_authorized
                self.effective_speech_confirmed = record_authorized
                self._learn_raw_ambient(
                    self.raw_level_dbfs, speech_prob, decision, event.event_active)
                if (self._is_calibrating and self.raw_ambient_ready
                        and self.is_verified_quiet(speech_prob, decision, event.event_active)):
                    self._calibration_levels.append(self.raw_level_dbfs)
                learning_samples = int(self.config.ambient_learning_seconds * self.config.sample_rate)
                if self.ambient_learning:
                    # Calibration is measured in verified quiet audio, not wall time.
                    # An empty profile needs quiet bootstrap frames; a restored or
                    # partially learned profile can also reject radio signatures.
                    if (self.raw_ambient_ready
                            and self.should_learn_ambient(speech_prob, decision)):
                        self.noise_profile.update(dbfs, detection_spectrum)
                        self.ambient_learned_samples += len(chunk)
                    # Chunk boundaries may straddle the configured duration; one
                    # analysis frame of tolerance avoids requiring a whole extra
                    # quiet frame while still never learning a voice frame.
                    if self.ambient_learned_samples >= max(0, learning_samples - len(chunk)):
                        self.ambient_learning = False
                        self.current_status = "listening"
                        self._ambient_profile_dirty = True
                        self._save_ambient_profile_if_valid()
                noise_metrics = self.noise_profile.analyse(dbfs, detection_spectrum)
                # Never absorb probable voice or an active event into the room baseline.
                if (self.config.adaptive_noise and not self.ambient_learning
                        and decision.ambient_update_allowed(
                            speech_prob, self.recorder.is_recording, .15)):
                    self.noise_profile.update(dbfs, detection_spectrum)
                    self._ambient_profile_dirty = True
                    noise_metrics = self.noise_profile.analyse(dbfs, detection_spectrum)
                self.noise_floor_dbfs = round(noise_metrics.noise_floor_dbfs, 1)
                self.current_dynamic_threshold = round(noise_metrics.dynamic_threshold_dbfs, 1)
                self.current_snr = round(noise_metrics.broadband_snr_db, 1)
                self.current_speech_band_snr = round(noise_metrics.speech_band_snr_db, 1)
                self.current_spectral_change = round(noise_metrics.spectral_difference, 3)
                self.current_ambient_spectrum = self.noise_profile.display_spectrum()
                self.current_radio_activity = decision.radio_activity
                self.current_radio_activity_score = decision.radio_activity_score
                self.current_speech_candidate = decision.is_candidate
                self.current_speech_confirmed = decision.speech_confirmed
                self.current_speech_reject_reason = (
                    "ambient_learning_active" if self.ambient_learning else decision.reject_reason
                )

                # 3. Process recorder state machine
                status, voice_detected, is_recording = self.recorder.process_frame(
                    raw_chunk, self.current_level_dbfs, self.current_speech_prob,
                    speech_confirmed=effective_speech_confirmed,
                    candidate=decision.is_candidate, event_active=event.event_active,
                    radio_activity=decision.radio_activity,
                    confidence=decision.confidence,
                    metrics={"noise_floor_dbfs": noise_metrics.noise_floor_dbfs,
                             "raw_noise_floor_dbfs": raw_ambient,
                             "raw_level_dbfs": self.raw_level_dbfs,
                             "event_delta_db": event.delta_db,
                             "dynamic_threshold_dbfs": noise_metrics.dynamic_threshold_dbfs,
                             "snr_db": noise_metrics.broadband_snr_db,
                             "speech_band_snr_db": noise_metrics.speech_band_snr_db,
                             "spectral_change": noise_metrics.spectral_difference,
                             "speech_probability": speech_prob,
                             "speech_confirmed": decision.speech_confirmed,
                             "effective_speech_confirmed": effective_speech_confirmed,
                             "radio_activity": decision.radio_activity,
                             "radio_activity_score": decision.radio_activity_score},
                    vad_backend=self.vad_detector.vad_backend,
                    return_to_ambient=(not event.event_active and
                                       speech_prob < self.config.vad_stop_threshold),
                )
                self.ambient_learning_paused_for_voice = bool(
                    self.ambient_learning and (
                        effective_speech_confirmed or is_recording
                        or decision.is_candidate
                    )
                )
                self.current_status = (("calibration_paused_recording_voice"
                    if self.ambient_learning_paused_for_voice else
                    ("calibration_paused_voice_present"
                    if speech_prob >= self.config.ambient_learning_vad_max else "learning_ambient"))
                    if self.ambient_learning else status)
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
        now = time.time()
        source = self.source
        last_frame_ms = None if self.last_audio_frame_at is None else round((now - self.last_audio_frame_at) * 1000)
        receiving = last_frame_ms is not None and last_frame_ms < 1000
        if self.config.source != "gnuradio" and self.config.device_id is None:
            signal_state = "no_device"
        elif self._is_running and not receiving and self.started_at and now - self.started_at > 1.0:
            signal_state = "no_audio_data"
        elif self.current_level_dbfs <= -85:
            signal_state = "silence"
        elif self.raw_ambient_ready and self.raw_noise_floor_dbfs is not None and (
                self.raw_level_dbfs < self.raw_noise_floor_dbfs + self.config.noise_margin_db):
            signal_state = "low_signal"
        elif self.current_voice_detected:
            signal_state = "voice"
        else:
            signal_state = "signal"
        diagnosis, hint = self._pipeline_diagnosis()
        selector = getattr(source, "channel_selector", None)
        selected_index = getattr(selector, "selected_index", 0)
        channel_levels = getattr(selector, "channel_rms_dbfs", [self.raw_level_dbfs, -100.0])
        return {
            "timestamp": now,
            "level_dbfs": self.current_level_dbfs,
            "raw_level_dbfs": self.raw_level_dbfs,
            "processed_level_dbfs": self.current_level_dbfs,
            "raw_peak_dbfs": self.raw_peak_dbfs,
            "processed_peak_dbfs": self.current_peak_dbfs,
            "rms_dbfs": self.current_level_dbfs,
            "peak_dbfs": self.current_peak_dbfs,
            "noise_floor_dbfs": self.noise_floor_dbfs,
            "raw_noise_floor_dbfs": self.raw_noise_floor_dbfs,
            "dynamic_threshold_dbfs": self.current_dynamic_threshold,
            "raw_ambient_ready": self.raw_ambient_ready,
            "event_active": self.current_event_active,
            "event_delta_db": (round(self.raw_level_dbfs - self.raw_noise_floor_dbfs, 1)
                               if self.raw_noise_floor_dbfs is not None else None),
            "event_start_threshold_dbfs": (min(0.0, self.raw_noise_floor_dbfs + self.event_gate.start_margin_db)
                                            if self.raw_noise_floor_dbfs is not None else None),
            "event_continue_threshold_dbfs": (min(0.0, self.raw_noise_floor_dbfs + self.event_gate.continue_margin_db)
                                               if self.raw_noise_floor_dbfs is not None else None),
            "event_end_threshold_dbfs": (min(0.0, self.raw_noise_floor_dbfs + self.event_gate.end_margin_db)
                                          if self.raw_noise_floor_dbfs is not None else None),
            "snr_db": self.current_snr,
            "speech_band_snr_db": self.current_speech_band_snr,
            "spectral_change": self.current_spectral_change,
            "radio_activity": self.current_radio_activity,
            "radio_activity_score": self.current_radio_activity_score,
            "ambient_learning": self.ambient_learning,
            "ambient_learned_seconds": round(self.ambient_learned_samples / self.config.sample_rate, 3),
            "ambient_learning_vad_max": self.config.ambient_learning_vad_max,
            "effective_speech_confirmed": self.effective_speech_confirmed,
            "ambient_learning_paused_for_voice": self.ambient_learning_paused_for_voice,
            "ambient_profile_loaded": self.ambient_profile_loaded,
            "ambient_profile_age_seconds": self.ambient_profile_age_seconds,
            "ambient_profile_key": self.ambient_profile_store.key(
                self.config, self._ambient_device_name),
            "ambient_profile_source": self.ambient_profile_source,
            "speech_probability": self.current_speech_prob,
            "speech_candidate": self.current_speech_candidate,
            "speech_confirmed": self.current_speech_confirmed,
            "speech_reject_reason": self.current_speech_reject_reason,
            "minimum_snr_db": self.speech_detector.minimum_snr,
            "voice_detected": self.current_voice_detected,
            "recording": self.recorder.is_recording,
            "status": self.current_status,
            "error_message": self.current_error,
            # Opening a FIFO succeeds even when GNU Radio has no writer.  For that
            # source, real received frames are the only honest connectivity signal.
            "device_connected": bool(
                self._is_running and source and source.is_active
                and (self.config.source != "gnuradio" or receiving)
            ),
            "audio_frames_received": receiving,
            "frames_received": self.frames_received,
            "callback_count": getattr(source, "callback_count", 0),
            "last_audio_frame_ms": last_frame_ms,
            "signal_state": signal_state,
            "device_name": getattr(source, "device_name", self.config.device_name),
            "capture_sample_rate": getattr(source, "capture_sample_rate", self.config.sample_rate),
            "processing_sample_rate": self.config.sample_rate,
            "channels": 1,
            "capture_channels": getattr(source, "capture_channels", 1),
            "hostapi": getattr(source, "host_api", ""),
            "capture_backend": "alsa" if isinstance(source, ALSAArecordSource) else "portaudio",
            "alsa_device": getattr(getattr(source, "alsa_device", None), "identifier", None),
            "input_channel": self.config.input_channel,
            "selected_channel": getattr(selector, "selected_channel", "channel_1"),
            "selected_channel_index": selected_index,
            "channel_1_rms_dbfs": round(channel_levels[0], 1),
            "channel_2_rms_dbfs": round(channel_levels[1], 1),
            "input_signal_quality": self.classify_signal(self.raw_level_dbfs, self.raw_peak_dbfs),
            "signal_present_but_vad_inactive": self._vad_inactive_frames >= 6,
            "voice_pipeline_diagnosis": diagnosis,
            "voice_pipeline_hint": hint,
            "effective_gain": round(self.effective_gain, 3),
            "agc_active": self.config.auto_gain_control,
            "waveform": self.current_waveform,
            "spectrum": self.current_spectrum,
            "ambient_spectrum": self.current_ambient_spectrum,
            **self.get_effective_detection_config(),
            **self.recorder.session_telemetry(),
            **self.vad_detector.diagnostics(),
        }

    def restart(self) -> bool:
        self.stop()
        return self.start()

    def calibrate_noise_floor(self, duration_sec: float = 3.0) -> Dict[str, Any]:
        """
        Listens to ambient noise for duration_sec, calculates average noise floor dBFS,
        and returns recommended trigger threshold.
        """
        was_running = self._is_running
        if not was_running:
            self.start()

        self._calibration_levels = []
        self._is_calibrating = True

        required = int(duration_sec * self.config.sample_rate)
        deadline = time.monotonic() + max(duration_sec * 4, duration_sec + 5)
        while (len(self._calibration_levels) * 1024 < required
               and time.monotonic() < deadline):
            time.sleep(.05)

        self._is_calibrating = False
        valid_samples = [x for x in self._calibration_levels if x > -95.0]

        if valid_samples:
            values = np.asarray(valid_samples)
            noise_floor = float(np.median(values))
            mean = float(np.mean(values))
            p90 = float(np.percentile(values, 90))
            peak = float(np.max(values))
        else:
            noise_floor = -58.0
            mean = p90 = peak = noise_floor

        recommended = float(np.clip(max(noise_floor + 8.0, p90 + 4.0), -90.0, 0.0))

        if not was_running:
            self.stop()

        return {
            "noise_floor_dbfs": round(noise_floor, 1),
            "noise_mean_dbfs": round(mean, 1),
            "noise_median_dbfs": round(noise_floor, 1),
            "noise_p90_dbfs": round(p90, 1),
            "noise_peak_dbfs": round(peak, 1),
            "recommended_threshold_dbfs": round(recommended, 1),
            "margin_db": round(recommended - noise_floor, 1),
            "quiet_seconds": round(len(valid_samples) * 1024 / self.config.sample_rate, 2),
            "sample_count": len(valid_samples),
        }
