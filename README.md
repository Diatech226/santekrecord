# Auto Voice Recorder (Linux)

Application web locale minimaliste et professionnelle pour **Linux** permettant d'automatiser l'enregistrement audio selon la détection d'activité vocale (VAD) et de niveau sonore (dBFS).

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
santekrecord/
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

## 🚀 Installation et lancement sous Linux

### Prérequis

Le projet nécessite :

- **Python 3.10 ou plus récent**, avec `venv` et `pip` ;
- **Node.js 18 ou plus récent** et npm ;
- PortAudio et ses en-têtes de développement pour l'accès aux entrées audio ;
- `ffmpeg` ;
- un serveur audio Linux (ALSA, PulseAudio ou PipeWire) correctement configuré.

Vérifiez les versions installées :

```bash
python3 --version
node --version
npm --version
```

Installez les paquets système correspondant à votre distribution :

#### Debian, Ubuntu et Kali Linux

```bash
sudo apt update
sudo apt install -y python3 python3-venv python3-pip \
  portaudio19-dev libportaudio2 alsa-utils ffmpeg nodejs npm git curl
```

#### Fedora

```bash
sudo dnf install -y python3 python3-pip portaudio-devel alsa-utils ffmpeg nodejs npm git curl
```

> Sur Fedora, `ffmpeg` peut nécessiter l'activation préalable du dépôt RPM Fusion.

#### Arch Linux et Manjaro

```bash
sudo pacman -S --needed python python-pip portaudio alsa-utils ffmpeg nodejs npm git curl
```

GNU Radio et HackRF ne sont nécessaires que pour utiliser une source radio. Installez-les avec le gestionnaire de paquets de votre distribution (`gnuradio` et `hackrf`).

### Option 1 — Démarrage automatique sur Debian, Ubuntu ou Kali

Depuis la racine du dépôt :

```bash
git clone <URL_DU_DEPOT>
cd santekrecord
chmod +x start_kali.sh
./start_kali.sh
```

Le script utilise `apt` et `dpkg` : il est donc réservé aux distributions basées sur Debian. Il installe les paquets manquants, crée `.venv`, installe les dépendances Python et Node.js, prépare le FIFO GNU Radio, puis lance les deux services.

Quand le message de confirmation apparaît, ouvrez **http://127.0.0.1:3000**. L'API FastAPI est disponible sur **http://127.0.0.1:8000**. Utilisez `Ctrl+C` dans le terminal pour arrêter les deux services.

### Option 2 — Démarrage manuel sur toute distribution Linux

Cette méthode est recommandée sur Fedora, Arch Linux, Manjaro et les autres distributions non basées sur Debian.

#### 1. Récupérer le projet

```bash
git clone <URL_DU_DEPOT>
cd santekrecord
```

Si le dépôt est déjà présent, placez-vous simplement dans sa racine avant d'exécuter les commandes suivantes.

#### 2. Préparer le backend Python

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r backend/requirements.txt
```

Lancez ensuite le backend :

```bash
python -m uvicorn backend.app.main:app --host 0.0.0.0 --port 8000
```

Conservez ce terminal ouvert. Pour le développement, ajoutez l'option `--reload`.

#### 3. Préparer et lancer l'interface

Dans un **deuxième terminal**, à la racine du dépôt :

```bash
npm install
npm run dev
```

Ouvrez ensuite **http://127.0.0.1:3000** dans votre navigateur. Le serveur Node écoute par défaut sur toutes les interfaces ; l'interface contacte le backend sur le port `8000` de la même machine.

### Lancement après la première installation

Il n'est pas nécessaire de réinstaller les dépendances à chaque démarrage. Lancez le backend dans un premier terminal :

```bash
cd santekrecord
source .venv/bin/activate
python -m uvicorn backend.app.main:app --host 0.0.0.0 --port 8000
```

Puis l'interface dans un second terminal :

```bash
cd santekrecord
npm run dev
```

### Build de production

Pour compiler puis exécuter l'interface sans le serveur de développement Vite :

```bash
npm run build
NODE_ENV=production npm start
```

Le backend Python doit toujours être lancé séparément sur le port `8000`.

### Vérification et dépannage audio

Listez les périphériques vus par ALSA :

```bash
arecord -l
```

Si la liste est vide, vérifiez que le microphone est branché, que votre utilisateur a accès au périphérique audio et que PipeWire/PulseAudio fonctionne. Vous pouvez aussi vérifier directement la détection par le backend :

```bash
curl http://127.0.0.1:8000/api/health
curl http://127.0.0.1:8000/api/audio/devices
```

Pour accéder à l'application depuis une autre machine du réseau, ouvrez les ports TCP `3000` et `8000` dans le pare-feu, puis utilisez `http://ADRESSE_IP_DU_SERVEUR:3000`. N'exposez pas directement le serveur de développement sur Internet ; placez un reverse proxy avec HTTPS et une authentification devant l'application.

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
- `GET /api/audio/instruments` : présence réellement sondée des entrées, de GNU Radio, du FIFO et du HackRF
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

> **Présence matérielle réelle :** l'interface ne fabrique plus de microphone ou de
> carte USB de démonstration. Une liste vide signifie que PortAudio/ALSA ne voit
> aucune entrée. Pour GNU Radio, « connecté » n'est affiché qu'après réception
> effective d'échantillons dans le FIFO ; la seule existence du tube ne suffit pas.
