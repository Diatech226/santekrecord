"""Fixed-step scan state, advanced by received audio frames."""
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class ScanPlan(BaseModel):
    start_hz: int = Field(ge=1_000_000, le=6_000_000_000)
    end_hz: int = Field(ge=1_000_000, le=6_000_000_000)
    step_hz: int = Field(ge=1000, le=5_999_000_000)
    hang_ms: int = Field(default=900, ge=100, le=10_000)
    signal_dbfs: float = Field(default=-48, ge=-100, le=0)

    @model_validator(mode="after")
    def validate_range(self):
        span = self.end_hz - self.start_hz
        if span < self.step_hz:
            raise ValueError("La fin doit suivre le début et le pas doit tenir dans la plage.")
        return self


ScanAction = Literal["pause", "resume", "stop", "next"]


class HackRFScan:
    def __init__(self, plan: ScanPlan):
        self.plan = plan
        self.paused = False
        self.pending_hz = plan.start_hz
        self.heard_signal = False
        self.quiet_samples = 0

    def tuned(self):
        self.pending_hz = None
        self.heard_signal = False
        self.quiet_samples = 0

    def next_channel(self, frequency_hz):
        next_hz = frequency_hz + self.plan.step_hz
        self.pending_hz = next_hz if next_hz <= self.plan.end_hz else self.plan.start_hz

    def observe(self, level, voice, samples, sample_rate):
        if level >= self.plan.signal_dbfs or voice:
            self.heard_signal = True
            self.quiet_samples = 0
        else:
            self.quiet_samples += samples
        wait_ms = self.plan.hang_ms if self.heard_signal else 192
        return self.quiet_samples * 1000 >= wait_ms * sample_rate
