"""Stable, observable stereo input routing for detection audio."""
from collections import deque
import numpy as np


class StableChannelSelector:
    """Prefer speech-like modulation and require sustained evidence to switch.

    A steady noisy channel can have greater RMS than a voice channel.  The score
    therefore combines level, crest factor and block-to-block level variation.
    Switching requires a margin for several blocks and is then briefly locked.
    """
    def __init__(self, preference="auto", switch_blocks=6, lock_blocks=24):
        self.preference = preference
        self.switch_blocks = switch_blocks
        self.lock_blocks = lock_blocks
        self.selected_index = 0
        self.channel_rms_dbfs = [-100.0, -100.0]
        self._history = [deque(maxlen=12), deque(maxlen=12)]
        self._challenger_hits = 0
        self._locked = 0

    @staticmethod
    def _db(value):
        return max(-100.0, 20.0 * np.log10(max(float(value), 1e-5)))

    def select(self, samples):
        data = np.asarray(samples)
        if data.ndim < 2 or data.shape[1] < 2:
            self.selected_index = 0
            rms = np.sqrt(np.mean(np.square(data, dtype=np.float64))) if data.size else 0
            self.channel_rms_dbfs = [self._db(rms), -100.0]
            return data.reshape(-1).copy()
        rms = np.sqrt(np.mean(np.square(data, dtype=np.float64), axis=0))
        self.channel_rms_dbfs = [self._db(v) for v in rms[:2]]
        if self.preference in ("channel_1", "channel_2"):
            self.selected_index = 0 if self.preference == "channel_1" else 1
        else:
            scores = []
            for index in range(2):
                self._history[index].append(self.channel_rms_dbfs[index])
                peak = float(np.max(np.abs(data[:, index])))
                crest = peak / max(float(rms[index]), 1e-7)
                modulation = float(np.std(self._history[index]))
                power = np.abs(np.fft.rfft(data[:, index] * np.hanning(len(data)))) ** 2 + 1e-12
                flatness = float(np.exp(np.mean(np.log(power))) / np.mean(power))
                # Level prevents choosing an empty channel; modulation/crest
                # distinguish structured intermittent voice from steady hiss.
                scores.append(self.channel_rms_dbfs[index] + min(12., 2 * modulation)
                              + min(8., 2 * max(0., crest - 1.5)) + 18 * (1 - flatness))
            other = 1 - self.selected_index
            if self._locked:
                self._locked -= 1
            elif scores[other] >= scores[self.selected_index] + 3.0:
                self._challenger_hits += 1
                if self._challenger_hits >= self.switch_blocks:
                    self.selected_index, self._challenger_hits = other, 0
                    self._locked = self.lock_blocks
            else:
                self._challenger_hits = 0
        return data[:, self.selected_index].astype(np.float32, copy=True)

    @property
    def selected_channel(self):
        return f"channel_{self.selected_index + 1}"
