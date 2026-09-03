"""Level-only gate for significant audio events relative to ambient sound."""
from dataclasses import dataclass


@dataclass(frozen=True)
class AudioEventDecision:
    event_active: bool
    level_dbfs: float
    ambient_dbfs: float
    delta_db: float
    event_start_threshold: float
    event_continue_threshold: float
    event_end_threshold: float


class AudioEventGate:
    """Adds level hysteresis without making any voice/source classification."""

    def __init__(self, start_margin_db=8.0, continue_margin_db=4.0,
                 end_margin_db=2.0, end_hold_ms=300, frame_ms=64):
        self.start_margin_db = start_margin_db
        self.continue_margin_db = min(continue_margin_db, start_margin_db)
        self.end_margin_db = min(end_margin_db, self.continue_margin_db)
        self.end_frames = max(1, round(end_hold_ms / frame_ms))
        self.active = False
        self._below_end = 0

    def reset(self):
        self.active = False
        self._below_end = 0

    def process(self, level_dbfs, ambient_dbfs):
        start = min(0.0, ambient_dbfs + self.start_margin_db)
        keep = min(start, ambient_dbfs + self.continue_margin_db)
        end = min(keep, ambient_dbfs + self.end_margin_db)
        if not self.active and level_dbfs >= start:
            self.active = True
        elif self.active:
            if level_dbfs <= end:
                self._below_end += 1
                if self._below_end >= self.end_frames:
                    self.active = False
                    self._below_end = 0
            elif level_dbfs >= keep:
                self._below_end = 0
        return AudioEventDecision(
            self.active, float(level_dbfs), float(ambient_dbfs),
            float(level_dbfs - ambient_dbfs), start, keep, end,
        )
