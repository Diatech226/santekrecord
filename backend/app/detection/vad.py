"""Deterministic, offline-first Silero VAD adapter."""
from collections import deque
from pathlib import Path
import os
import numpy as np

try:
    import torch
except ImportError:  # pragma: no cover - depends on installation
    torch = None


class SileroVADDetector:
    """Feeds Silero its documented 512-sample frames at 16 kHz.

    Model loading never initiates a network request.  Put a torch-hub checkout in
    its normal cache or set ``SILERO_VAD_REPO`` during installation.
    """
    frame_samples = 512

    def __init__(self, sample_rate=16000):
        self.sample_rate = sample_rate
        self.model = None
        self.vad_backend = "acoustic_fallback"
        self.vad_model_loaded = False
        self.vad_error = None
        self._pending = np.empty(0, dtype=np.float32)
        self._recent = deque(maxlen=3)
        self._init_model()

    def _init_model(self):
        if torch is None:
            self.vad_error = "PyTorch is not installed; using acoustic fallback"
            return
        repo = os.environ.get("SILERO_VAD_REPO")
        if not repo:
            hub = Path(torch.hub.get_dir())
            candidates = sorted(hub.glob("snakers4_silero-vad*"))
            repo = str(candidates[-1]) if candidates else None
        if not repo or not Path(repo).exists():
            self.vad_error = "Silero cache not found (offline fallback active)"
            return
        try:
            self.model, _ = torch.hub.load(repo_or_dir=repo, model="silero_vad", source="local", onnx=False)
            self.model.eval()
            self.vad_backend, self.vad_model_loaded = "silero", True
        except Exception as exc:
            self.vad_error = f"Silero load failed: {type(exc).__name__}: {exc}"

    def get_speech_probability(self, chunk):
        chunk = np.asarray(chunk, dtype=np.float32).reshape(-1)
        if not len(chunk): return 0.0
        self._pending = np.concatenate((self._pending, chunk))
        probabilities = []
        while len(self._pending) >= self.frame_samples:
            frame, self._pending = self._pending[:self.frame_samples], self._pending[self.frame_samples:]
            probabilities.append(self._infer_frame(frame))
        if probabilities:
            self._recent.append(max(probabilities))
        return float(np.mean(self._recent)) if self._recent else 0.0

    def _infer_frame(self, frame):
        if self.model is not None:
            try:
                with torch.no_grad():
                    return float(np.clip(self.model(torch.from_numpy(frame), self.sample_rate).item(), 0, 1))
            except Exception as exc:
                self.vad_error = f"Silero inference failed: {type(exc).__name__}: {exc}"
                self.model, self.vad_model_loaded, self.vad_backend = None, False, "acoustic_fallback"
        return self._acoustic_vad_fallback(frame)

    def _acoustic_vad_fallback(self, chunk):
        rms = float(np.sqrt(np.mean(chunk ** 2)))
        if rms < .003: return 0.0
        windowed = chunk * np.hanning(len(chunk))
        power = np.abs(np.fft.rfft(windowed)) ** 2
        freqs = np.fft.rfftfreq(len(chunk), 1 / self.sample_rate)
        ratio = float(power[(freqs >= 250) & (freqs <= 4000)].sum() / (power.sum() + 1e-12))
        zcr = float(np.mean(np.diff(np.signbit(chunk))))
        zcr_score = max(0., 1. - abs(zcr - .12) / .16)
        return float(np.clip(.55 * ratio + .30 * zcr_score + .15 * min(1., rms * 20), 0, .92))

    def diagnostics(self):
        return {"vad_backend": self.vad_backend, "vad_model_loaded": self.vad_model_loaded, "vad_error": self.vad_error}
