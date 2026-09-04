# Auto Voice Recorder (Linux)

Application web locale minimaliste et professionnelle pour **Linux** permettant d'automatiser l'enregistrement audio dès que le VAD confirme une voix humaine. Le niveau sonore (dBFS) informe et met en tampon les événements, sans autoriser ni interdire l'enregistrement.

---

## 🎯 Fonctionnalités Principales

- **Multiples Sources Audio** :
  1. **Microphone** (détection automatique via `sounddevice` / ALSA / PulseAudio / Web Audio)
  2. **Carte son USB / Line-In** (sélection de l'interface d'entrée matérielle)
  3. **HackRF / GNU Radio** (lecture directe de flux `float32` mono 16 kHz depuis `/tmp/hackrf_audio.f32`)
- **Moteur de Détection Intelligent** :
  - **RMS / dBFS** : calcul en temps réel du niveau sonore (`20 * log10(RMS)`).
  - **Silero VAD** : probabilité de présence de voix humaine (0.00 à 1.00) avec modèle PyTorch et fallback acoustique formant.
  - **Chemins séparés** : `RAW LEVEL -> EVENT GATE` pour la télémétrie, et `GAIN/AGC -> SILERO -> SPEECH -> REC` pour la décision. Le gate n'a aucun droit de veto sur une voix confirmée.
- **Enregistrement Automatisé** :
  - **Pre-buffer circulaire** : conserve 1 seconde (configurable de 0 à 5s) avant la détection pour ne jamais couper le début de phrase.
  - **Arrêt sur silence** : temporisation configurable (0.5s à 10s, défaut 2.0s) après la disparition de la voix.
  - **Format standard** : WAV PCM16 16000 Hz mono + fichier JSON de métadonnées complet.
- **Calibration Automatique du Bruit de Fond** :
  - Accumule 3 secondes d'audio calme vérifié (la voix suspend la mesure) et applique la marge recommandée au gate RAW.
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
  "trigger_mode": "confirmed_voice",
  "trigger_threshold_dbfs": null,
  "vad_threshold": 0.65,
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
- `POST /api/audio/test-input` : capture réelle 2,5 s (JSON `{ "device_id": 2 }`)
- `GET /api/audio/diagnostics` : PortAudio, périphérique/rates, frames et dernier callback
- `GET /api/audio/instruments` : présence réellement sondée des entrées, de GNU Radio, du FIFO et du HackRF
- `GET /api/settings` : Récupère la configuration actuelle
- `PUT /api/settings` : Sauvegarde la configuration dans `config.json`
- `POST /api/monitor/start` : Démarre la surveillance audio continue
- `POST /api/monitor/stop` : Arrête la surveillance
- `POST /api/calibrate` : accumule 3 secondes de bruit ambiant vérifié et recommande la marge du gate RAW
- `GET /api/recordings` : Liste des enregistrements triés du plus récent au plus ancien
- `GET /api/recordings/{id}` : Métadonnées d'un enregistrement
- `GET /api/recordings/{id}/audio` : Fichier audio WAV streamable
- `DELETE /api/recordings/{id}` : Suppression d'un enregistrement (WAV + JSON)
- `WebSocket /ws/monitor` : Flux de télémétrie temps réel (~8 Hz)

> **Présence matérielle réelle :** l'interface ne fabrique plus de microphone ou de
> carte USB de démonstration. Une liste vide signifie que PortAudio/ALSA ne voit
> aucune entrée. Pour GNU Radio, « connecté » n'est affiché qu'après réception
> effective d'échantillons dans le FIFO ; la seule existence du tube ne suffit pas.

## Détection adaptative `voice_any_source`

Pour les sources acoustiques `microphone` et `usb`, le profil par défaut sépare désormais le chemin **archive RAW** du chemin de détection. Les FFT, le profil ambiant et le VAD servent uniquement à décider et segmenter : le WAV PCM16 est écrit à partir des échantillons capturés, sans soustraction spectrale, noise gate ni AGC destructeur.

Au démarrage de la surveillance, l'état `LEARNING_AMBIENT` accumule 3 secondes d'audio calme vérifié (VAD bas, aucun candidat vocal, aucune voix confirmée et aucun enregistrement). En écoute, le profil borné à 20 secondes ne se met à jour que si la probabilité de parole est inférieure à 0,15, hors candidat et hors enregistrement. Le seuil dynamique vaut par défaut `noise_floor_dbfs + 8 dB` et la décision combine Silero/fallback acoustique, SNR large bande, SNR 250–4000 Hz et changement spectral.

Une hausse non vocale devient `RADIO ACTIVITY`, sans fichier. Une voix confirmée pendant au moins 160 ms démarre une transmission avec 1,5 s de pré-roll. L'hystérésis VAD (0,65 / 0,35) et un hangover de 2 secondes réunissent les phrases séparées par des pauses. À la finalisation, le masque vocal enlève uniquement les bords inutiles avec 200 ms de marge ; les pauses internes restent intactes. Un événement contenant moins de 300 ms de parole est abandonné.

### Paramètres par défaut importants

| Paramètre | Défaut |
|---|---:|
| `config_version` | `2` |
| `detection_profile` | `voice_any_source` |
| `sample_rate` | `16000` |
| `ambient_learning_seconds` | `3.0` d'audio calme vérifié |
| `ambient_learning_vad_max` | `0.15` |
| `ambient_window_seconds` | `20.0` |
| `noise_margin_db` | `8.0` |
| `minimum_snr_db` | `6.0` |
| `speech_band_low_hz` / `speech_band_high_hz` | `250` / `4000` |
| `vad_start_threshold` / `vad_stop_threshold` | `0.65` / `0.35` |
| `minimum_speech_ms` / `minimum_total_speech_ms` | `160` / `300` |
| `preroll_seconds` | `1.5` |
| `transmission_hangover_seconds` | `2.0` |
| `trim_margin_seconds` | `0.2` |
| `input_gain` / `auto_gain_control` | `1.0` / `false` |
| `input_channel` | `auto` |

`config.json` et `AppConfig` définissent directement le schéma canonique neuf de
version 2. Il n'existe aucune migration legacy. Une version supérieure est
refusée explicitement, sans réécriture du fichier, afin d'exiger la mise à jour
de SantekRecord.

Au démarrage, RAW AMBIENT reste `LEARNING` (valeur `null`) jusqu'à huit trames
calmes consécutives et stables (environ 0,5 s). Une candidature vocale, un VAD
au-dessus de 0,15, un enregistrement ou une fenêtre RMS modulée invalide cette
fenêtre. L'apprentissage de trois secondes compte exclusivement l'audio calme
vérifié. Silero et SpeechDetector continuent néanmoins immédiatement : une voix
confirmée enregistre même lorsque RAW AMBIENT n'est pas encore prêt.

Le pipeline canonique est :

```text
RAW AUDIO
├── RAW LEVEL → EVENT (diagnostic/buffering only)
└── GAIN/AGC → SILERO → SPEECH → REC
```

`EVENT` ne peut jamais opposer de veto à une voix humaine confirmée.

### Validation

```bash
source .venv/bin/activate
python -m pytest -q
npm run lint
npm run build
arecord -l
curl http://127.0.0.1:8000/api/audio/devices
./start_kali.sh
```

Après sélection de la carte USB et clic sur **Surveiller**, vérifiez la séquence `LEARNING AMBIENT` → `LISTENING`, puis `RADIO ACTIVITY` lors du squelch et `VOICE DETECTED` / `RECORDING` uniquement pendant la voix. Contrôlez enfin le WAV et son JSON dans `recordings/`.

## Sessions de communication radio

Le moteur archive maintenant une **communication** complète dans une seule paire
`COM-YYYYMMDD-HHMMSS-XXX.wav/.json`. Une parole confirmée ouvre une transmission et
la première transmission ouvre la session. Les pauses courtes (1,2 s par défaut)
restent dans la transmission; après 3 s sans parole celle-ci est fermée, mais la
session attend une réponse pendant 10 s. Elle n'est finalisée que lorsque le signal
est revenu à l'ambiance, ou après la limite de sécurité de 300 s. Ces quatre valeurs
sont configurables avec `intra_phrase_pause_seconds`,
`transmission_end_timeout_seconds`, `communication_end_timeout_seconds` et
`max_communication_seconds`; `silence_seconds` et `transmission_hangover_seconds`
restent acceptés pour les anciennes configurations.

Le WAV conserve tous les intervalles entre transmissions. Le JSON ajoute
`communication_id`, `transmissions` (positions échantillon/seconde et segments de
parole, sans identité de locuteur), les écarts entre transmissions, les durées
cumulées et `communication_end_reason`, sans retirer les métadonnées historiques.

Validation sur Kali Linux :

```bash
cd /workspace/santekrecord
python -m pytest backend/tests -q
npm run lint
npm run build
```
# Voice detection setup and validation

`start_kali.sh` installs the pinned local Silero ONNX model once. Runtime model
loading is offline-only. To provision it separately, run
`python3 scripts/install_silero_vad.py`; set `SILERO_VAD_MODEL` to use another
local path. If it is absent or invalid, monitoring continues with the adaptive
acoustic fallback and exposes the cause in WebSocket diagnostics.

Manual microphone validation:

1. Start monitoring and wait for **LISTENING** without speaking.
2. Say “Bonjour ceci est un test de voix”; verify probability rises, VOICE is
   shown, and a communication becomes active.
3. Pause, speak again, stop, wait for the communication timeout, then verify the
   WAV and JSON files.
4. Repeat but speak immediately after Start. Calibration must display
   **CALIBRATION PAUSED - VOICE PRESENT**, must not advance learned ambient time,
   and must resume automatically when the room is quiet.
# Kali validation checklist

Silero is pinned to official release `v6.2.1`. The installer validates the
model by loading it with ONNX Runtime, checking the `input`, `state`, and `sr`
inputs, and running consecutive official-style streaming inferences (64 samples
of retained context plus each 512-sample frame) before atomically installing it.
Validation includes silence and a non-zero signal and verifies finite changing
probabilities plus recurrent-state evolution. A SHA-256 is deliberately not pinned because the release asset was not
reachable from the environment used to establish a trustworthy digest.

## TEST 1 — SILERO

```bash
./start_kali.sh
```

Expected startup output:

```text
[OK] onnxruntime 1.x.x
[OK] Silero VAD ONNX ready
```

Verify in the UI diagnostics: `vad_backend = silero_onnx` and
`vad_model_loaded = true`. If the network is unavailable, an existing validated
model is reused without downloading. Without a valid local model, startup logs
explicit warnings and continues with the acoustic fallback.

## TEST 2 — IMMEDIATE VOICE

Delete/reset the ambient profile, start monitoring, and immediately say
“Bonjour ceci est un test de démarrage”. Expected: VAD rises quickly,
calibration pauses, `VOICE` / `COMMUNICATION ACTIVE` appears, and WAV recording
starts. After speaking stops and the communication closes, ambient learning
resumes, completes using quiet frames, and saves the profile.

## TEST 3 — RADIO ROOM

Select `radio_room`, reset the ambient profile, start monitoring, then
immediately activate the talkie and speak. Expected: `radio_activity = true`,
`speech_confirmed = true`, and `COMMUNICATION ACTIVE`. Stop talking and wait;
the communication must close and ambient profile learning must resume and save.

## TEST 4 — COLD-START VOICE CONTINUITY

Reset the ambient profile, start monitoring, and speak the first word strongly:
“Bonjour…”. Continue more softly: “… ceci est un test de conversation”. Expected:
one continuous communication, with no interruption when VAD falls below `0.75`;
normal detector hysteresis and natural silence still control continuation and end.

Repeat with the `radio_room` profile: reset the ambient profile, start monitoring,
open the talkie, speak the first word strongly, then continue normally or more
softly. Expected: one radio transmission; speech and radio activity may remain
true after VAD falls below `0.75`.
# USB AUDIO HOT-PLUG / RECONNECT

PortAudio indices are volatile. SantekRecord persists the selected input's name,
host API, channel/rate properties and ALSA card identity, then re-enumerates and
resolves that identity before every open. If frames stop for two seconds, the
current recording is finalized, the UI receives `device_disconnected`, and the
backend retries the same physical device for 45 seconds (including when its index
changes). It never silently falls back to an internal microphone.

Kali field check: start monitoring; speak and confirm REC; unplug the USB card;
observe **DEVICE DISCONNECTED / RECONNECTING**; reconnect the same card; confirm
LISTENING returns; speak again and confirm REC. No browser, FastAPI, or Kali
restart should be required.
