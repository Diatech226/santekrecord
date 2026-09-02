"""Versioned and sample-accurate ground-truth annotation schema."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field, model_validator

EventType = Literal["ambient", "radio_hiss", "beep", "speech", "door_noise", "other_noise"]


class Interval(BaseModel):
    start_sec: float = Field(ge=0)
    end_sec: float = Field(gt=0)
    start_sample: int | None = Field(default=None, ge=0)
    end_sample: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def valid_interval(self):
        if self.end_sec <= self.start_sec:
            raise ValueError("end_sec must be greater than start_sec")
        if self.start_sample is not None and self.end_sample is not None and self.end_sample <= self.start_sample:
            raise ValueError("end_sample must be greater than start_sample")
        return self

    def populate_samples(self, sample_rate: int):
        self.start_sample = round(self.start_sec * sample_rate)
        self.end_sample = round(self.end_sec * sample_rate)


class SpeechSegment(Interval):
    pass


class Transmission(Interval):
    id: int | str
    speaker: str = "Unknown"
    speech_segments: list[SpeechSegment] = Field(default_factory=list)
    false_detection: bool = False


class Communication(Interval):
    id: str
    transmissions: list[Transmission] = Field(default_factory=list)


class Event(Interval):
    type: EventType


class GroundTruth(BaseModel):
    schema_version: int = 1
    file: str
    sample_rate: int = Field(gt=0)
    communications: list[Communication] = Field(default_factory=list)
    events: list[Event] = Field(default_factory=list)

    @model_validator(mode="after")
    def add_sample_positions(self):
        for item in [*self.communications, *self.events]:
            item.populate_samples(self.sample_rate)
        for communication in self.communications:
            for transmission in communication.transmissions:
                transmission.populate_samples(self.sample_rate)
                for segment in transmission.speech_segments:
                    segment.populate_samples(self.sample_rate)
        return self

    @classmethod
    def load(cls, path: str | Path) -> "GroundTruth":
        return cls.model_validate_json(Path(path).read_text(encoding="utf-8"))

    def save(self, path: str | Path) -> None:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(self.model_dump_json(indent=2, exclude_none=True) + "\n", encoding="utf-8")

    def as_json(self) -> dict:
        return json.loads(self.model_dump_json(exclude_none=True))
