"""Groups VAD frames into logical push-to-talk transmissions."""
from .models import SpeechSegment, Transmission


class TransmissionManager:
    def __init__(self, sample_rate: int, intra_phrase_pause_seconds: float,
                 end_timeout_seconds: float):
        self.sample_rate = sample_rate
        self.intra_pause = int(intra_phrase_pause_seconds * sample_rate)
        self.end_timeout = int(end_timeout_seconds * sample_rate)
        self.current: Transmission | None = None
        self.last_speech_end: int | None = None

    def reset(self):
        self.current = None
        self.last_speech_end = None

    def process(self, start: int, end: int, speech: bool, radio_activity: bool,
                return_to_ambient: bool, transmission_id: int) -> Transmission | None:
        if speech:
            if self.current is None:
                self.current = Transmission(transmission_id, start, end)
            self.current.end_sample = end
            if self.current.speech_segments and start == self.current.speech_segments[-1].end_sample:
                self.current.speech_segments[-1].end_sample = end
            else:
                self.current.speech_segments.append(SpeechSegment(start, end))
            self.last_speech_end = end
            return None
        if self.current is None:
            return None
        quiet = end - (self.last_speech_end or end)
        if radio_activity and quiet < self.end_timeout:
            self.current.end_sample = end
        if quiet >= self.end_timeout and (return_to_ambient or quiet >= self.end_timeout):
            closed, self.current = self.current, None
            closed.end_sample = max(closed.end_sample, self.last_speech_end or closed.end_sample)
            self.last_speech_end = None
            return closed
        return None

    def flush(self) -> Transmission | None:
        closed, self.current = self.current, None
        self.last_speech_end = None
        return closed
