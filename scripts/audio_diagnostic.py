#!/usr/bin/env python3
"""Interactive real-frame PortAudio/ALSA diagnostic (never emits simulated values)."""
from __future__ import annotations
import platform, sys, time
from pathlib import Path
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.app.audio.microphone import MicrophoneSource, sd
from backend.app.audio.alsa import ALSAArecordSource, list_alsa_devices, match_alsa_device


def measure(source, seconds=1.0):
    frames, squares, peak = 0, 0.0, 0.0
    source.start()
    try:
        verifier = getattr(source, "verify_audio_stream", lambda: True)
        if not verifier(): return None
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            chunk = source.read_chunk()
            if chunk is not None and len(chunk):
                frames += len(chunk); squares += float(np.sum(chunk.astype(np.float64) ** 2)); peak = max(peak, float(np.max(np.abs(chunk))))
    finally: source.stop()
    if not frames: return None
    rms = (squares / frames) ** .5
    db = lambda value: max(-100.0, 20 * np.log10(max(value, 1e-5)))
    return frames, db(rms), db(peak)

print("SANTEK RECORD AUDIO DIAGNOSTIC\n\nOS:\n" + platform.platform())
print("\nPortAudio:\n" + ("OK" if sd is not None else "UNAVAILABLE"))
if sd is not None: print(sd.query_devices())
alsa = list_alsa_devices()
print("\nALSA:\n" + ("OK" if alsa else "UNAVAILABLE"))
for d in alsa: print(f"  card {d.card}, device {d.device}: {d.name} ({d.identifier})")
inputs = MicrophoneSource.list_devices()
print("\nInputs:")
for d in inputs: print(f"[{d['id']}] {d['name']}\nPortAudio ID: {d['id']}\nALSA: {d.get('alsa_identifier') or 'unmatched'}")
for d in inputs:
    print(f"\nTesting {d['name']}...\nOpening PortAudio...")
    try: result = measure(MicrophoneSource(d['id']))
    except Exception as exc: print(f"FAILED: {exc}"); result = None
    backend = "PortAudio"
    if result is None:
        print("NO FRAMES\nTrying ALSA...")
        mapping = match_alsa_device(d['name'])
        try: result = measure(ALSAArecordSource(mapping)) if mapping else None
        except Exception as exc: print(f"FAILED: {exc}"); result = None
        backend = "ALSA fallback"
    if result:
        print(f"Frames: {result[0]}\nRMS: {result[1]:.1f} dBFS\nPeak: {result[2]:.1f} dBFS\nRESULT: AUDIO INPUT WORKING ({backend})")
    else: print("RESULT: NO AUDIO DATA")
