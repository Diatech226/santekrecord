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
        outputs = session.run(None, {
            "input": np.zeros((1, 512), dtype=np.float32),
            "state": np.zeros((2, 1, 128), dtype=np.float32),
            "sr": np.asarray(16000, dtype=np.int64),
        })
        if not outputs or np.asarray(outputs[0]).size == 0:
            return False, "dummy inference returned no speech probability"
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
