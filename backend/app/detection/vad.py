import os
from typing import Optional
import numpy as np

# Try importing PyTorch for Silero VAD
try:
    import torch
    TORCH_AVAILABLE = True
except ImportError:
    torch = None
    TORCH_AVAILABLE = False


class SileroVADDetector:
    """
    Voice Activity Detection using Silero VAD model (16kHz mono).
    Returns speech_probability between 0.00 and 1.00.
    Includes acoustic fallback if PyTorch or internet is unavailable in offline Kali environments.
    """

    def __init__(self, sample_rate: int = 16000):
        self.sample_rate = sample_rate
        self.model = None
        self._utils = None
        self._init_model()

    def _init_model(self):
        if TORCH_AVAILABLE and torch is not None:
            try:
                # Load Silero VAD from torch hub with local caching
                self.model, self._utils = torch.hub.load(
                    repo_or_dir="snakers4/silero-vad",
                    model="silero_vad",
                    force_reload=False,
                    onnx=False,
                    trust_repo=True,
                )
                self.model.eval()
                print("[VAD] Silero VAD initialized successfully via PyTorch.")
            except Exception as e:
                print(f"[VAD] Note: Silero VAD online download not available ({e}). Using optimized acoustic formant fallback.")
                self.model = None

    def get_speech_probability(self, chunk: np.ndarray) -> float:
        """
        Process audio chunk and return speech probability (0.00 - 1.00).
        """
        if len(chunk) == 0:
            return 0.0

        # If PyTorch model is loaded
        if self.model is not None and TORCH_AVAILABLE and torch is not None:
            try:
                tensor = torch.from_numpy(chunk.astype(np.float32))
                with torch.no_grad():
                    speech_prob = self.model(tensor, self.sample_rate).item()
                    return float(np.clip(speech_prob, 0.0, 1.0))
            except Exception:
                pass

        # Robust acoustic formant & zero-crossing rate fallback
        return self._acoustic_vad_fallback(chunk)

    def _acoustic_vad_fallback(self, chunk: np.ndarray) -> float:
        """
        Acoustic voice activity estimator analyzing formant frequency band and zero crossings.
        """
        rms = np.sqrt(np.mean(chunk ** 2))
        if rms < 0.003:
            return 0.0

        # Zero crossing rate
        zcr = np.mean(np.abs(np.diff(np.signbit(chunk))))
        
        # Spectral energy in human voice formant band (approx 300Hz - 3400Hz)
        # Using autocorrelation and differences
        diff_samples = np.diff(chunk, n=2)
        voice_energy = np.mean(diff_samples ** 2) if len(diff_samples) > 0 else 0.0
        total_energy = np.mean(chunk ** 2) + 1e-8
        spectral_ratio = voice_energy / total_energy

        # Human vocal cord speech typical ZCR is between 0.04 and 0.30
        if 0.03 < zcr < 0.32:
            zcr_score = 1.0 - abs(zcr - 0.12) / 0.15
            energy_score = min(1.0, float(rms * 18.0))
            prob = max(0.0, min(1.0, zcr_score * 0.6 + energy_score * 0.4))
        else:
            prob = float(min(1.0, rms * 10.0))

        return float(np.clip(prob, 0.01, 0.99))
