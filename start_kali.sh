#!/usr/bin/env bash
# Reliable offline-first launcher for SantekRecord on Kali Linux.

set -Eeuo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

log()   { printf '[SANTEK] %s\n' "$*"; }
ok()    { printf '[OK] %s\n' "$*"; }
warn()  { printf '[WARN] %s\n' "$*" >&2; }
error() { printf '[ERROR] %s\n' "$*" >&2; }

PYTHON_MODULES=(fastapi uvicorn sounddevice numpy soundfile pydantic websockets multipart aiofiles scipy onnxruntime)
SETUP_REASONS=()

check_python_environment() {
    [[ -x .venv/bin/python ]] || return 1
    .venv/bin/python -c 'import sys; raise SystemExit(sys.prefix == sys.base_prefix)' >/dev/null 2>&1 || return 1
    .venv/bin/python - "${PYTHON_MODULES[@]}" <<'PY'
import importlib
import sys
failures = []
for module in sys.argv[1:]:
    try:
        importlib.import_module(module)
    except Exception as exc:
        failures.append(f"{module}: {type(exc).__name__}: {exc}")
if failures:
    print("\n".join(failures), file=sys.stderr)
    raise SystemExit(1)
PY
}

check_frontend_environment() {
    [[ -d node_modules && -x node_modules/.bin/tsx && -x node_modules/.bin/vite ]] || return 1
    npm ls --depth=0 >/dev/null 2>&1
}

log "Vérification de l'environnement..."
command -v python3 >/dev/null 2>&1 && ok "Python : $(python3 --version 2>&1)" || SETUP_REASONS+=("Python 3 absent")
command -v node >/dev/null 2>&1 && ok "Node.js : $(node --version)" || SETUP_REASONS+=("Node.js absent")
command -v npm >/dev/null 2>&1 && ok "npm : $(npm --version)" || SETUP_REASONS+=("npm absent")

RUNTIME_PACKAGES=(alsa-utils libportaudio2 ffmpeg)
if command -v dpkg-query >/dev/null 2>&1; then
    for package in "${RUNTIME_PACKAGES[@]}"; do
        dpkg-query -W -f='${Status}' "$package" 2>/dev/null | grep -q "install ok installed" || SETUP_REASONS+=("paquet système manquant : $package")
    done
else
    SETUP_REASONS+=("dpkg indisponible (Kali/Debian requis)")
fi

PYTHON_CHECK_LOG=$(mktemp "${TMPDIR:-/tmp}/santek-python-check.XXXXXX")
if check_python_environment 2>"$PYTHON_CHECK_LOG"; then
    ok "Virtualenv et dépendances backend"
else
    [[ -s $PYTHON_CHECK_LOG ]] && sed 's/^/[ERROR] Python dependency missing or broken: /' "$PYTHON_CHECK_LOG" >&2
    SETUP_REASONS+=(".venv absent, invalide ou incomplet")
fi
if command -v npm >/dev/null 2>&1 && check_frontend_environment; then
    ok "Dépendances frontend"
else
    SETUP_REASONS+=("node_modules absent ou incompatible")
fi
rm -f "$PYTHON_CHECK_LOG"

if ((${#SETUP_REASONS[@]})); then
    warn "Une réparation initiale est nécessaire :"
    printf '  - %s\n' "${SETUP_REASONS[@]}" >&2
    log "Lancement automatique de setup_kali.sh..."
    [[ -f setup_kali.sh ]] || { error "setup_kali.sh est introuvable."; exit 1; }
    bash ./setup_kali.sh
    log "Nouvelle vérification après préparation..."
fi

check_python_environment || { error "L'environnement Python reste incomplet après setup."; exit 1; }
check_frontend_environment || { error "Les dépendances frontend restent incomplètes après setup."; exit 1; }
ok "Backend dependencies"
ok "Frontend dependencies"

if .venv/bin/python - <<'PY'
from pathlib import Path
from scripts.install_silero_vad import validate_model
valid, diagnostic = validate_model(Path("backend/models/silero_vad.onnx"))
print(diagnostic)
raise SystemExit(not valid)
PY
then
    ok "Silero VAD"
else
    warn "Silero VAD indisponible ; démarrage avec le fallback acoustique (aucun téléchargement)."
fi

if [[ -e /tmp/hackrf_audio.f32 && ! -p /tmp/hackrf_audio.f32 ]]; then
    warn "Remplacement du fichier non-FIFO /tmp/hackrf_audio.f32."
    rm -f /tmp/hackrf_audio.f32
fi
[[ -p /tmp/hackrf_audio.f32 ]] || mkfifo /tmp/hackrf_audio.f32

if command -v arecord >/dev/null 2>&1; then
    arecord -l >/dev/null 2>&1 && ok "Audio subsystem (ALSA/PortAudio)" || warn "Aucune entrée ALSA visible ; l'application reste utilisable avec GNU Radio."
fi
.venv/bin/python - <<'PY' || warn "PortAudio ne voit aucune entrée ; vérifiez la carte son et les permissions."
import sounddevice as sd
raise SystemExit(not any(d['max_input_channels'] > 0 for d in sd.query_devices()))
PY

describe_port() {
    local port=$1
    if command -v ss >/dev/null 2>&1; then
        ss -ltnp "sport = :$port" 2>/dev/null | tail -n +2 || true
    elif command -v lsof >/dev/null 2>&1; then
        lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null || true
    fi
}
port_is_free() {
    .venv/bin/python - "$1" <<'PY'
import socket, sys
sock = socket.socket()
try:
    sock.bind(("127.0.0.1", int(sys.argv[1])))
except OSError:
    raise SystemExit(1)
finally:
    sock.close()
PY
}
for port in 8000 3000; do
    if ! port_is_free "$port"; then
        error "Le port $port est déjà utilisé. Arrêtez l'instance concernée puis relancez SantekRecord."
        describe_port "$port" >&2
        exit 1
    fi
done
ok "Ports 8000 et 3000 disponibles"

BACKEND_PID=
FRONTEND_PID=
cleanup() {
    trap - EXIT INT TERM
    for pid in "${FRONTEND_PID:-}" "${BACKEND_PID:-}"; do
        [[ -n $pid ]] && kill -TERM -- "-$pid" 2>/dev/null || true
    done
    for _ in {1..30}; do
        kill -0 "${BACKEND_PID:-0}" 2>/dev/null || kill -0 "${FRONTEND_PID:-0}" 2>/dev/null || break
        sleep 0.1
    done
    for pid in "${FRONTEND_PID:-}" "${BACKEND_PID:-}"; do
        [[ -n $pid ]] && kill -KILL -- "-$pid" 2>/dev/null || true
    done
    wait "${FRONTEND_PID:-}" "${BACKEND_PID:-}" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 130' INT TERM

wait_for_url() {
    local url=$1 pid=$2 label=$3
    for _ in {1..100}; do
        kill -0 "$pid" 2>/dev/null || { error "$label s'est arrêté pendant son démarrage (voir l'erreur ci-dessus)."; return 1; }
        if .venv/bin/python - "$url" <<'PY' >/dev/null 2>&1
import sys
from urllib.request import urlopen
with urlopen(sys.argv[1], timeout=.5) as response:
    raise SystemExit(response.status >= 500)
PY
        then return 0; fi
        sleep 0.1
    done
    error "$label ne répond pas sur $url avant l'expiration du délai de démarrage."
    return 1
}

log "Starting backend..."
setsid .venv/bin/python -m uvicorn backend.app.main:app --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!
wait_for_url http://127.0.0.1:8000/api/health "$BACKEND_PID" "Le backend"
ok "Backend running : http://127.0.0.1:8000"

log "Starting frontend..."
NO_OPEN=true HOST=127.0.0.1 PORT=3000 setsid npm run dev &
FRONTEND_PID=$!
wait_for_url http://127.0.0.1:3000 "$FRONTEND_PID" "Le frontend"
ok "Frontend running : http://127.0.0.1:3000"
log "SantekRecord fonctionne hors ligne. Ctrl+C arrête proprement les deux services."

set +e
wait -n "$BACKEND_PID" "$FRONTEND_PID"
status=$?
set -e
error "Un service s'est arrêté (code $status) ; arrêt de l'application."
exit "$status"
