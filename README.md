# Auto Voice Recorder (Kali Linux)

Application desktop/web locale minimaliste et professionnelle pour **Kali Linux** permettant d'automatiser l'enregistrement audio selon la détection d'activité vocale (VAD) et de niveau sonore (dBFS).

---

## 🎯 Fonctionnalités Principales

- **Multiples Sources Audio** :
  1. **Microphone** (détection automatique via `sounddevice` / ALSA / PulseAudio / Web Audio)
  2. **Carte son USB / Line-In** (sélection de l'interface d'entrée matérielle)
  3. **HackRF / GNU Radio** (lecture directe de flux `float32` mono 16 kHz depuis `/tmp/hackrf_audio.f32`)
- **Moteur de Détection Intelligent** :
  - **RMS / dBFS** : calcul en temps réel du niveau sonore (`20 * log10(RMS)`).
  - **Silero VAD** : probabilité de présence de voix humaine (0.00 à 1.00) avec modèle PyTorch et fallback acoustique formant.
  - **Mode combiné dB + VAD** : déclenchement précis évitant les faux positifs (filtre de lissage 2 blocs positifs parmi 3).
- **Enregistrement Automatisé** :
  - **Pre-buffer circulaire** : conserve 1 seconde (configurable de 0 à 5s) avant la détection pour ne jamais couper le début de phrase.
  - **Arrêt sur silence** : temporisation configurable (0.5s à 10s, défaut 2.0s) après la disparition de la voix.
  - **Format standard** : WAV PCM16 16000 Hz mono + fichier JSON de métadonnées complet.
- **Calibration Automatique du Bruit de Fond** :
  - Mesure le niveau ambiant pendant 5 secondes et recommande le seuil optimal (`noise_floor + marge`).
- **Interface Minimaliste & Technique** :
  - Dark mode sobre, bargraph LED segmenté avec repère de seuil, badge d'état temps réel, lecteur audio intégré avec scrubbing, historique des enregistrements et visionneuse de métadonnées.

---

## 🏗️ Architecture du Projet

```
auto-voice-recorder/
├── backend/
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py              # Application FastAPI & WebSocket
│   │   ├── api/
│   │   │   ├── routes.py        # Endpoints REST (/api/*)
│   │   │   └── websocket.py     # Monitoring temps réel (/ws/monitor)
│   │   ├── audio/
│   │   │   ├── base.py          # Abstraction AudioSource
│   │   │   ├── microphone.py    # Capture sounddevice Micro
│   │   │   ├── soundcard.py     # Capture Carte USB / Line In
│   │   │   ├── gnuradio.py      # Lecture FIFO /tmp/hackrf_audio.f32
│   │   │   └── engine.py        # Orchestration temps réel & capture
│   │   ├── detection/
│   │   │   ├── rms.py           # Calcul RMS et dBFS
│   │   │   └── vad.py           # Silero VAD / Fallback acoustique
│   │   ├── recording/
│   │   │   ├── recorder.py      # Buffer circulaire & écriture WAV
│   │   │   └── metadata.py      # Génération JSON des métadonnées
│   │   └── config/
│   │       └── settings.py      # Persistance config.json
│   └── requirements.txt
├── src/
│   ├── components/              # Composants React modulaires
│   ├── services/                # API REST, Web Audio Processor & WebSocket
│   ├── types/                   # Interfaces TypeScript
│   └── App.tsx                  # Interface principale minimaliste
├── recordings/                  # Dossier de stockage des WAV + JSON
├── server.ts                    # Serveur intégré Node/Express/Vite
├── start_kali.sh                # Script de lancement tout-en-un pour Kali
├── package.json
└── README.md
```

---

## 🚀 Installation & Lancement sur Kali Linux

### 1. Prérequis système Kali

Installez les dépendances audio et système :
```bash
sudo apt update
sudo apt install -y python3 python3-venv python3-pip portaudio19-dev ffmpeg nodejs npm gnuradio hackrf
```

### 2. Démarrage rapide (Script automatique)

Exécutez simplement :
```bash
chmod +x start_kali.sh
./start_kali.sh
```

Ce script configure l'environnement virtuel Python, installe les dépendances, prépare le tube nommé FIFO pour GNU Radio et démarre simultanément l'interface web (port 3000) et le backend (port 8000).

---

### 3. Démarrage manuel (Pas à pas)

#### A. Backend Python FastAPI

```bash
# Créer et activer le venv
python3 -m venv .venv
source .venv/bin/activate

# Installer les dépendances
pip install -r backend/requirements.txt

# Lancer FastAPI
uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 --reload
```

#### B. Frontend React / Vite

Dans un autre terminal :
```bash
npm install
npm run dev
```

Accédez à l'application dans votre navigateur : **`http://localhost:3000`**

---

## 📻 Configuration HackRF & GNU Radio

Pour surveiller un signal RF (ex: VHF/UHF NFM) avec un HackRF :

1. Créer le tube FIFO si inexistant :
   ```bash
   mkfifo /tmp/hackrf_audio.f32
   ```

2. Dans **GNU Radio Companion** (GRC), configurez votre graphe de flux :
   - `Osmocom Source` (HackRF One, sample rate 2 Msps, fréquence désirée)
   - `Low Pass Filter` (Cutoff 5 kHz, Transition 2 kHz)
   - `NBFM Receive` (Quadrature rate 200 kHz, Audio rate 16 kHz)
   - `Rational Resampler` -> Sortie 16000 Hz
   - `File Sink` : Chemin `/tmp/hackrf_audio.f32`, format `Float 32` (Unbuffered).

3. Dans l'application web :
   - Choisissez **Source** : `HackRF / GNU`
   - Le système lira automatiquement le flux RF démodulé et déclenchera l'enregistrement dès qu'une voix est captée sur la fréquence.

---

## 📄 Structure des Métadonnées JSON

Chaque enregistrement génère automatiquement un fichier `.wav` et un fichier `.json` dans le dossier `recordings/` :

```json
{
  "recording_id": "2026-08-30_11-52-33",
  "source": "microphone",
  "device": "USB Audio Device",
  "sample_rate": 16000,
  "channels": 1,
  "timestamp_start": "2026-08-30T11:52:33.120Z",
  "timestamp_end": "2026-08-30T11:52:47.450Z",
  "duration_seconds": 14.3,
  "trigger_mode": "db_vad",
  "trigger_threshold_dbfs": -38.0,
  "vad_threshold": 0.60,
  "annotation_status": "pending",
  "upload_status": "pending",
  "frequency_hz": 145000000,
  "modulation": "NFM",
  "station_id": "ST001"
}
```

---

## 🔌 Endpoints de l'API

- `GET /api/health` : État de santé du système et moteur audio
- `GET /api/audio/devices` : Liste des interfaces audio ALSA / Pulse / USB
- `GET /api/settings` : Récupère la configuration actuelle
- `PUT /api/settings` : Sauvegarde la configuration dans `config.json`
- `POST /api/monitor/start` : Démarre la surveillance audio continue
- `POST /api/monitor/stop` : Arrête la surveillance
- `POST /api/calibrate` : Déclenche la calibration du bruit ambiant (5 sec)
- `GET /api/recordings` : Liste des enregistrements triés du plus récent au plus ancien
- `GET /api/recordings/{id}` : Métadonnées d'un enregistrement
- `GET /api/recordings/{id}/audio` : Fichier audio WAV streamable
- `DELETE /api/recordings/{id}` : Suppression d'un enregistrement (WAV + JSON)
- `WebSocket /ws/monitor` : Flux de télémétrie temps réel (~8 Hz)
