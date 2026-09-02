"""Sample-accurate domain objects for radio conversations."""
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


class SessionState(str, Enum):
    AMBIENT = "ambient"
    TRANSMISSION_ACTIVE = "transmission_active"
    TRANSMISSION_HANGOVER = "transmission_hangover"
    WAITING_REPLY = "waiting_reply"
    FINALIZING = "finalizing_session"
    SAVING = "saving_communication"


@dataclass
class SpeechSegment:
    start_sample: int
    end_sample: int

    def as_dict(self, sample_rate: int, offset: int = 0) -> dict:
        return {
            "start_sample": self.start_sample - offset,
            "end_sample": self.end_sample - offset,
            "start_sec": round((self.start_sample - offset) / sample_rate, 3),
            "end_sec": round((self.end_sample - offset) / sample_rate, 3),
        }


@dataclass
class Transmission:
    id: int
    start_sample: int
    end_sample: int
    speech_segments: list[SpeechSegment] = field(default_factory=list)
    speaker: Optional[str] = None

    @property
    def speech_samples(self) -> int:
        return sum(s.end_sample - s.start_sample for s in self.speech_segments)

    def as_dict(self, sample_rate: int, offset: int = 0) -> dict:
        return {
            "id": self.id,
            "start_sample": self.start_sample - offset,
            "end_sample": self.end_sample - offset,
            "start_sec": round((self.start_sample - offset) / sample_rate, 3),
            "end_sec": round((self.end_sample - offset) / sample_rate, 3),
            "speech_duration_sec": round(self.speech_samples / sample_rate, 3),
            "speech_segments": [s.as_dict(sample_rate, offset) for s in self.speech_segments],
            "speaker": self.speaker,
        }


@dataclass
class CommunicationSession:
    communication_id: str
    start_iso: str
    transmissions: list[Transmission] = field(default_factory=list)
    end_reason: Optional[str] = None
