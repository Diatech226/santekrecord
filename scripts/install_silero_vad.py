"""Install and validate the pinned Silero ONNX model used by the backend."""
from __future__ import annotations

import hashlib
from pathlib import Path
from urllib.request import urlopen

import numpy as np

SILERO_VERSION = "v6.2.1"
URL = (
    "https://raw.githubusercontent.com/snakers4/silero-vad/"
    f"{SILERO_VERSION}/src/silero_vad/data/silero_vad.onnx"
)
# No checksum is pinned: the release asset could not be fetched in the build
# environment used to establish this value. Runtime structure and inference are
# validated below instead of publishing an unverified digest.
EXPECTED_SHA256: str | None = None
DESTINATION = Path(__file__).parents[1] / "backend" / "models" / "silero_vad.onnx"
EXPECTED_INPUTS = {"input", "state", "sr"}


def validate_model(path: Path) -> tuple[bool, str]:
    """Return whether *path* is a usable Silero model and a clear diagnostic."""
    path = Path(path)
    if not path.is_file():
        return False, f"model file does not exist: {path}"
    if path.stat().st_size <= 0:
        return False, f"model file is empty: {path}"
    try:
        import onnxruntime as ort
    except ImportError as exc:
        return False, f"onnxruntime unavailable: {exc}"

    try:
        session = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
        names = {item.name for item in session.get_inputs()}
        missing = EXPECTED_INPUTS - names
        if missing:
            return False, f"missing expected ONNX inputs: {', '.join(sorted(missing))}"
        state = np.zeros((2, 1, 128), dtype=np.float32)
        context = np.zeros((1, 64), dtype=np.float32)
        probabilities = []
        states = []
        frames = [np.zeros((1, 512), dtype=np.float32),
                  np.sin(np.arange(512, dtype=np.float32) * (2 * np.pi * 220 / 16000))[None] * .2]
        for frame in frames:
            model_input = np.concatenate((context, frame), axis=1).astype(np.float32)
            if model_input.shape != (1, 576):
                return False, f"invalid streaming input shape: {model_input.shape}"
            outputs = session.run(None, {"input": model_input, "state": state,
                                         "sr": np.asarray(16000, dtype=np.int64)})
            if len(outputs) < 2:
                return False, "inference did not return probability and recurrent state"
            probability = float(np.asarray(outputs[0]).reshape(-1)[0])
            if not np.isfinite(probability):
                return False, "inference returned a non-finite speech probability"
            probabilities.append(probability)
            state = np.asarray(outputs[1], dtype=np.float32)
            states.append(state.copy())
            context = model_input[:, -64:].copy()
        if not np.isfinite(state).all() or not np.any(states[-1] != states[0]):
            return False, "recurrent state did not evolve across validation frames"
        if probabilities[0] == probabilities[1]:
            return False, "speech probability did not change for a non-zero input"
    except Exception as exc:
        return False, f"ONNX validation failed ({type(exc).__name__}): {exc}"
    return True, f"valid Silero ONNX model ({path.stat().st_size} bytes)"


def install_model(destination: Path = DESTINATION, url: str = URL) -> bool:
    """Keep an existing valid model, otherwise atomically install a valid copy."""
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(".onnx.part")
    valid, diagnostic = validate_model(destination)
    if valid:
        print(f"[OK] Silero VAD ONNX ready: {diagnostic}")
        return True
    if destination.exists():
        print(f"[WARN] Existing Silero model is invalid: {diagnostic}")
        destination.unlink()

    try:
        temporary.unlink(missing_ok=True)
        with urlopen(url, timeout=60) as response, temporary.open("wb") as output:
            digest = hashlib.sha256()
            while block := response.read(1024 * 1024):
                output.write(block)
                digest.update(block)
        if EXPECTED_SHA256 and digest.hexdigest() != EXPECTED_SHA256:
            raise ValueError("downloaded model SHA-256 does not match the pinned digest")
        valid, diagnostic = validate_model(temporary)
        if not valid:
            raise ValueError(diagnostic)
        temporary.replace(destination)
        print(f"[OK] Silero VAD ONNX ready: {diagnostic}")
        return True
    except Exception as exc:
        temporary.unlink(missing_ok=True)
        print(f"[ERROR] Silero VAD installation failed: {type(exc).__name__}: {exc}")
        return False


def main() -> int:
    try:
        import onnxruntime as ort
        print(f"[OK] onnxruntime {ort.__version__}")
    except ImportError as exc:
        print(f"[ERROR] onnxruntime unavailable: {exc}")
        return 1
    return 0 if install_model() else 1


if __name__ == "__main__":
    raise SystemExit(main())
