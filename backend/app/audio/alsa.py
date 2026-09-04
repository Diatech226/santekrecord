"""Real Linux ALSA capture fallback implemented as a continuous arecord pipe."""
from __future__ import annotations

import math
import queue
import re
import shutil
import subprocess
import threading
import time
from dataclasses import dataclass
from typing import Optional

import numpy as np

from .base import AudioSource
from .channel_selector import StableChannelSelector


@dataclass(frozen=True)
class ALSADevice:
    card: int
    device: int
    card_id: str
    name: str

    @property
    def identifier(self) -> str:
        return f"plughw:{self.card},{self.device}"


def parse_arecord_devices(output: str) -> list[ALSADevice]:
    devices: list[ALSADevice] = []
    pattern = re.compile(
        r"^card\s+(\d+):\s*([^\[]+?)\s*\[([^\]]+)\],\s*device\s+(\d+):\s*([^\[]+?)\s*\[([^\]]+)\]",
        re.IGNORECASE | re.MULTILINE,
    )
    for match in pattern.finditer(output):
        devices.append(ALSADevice(int(match[1]), int(match[4]), match[2].strip(), match[3].strip()))
    return devices


def list_alsa_devices() -> list[ALSADevice]:
    if not shutil.which("arecord"):
        return []
    probe = subprocess.run(["arecord", "-l"], capture_output=True, text=True, timeout=3, check=False)
    return parse_arecord_devices(probe.stdout)


def match_alsa_device(portaudio_name: str, card_id: Optional[str] = None,
                      device_number: Optional[int] = None) -> Optional[ALSADevice]:
    """Return a mapping only when exactly one ALSA capture device matches by name/card id."""
    devices = list_alsa_devices()
    if card_id:
        exact = [d for d in devices if d.card_id.casefold() == card_id.casefold()
                 and (device_number is None or d.device == device_number)]
        return exact[0] if len(exact) == 1 else None
    exact_names = [d for d in devices if d.name.casefold() == portaudio_name.casefold()]
    if len(exact_names) == 1:
        return exact_names[0]
    if len(exact_names) > 1:
        return None
    tokens = {t for t in re.findall(r"[a-z0-9]+", portaudio_name.lower()) if len(t) >= 3}
    scored = []
    for device in devices:
        haystack = f"{device.card_id} {device.name}".lower()
        score = len(tokens.intersection(re.findall(r"[a-z0-9]+", haystack)))
        if score:
            scored.append((score, device))
    if not scored:
        return None
    best = max(score for score, _ in scored)
    winners = [device for score, device in scored if score == best]
    return winners[0] if len(winners) == 1 else None


def pcm16_to_float32(data: bytes, channels: int, input_channel: str = "auto") -> np.ndarray:
    raw = np.frombuffer(data, dtype="<i2")
    if channels > 1:
        raw = raw[: len(raw) - (len(raw) % channels)].reshape(-1, channels)
        if input_channel == "channel_1":
            index = 0
        elif input_channel == "channel_2":
            index = min(1, channels - 1)
        else:
            energy = np.mean(raw.astype(np.float64) ** 2, axis=0)
            index = int(np.argmax(energy))
        raw = raw[:, index]
    return (raw.astype(np.float32) / 32768.0).reshape(-1)


class ALSAArecordSource(AudioSource):
    def __init__(self, alsa_device: ALSADevice, sample_rate: int = 16000,
                 capture_sample_rate: int = 48000, channels: int = 2,
                 input_channel: str = "auto"):
        super().__init__(sample_rate, 1)
        self.alsa_device = alsa_device
        self.device_name = alsa_device.name
        self.host_api = "ALSA arecord fallback"
        self.capture_sample_rate = capture_sample_rate
        self.capture_channels = channels
        self.input_channel = input_channel
        self.callback_count = 0
        self.callback_frames = 0
        self.last_callback_at: Optional[float] = None
        self._process: Optional[subprocess.Popen] = None
        self._thread: Optional[threading.Thread] = None
        self._queue: queue.Queue[np.ndarray] = queue.Queue(maxsize=100)
        self.channel_selector = StableChannelSelector(input_channel)

    def start(self) -> None:
        if not shutil.which("arecord"):
            raise RuntimeError("arecord is not installed (install alsa-utils)")
        command = ["arecord", "-D", self.alsa_device.identifier, "-f", "S16_LE", "-r",
                   str(self.capture_sample_rate), "-c", str(self.capture_channels), "-t", "raw", "-q"]
        self._process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, bufsize=0)
        self._is_active = True
        self._thread = threading.Thread(target=self._reader, daemon=True)
        self._thread.start()

    def _reader(self) -> None:
        assert self._process and self._process.stdout
        byte_count = 1024 * self.capture_channels * 2
        while self._is_active:
            data = self._process.stdout.read(byte_count)
            if not data:
                break
            raw = np.frombuffer(data, dtype="<i2").astype(np.float32) / 32768.0
            raw = raw[:len(raw) - len(raw) % self.capture_channels].reshape(-1, self.capture_channels)
            chunk = self.channel_selector.select(raw)
            self.callback_count += 1
            self.callback_frames += len(chunk)
            self.last_callback_at = time.time()
            try:
                self._queue.put_nowait(chunk)
            except queue.Full:
                self._queue.get_nowait()
                self._queue.put_nowait(chunk)
        self._is_active = False

    def verify_audio_stream(self, timeout: float = 0.8) -> bool:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if self.callback_count and self.callback_frames and self.last_callback_at:
                return True
            if self._process and self._process.poll() is not None:
                break
            time.sleep(0.01)
        return False

    def read_chunk(self, chunk_size: int = 1024) -> Optional[np.ndarray]:
        try:
            chunk = self._queue.get(timeout=0.2)
        except queue.Empty:
            return None
        if self.capture_sample_rate != self.sample_rate:
            from scipy.signal import resample_poly
            divisor = math.gcd(self.capture_sample_rate, self.sample_rate)
            chunk = resample_poly(chunk, self.sample_rate // divisor,
                                  self.capture_sample_rate // divisor).astype(np.float32)
        return chunk

    def stop(self) -> None:
        self._is_active = False
        if self._process:
            self._process.terminate()
            try:
                self._process.wait(timeout=1)
            except subprocess.TimeoutExpired:
                self._process.kill()
            self._process = None
        if self._thread and self._thread is not threading.current_thread():
            self._thread.join(timeout=1)
        self._thread = None
