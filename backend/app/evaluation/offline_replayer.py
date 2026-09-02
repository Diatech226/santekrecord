"""Fast WAV replay through the production detection and recording components."""
from __future__ import annotations

import tempfile
import wave
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from ..config.settings import AppConfig
from ..detection.noise_profile import AdaptiveNoiseProfile
from ..detection.rms import RMSDetector
from ..detection.speech_detector import SpeechDetector
from ..detection.vad import SileroVADDetector
from ..recording.recorder import AudioRecorderEngine


@dataclass
class ReplayResult:
    file: str
    sample_rate: int
    duration_seconds: float
    communications: list[dict]
    frame_decisions: list[dict]

    def as_dict(self):
        return self.__dict__


def _read_wav(path: Path) -> tuple[np.ndarray, int]:
    with wave.open(str(path), "rb") as wav:
        channels, width, rate = wav.getnchannels(), wav.getsampwidth(), wav.getframerate()
        raw = wav.readframes(wav.getnframes())
    if width != 2:
        raise ValueError(f"Only PCM-16 WAV is supported (got {width * 8}-bit)")
    audio = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
    if channels > 1:
        audio = audio.reshape(-1, channels).mean(axis=1)
    return audio, rate


class OfflineAudioReplayer:
    """Drive production algorithms by sample position, without sleeping.

    AudioRecorderEngine, SpeechDetector, VAD, noise profiling, transmission and
    communication managers are the same classes used by MainAudioEngine.
    """

    def __init__(self, config: AppConfig | None = None, frame_samples: int = 1024):
        self.config = (config or AppConfig()).model_copy(deep=True)
        self.frame_samples = frame_samples

    def replay(self, wav_path: str | Path) -> ReplayResult:
        path = Path(wav_path)
        audio, source_rate = _read_wav(path)
        if source_rate != self.config.sample_rate:
            size = round(len(audio) * self.config.sample_rate / source_rate)
            audio = np.interp(np.linspace(0, len(audio) - 1, size), np.arange(len(audio)), audio).astype(np.float32)
        sample_rate = self.config.sample_rate
        rms_detector = RMSDetector()
        vad = SileroVADDetector(sample_rate=sample_rate)
        noise = AdaptiveNoiseProfile(sample_rate, window_seconds=self.config.ambient_window_seconds,
                                     noise_margin_db=self.config.noise_margin_db,
                                     speech_band_low_hz=self.config.speech_band_low_hz,
                                     speech_band_high_hz=self.config.speech_band_high_hz)
        speech = SpeechDetector(self.config.vad_start_threshold, self.config.vad_stop_threshold,
                                self.config.minimum_snr_db, self.config.minimum_speech_ms,
                                frame_ms=self.frame_samples * 1000 / sample_rate)
        metadata, decisions, clock = [], [], {"sample": 0}
        with tempfile.TemporaryDirectory(prefix="santek-eval-") as output:
            recorder = AudioRecorderEngine(self.config, output,
                lambda meta, _: metadata.append((meta.model_dump(), clock["sample"])))
            learning_samples = round(self.config.ambient_learning_seconds * sample_rate)
            position = 0
            # A deterministic tail gives sample-clock state machines enough time to close.
            tail = round((self.config.transmission_end_timeout_seconds + self.config.communication_end_timeout_seconds + 1) * sample_rate)
            stream = np.concatenate((audio, np.zeros(tail, dtype=np.float32)))
            while position < len(stream):
                raw = stream[position:position + self.frame_samples]
                if len(raw) < self.frame_samples:
                    raw = np.pad(raw, (0, self.frame_samples - len(raw)))
                gain = self.config.input_gain
                chunk = np.clip(raw * gain, -1, 1).astype(np.float32)
                spectrum = noise.spectrum(chunk)
                _, dbfs = rms_detector.process_chunk(chunk)
                probability = vad.get_speech_probability(chunk)
                if position < learning_samples:
                    noise.update(dbfs, spectrum)
                metrics = noise.analyse(dbfs, spectrum)
                decision = speech.process(probability, dbfs, metrics.noise_floor_dbfs,
                                          metrics.broadband_snr_db, metrics.speech_band_snr_db,
                                          metrics.spectral_difference)
                learning = position < learning_samples
                ambient = (metrics.spectral_difference < self.config.ambient_return_spectral_threshold and
                           metrics.broadband_snr_db < self.config.minimum_snr_db and
                           probability < self.config.vad_stop_threshold and not decision.radio_activity)
                clock["sample"] = min(position + len(raw), len(audio))
                recorder.process_frame(raw, dbfs, probability,
                    speech_confirmed=False if learning else decision.speech_confirmed,
                    candidate=decision.is_candidate, radio_activity=decision.radio_activity,
                    confidence=decision.confidence, return_to_ambient=ambient,
                    vad_backend=vad.vad_backend, metrics={"noise_floor_dbfs": metrics.noise_floor_dbfs,
                    "dynamic_threshold_dbfs": metrics.dynamic_threshold_dbfs,
                    "snr_db": metrics.broadband_snr_db, "speech_band_snr_db": metrics.speech_band_snr_db,
                    "spectral_change": metrics.spectral_difference})
                if position < len(audio):
                    decisions.append({"start_sample": position, "end_sample": min(position + len(raw), len(audio)),
                                      "speech": bool(decision.speech_confirmed and not learning),
                                      "radio_activity": bool(decision.radio_activity)})
                position += self.frame_samples
            recorder.stop_and_flush()
        communications = []
        for meta, end_sample in metadata:
            raw_start = max(0, end_sample / sample_rate - meta.get("raw_event_duration_seconds", meta["duration_seconds"]))
            start_sec = raw_start + meta.get("trimmed_leading_seconds", 0)
            transmissions = []
            for transmission in meta.get("transmissions", []):
                tx = {**transmission, "start_sec": start_sec + transmission["start_sec"],
                      "end_sec": start_sec + transmission["end_sec"]}
                tx["speech_segments"] = [{**segment, "start_sec": start_sec + segment["start_sec"],
                    "end_sec": start_sec + segment["end_sec"]} for segment in transmission.get("speech_segments", [])]
                transmissions.append(tx)
            communications.append({"id": meta["communication_id"], "start_sec": start_sec,
                "end_sec": start_sec + meta["duration_seconds"], "transmissions": transmissions})
        return ReplayResult(path.name, sample_rate, len(audio) / sample_rate, communications, decisions)
