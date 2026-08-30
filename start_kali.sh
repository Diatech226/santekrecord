#!/usr/bin/env bash
# ==============================================================================
# Auto Voice Recorder - Kali Linux Startup Script
# ==============================================================================

set -e

echo "=== Auto Voice Recorder (Kali Linux) ==="

# 1. Check Python3
if ! command -v python3 &> /dev/null; then
    echo "[!] Python3 not found. Installing..."
    sudo apt update && sudo apt install -y python3 python3-venv python3-pip portaudio19-dev ffmpeg
fi

# 2. Check Node.js
if ! command -v npm &> /dev/null; then
    echo "[!] Node.js / npm not found. Installing..."
    sudo apt update && sudo apt install -y nodejs npm
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

# 4. Install Node.js dependencies
if [ ! -d "node_modules" ]; then
    echo "[*] Installing Frontend / Node dependencies..."
    npm install
fi

# 5. Create FIFO for GNU Radio HackRF if not present
if [ ! -p "/tmp/hackrf_audio.f32" ]; then
    echo "[*] Creating GNU Radio FIFO at /tmp/hackrf_audio.f32..."
    mkfifo /tmp/hackrf_audio.f32 || true
fi

# 6. Launch Backend & Frontend
echo "[*] Starting FastAPI Backend on http://127.0.0.1:8000 ..."
python3 -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 &
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
