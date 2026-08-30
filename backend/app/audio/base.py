from abc import ABC, abstractmethod
from typing import Generator, Optional
import numpy as np


class AudioSource(ABC):
    """
    Abstract base class for all audio source streams (Microphone, SoundCard, GNU Radio FIFO).
    All sources MUST output mono float32 audio sampled at 16,000 Hz.
    """

    def __init__(self, sample_rate: int = 16000, channels: int = 1):
        self.sample_rate = sample_rate
        self.channels = channels
        self._is_active = False

    @property
    def is_active(self) -> bool:
        return self._is_active

    @abstractmethod
    def start(self) -> None:
        """Initialize and start reading audio."""
        pass

    @abstractmethod
    def stop(self) -> None:
        """Stop and release audio hardware/pipe resources."""
        pass

    @abstractmethod
    def read_chunk(self, chunk_size: int = 1024) -> Optional[np.ndarray]:
        """
        Read a chunk of float32 mono audio samples.
        Returns numpy array of shape (chunk_size,) or None if stream ended/paused.
        """
        pass
