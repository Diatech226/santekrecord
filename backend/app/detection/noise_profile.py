"""Bounded adaptive room-noise and spectral baseline model."""
from collections import deque
from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class NoiseMetrics:
    noise_floor_dbfs: float
    noise_variance_db: float
    dynamic_threshold_dbfs: float
    broadband_snr_db: float
    speech_band_snr_db: float
    spectral_difference: float


class AdaptiveNoiseProfile:
    """Learns ambient levels/spectra without unbounded history.

    Spectra are linear power values.  A rolling median resists short clicks and
    an EMA lets persistent changes such as a newly started fan settle gradually.
    """

    VERSION = 1

    def __init__(self, sample_rate=16000, fft_size=1024, window_seconds=20.0,
                 noise_margin_db=8.0, speech_band_low_hz=250.0,
                 speech_band_high_hz=4000.0):
        self.sample_rate = sample_rate
        self.fft_size = fft_size
        self.noise_margin_db = noise_margin_db
        self.low_hz, self.high_hz = speech_band_low_hz, speech_band_high_hz
        # About 16 observations/s for the engine's normal 1024-sample chunks.
        size = max(8, int(window_seconds * sample_rate / fft_size))
        self._levels = deque(maxlen=size)
        self._spectra = deque(maxlen=min(size, 160))
        self.noise_floor_dbfs = -90.0
        self.noise_variance_db = 0.0
        self.noise_spectrum = np.zeros(fft_size // 2 + 1, dtype=np.float32)
        self.mean_spectrum = self.noise_spectrum.copy()
        self.frames_learned = 0

    def spectrum(self, samples):
        x = np.asarray(samples, dtype=np.float32)
        if len(x) < self.fft_size:
            x = np.pad(x, (0, self.fft_size - len(x)))
        elif len(x) > self.fft_size:
            x = x[:self.fft_size]
        windowed = x * np.hanning(self.fft_size)
        return (np.abs(np.fft.rfft(windowed)) ** 2 / self.fft_size).astype(np.float32)

    def update(self, dbfs, spectrum):
        spectrum = np.asarray(spectrum, dtype=np.float32)
        self._levels.append(float(dbfs))
        self._spectra.append(spectrum.copy())
        levels = np.asarray(self._levels)
        # 30th percentile estimates normal room energy without tracking silence only.
        target = float(np.percentile(levels, 30))
        self.noise_floor_dbfs = target if self.frames_learned == 0 else 0.95 * self.noise_floor_dbfs + 0.05 * target
        self.noise_variance_db = float(np.var(levels))
        stack = np.stack(self._spectra)
        median = np.median(stack, axis=0)
        mean = np.mean(stack, axis=0)
        if self.frames_learned == 0:
            self.noise_spectrum, self.mean_spectrum = median, mean
        else:
            self.noise_spectrum = 0.95 * self.noise_spectrum + 0.05 * median
            self.mean_spectrum = 0.95 * self.mean_spectrum + 0.05 * mean
        self.frames_learned += 1

    @property
    def dynamic_threshold_dbfs(self):
        return float(np.clip(self.noise_floor_dbfs + self.noise_margin_db, -90.0, 0.0))

    def analyse(self, current_dbfs, current_spectrum):
        current = np.asarray(current_spectrum, dtype=np.float32)
        eps = 1e-12
        freqs = np.fft.rfftfreq(self.fft_size, 1 / self.sample_rate)
        band = (freqs >= self.low_hz) & (freqs <= min(self.high_hz, self.sample_rate / 2))
        current_band = float(np.sum(current[band]))
        noise_band = float(np.sum(self.noise_spectrum[band]))
        band_snr = 10 * np.log10((current_band + eps) / (noise_band + eps))
        # Normalized log-spectral distance is stable across input gain changes.
        delta = np.mean(np.abs(10 * np.log10(current + eps) - 10 * np.log10(self.noise_spectrum + eps)))
        return NoiseMetrics(
            self.noise_floor_dbfs, self.noise_variance_db,
            self.dynamic_threshold_dbfs, float(current_dbfs - self.noise_floor_dbfs),
            float(np.clip(band_snr, -40, 60)), float(np.clip(delta / 30.0, 0, 1)),
        )

    def display_spectrum(self, bins=64):
        indices = np.linspace(0, len(self.noise_spectrum) - 1, bins).astype(int)
        db = 10 * np.log10(np.maximum(self.noise_spectrum[indices], 1e-10))
        return np.clip((db + 100) / 100, 0, 1).round(5).tolist()

    def export_profile(self):
        """Return the stable ambient baseline without exposing private state."""
        return {
            "version": self.VERSION,
            "sample_rate": self.sample_rate,
            "fft_size": self.fft_size,
            "noise_floor_dbfs": self.noise_floor_dbfs,
            "noise_variance_db": self.noise_variance_db,
            "noise_spectrum": self.noise_spectrum.tolist(),
            "mean_spectrum": self.mean_spectrum.tolist(),
            "frames_learned": self.frames_learned,
        }

    def load_profile(self, data):
        """Load a compatible exported baseline, returning False for stale data."""
        try:
            noise = np.asarray(data["noise_spectrum"], dtype=np.float32)
            mean = np.asarray(data["mean_spectrum"], dtype=np.float32)
            compatible = (
                data.get("version") == self.VERSION
                and int(data["sample_rate"]) == self.sample_rate
                and int(data["fft_size"]) == self.fft_size
                and noise.shape == self.noise_spectrum.shape
                and mean.shape == self.mean_spectrum.shape
                and int(data.get("frames_learned", 0)) > 0
                and np.all(np.isfinite(noise)) and np.all(np.isfinite(mean))
            )
            if not compatible:
                return False
            self.noise_floor_dbfs = float(data["noise_floor_dbfs"])
            self.noise_variance_db = float(data.get("noise_variance_db", 0.0))
            self.noise_spectrum = noise
            self.mean_spectrum = mean
            self.frames_learned = int(data["frames_learned"])
            # Seed rolling history so the first background update cannot replace
            # a mature cached profile with one frame.
            self._levels.append(self.noise_floor_dbfs)
            self._spectra.append(self.noise_spectrum.copy())
            return True
        except (KeyError, TypeError, ValueError, OverflowError):
            return False
