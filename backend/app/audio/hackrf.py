"""Managed receive-only HackRF input for the audio engine."""
import os
from pathlib import Path
import re
import select
import subprocess
import tempfile
import time

import numpy as np

from .base import AudioSource
from .hackrf_protocol import FRAME_BYTES, TUNE_MARKER


def list_hackrf_devices():
    devices = {}
    for path in Path("/sys/bus/usb/devices").glob("*"):
        try:
            if (path / "idVendor").read_text().strip() != "1d50":
                continue
            if (path / "idProduct").read_text().strip() != "6089":
                continue
            serial = (path / "serial").read_text().strip().lower()
        except OSError:
            continue
        if re.fullmatch(r"[0-9a-f]{8,32}", serial):
            devices[serial] = {"serial": serial, "label": f"HackRF One · {serial}"}
    return list(devices.values())


class HackRFSource(AudioSource):
    def __init__(self, serial, frequency_hz, sample_rate):
        super().__init__(sample_rate)
        self.serial = serial
        self.frequency_hz = frequency_hz
        self.device_name = f"HackRF One · {serial}"
        self._process = None
        self._diagnostics = None
        self._pending = bytearray()
        self.signal_dbfs = -120.0

    def start(self):
        if self.is_active:
            return
        if self.serial not in {device["serial"] for device in list_hackrf_devices()}:
            raise RuntimeError("HackRF One absent. Connectez-le en USB et activez le mode HackRF du PortaPack.")
        if self.sample_rate != 16000:
            raise RuntimeError("Le récepteur HackRF requiert un moteur audio à 16 kHz.")
        self._diagnostics = tempfile.TemporaryFile()
        try:
            self._process = subprocess.Popen(
                ["/usr/bin/python3", "-u", str(Path(__file__).with_name("hackrf_receiver.py")),
                 self.serial, str(self.frequency_hz)],
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=self._diagnostics, bufsize=0,
            )
            deadline = time.monotonic() + 8
            count = 1024 * FRAME_BYTES
            while len(self._pending) < count:
                if self._process.poll() is not None or time.monotonic() >= deadline:
                    raise RuntimeError(self._error())
                try:
                    self._read_bytes(count - len(self._pending), 0.1)
                except OSError as exc:
                    raise RuntimeError(self._error()) from exc
            self._is_active = True
        except BaseException:
            self.stop()
            raise

    def _error(self):
        report = os.pread(self._diagnostics.fileno(), 4096, 0).decode(errors="replace").strip()
        if "ModuleNotFoundError" in report or "ImportError" in report:
            return f"GNU Radio ou gr-osmosdr indisponible. {report}"
        return (
            "Impossible de recevoir via le HackRF. Vérifiez le mode HackRF, les permissions USB "
            "et fermez les autres applications SDR (périphérique potentiellement occupé). "
            + report
        ).strip()

    def _read_bytes(self, count, timeout):
        stream = self._process.stdout
        if select.select([stream], [], [], timeout)[0]:
            data = os.read(stream.fileno(), count)
            if not data:
                raise OSError("Le flux USB HackRF est interrompu.")
            self._pending.extend(data)

    def read_chunk(self, chunk_size=1024):
        if not self.is_active:
            return None
        count = chunk_size * FRAME_BYTES
        try:
            if len(self._pending) < count:
                self._read_bytes(count - len(self._pending), 0.05)
        except (OSError, ValueError, AttributeError):
            # The engine closes the source to interrupt a pending read.
            if self.is_active:
                raise
            return None
        if len(self._pending) < count:
            return None
        frames = np.frombuffer(bytes(self._pending[:count]), dtype="<f4").reshape(-1, 2)
        del self._pending[:count]
        power = float(np.mean(frames[:, 1]))
        if not np.isfinite(power):
            raise OSError("Flux de puissance HackRF invalide.")
        self.signal_dbfs = 10 * np.log10(max(power, 1e-12))
        return frames[:, 0]

    def retune(self, frequency_hz):
        if not self.is_active:
            raise OSError("La réception HackRF est arrêtée.")
        self._process.stdin.write(f"{frequency_hz}\n".encode("ascii"))
        deadline = time.monotonic() + 4
        while time.monotonic() < deadline:
            # Drain the old pipe so that the GNU Radio sink can finish its
            # last write even if the pipe filled while processing audio.
            self._read_bytes(8192, 0.05)
            marker = self._pending.find(TUNE_MARKER)
            if marker >= 0:
                del self._pending[:marker + len(TUNE_MARKER)]
                while len(self._pending) < FRAME_BYTES:
                    if time.monotonic() >= deadline:
                        raise OSError("Le HackRF ne transmet plus après l’accord.")
                    self._read_bytes(1024 * FRAME_BYTES, 0.05)
                self.signal_dbfs = -120.0
                self.frequency_hz = frequency_hz
                return
            # Keep only the suffix that could hold a split marker.
            if len(self._pending) >= len(TUNE_MARKER):
                del self._pending[:1 - len(TUNE_MARKER)]
        raise OSError("Le HackRF n’a pas confirmé le nouvel accord.")


    def stop(self):
        self._is_active = False
        process, self._process = self._process, None
        if process is not None:
            process.stdin.close()
            process.stdout.close()
            if process.poll() is None:
                try:
                    process.wait(timeout=0.5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
        if self._diagnostics is not None:
            self._diagnostics.close()
            self._diagnostics = None
        self._pending.clear()
