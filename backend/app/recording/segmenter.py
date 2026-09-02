"""Sample-accurate speech observation and segment generation."""
from dataclasses import dataclass


@dataclass(frozen=True)
class FrameLabel:
    start_sample: int
    end_sample: int
    speech: bool
    confidence: float


class SpeechSegmenter:
    def __init__(self): self.frames = []
    def reset(self): self.frames = []
    def add(self, start_sample, end_sample, speech, confidence):
        self.frames.append(FrameLabel(start_sample, end_sample, bool(speech), float(confidence)))
    def segments(self):
        result = []
        for frame in self.frames:
            if not frame.speech: continue
            if result and frame.start_sample <= result[-1][1]: result[-1][1] = max(result[-1][1], frame.end_sample)
            else: result.append([frame.start_sample, frame.end_sample])
        return result
    @property
    def speech_samples(self): return sum(f.end_sample - f.start_sample for f in self.frames if f.speech)
