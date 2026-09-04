"""Deterministic, offline-first Silero VAD adapter."""
from collections import deque
from pathlib import Path
import os
import wave
import numpy as np

try:
    import torch
except ImportError:  # pragma: no cover - depends on installation
    torch = None
try:
    import onnxruntime as ort
except ImportError:  # pragma: no cover
    ort = None


class SileroVADDetector:
    """Feeds Silero its documented 512-sample frames at 16 kHz.

    Model loading never initiates a network request. A local ONNX model is
    preferred; a local torch-hub checkout remains supported for compatibility.
    """
    frame_samples = 512
    context_samples = 64

    def __init__(self, sample_rate=16000):
        self.sample_rate = sample_rate
        self.model = None
        self._onnx_session = None
        self._onnx_state = np.zeros((2, 1, 128), dtype=np.float32)
        self._onnx_context = np.zeros((1, self.context_samples), dtype=np.float32)
        self.vad_backend = "acoustic_fallback"
        self.vad_model_loaded = False
        self.vad_error = None
        self._pending = np.empty(0, dtype=np.float32)
        self._recent = deque(maxlen=3)
        self._smoothed_probability = 0.0
        self.last_raw_probability = 0.0
        self.last_smoothed_probability = 0.0
        self.last_input_rms = 0.0
        self.last_input_abs_max = 0.0
        self._debug_wave = None
        self._debug_samples_written = 0
        self._debug_sum_squares = 0.0
        self._debug_abs_max = 0.0
        self._init_model()

    def _init_model(self):
        model_path = Path(os.environ.get(
            "SILERO_VAD_MODEL", Path(__file__).parents[2] / "models" / "silero_vad.onnx"))
        if model_path.is_file() and ort is not None:
            try:
                self._onnx_session = ort.InferenceSession(str(model_path), providers=["CPUExecutionProvider"])
                self.vad_backend, self.vad_model_loaded = "silero_onnx", True
                return
            except Exception as exc:
                self.vad_error = f"Silero ONNX load failed: {type(exc).__name__}: {exc}"
        elif model_path.is_file():
            self.vad_error = "onnxruntime is not installed; using acoustic fallback"
        if torch is None:
            self.vad_error = self.vad_error or "Local Silero model unavailable; using acoustic fallback"
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
            self.vad_backend, self.vad_model_loaded = "silero_torch", True
        except Exception as exc:
            self.vad_error = f"Silero load failed: {type(exc).__name__}: {exc}"

    def get_speech_probability(self, chunk):
        chunk = np.asarray(chunk, dtype=np.float32).reshape(-1)
        if not len(chunk): return 0.0
        if not np.isfinite(chunk).all():
            self.vad_error = "Non-finite samples replaced before VAD inference"
            chunk = np.nan_to_num(chunk, nan=0.0, posinf=1.0, neginf=-1.0)
        chunk = np.clip(chunk, -1.0, 1.0).astype(np.float32, copy=False)
        self.last_input_rms = float(np.sqrt(np.mean(np.square(chunk, dtype=np.float64))))
        self.last_input_abs_max = float(np.max(np.abs(chunk)))
        self._write_debug_audio(chunk)
        self._pending = np.concatenate((self._pending, chunk))
        probabilities = []
        while len(self._pending) >= self.frame_samples:
            frame, self._pending = self._pending[:self.frame_samples], self._pending[self.frame_samples:]
            probabilities.append(self._infer_frame(frame))
        if probabilities:
            current = max(probabilities)
            self.last_raw_probability = float(current)
            self._recent.append(current)
            # Fast attack preserves the first voiced frame. Slow release avoids
            # chatter on short dips without averaging speech with old silence.
            if current >= self._smoothed_probability:
                self._smoothed_probability = current
            else:
                self._smoothed_probability = .75 * self._smoothed_probability + .25 * current
            self.last_smoothed_probability = float(self._smoothed_probability)
        return float(self._smoothed_probability)

    def reset(self):
        """Clear all streaming/recurrent state between monitoring sessions."""
        self._pending = np.empty(0, dtype=np.float32)
        self._recent.clear()
        self._smoothed_probability = 0.0
        self.last_raw_probability = 0.0
        self.last_smoothed_probability = 0.0
        self.last_input_rms = 0.0
        self.last_input_abs_max = 0.0
        self._onnx_state = np.zeros((2, 1, 128), dtype=np.float32)
        self._onnx_context = np.zeros((1, self.context_samples), dtype=np.float32)
        self._close_debug_audio()
        if self.model is not None:
            reset_states = getattr(self.model, "reset_states", None)
            if callable(reset_states):
                reset_states()

    def _infer_frame(self, frame):
        if self._onnx_session is not None:
            onnx_frame = np.asarray(frame, dtype=np.float32).reshape(1, self.frame_samples)
            model_input = np.concatenate((self._onnx_context, onnx_frame), axis=1).astype(
                np.float32, copy=False
            )
            try:
                names = {item.name for item in self._onnx_session.get_inputs()}
                feed = {"input": model_input}
                if "state" in names:
                    feed["state"] = self._onnx_state
                if "sr" in names:
                    feed["sr"] = np.asarray(self.sample_rate, dtype=np.int64)
                outputs = self._onnx_session.run(None, feed)
                if len(outputs) > 1:
                    self._onnx_state = np.asarray(outputs[1], dtype=np.float32)
                self._onnx_context = model_input[:, -self.context_samples:].copy()
                return float(np.clip(np.asarray(outputs[0]).reshape(-1)[0], 0, 1))
            except Exception as exc:
                self.vad_error = (
                    "Silero ONNX inference failed: "
                    f"input={model_input.shape} state={self._onnx_state.shape} "
                    f"sr={self.sample_rate} error={type(exc).__name__}: {exc}"
                )
                print(f"[SILERO ERROR] {self.vad_error}")
                self._onnx_session = None
                self.vad_model_loaded, self.vad_backend = False, "acoustic_fallback"
        if self.model is not None:
            try:
                with torch.no_grad():
                    return float(np.clip(self.model(torch.from_numpy(frame), self.sample_rate).item(), 0, 1))
            except Exception as exc:
                self.vad_error = f"Silero inference failed: {type(exc).__name__}: {exc}"
                self.model, self.vad_model_loaded, self.vad_backend = None, False, "acoustic_fallback"
        return self._acoustic_vad_fallback(frame)

    def _write_debug_audio(self, chunk):
        """Optionally dump exactly the normalized signal presented to this VAD."""
        if os.environ.get("SANTEK_DEBUG_VAD_AUDIO") != "1":
            return
        limit = self.sample_rate * 10
        remaining = limit - self._debug_samples_written
        if remaining <= 0:
            return
        samples = np.asarray(chunk[:remaining], dtype=np.float32)
        if self._debug_wave is None:
            path = Path("data/debug/vad_input.wav")
            path.parent.mkdir(parents=True, exist_ok=True)
            self._debug_wave = wave.open(str(path), "wb")
            self._debug_wave.setnchannels(1)
            self._debug_wave.setsampwidth(2)
            self._debug_wave.setframerate(self.sample_rate)
            print(f"[DEBUG VAD AUDIO] path={path} sample_rate={self.sample_rate}")
        pcm = (np.clip(samples, -1, 1) * 32767).astype("<i2")
        self._debug_wave.writeframesraw(pcm.tobytes())
        self._debug_samples_written += len(samples)
        self._debug_sum_squares += float(np.sum(np.square(samples, dtype=np.float64)))
        self._debug_abs_max = max(self._debug_abs_max, float(np.max(np.abs(samples), initial=0)))
        if self._debug_samples_written >= limit:
            self._close_debug_audio()

    def _close_debug_audio(self):
        if self._debug_wave is None:
            return
        self._debug_wave.close()
        self._debug_wave = None
        duration = self._debug_samples_written / self.sample_rate
        rms = np.sqrt(self._debug_sum_squares / max(1, self._debug_samples_written))
        print("[DEBUG VAD AUDIO] "
              f"path=data/debug/vad_input.wav duration={duration:.2f}s "
              f"sample_rate={self.sample_rate} rms={rms:.7f} peak={self._debug_abs_max:.7f}")

    def _acoustic_vad_fallback(self, chunk):
        rms = float(np.sqrt(np.mean(chunk ** 2)))
        windowed = chunk * np.hanning(len(chunk))
        power = np.abs(np.fft.rfft(windowed)) ** 2
        freqs = np.fft.rfftfreq(len(chunk), 1 / self.sample_rate)
        ratio = float(power[(freqs >= 250) & (freqs <= 4000)].sum() / (power.sum() + 1e-12))
        zcr = float(np.mean(np.diff(np.signbit(chunk))))
        zcr_score = max(0., 1. - abs(zcr - .12) / .16)
        # No absolute RMS gate: spectral shape still recognizes quiet speech.
        # The adaptive noise profile supplies the level/SNR evidence downstream.
        level_score = np.clip((20 * np.log10(rms + 1e-8) + 80) / 50, 0, 1)
        return float(np.clip(.58 * ratio + .30 * zcr_score + .12 * level_score, 0, .92))

    def diagnostics(self):
        return {"vad_backend": self.vad_backend, "vad_model_loaded": self.vad_model_loaded,
                "vad_error": self.vad_error,
                "vad_frame_samples": self.frame_samples,
                "vad_context_samples": self.context_samples,
                "vad_model_input_samples": self.frame_samples + self.context_samples,
                "vad_raw_probability": round(self.last_raw_probability, 4),
                "vad_smoothed_probability": round(self.last_smoothed_probability, 4),
                "sample_rms": round(self.last_input_rms, 7),
                "sample_abs_max": round(self.last_input_abs_max, 7)}
