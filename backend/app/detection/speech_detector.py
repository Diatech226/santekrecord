"""Multi-feature speech decision with hysteresis and temporal confirmation."""
from collections import deque
from dataclasses import dataclass


@dataclass(frozen=True)
class SpeechDecision:
    is_candidate: bool
    speech_confirmed: bool
    confidence: float
    radio_activity: bool


class SpeechDetector:
    def __init__(self, vad_start_threshold=.65, vad_continue_threshold=.35,
                 minimum_snr_db=6.0, minimum_speech_ms=160, frame_ms=64):
        self.start = vad_start_threshold
        self.continue_ = vad_continue_threshold
        self.minimum_snr = minimum_snr_db
        self.required = max(2, int(round(minimum_speech_ms / frame_ms)))
        self.hits = deque(maxlen=self.required)
        self.active = False

    def reset(self):
        self.hits.clear(); self.active = False

    def process(self, speech_probability, current_dbfs, noise_floor_dbfs, snr_db,
                speech_band_snr_db, spectral_change):
        vad_limit = self.continue_ if self.active else self.start
        snr_score = max(0.0, min(1.0, snr_db / max(1.0, self.minimum_snr * 2)))
        band_score = max(0.0, min(1.0, speech_band_snr_db / max(1.0, self.minimum_snr * 2)))
        confidence = .60 * speech_probability + .20 * snr_score + .15 * band_score + .05 * spectral_change
        # Very certain VAD may survive marginal SNR; ordinary decisions need both.
        candidate = (speech_probability >= vad_limit and (snr_db >= self.minimum_snr or speech_probability >= .85))
        self.hits.append(candidate)
        confirmed = candidate and (self.active or sum(self.hits) >= self.required)
        self.active = confirmed
        radio = (snr_db >= self.minimum_snr or spectral_change >= .18) and not confirmed
        return SpeechDecision(candidate, confirmed, round(confidence, 4), radio)
