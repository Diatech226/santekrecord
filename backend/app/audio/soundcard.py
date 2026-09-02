from typing import Optional
from .microphone import MicrophoneSource


class SoundCardSource(MicrophoneSource):
    """
    Dedicated audio source for external USB audio cards, Line-In interfaces, and mixers.
    """

    def __init__(self, device_id: Optional[int | str] = None, sample_rate: int = 16000,
                 input_channel: str = "auto"):
        super().__init__(device_id=device_id, sample_rate=sample_rate, input_channel=input_channel)
