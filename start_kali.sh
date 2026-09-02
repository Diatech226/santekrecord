#!/usr/bin/env bash
# ==============================================================================
# Auto Voice Recorder - Kali Linux Startup Script
# ==============================================================================

set -e

# Always operate from the repository, even when launched from another directory.
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

echo "=== Auto Voice Recorder (Kali Linux) ==="

# 1. Install the complete runtime instead of assuming that the presence of
# python3 means ALSA/PortAudio headers and venv support are also installed.
SYSTEM_PACKAGES=(python3 python3-dev python3-venv python3-pip alsa-utils portaudio19-dev libportaudio2 ffmpeg nodejs npm)
MISSING_PACKAGES=()
for package in "${SYSTEM_PACKAGES[@]}"; do
    dpkg-query -W -f='${Status}' "$package" 2>/dev/null | grep -q "install ok installed" || MISSING_PACKAGES+=("$package")
done
if ((${#MISSING_PACKAGES[@]})); then
    echo "[*] Installing missing Kali packages: ${MISSING_PACKAGES[*]}"
    sudo apt update
    sudo apt install -y "${MISSING_PACKAGES[@]}"
fi

# 3. Create & Activate Python Virtual Environment
if [ ! -d ".venv" ]; then
    echo "[*] Creating Python virtual environment in .venv..."
    python3 -m venv .venv
fi

echo "[*] Activating virtual environment..."
source .venv/bin/activate

echo "[*] Installing Python dependencies..."
pip install --upgrade pip
pip install -r backend/requirements.txt

# Fetch only during installation. Once present, startup and inference are offline.
if [ ! -s backend/models/silero_vad.onnx ]; then
    echo "[*] Installing pinned Silero VAD ONNX model..."
    python3 scripts/install_silero_vad.py || true
fi
if [ -s backend/models/silero_vad.onnx ]; then
    echo "[OK] Silero VAD model available"
else
    echo "[WARN] Silero VAD unavailable - acoustic fallback active"
fi

# 4. Install Node.js dependencies
if [ ! -d "node_modules" ]; then
    echo "[*] Installing Frontend / Node dependencies..."
    npm install
fi

# 5. Create FIFO for GNU Radio HackRF if not present
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

# 6. Launch Backend & Frontend
echo "[*] Starting FastAPI Backend on http://127.0.0.1:8000 ..."
python3 -m uvicorn backend.app.main:app --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!

echo "[*] Starting Vite / Express Frontend on http://127.0.0.1:3000 ..."
npm run dev &
FRONTEND_PID=$!

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null || true; exit" INT TERM EXIT

echo ""
echo "=========================================================="
echo ">> Auto Voice Recorder is running!"
echo ">> Web UI:  http://127.0.0.1:3000"
echo ">> API:     http://127.0.0.1:8000"
echo ">> Press Ctrl+C to stop all services."
echo "=========================================================="
echo ""

wait
