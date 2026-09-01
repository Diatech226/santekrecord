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
        self.capture_channels = 1
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
                    lowered = name.lower()
                    is_usb = "usb" in lowered or "external" in lowered
                    is_line = "line" in name.lower()
                    if lowered in {"default", "sysdefault"}:
                        device_kind = "default"
                    elif any(token in lowered for token in ("pulse", "pipewire", "jack")):
                        device_kind = "virtual"
                    else:
                        device_kind = "hardware"
                    inputs.append({
                        "id": idx,
                        "name": name,
                        "hostapi": host_apis[int(dev.get("hostapi", 0))]["name"],
                        "max_input_channels": dev.get("max_input_channels", 1),
                        "default_samplerate": int(dev.get("default_samplerate", 16000)),
                        "is_default": idx == default_input,
                        "type": "usb" if is_usb else ("line" if is_line else "microphone"),
                        "device_kind": device_kind,
                    })
            return inputs
        except Exception as e:
            print(f"[MicrophoneSource] Error querying sounddevice: {e}")
            return []

    def _audio_callback(self, indata, frames, time_info, status):
        if status:
            pass
        if self._is_active:
            # Keep every input channel at capture time and downmix here.  A number
            # of ALSA USB interfaces cannot be opened with channels=1.
            mono_chunk = np.mean(indata, axis=1, dtype=np.float32) if indata.ndim > 1 else indata.copy()
            self.callback_frames += int(frames)
            self.last_callback_at = time.time()
            if self.last_callback_at - self._callback_log_at >= 5.0:
                rms = float(np.sqrt(np.mean(np.square(mono_chunk)))) if len(mono_chunk) else 0.0
                dbfs = max(-100.0, 20.0 * math.log10(max(rms, 1e-5)))
                peak = float(np.max(np.abs(mono_chunk))) if len(mono_chunk) else 0.0
                peak_dbfs = 20.0 * math.log10(max(peak, 1e-5))
                print(f"[AUDIO] frames={frames} rms={rms:.6f} dbfs={dbfs:.1f} peak={peak_dbfs:.1f}")
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
        max_channels = int(device.get("max_input_channels", 0))
        if max_channels < 1:
            raise RuntimeError(f"Device {self.device_id!r} has no input channels")
        native_rate = int(round(float(device.get("default_samplerate", self.sample_rate))))
        try:
            host_apis = sd.query_hostapis()
            self.host_api = str(host_apis[int(device.get("hostapi", 0))]["name"])
        except Exception:
            self.host_api = "PortAudio"
        print(f"[AUDIO] Selected device id: {self.device_id}")
        print(f"[AUDIO] Device: {self.device_name}")
        print(f"[AUDIO] Host API: {self.host_api}")
        print(f"[AUDIO] Inputs: {max_channels}")
        print(f"[AUDIO] Native sample rate: {native_rate}")
        # Always prefer the hardware-native rate. Try mono, then stereo: this is
        # portable across ALSA/Pulse/PipeWire and WASAPI without hardcoded hw IDs.
        errors = []
        selected_channels = None
        print("[AUDIO] Checking input settings...")
        for candidate_channels in dict.fromkeys([1, min(2, max_channels)]):
            try:
                sd.check_input_settings(device=self.device_id, samplerate=native_rate, channels=candidate_channels, dtype="float32")
                selected_channels = candidate_channels
                break
            except Exception as exc:
                errors.append(f"{native_rate} Hz/{candidate_channels} ch: {exc}")
        if selected_channels is None:
            raise RuntimeError(f"Unable to open {self.device_name} at native rate {native_rate} Hz ({'; '.join(errors)})")
        print("[AUDIO] Input settings valid")
        self.capture_sample_rate = native_rate
        self.capture_channels = selected_channels
        print("[AUDIO] Opening stream...")
        self._stream = sd.InputStream(
            device=self.device_id,
            samplerate=self.capture_sample_rate,
            channels=self.capture_channels,
            dtype="float32",
            blocksize=0,
            callback=self._audio_callback,
        )
        self._is_active = True
        try:
            self._stream.start()
        except Exception:
            self._is_active = False
            self._stream.close()
            self._stream = None
            raise
        print("[AUDIO] Stream started")

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
