"""Profile-driven speech decisions with hysteresis and diagnostics."""
from collections import deque
from dataclasses import dataclass


@dataclass(frozen=True)
class SpeechDecision:
    is_candidate: bool
    speech_confirmed: bool
    confidence: float
    radio_activity: bool
    reject_reason: str


@dataclass(frozen=True)
class DetectionProfile:
    name: str
    high_vad_override: float
    use_radio_features: bool

    def candidate(self, probability, vad_limit, snr_db, minimum_snr,
                  speech_band_snr_db, spectral_change):
        if probability < vad_limit:
            return False, "vad_too_low"
        if probability >= self.high_vad_override:
            return True, "candidate_waiting_confirmation"
        if snr_db < minimum_snr:
            return False, "snr_too_low"
        if self.use_radio_features and speech_band_snr_db < minimum_snr and spectral_change < .18:
            return False, "radio_features_too_low"
        return True, "candidate_waiting_confirmation"


RADIO_ROOM = DetectionProfile("radio_room", .85, True)
GENERAL_VOICE = DetectionProfile("general_voice", .80, False)
PROFILES = {profile.name: profile for profile in (RADIO_ROOM, GENERAL_VOICE)}


class SpeechDetector:
    def __init__(self, vad_start_threshold=.65, vad_continue_threshold=.35,
                 minimum_snr_db=6.0, minimum_speech_ms=160, frame_ms=64,
                 profile="radio_room"):
        self.profile = PROFILES.get(profile, RADIO_ROOM)
        # General voice has intentionally conversation-friendly defaults, but an
        # explicitly more permissive configured value is still respected.
        if self.profile is GENERAL_VOICE:
            vad_start_threshold = min(vad_start_threshold, .50)
            vad_continue_threshold = min(vad_continue_threshold, .30)
            minimum_snr_db = min(minimum_snr_db, 3.0)
            minimum_speech_ms = min(minimum_speech_ms, 120)
        self.start = vad_start_threshold
        self.continue_ = vad_continue_threshold
        self.minimum_snr = minimum_snr_db
        self.required = max(2, int(round(minimum_speech_ms / frame_ms)))
        self.hits = deque(maxlen=self.required)
        self.active = False

    def reset(self):
        self.hits.clear()
        self.active = False

    def process(self, speech_probability, current_dbfs, noise_floor_dbfs, snr_db,
                speech_band_snr_db, spectral_change):
        vad_limit = self.continue_ if self.active else self.start
        candidate, reason = self.profile.candidate(
            speech_probability, vad_limit, snr_db, self.minimum_snr,
            speech_band_snr_db, spectral_change)
        snr_score = max(0.0, min(1.0, snr_db / max(1.0, self.minimum_snr * 2)))
        band_score = max(0.0, min(1.0, speech_band_snr_db / max(1.0, self.minimum_snr * 2)))
        confidence = .60 * speech_probability + .20 * snr_score + .15 * band_score + .05 * spectral_change
        self.hits.append(candidate)
        confirmed = candidate and (self.active or sum(self.hits) >= self.required)
        self.active = confirmed
        if confirmed:
            reason = "speech_confirmed"
        elif candidate:
            reason = "minimum_duration_not_reached"
        radio = self.profile.use_radio_features and (snr_db >= self.minimum_snr or spectral_change >= .18) and not confirmed
        return SpeechDecision(candidate, confirmed, round(confidence, 4), radio, reason)
