import queue
from typing import Optional, List, Dict, Any
import numpy as np
from .base import AudioSource

try:
    import sounddevice as sd
except ImportError:
    sd = None


class MicrophoneSource(AudioSource):
    """
    Audio input source capturing from system default or selected microphone via sounddevice.
    """

    def __init__(self, device_id: Optional[int | str] = None, sample_rate: int = 16000):
        super().__init__(sample_rate=sample_rate, channels=1)
        self.device_id = int(device_id) if isinstance(device_id, int) or (isinstance(device_id, str) and device_id.isdigit()) else None
        self._stream = None
        self._queue: queue.Queue = queue.Queue(maxsize=100)

    @classmethod
    def list_devices(cls) -> List[Dict[str, Any]]:
        if sd is None:
            return []
        try:
            device_list = sd.query_devices()
            inputs = []
            default_input = sd.default.device[0] if sd.default.device else 0
            for idx, dev in enumerate(device_list):
                if dev.get("max_input_channels", 0) > 0:
                    name = dev.get("name", f"Device {idx}")
                    is_usb = "usb" in name.lower() or "external" in name.lower()
                    is_line = "line" in name.lower()
                    inputs.append({
                        "id": idx,
                        "name": name,
                        "hostapi": str(dev.get("hostapi", "")),
                        "max_input_channels": dev.get("max_input_channels", 1),
                        "default_samplerate": int(dev.get("default_samplerate", 16000)),
                        "is_default": idx == default_input,
                        "type": "usb" if is_usb else ("line" if is_line else "microphone"),
                    })
            return inputs
        except Exception as e:
            print(f"[MicrophoneSource] Error querying sounddevice: {e}")
            return []

    def _audio_callback(self, indata, frames, time_info, status):
        if status:
            pass
        if self._is_active:
            # indata shape is (frames, channels)
            mono_chunk = indata[:, 0].copy() if indata.ndim > 1 else indata.copy()
            try:
                self._queue.put_nowait(mono_chunk)
            except queue.Full:
                try:
                    self._queue.get_nowait()
                    self._queue.put_nowait(mono_chunk)
                except (queue.Empty, queue.Full):
                    pass

    def start(self) -> None:
        if self._is_active:
            return
        if sd is None:
            raise RuntimeError("sounddevice is not installed or available on this system")

        self._queue = queue.Queue(maxsize=100)
        self._stream = sd.InputStream(
            device=self.device_id,
            samplerate=self.sample_rate,
            channels=1,
            dtype="float32",
            blocksize=1024,
            callback=self._audio_callback,
        )
        self._stream.start()
        self._is_active = True

    def stop(self) -> None:
        self._is_active = False
        if self._stream is not None:
            try:
                self._stream.stop()
                self._stream.close()
            except Exception:
                pass
            self._stream = None

    def read_chunk(self, chunk_size: int = 1024) -> Optional[np.ndarray]:
        if not self._is_active:
            return None
        try:
            chunk = self._queue.get(timeout=0.2)
            return chunk.astype(np.float32)
        except queue.Empty:
            return None
