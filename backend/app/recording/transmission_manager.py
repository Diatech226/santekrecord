"""Groups VAD frames into logical push-to-talk transmissions."""
from enum import Enum

from .models import SpeechSegment, Transmission


class TransmissionState(str, Enum):
    IDLE = "idle"
    SPEECH = "speech"
    INTRA_PHRASE_PAUSE = "intra_phrase_pause"
    HANGOVER = "transmission_hangover"


class TransmissionManager:
    """Sample-accurate state machine for one push-to-talk transmission."""

    def __init__(self, sample_rate: int, intra_phrase_pause_seconds: float,
                 end_timeout_seconds: float, ambient_confirm_ms: int = 300):
        self.sample_rate = sample_rate
        self.intra_pause = int(intra_phrase_pause_seconds * sample_rate)
        self.end_timeout = int(end_timeout_seconds * sample_rate)
        self.ambient_confirm = max(1, int(ambient_confirm_ms * sample_rate / 1000))
        self.current: Transmission | None = None
        self.last_speech_end: int | None = None
        self.quiet_samples = 0
        self.ambient_samples = 0
        self.state = TransmissionState.IDLE

    def reset(self):
        self.current = None
        self.last_speech_end = None
        self.quiet_samples = 0
        self.ambient_samples = 0
        self.state = TransmissionState.IDLE

    def process(self, start: int, end: int, speech: bool, radio_activity: bool,
                return_to_ambient: bool, transmission_id: int) -> Transmission | None:
        frame_samples = max(0, end - start)
        if speech:
            if self.current is None:
                self.current = Transmission(transmission_id, start, end)
            self.current.end_sample = end
            if self.current.speech_segments and start == self.current.speech_segments[-1].end_sample:
                self.current.speech_segments[-1].end_sample = end
            else:
                self.current.speech_segments.append(SpeechSegment(start, end))
            self.last_speech_end = end
            self.quiet_samples = self.ambient_samples = 0
            self.state = TransmissionState.SPEECH
            return None

        if self.current is None:
            self.state = TransmissionState.IDLE
            return None

        self.quiet_samples = max(0, end - (self.last_speech_end or end))
        self.ambient_samples = self.ambient_samples + frame_samples if return_to_ambient else 0
        if radio_activity:
            self.current.end_sample = end

        if self.quiet_samples <= self.intra_pause:
            self.state = TransmissionState.INTRA_PHRASE_PAUSE
        else:
            self.state = TransmissionState.HANGOVER

        stable_ambient = self.ambient_samples >= self.ambient_confirm
        ambient_close = self.state == TransmissionState.HANGOVER and stable_ambient
        timeout_close = self.quiet_samples >= self.end_timeout
        if ambient_close or timeout_close:
            closed, self.current = self.current, None
            closed.end_sample = max(closed.end_sample, self.last_speech_end or closed.end_sample)
            self.last_speech_end = None
            self.quiet_samples = 0
            self.ambient_samples = 0
            self.state = TransmissionState.IDLE
            return closed
        return None

    def flush(self) -> Transmission | None:
        closed = self.current
        self.reset()
        return closed
