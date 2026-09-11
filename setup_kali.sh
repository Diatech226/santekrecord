#!/usr/bin/env bash
# ==============================================================================
# Auto Voice Recorder - Kali Linux ONE-TIME ONLINE setup
# ==============================================================================

set -e
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

echo "=== Auto Voice Recorder (Kali Linux setup) ==="
echo "This setup may require Internet access. Normal launches use ./start_kali.sh offline."

SYSTEM_PACKAGES=(python3 python3-dev python3-venv python3-pip alsa-utils portaudio19-dev libportaudio2 ffmpeg nodejs npm)
MISSING_PACKAGES=()
for package in "${SYSTEM_PACKAGES[@]}"; do
    dpkg-query -W -f='${Status}' "$package" 2>/dev/null | grep -q "install ok installed" || MISSING_PACKAGES+=("$package")
done
if ((${#MISSING_PACKAGES[@]})); then
    echo "[*] Installing missing Kali packages: ${MISSING_PACKAGES[*]}"
    sudo apt update
    sudo apt install -y "${MISSING_PACKAGES[@]}"
else
    echo "[OK] System packages already installed"
fi

if [ ! -d ".venv" ]; then
    echo "[*] Creating Python virtual environment in .venv..."
    python3 -m venv .venv
fi
source .venv/bin/activate

echo "[*] Installing/updating Python dependencies..."
python3 -m pip install --upgrade pip
python3 -m pip install -r backend/requirements.txt

echo "[*] Installing/validating pinned Silero VAD ONNX model..."
python3 scripts/install_silero_vad.py

echo "[*] Installing frontend dependencies..."
if [ -f package-lock.json ]; then
    npm ci
else
    npm install
fi

if [ -e "/tmp/hackrf_audio.f32" ] && [ ! -p "/tmp/hackrf_audio.f32" ]; then
    rm -f /tmp/hackrf_audio.f32
fi
if [ ! -p "/tmp/hackrf_audio.f32" ]; then
    mkfifo /tmp/hackrf_audio.f32 || true
fi

echo ""
echo "=========================================================="
echo ">> Setup complete."
echo ">> You can now disconnect the PC from the Internet."
echo ">> Start the application with: ./start_kali.sh"
echo "=========================================================="
