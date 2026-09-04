import queue
import math
import os
import time
from typing import Optional, List, Dict, Any
import numpy as np
from .base import AudioSource
from .channel_selector import StableChannelSelector

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

    def __init__(self, device_id: Optional[int | str] = None, sample_rate: int = 16000,
                 input_channel: str = "auto"):
        super().__init__(sample_rate=sample_rate, channels=1)
        if device_id is None:
            self.device_id = None
        elif isinstance(device_id, bool) or not str(device_id).isdigit():
            raise ValueError(f"Invalid PortAudio device_id {device_id!r}; select a real input device")
        else:
            self.device_id = int(device_id)
        self.input_channel = input_channel
        self._stream = None
        self._queue: queue.Queue = queue.Queue(maxsize=100)
        self._read_buffer = np.empty(0, dtype=np.float32)
        self.capture_sample_rate = sample_rate
        self.capture_channels = 1
        self.device_name = "Default input"
        self.host_api = ""
        self.callback_frames = 0
        self.callback_count = 0
        self.last_callback_at: Optional[float] = None
        self._callback_log_at = 0.0
        self.channel_selector = StableChannelSelector(input_channel)

    @classmethod
    def _detect_usb_cards_from_proc(cls) -> set:
        """Inspect /proc/asound/cards on Linux to find USB sound cards."""
        usb_cards = set()
        try:
            if os.path.exists("/proc/asound/cards"):
                with open("/proc/asound/cards", "r", encoding="utf-8", errors="ignore") as f:
                    content = f.read()
                # Lines like: " 1 [CODEC          ]: USB-Audio - USB Audio CODEC"
                for line in content.splitlines():
                    lowered = line.lower()
                    if "usb" in lowered:
                        import re
                        m = re.search(r"^\s*(\d+)\s+\[([^\]]+)\]", line)
                        if m:
                            usb_cards.add(m.group(1)) # card number
                            usb_cards.add(m.group(2).strip().lower()) # card id
        except Exception:
            pass
        return usb_cards

    @classmethod
    def list_devices(cls) -> List[Dict[str, Any]]:
        if sd is None:
            return []
        try:
            # Re-query sounddevice devices
            device_list = sd.query_devices()
            host_apis = sd.query_hostapis()
            usb_cards = cls._detect_usb_cards_from_proc()
            inputs = []
            default_input = sd.default.device[0] if sd.default.device else 0
            
            usb_keywords = (
                "usb", "external", "codec", "c-media", "cm108", "cm106", "pcm29",
                "focusrite", "scarlett", "behringer", "u-phoria", "umc", "yeti",
                "snowball", "rode", "fifine", "hyperx", "jabra", "plantronics",
                "headset", "headphone", "soundcard", "sound card", "audio adapter",
                "dac", "adc", "dongle", "card=device", "card=codec", "card=audio",
                "card=sound", "card=mic", "hw:1", "hw:2", "plughw:1", "plughw:2"
            )

            for idx, dev in enumerate(device_list):
                if dev.get("max_input_channels", 0) > 0:
                    name = dev.get("name", f"Device {idx}")
                    lowered = name.lower()
                    
                    # Check if device is a USB sound card
                    is_usb = any(k in lowered for k in usb_keywords)
                    if not is_usb and usb_cards:
                        for card in usb_cards:
                            if f"card={card}" in lowered or f"hw:{card}" in lowered or f"[{card}]" in lowered:
                                is_usb = True
                                break

                    is_line = "line" in lowered or "aux" in lowered

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
            # ALSA identifiers are exposed only for an unambiguous name match.
            if os.name == "posix":
                from .alsa import match_alsa_device
                for item in inputs:
                    mapping = match_alsa_device(item["name"])
                    item.update({
                        "alsa_card": mapping.card if mapping else None,
                        "alsa_device": mapping.device if mapping else None,
                        "alsa_identifier": mapping.identifier if mapping else None,
                    })
            return inputs
        except Exception as e:
            print(f"[MicrophoneSource] Error querying sounddevice: {e}")
            return []

    def _audio_callback(self, indata, frames, time_info, status):
        if status:
            pass
        if self._is_active:
            # Do not average stereo interface inputs: balanced/opposite-polarity
            # channels can cancel and many USB adapters only carry signal on one
            # side. Auto follows the channel with the greatest RMS energy.
            mono_chunk = self.channel_selector.select(indata)
            self.callback_frames += int(frames)
            self.callback_count += 1
            self.last_callback_at = time.time()
            if self.callback_count <= 3 or self.last_callback_at - self._callback_log_at >= 1.0:
                rms = float(np.sqrt(np.mean(np.square(mono_chunk)))) if len(mono_chunk) else 0.0
                dbfs = max(-100.0, 20.0 * math.log10(max(rms, 1e-5)))
                peak = float(np.max(np.abs(mono_chunk))) if len(mono_chunk) else 0.0
                peak_dbfs = 20.0 * math.log10(max(peak, 1e-5))
                print(f"[AUDIO CALLBACK] frames={frames} callbacks={self.callback_count} total_frames={self.callback_frames} rms={rms:.6f} level={dbfs:.1f}dBFS peak={peak_dbfs:.1f}dBFS")
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
        if self.device_id is None:
            raise RuntimeError("NO DEVICE: select an input returned by /api/audio/devices")
        if sd is None:
            raise RuntimeError("sounddevice is not installed or available on this system")

        self._queue = queue.Queue(maxsize=100)
        self._read_buffer = np.empty(0, dtype=np.float32)
        all_devices = sd.query_devices()
        if self.device_id < 0 or self.device_id >= len(all_devices):
            raise RuntimeError(f"Invalid or stale PortAudio device id {self.device_id}")
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
        self.callback_frames = 0
        self.callback_count = 0
        self.last_callback_at = None
        print(f"[AUDIO START] Requested device id: {self.device_id}\nResolved device: {self.device_name}\nPortAudio index: {self.device_id}\nHost API: {self.host_api}\nInput channels: {max_channels}\nNative sample rate: {native_rate}")
        # Always prefer the hardware-native rate. Try mono, then stereo: this is
        # portable across ALSA/Pulse/PipeWire and WASAPI without hardcoded hw IDs.
        errors = []
        selected_channels = None
        print("Testing input settings...")
        preferred_channels = min(2, max_channels) if self.input_channel != "channel_1" else 1
        for candidate_channels in dict.fromkeys([preferred_channels, 1, min(2, max_channels)]):
            try:
                sd.check_input_settings(device=self.device_id, samplerate=native_rate, channels=candidate_channels, dtype="float32")
                selected_channels = candidate_channels
                break
            except Exception as exc:
                errors.append(f"{native_rate} Hz/{candidate_channels} ch: {exc}")
        if selected_channels is None:
            raise RuntimeError(f"Unable to open {self.device_name} at native rate {native_rate} Hz ({'; '.join(errors)})")
        print("OK")
        self.capture_sample_rate = native_rate
        self.capture_channels = selected_channels
        print("Opening InputStream...")
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
        print("OK\nWaiting for first callback...")

    def verify_audio_stream(self, timeout: float = 0.8) -> bool:
        """Prove that samples flow; opening a PortAudio stream is not proof."""
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if self.callback_count > 0 and self.callback_frames > 0 and self.last_callback_at:
                return True
            time.sleep(0.01)
        return False

    def stop(self) -> None:
        self._is_active = False
        if self._stream is not None:
            try:
                self._stream.stop()
                self._stream.close()
            except Exception:
                pass
            self._stream = None
        self._read_buffer = np.empty(0, dtype=np.float32)

    def read_chunk(self, chunk_size: int = 1024) -> Optional[np.ndarray]:
        if not self._is_active:
            return None
        while len(self._read_buffer) < chunk_size:
            try:
                chunk = self._queue.get(timeout=0.2).astype(np.float32)
            except queue.Empty:
                return None
            if self.capture_sample_rate != self.sample_rate:
                from scipy.signal import resample_poly
                divisor = math.gcd(self.capture_sample_rate, self.sample_rate)
                chunk = resample_poly(
                    chunk, self.sample_rate // divisor, self.capture_sample_rate // divisor
                ).astype(np.float32)
            self._read_buffer = np.concatenate((self._read_buffer, chunk))
        result = self._read_buffer[:chunk_size].copy()
        self._read_buffer = self._read_buffer[chunk_size:]
        return result
