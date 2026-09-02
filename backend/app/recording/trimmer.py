"""VAD-mask based edge trimming; raw samples and internal pauses stay untouched."""
from dataclasses import dataclass
import numpy as np


@dataclass(frozen=True)
class TrimResult:
    samples: np.ndarray
    leading_seconds: float
    trailing_seconds: float
    segments: list


def trim_to_speech(samples, segments, sample_rate, margin_seconds=.2):
    samples = np.asarray(samples)
    if not segments:
        return TrimResult(samples[:0], len(samples) / sample_rate, 0.0, [])
    padding = int(margin_seconds * sample_rate)
    start = max(0, segments[0][0] - padding)
    end = min(len(samples), segments[-1][1] + padding)
    adjusted = [[max(0, a - start), min(end - start, b - start)] for a, b in segments]
    return TrimResult(samples[start:end], start / sample_rate, (len(samples) - end) / sample_rate, adjusted)
