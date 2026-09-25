#!/usr/bin/env bash
# One-time/repair installer for SantekRecord on Kali Linux.

set -Eeuo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

log()   { printf '[SANTEK] %s\n' "$*"; }
ok()    { printf '[OK] %s\n' "$*"; }
warn()  { printf '[WARN] %s\n' "$*" >&2; }
error() { printf '[ERROR] %s\n' "$*" >&2; }

log "Préparation de l'environnement Kali (une connexion peut être nécessaire)..."

SYSTEM_PACKAGES=(python3 python3-dev python3-venv python3-pip alsa-utils portaudio19-dev libportaudio2 ffmpeg nodejs npm)
MISSING_PACKAGES=()
if command -v dpkg-query >/dev/null 2>&1; then
    for package in "${SYSTEM_PACKAGES[@]}"; do
        dpkg-query -W -f='${Status}' "$package" 2>/dev/null | grep -q "install ok installed" || MISSING_PACKAGES+=("$package")
    done
else
    error "Ce programme d'installation nécessite Kali/Debian (dpkg est introuvable)."
    exit 1
fi

if ((${#MISSING_PACKAGES[@]})); then
    log "Installation des paquets système manquants : ${MISSING_PACKAGES[*]}"
    if [[ $EUID -eq 0 ]]; then
        APT=(apt-get)
    elif command -v sudo >/dev/null 2>&1; then
        APT=(sudo apt-get)
    else
        error "sudo est requis pour installer : ${MISSING_PACKAGES[*]}"
        exit 1
    fi
    "${APT[@]}" update
    "${APT[@]}" install -y "${MISSING_PACKAGES[@]}"
else
    ok "Paquets système"
fi

if ! command -v python3 >/dev/null 2>&1; then
    error "Python 3 reste introuvable après l'installation."
    exit 1
fi

# A directory alone does not make a usable virtualenv. Recreate stale/broken
# environments (for example after a Python distribution upgrade).
if [[ -d .venv ]] && { [[ ! -x .venv/bin/python ]] || ! .venv/bin/python -c 'import sys; raise SystemExit(sys.prefix == sys.base_prefix)' >/dev/null 2>&1; }; then
    warn "L'environnement .venv est invalide ; recréation complète."
    rm -rf .venv
fi
if [[ ! -x .venv/bin/python ]]; then
    log "Création de .venv..."
    python3 -m venv .venv
fi
ok "Environnement virtuel Python"

log "Installation des dépendances backend..."
.venv/bin/python -m pip install -r backend/requirements.txt
ok "Dépendances backend"

log "Installation/validation du modèle Silero VAD..."
if .venv/bin/python scripts/install_silero_vad.py; then
    ok "Silero VAD"
else
    warn "Silero VAD n'a pas pu être installé ; le fallback acoustique local restera disponible."
fi

if ! command -v npm >/dev/null 2>&1; then
    error "npm reste introuvable après l'installation."
    exit 1
fi
log "Installation des dépendances frontend reproductibles..."
if [[ -f package-lock.json ]]; then
    npm ci
else
    warn "package-lock.json absent ; utilisation de npm install."
    npm install
fi
ok "Dépendances frontend"

if [[ -e /tmp/hackrf_audio.f32 && ! -p /tmp/hackrf_audio.f32 ]]; then
    warn "Remplacement du fichier non-FIFO /tmp/hackrf_audio.f32."
    rm -f /tmp/hackrf_audio.f32
fi
[[ -p /tmp/hackrf_audio.f32 ]] || mkfifo /tmp/hackrf_audio.f32
ok "FIFO GNU Radio /tmp/hackrf_audio.f32"

log "Préparation terminée. Les prochains lancements peuvent fonctionner hors ligne."
