#!/usr/bin/env bash
# ==============================================================================
# Auto Voice Recorder - Kali Linux OFFLINE runtime launcher
# ==============================================================================

set -e

# Always operate from the repository, even when launched from another directory.
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

echo "=== Auto Voice Recorder (Kali Linux - offline runtime) ==="

# Runtime startup must never depend on Internet access. Installation and model
# downloads belong to setup_kali.sh, which is run once while online.
# Only packages needed at runtime are checked here; development headers/pip are
# intentionally left to setup_kali.sh.
RUNTIME_PACKAGES=(python3 alsa-utils libportaudio2 ffmpeg nodejs npm)
MISSING_PACKAGES=()
for package in "${RUNTIME_PACKAGES[@]}"; do
    dpkg-query -W -f='${Status}' "$package" 2>/dev/null | grep -q "install ok installed" || MISSING_PACKAGES+=("$package")
done
if ((${#MISSING_PACKAGES[@]})); then
    echo "[ERROR] Missing runtime packages: ${MISSING_PACKAGES[*]}"
    echo "[ERROR] Run ./setup_kali.sh once while Internet access is available."
    exit 1
fi

if [ ! -d ".venv" ]; then
    echo "[ERROR] Python virtual environment .venv is missing."
    echo "[ERROR] Run ./setup_kali.sh once while Internet access is available."
    exit 1
fi

source .venv/bin/activate

# Validate only the dependencies required to start the local app. Optional ML
# packages must not block a machine that can already run the ONNX voice path.
if ! python3 - <<'PYDEPS'
import importlib
import sys

required = [
    "fastapi",
    "uvicorn",
    "sounddevice",
    "numpy",
    "soundfile",
    "pydantic",
    "websockets",
    "multipart",
    "aiofiles",
    "scipy",
]
missing = []
for module in required:
    try:
        importlib.import_module(module)
    except Exception as exc:
        missing.append(f"{module} ({type(exc).__name__}: {exc})")

if missing:
    print("[ERROR] Missing/broken required Python dependencies:")
    for item in missing:
        print(f"  - {item}")
    sys.exit(1)
print("[OK] Required Python runtime dependencies are available locally")
PYDEPS
then
    echo "[ERROR] Python runtime is incomplete."
    echo "[ERROR] Run ./setup_kali.sh once while Internet access is available."
    exit 1
fi

if [ ! -d "node_modules" ]; then
    echo "[ERROR] node_modules is missing."
    echo "[ERROR] Run ./setup_kali.sh once while Internet access is available."
    exit 1
fi

# Validate the local Silero model only. Never download during normal startup.
if python3 - <<'PYSILERO'
from pathlib import Path
from scripts.install_silero_vad import validate_model

path = Path("backend/models/silero_vad.onnx")
valid, diagnostic = validate_model(path)
print(("[OK] " if valid else "[WARN] ") + diagnostic)
raise SystemExit(0 if valid else 1)
PYSILERO
then
    echo "[OK] Silero VAD local model ready"
else
    echo "[WARN] Silero local model or onnxruntime is unavailable."
    echo "[WARN] The app will start with its local acoustic fallback; voice detection may be less accurate."
    echo "[WARN] Run ./setup_kali.sh later with Internet access to install/repair Silero."
fi

# Create FIFO for GNU Radio HackRF if not present.
if [ -e "/tmp/hackrf_audio.f32" ] && [ ! -p "/tmp/hackrf_audio.f32" ]; then
    echo "[!] Removing non-FIFO file at /tmp/hackrf_audio.f32"
    rm -f /tmp/hackrf_audio.f32
fi
if [ ! -p "/tmp/hackrf_audio.f32" ]; then
    echo "[*] Creating GNU Radio FIFO at /tmp/hackrf_audio.f32..."
    mkfifo /tmp/hackrf_audio.f32 || true
fi

echo "Checking audio..."
echo "ALSA cards:"
arecord -l 2>&1 || echo "No ALSA capture cards visible"
echo "PortAudio:"
python3 - <<'PYPORTAUDIO'
import sounddevice as sd
inputs = [(i, d['name']) for i, d in enumerate(sd.query_devices()) if d['max_input_channels'] > 0]
print(inputs if inputs else 'No PortAudio inputs visible')
PYPORTAUDIO

# Launch local backend and frontend. Neither service requires Internet access.
echo "[*] Starting FastAPI Backend on http://127.0.0.1:8000 ..."
python3 -m uvicorn backend.app.main:app --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!

echo "[*] Starting Vite / Express Frontend on http://127.0.0.1:3000 ..."
npm run dev &
FRONTEND_PID=$!

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null || true; exit" INT TERM EXIT

echo ""
echo "=========================================================="
echo ">> Auto Voice Recorder is running OFFLINE."
echo ">> Internet access is NOT required."
echo ">> Web UI:  http://127.0.0.1:3000"
echo ">> API:     http://127.0.0.1:8000"
echo ">> Press Ctrl+C to stop all services."
echo "=========================================================="
echo ""

wait
