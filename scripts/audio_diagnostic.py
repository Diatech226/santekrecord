#!/usr/bin/env python3
"""Interactive PortAudio input diagnostic; run from the repository root."""
from __future__ import annotations

import argparse
import platform
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.app.audio.microphone import MicrophoneSource  # noqa: E402
from backend.app.detection.rms import RMSDetector  # noqa: E402
import numpy as np  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--device", type=int, help="real PortAudio device ID")
    parser.add_argument("--seconds", type=float, default=3.0)
    args = parser.parse_args()
    print("Auto Voice Recorder - Linux Audio Diagnostic\n")
    print(f"Platform:\n{platform.system()}\n")
    devices = MicrophoneSource.list_devices()
    print(f"PortAudio:\n{'OK' if devices else 'UNAVAILABLE OR NO INPUT'}\n\nInput devices:\n")
    for dev in devices:
        print(f"[{dev['id']}]\n{dev['name']}\nInputs: {dev['max_input_channels']}")
        print(f"Rate: {dev['default_samplerate']}\nHost API: {dev['hostapi']}\nType: {dev['device_kind']}\n")
    if not devices:
        return 1
    device_id = args.device if args.device is not None else next(
        (d["id"] for d in devices if "usb" in d["name"].lower()), devices[0]["id"]
    )
    source = MicrophoneSource(device_id=device_id, sample_rate=16000)
    chunks = []
    try:
        print(f"Testing {next(d['name'] for d in devices if d['id'] == device_id)}...\n")
        source.start()
        import time
        deadline = time.monotonic() + args.seconds
        while time.monotonic() < deadline:
            chunk = source.read_chunk()
            if chunk is not None and len(chunk):
                chunks.append(chunk)
    except Exception as exc:
        print(f"RESULT:\nINPUT FAILED\n\nExact error: {exc}")
        return 2
    finally:
        source.stop()
    samples = np.concatenate(chunks) if chunks else np.empty(0, dtype=np.float32)
    rms, level = RMSDetector.process_chunk(samples)
    peak = RMSDetector.rms_to_dbfs(float(np.max(np.abs(samples))) if len(samples) else 0.0)
    print(f"Frames received: {len(samples)}\nCurrent RMS: {rms:.4f}\nLevel: {level:.1f} dBFS\nPeak: {peak:.1f} dBFS")
    print(f"\nRESULT:\n{'INPUT WORKING' if len(samples) else 'NO AUDIO DATA'}")
    return 0 if len(samples) else 3


if __name__ == "__main__":
    raise SystemExit(main())
