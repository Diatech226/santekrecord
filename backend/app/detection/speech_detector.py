"""Profile-driven speech decisions with hysteresis and diagnostics."""
from collections import deque
from dataclasses import dataclass


@dataclass(frozen=True)
class SpeechDecision:
    is_candidate: bool
    speech_confirmed: bool
    confidence: float
    radio_activity: bool
    radio_activity_score: float
    reject_reason: str

    def ambient_update_allowed(self, speech_probability, recording_active,
                               low_probability_threshold=.15):
        """Whether this frame is safe evidence of the room without communication."""
        return (speech_probability < low_probability_threshold
                and not self.is_candidate
                and not self.speech_confirmed
                and not self.radio_activity
                and not recording_active)


@dataclass(frozen=True)
class DetectionProfile:
    name: str
    use_radio_features: bool

    def candidate(self, probability, vad_limit, snr_db, minimum_snr,
                  speech_band_snr_db, spectral_change):
        if probability < vad_limit:
            return False, "vad_too_low"
        # Silero is the voice classifier. Level/SNR and radio signatures remain
        # useful confidence diagnostics, but never veto a positive VAD decision.
        return True, "candidate_waiting_confirmation"

    def radio_score(self, snr_db, speech_band_snr_db, spectral_change, minimum_snr):
        """Score radio-event evidence independently from speech evidence.

        A room voice may have excellent VAD/SNR, so energy alone is deliberately
        insufficient.  The spectral departure from the learned room is the main
        radio-signature evidence; band and broadband energy only support it.
        """
        if not self.use_radio_features:
            return 0.0
        signature = max(0.0, min(1.0, (spectral_change - .12) / .38))
        band = max(0.0, min(1.0, speech_band_snr_db / max(1.0, minimum_snr * 2)))
        snr = max(0.0, min(1.0, snr_db / max(1.0, minimum_snr * 2)))
        return max(0.0, min(1.0, .65 * signature + .20 * band + .15 * snr))


VOICE_ANY_SOURCE = DetectionProfile("voice_any_source", False)
RADIO_ROOM = DetectionProfile("radio_room", True)
PROFILES = {profile.name: profile for profile in (VOICE_ANY_SOURCE, RADIO_ROOM)}


class SpeechDetector:
    def __init__(self, vad_start_threshold=.50, vad_continue_threshold=.30,
                 minimum_snr_db=6.0, minimum_speech_ms=120, frame_ms=64,
                 profile="voice_any_source"):
        self.profile = PROFILES.get(profile, VOICE_ANY_SOURCE)
        self.start = vad_start_threshold
        self.continue_ = vad_continue_threshold
        self.minimum_snr = minimum_snr_db
        self.minimum_speech_ms = minimum_speech_ms
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
        radio_score = self.profile.radio_score(
            snr_db, speech_band_snr_db, spectral_change, self.minimum_snr)
        # Speech and radio activity describe superposable physical layers.  Do
        # not suppress a radio signature merely because VAD confirmed speech.
        radio = radio_score >= .50
        return SpeechDecision(candidate, confirmed, round(confidence, 4), radio,
                              round(radio_score, 4), reason)
