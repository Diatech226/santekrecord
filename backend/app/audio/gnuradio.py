import os
import time
import errno
from typing import Optional
import numpy as np
from .base import AudioSource


class GNURadioSource(AudioSource):
    """
    Audio input source reading a continuous float32 16kHz mono audio stream
    from a GNU Radio FIFO named pipe (e.g. /tmp/hackrf_audio.f32).
    """

    def __init__(self, fifo_path: str = "/tmp/hackrf_audio.f32", sample_rate: int = 16000):
        super().__init__(sample_rate=sample_rate, channels=1)
        self.fifo_path = fifo_path
        self._fd: Optional[int] = None

    def _ensure_fifo(self):
        if not os.path.exists(self.fifo_path):
            try:
                os.mkfifo(self.fifo_path)
                print(f"[GNURadioSource] Created FIFO named pipe at {self.fifo_path}")
            except OSError as e:
                if e.errno != errno.EEXIST:
                    print(f"[GNURadioSource] Warning: Failed to create FIFO {self.fifo_path}: {e}")

    def start(self) -> None:
        if self._is_active:
            return
        self._ensure_fifo()
        try:
            # Open non-blocking so it doesn't hang if GNU Radio isn't producing yet
            self._fd = os.open(self.fifo_path, os.O_RDONLY | os.O_NONBLOCK)
            self._is_active = True
        except Exception as e:
            print(f"[GNURadioSource] Error opening pipe {self.fifo_path}: {e}")
            self._is_active = False
            raise

    def stop(self) -> None:
        self._is_active = False
        if self._fd is not None:
            try:
                os.close(self._fd)
            except Exception:
                pass
            self._fd = None

    def read_chunk(self, chunk_size: int = 1024) -> Optional[np.ndarray]:
        if not self._is_active or self._fd is None:
            return None
        bytes_needed = chunk_size * 4  # 4 bytes per float32
        try:
            raw_bytes = os.read(self._fd, bytes_needed)
            if not raw_bytes:
                # No data available right now, brief sleep
                time.sleep(0.01)
                return None
            
            floats = np.frombuffer(raw_bytes, dtype=np.float32)
            if len(floats) == 0:
                return None
            return floats
        except (BlockingIOError, OSError):
            time.sleep(0.01)
            return None
