import queue
import math
import time
from typing import Optional, List, Dict, Any
import numpy as np
from .base import AudioSource

try:
    import sounddevice as sd
except (ImportError, OSError):
    # sounddevice may be installed while the native PortAudio library is not.
    # Keep the API alive so it can report zero inputs and a useful start error.
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
        self.capture_sample_rate = sample_rate
        self.device_name = "Default input"
        self.host_api = ""
        self.callback_frames = 0
        self.last_callback_at: Optional[float] = None
        self._callback_log_at = 0.0

    @classmethod
    def list_devices(cls) -> List[Dict[str, Any]]:
        if sd is None:
            return []
        try:
            device_list = sd.query_devices()
            host_apis = sd.query_hostapis()
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
                        "hostapi": host_apis[int(dev.get("hostapi", 0))]["name"],
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
            self.callback_frames += int(frames)
            self.last_callback_at = time.time()
            if self.last_callback_at - self._callback_log_at >= 5.0:
                rms = float(np.sqrt(np.mean(np.square(mono_chunk)))) if len(mono_chunk) else 0.0
                dbfs = max(-100.0, 20.0 * math.log10(max(rms, 1e-5)))
                print(f"[MicrophoneSource] AUDIO CALLBACK frames={frames} rms={rms:.6f} dbfs={dbfs:.1f}")
                self._callback_log_at = self.last_callback_at
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
        device = sd.query_devices(self.device_id, "input")
        self.device_name = str(device.get("name", self.device_name))
        native_rate = int(round(float(device.get("default_samplerate", self.sample_rate))))
        # Windows/WASAPI USB devices frequently reject 16 kHz. Capture at the
        # hardware rate and resample to the processing rate in read_chunk().
        candidates = list(dict.fromkeys([native_rate, self.sample_rate, 48000, 44100]))
        selected_rate = None
        errors = []
        for candidate in candidates:
            try:
                sd.check_input_settings(device=self.device_id, samplerate=candidate, channels=1, dtype="float32")
                selected_rate = candidate
                break
            except Exception as exc:
                errors.append(f"{candidate} Hz: {exc}")
        if selected_rate is None:
            raise RuntimeError("Unable to open input device (" + "; ".join(errors) + ")")
        self.capture_sample_rate = selected_rate
        self._stream = sd.InputStream(
            device=self.device_id,
            samplerate=self.capture_sample_rate,
            channels=1,
            dtype="float32",
            blocksize=0,
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
            chunk = self._queue.get(timeout=0.2).astype(np.float32)
            if self.capture_sample_rate != self.sample_rate:
                from scipy.signal import resample_poly
                divisor = math.gcd(self.capture_sample_rate, self.sample_rate)
                chunk = resample_poly(
                    chunk, self.sample_rate // divisor, self.capture_sample_rate // divisor
                ).astype(np.float32)
            return chunk
        except queue.Empty:
            return None
