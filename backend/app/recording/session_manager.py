"""Owns the explicit lifecycle of a multi-transmission communication."""
from .models import CommunicationSession, SessionState, Transmission


class CommunicationSessionManager:
    def __init__(self, sample_rate: int, end_timeout_seconds: float,
                 max_seconds: float, ambient_confirm_ms: int = 300):
        self.sample_rate = sample_rate
        self.end_timeout = int(end_timeout_seconds * sample_rate)
        self.max_samples = int(max_seconds * sample_rate)
        self.session: CommunicationSession | None = None
        self.state = SessionState.AMBIENT
        self.last_activity_sample = 0
        self.last_observed_sample = 0
        self.ambient_samples = 0
        self.ambient_confirm = max(1, int(ambient_confirm_ms * sample_rate / 1000))

    def open(self, communication_id: str, start_iso: str, sample: int):
        self.session = CommunicationSession(communication_id, start_iso)
        self.last_activity_sample = sample
        self.last_observed_sample = sample
        self.ambient_samples = 0
        self.state = SessionState.TRANSMISSION_ACTIVE

    def add(self, transmission: Transmission):
        self.session.transmissions.append(transmission)
        self.last_activity_sample = max(self.last_activity_sample, transmission.end_sample)
        self.state = SessionState.WAITING_REPLY

    def observe(self, sample: int, speech: bool, radio_activity: bool,
                return_to_ambient: bool, session_start_sample: int,
                *, meaningful_radio_activity: bool | None = None,
                transmission_active: bool = False) -> str | None:
        if self.session is None:
            return None
        meaningful = radio_activity if meaningful_radio_activity is None else meaningful_radio_activity
        frame_samples = max(0, sample - self.last_observed_sample)
        self.last_observed_sample = sample
        if speech or meaningful:
            self.last_activity_sample = sample
        self.ambient_samples = self.ambient_samples + frame_samples if return_to_ambient else 0
        if sample - session_start_sample >= self.max_samples:
            return "max_duration"
        if (not transmission_active and not speech and not meaningful and
                self.ambient_samples >= self.ambient_confirm and
                sample - self.last_activity_sample >= self.end_timeout):
            return "ambient_timeout"
        return None

    def finish(self, reason: str) -> CommunicationSession | None:
        session, self.session = self.session, None
        if session:
            session.end_reason = reason
        self.state = SessionState.FINALIZING
        return session
