import os
import json
import time
import stat
import shutil
import subprocess
import platform
import numpy as np
from typing import List, Dict, Any, Optional
from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Depends
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

from ..config.settings import AppConfig, load_config, save_config
from ..audio.microphone import MicrophoneSource
from ..detection.rms import RMSDetector
from ..recording.metadata import RecordingMetadata

router = APIRouter(prefix="/api")

# We will inject the engine instance from main.py via dependency or state
def get_engine():
    from ..main import audio_engine
    return audio_engine


@router.get("/health")
def get_health(engine=Depends(get_engine)):
    return {
        "status": "ok",
        "engine": "python-fastapi",
        "monitoring": engine._is_running,
        "active_source": engine.config.source,
        "recordings_dir": engine.recordings_dir,
    }


@router.get("/audio/devices")
def get_devices():
    devices = MicrophoneSource.list_devices()
    return [{**device, "available": True} for device in devices]


class InputTestRequest(BaseModel):
    device_id: Optional[int] = None
    duration_seconds: float = 2.5


@router.get("/audio/diagnostics")
def audio_diagnostics(engine=Depends(get_engine)):
    devices = MicrophoneSource.list_devices()
    try:
        from ..audio.microphone import sd
        default_input = int(sd.default.device[0]) if sd is not None else None
        portaudio_available = sd is not None
    except Exception:
        default_input, portaudio_available = None, False
    selected_id = int(engine.config.device_id) if str(engine.config.device_id).isdigit() else None
    selected = next((d for d in devices if d["id"] == selected_id), None)
    telemetry = engine.get_telemetry()
    return {
        "platform": platform.system().lower(),
        "portaudio_available": portaudio_available,
        "default_input_device": default_input,
        "devices": devices,
        "selected_device": selected,
        "selected_device_id": selected_id,
        "selected_device_name": selected["name"] if selected else engine.config.device_name,
        "capture_backend": telemetry.get("capture_backend"),
        "stream_active": engine._is_running,
        "frames_received": telemetry["frames_received"],
        "last_frame_ms": telemetry["last_audio_frame_ms"],
        "native_samplerate": telemetry["capture_sample_rate"],
        "capture_samplerate": telemetry["capture_sample_rate"],
        "processing_samplerate": telemetry["processing_sample_rate"],
        "hostapi": telemetry.get("hostapi"),
        "capture_channels": telemetry.get("capture_channels"),
        "selected_channel": telemetry.get("selected_channel"),
        "selected_channel_index": telemetry.get("selected_channel_index"),
        "channel_1_rms_dbfs": telemetry.get("channel_1_rms_dbfs"),
        "channel_2_rms_dbfs": telemetry.get("channel_2_rms_dbfs"),
        "callback_count": telemetry.get("callback_count", 0),
        "level_dbfs": telemetry.get("level_dbfs"),
        "peak_dbfs": telemetry.get("peak_dbfs"),
        "alsa_device": telemetry.get("alsa_device"),
        "vad_backend": telemetry.get("vad_backend"),
        "vad_model_loaded": telemetry.get("vad_model_loaded"),
        "vad_error": telemetry.get("vad_error"),
        "cold_start_voice_active": telemetry.get("cold_start_voice_active"),
        "cold_start_mode_active": telemetry.get("cold_start_mode_active"),
        "cold_start_voice_triggered": telemetry.get("cold_start_voice_triggered"),
        "cold_start_vad_threshold": telemetry.get("cold_start_vad_threshold"),
        "effective_speech_confirmed": telemetry.get("effective_speech_confirmed"),
        "voice_pipeline_diagnosis": telemetry.get("voice_pipeline_diagnosis"),
        "voice_pipeline_hint": telemetry.get("voice_pipeline_hint"),
        "ambient_learning_paused_for_voice": telemetry.get("ambient_learning_paused_for_voice"),
        "error": engine.current_error,
    }


@router.get("/system/usb-diagnostic")
@router.post("/system/usb-diagnostic")
def get_usb_diagnostic():
    """Run a thorough Linux / Kali hardware permission & USB diagnostic check."""
    import getpass
    try:
        current_user = getpass.getuser()
    except Exception:
        current_user = os.environ.get("USER", "kali")

    # 1. Inspect groups
    groups = []
    try:
        probe = subprocess.run(["id", "-Gn"], capture_output=True, text=True, timeout=2, check=False)
        if probe.returncode == 0:
            groups = probe.stdout.strip().split()
    except Exception:
        pass
    if not groups:
        try:
            import grp
            groups = [grp.getgrgid(g).gr_name for g in os.getgroups()]
        except Exception:
            groups = ["audio", "plugdev"] if current_user == "root" else []

    is_root = current_user == "root"
    in_audio_group = is_root or "audio" in groups
    in_plugdev_group = is_root or "plugdev" in groups

    # 2. Inspect /dev/snd
    dev_snd_exists = os.path.exists("/dev/snd")
    dev_snd_readable = os.access("/dev/snd", os.R_OK) if dev_snd_exists else False
    dev_snd_nodes = []
    if dev_snd_exists:
        try:
            dev_snd_nodes = os.listdir("/dev/snd")
        except Exception:
            pass

    # 3. Inspect /dev/bus/usb
    dev_bus_usb_exists = os.path.exists("/dev/bus/usb")
    dev_bus_usb_readable = os.access("/dev/bus/usb", os.R_OK) if dev_bus_usb_exists else False

    # 4. Enumerate USB devices via lsusb or sysfs
    usb_devices = []
    lsusb_tool = shutil.which("lsusb")
    if lsusb_tool:
        try:
            probe = subprocess.run([lsusb_tool], capture_output=True, text=True, timeout=3, check=False)
            if probe.returncode == 0:
                for line in probe.stdout.strip().splitlines():
                    if line.strip():
                        parts = line.split(":", 1)
                        dev_id = parts[0].strip() if len(parts) > 1 else ""
                        name = parts[1].strip() if len(parts) > 1 else line.strip()
                        usb_devices.append({"id": dev_id, "name": name})
        except Exception:
            pass

    # Fallback to sysfs if lsusb returned nothing
    if not usb_devices and os.path.exists("/sys/bus/usb/devices"):
        try:
            for d in os.listdir("/sys/bus/usb/devices"):
                prod_file = os.path.join("/sys/bus/usb/devices", d, "product")
                if os.path.exists(prod_file):
                    with open(prod_file, "r", encoding="utf-8", errors="ignore") as f:
                        prod = f.read().strip()
                    if prod:
                        usb_devices.append({"id": d, "name": prod})
        except Exception:
            pass

    # 5. Enumerate sound cards via /proc/asound/cards
    sound_cards = []
    if os.path.exists("/proc/asound/cards"):
        try:
            with open("/proc/asound/cards", "r", encoding="utf-8", errors="ignore") as f:
                content = f.read().strip()
            import re
            for match in re.finditer(r"^\s*(\d+)\s+\[([^\]]+)\]:\s+(.+)$", content, re.MULTILINE):
                sound_cards.append({
                    "id": match.group(1),
                    "name": f"[{match.group(2).strip()}] {match.group(3).strip()}",
                })
        except Exception:
            pass

    # 6. Check audio server (PipeWire / PulseAudio / ALSA)
    audio_server = "ALSA Direct"
    try:
        user_runtime = os.environ.get("XDG_RUNTIME_DIR", f"/run/user/{os.getuid()}")
        if os.path.exists(os.path.join(user_runtime, "pipewire-0")) or subprocess.run(["pgrep", "-x", "pipewire"], capture_output=True).returncode == 0:
            audio_server = "PipeWire"
        elif os.path.exists(os.path.join(user_runtime, "pulse")) or subprocess.run(["pgrep", "-x", "pulseaudio"], capture_output=True).returncode == 0:
            audio_server = "PulseAudio"
    except Exception:
        pass

    # 7. Build granular diagnostic checks
    checks = []

    # Group membership is informational: PipeWire logind/ACL installations do
    # not require the legacy audio group. Actual stream tests are authoritative.
    if in_audio_group:
        checks.append({
            "id": "group_audio",
            "name": "Groupe système 'audio'",
            "category": "groups",
            "status": "pass",
            "message": f"L'utilisateur '{current_user}' est membre du groupe 'audio' (accès ALSA autorisé)",
            "details": f"Groupes détectés: {', '.join(groups) if groups else 'root'}",
        })
    else:
        checks.append({
            "id": "group_audio",
            "name": "Groupe système 'audio'",
            "category": "groups",
            "status": "warn",
            "message": f"L'utilisateur '{current_user}' n'est pas membre du groupe audio (cela peut être normal avec PipeWire/logind).",
            "details": "Utilisez Test Input pour vérifier l'accès réel au lieu de déduire les permissions depuis les groupes.",
        })

    # Check: Plugdev Group
    if in_plugdev_group:
        checks.append({
            "id": "group_plugdev",
            "name": "Groupe système 'plugdev'",
            "category": "groups",
            "status": "pass",
            "message": f"L'utilisateur '{current_user}' appartient au groupe 'plugdev' (USB / SDR / libusb)",
            "details": "Autorise la communication avec les périphériques USB à chaud sans privilèges root.",
        })
    else:
        checks.append({
            "id": "group_plugdev",
            "name": "Groupe système 'plugdev'",
            "category": "groups",
            "status": "warn",
            "message": f"L'utilisateur '{current_user}' n'est pas dans le groupe 'plugdev'. Recommandé pour HackRF et cartes sons USB externes.",
            "details": "Nécessaire pour le contrôle udev des périphériques USB non-standards.",
            "fix_command": f"sudo usermod -aG plugdev {current_user}",
        })

    # Check: /dev/snd Node Access
    if dev_snd_exists and dev_snd_readable:
        pcm_nodes = [n for n in dev_snd_nodes if n.startswith("pcm") or n.startswith("control")]
        checks.append({
            "id": "dev_snd",
            "name": "Permissions /dev/snd",
            "category": "permissions",
            "status": "pass",
            "message": f"/dev/snd accessible en lecture ({len(pcm_nodes)} nœuds audio détectés)",
            "details": f"Nœuds trouvés: {', '.join(pcm_nodes[:8])}{'...' if len(pcm_nodes) > 8 else ''}",
        })
    elif dev_snd_exists and not dev_snd_readable:
        checks.append({
            "id": "dev_snd",
            "name": "Permissions /dev/snd",
            "category": "permissions",
            "status": "fail",
            "message": "/dev/snd existe mais est inaccessible en lecture pour l'utilisateur actuel.",
            "details": "Droits insuffisants sur les fichiers de périphériques ALSA.",
            "fix_command": "getfacl /dev/snd/*",
        })
    else:
        checks.append({
            "id": "dev_snd",
            "name": "Permissions /dev/snd",
            "category": "permissions",
            "status": "warn",
            "message": "Répertoire /dev/snd non trouvé (pilote ALSA non chargé ou environnement conteneurisé).",
            "details": "Vérifiez que le module noyau snd_pcm est chargé.",
            "fix_command": "sudo modprobe snd_pcm && sudo modprobe snd_usb_audio",
        })

    # Check: /dev/bus/usb Node Access
    if dev_bus_usb_exists and dev_bus_usb_readable:
        checks.append({
            "id": "dev_bus_usb",
            "name": "Permissions /dev/bus/usb",
            "category": "permissions",
            "status": "pass",
            "message": "/dev/bus/usb accessible pour l'énumération USB",
            "details": f"{len(usb_devices)} périphériques USB physiques listés.",
        })
    else:
        checks.append({
            "id": "dev_bus_usb",
            "name": "Permissions /dev/bus/usb",
            "category": "permissions",
            "status": "warn",
            "message": "/dev/bus/usb non accessible ou absent.",
            "details": "Vérifiez les règles udev pour autoriser l'accès USB.",
            "fix_command": "sudo udevadm control --reload-rules && sudo udevadm trigger",
        })

    # Check: ALSA Sound Cards Count
    if len(sound_cards) > 0:
        has_usb_card = any("usb" in c["name"].lower() for c in sound_cards)
        checks.append({
            "id": "sound_cards",
            "name": "Cartes son ALSA reconnues",
            "category": "devices",
            "status": "pass",
            "message": f"{len(sound_cards)} carte(s) son reconnue(s) par le noyau ALSA",
            "details": ", ".join(c["name"] for c in sound_cards),
        })
    else:
        checks.append({
            "id": "sound_cards",
            "name": "Cartes son ALSA reconnues",
            "category": "devices",
            "status": "warn",
            "message": "Aucune carte son enregistrée dans /proc/asound/cards.",
            "details": "Branchez votre carte son USB ou vérifiez 'lsusb' et 'dmesg | grep -i audio'.",
            "fix_command": "dmesg | tail -n 20",
        })

    # Check: Audio Daemon
    checks.append({
        "id": "audio_daemon",
        "name": "Serveur Audio Linux",
        "category": "services",
        "status": "pass" if audio_server != "ALSA Direct" else "warn",
        "message": f"Serveur audio actif : {audio_server}",
        "details": "PipeWire ou PulseAudio permet le partage transparent des cartes son entre plusieurs applications.",
        "fix_command": "systemctl --user restart pipewire pipewire-pulse 2>/dev/null || pulseaudio -k && pulseaudio --start",
    })

    # Overall Status Calculation
    if any(c["status"] == "fail" for c in checks):
        overall_status = "error"
    elif any(c["status"] == "warn" for c in checks):
        overall_status = "warning"
    else:
        overall_status = "ok"

    return {
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        "platform": platform.platform(),
        "user": current_user,
        "groups": groups,
        "in_audio_group": in_audio_group,
        "in_plugdev_group": in_plugdev_group,
        "dev_snd_exists": dev_snd_exists,
        "dev_snd_readable": dev_snd_readable,
        "dev_snd_nodes_count": len(dev_snd_nodes),
        "dev_bus_usb_exists": dev_bus_usb_exists,
        "dev_bus_usb_readable": dev_bus_usb_readable,
        "usb_devices": usb_devices,
        "sound_cards": sound_cards,
        "audio_server": audio_server,
        "checks": checks,
        "overall_status": overall_status,
    }


@router.get("/audio/instruments")
def get_instruments(engine=Depends(get_engine)):
    """Report only observed hardware/software capabilities; never invent devices."""
    fifo_path = engine.config.fifo_path
    fifo_exists = os.path.exists(fifo_path) and stat.S_ISFIFO(os.stat(fifo_path).st_mode)
    hackrf_tool = shutil.which("hackrf_info")
    hackrf_present = False
    hackrf_detail = "hackrf_info is not installed"
    if hackrf_tool:
        try:
            probe = subprocess.run(
                [hackrf_tool], capture_output=True, text=True, timeout=4, check=False
            )
            output = (probe.stdout + probe.stderr).strip()
            hackrf_present = probe.returncode == 0 and "No HackRF boards found" not in output
            hackrf_detail = output.splitlines()[0] if output else f"exit code {probe.returncode}"
        except (OSError, subprocess.TimeoutExpired) as exc:
            hackrf_detail = str(exc)
    audio_devices = MicrophoneSource.list_devices()
    return {
        "audio_inputs": len(audio_devices),
        "sounddevice_available": bool(audio_devices),
        "gnuradio_installed": shutil.which("gnuradio-companion") is not None,
        "fifo_path": fifo_path,
        "fifo_ready": fifo_exists,
        "hackrf_present": hackrf_present,
        "hackrf_detail": hackrf_detail,
    }


@router.get("/settings", response_model=AppConfig)
def get_settings(engine=Depends(get_engine)):
    return engine.config


@router.put("/settings", response_model=AppConfig)
def update_settings(new_settings: AppConfig, engine=Depends(get_engine)):
    saved = save_config(new_settings)
    engine.update_config(saved)
    return saved


@router.post("/monitor/start")
def start_monitoring(settings_override: Optional[AppConfig] = None, engine=Depends(get_engine)):
    if settings_override is not None:
        save_config(settings_override)
        engine.update_config(settings_override)
    ok = engine.start()
    if not ok:
        telemetry = engine.get_telemetry()
        return JSONResponse(status_code=503, content={
            "success": False, "error": engine.current_error or "Failed to start audio engine",
            "device_id": engine.config.device_id, "device_name": engine.config.device_name,
            "hostapi": telemetry.get("hostapi"),
            "native_samplerate": telemetry.get("capture_sample_rate"),
        })
    return {"success": True, "message": "Monitoring active", **engine.get_telemetry()}


@router.post("/monitor/stop")
def stop_monitoring(engine=Depends(get_engine)):
    engine.stop()
    return {"success": True, "message": "Monitoring stopped"}


@router.delete("/audio/ambient-profile")
def reset_ambient_profile(engine=Depends(get_engine)):
    deleted = engine.reset_ambient_profile()
    return {
        "success": True,
        "deleted": deleted,
        "message": "Ambient profile cleared; quiet calibration restarted",
        **engine.get_telemetry(),
    }


@router.post("/audio/test")
def test_input(device_id: Optional[int | str] = None, source_type: str = "microphone", engine=Depends(get_engine)):
    """Open the selected hardware independently and report real samples for 3 seconds."""
    if engine._is_running:
        telemetry = engine.get_telemetry()
        return {"working": telemetry["audio_frames_received"], **telemetry}
    if source_type == "gnuradio":
        from ..audio.gnuradio import GNURadioSource
        source = GNURadioSource(engine.config.fifo_path, engine.config.sample_rate)
    else:
        source = MicrophoneSource(device_id=device_id, sample_rate=engine.config.sample_rate)
    levels, peaks, frames = [], [], 0
    try:
        source.start()
        deadline = time.time() + 3.0
        while time.time() < deadline:
            chunk = source.read_chunk()
            if chunk is None or not len(chunk):
                continue
            frames += len(chunk)
            _, level = RMSDetector.process_chunk(chunk)
            peak = RMSDetector.rms_to_dbfs(float(np.max(np.abs(chunk))))
            levels.append(level)
            peaks.append(peak)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Unable to open device: {exc}")
    finally:
        source.stop()
    return {
        "working": frames > 0,
        "message": "Input working" if frames > 0 else "No audio data",
        "level_dbfs": round(levels[-1], 1) if levels else -100.0,
        "peak_dbfs": round(max(peaks), 1) if peaks else -100.0,
        "frames_received": frames,
        "capture_sample_rate": getattr(source, "capture_sample_rate", source.sample_rate),
    }


@router.post("/audio/test-input")
def test_input_json(request: InputTestRequest, engine=Depends(get_engine)):
    """Capture a selected real PortAudio input and return measurable signal data."""
    if engine._is_running:
        raise HTTPException(status_code=409, detail="Stop monitoring before testing an input")
    source = MicrophoneSource(device_id=request.device_id, sample_rate=engine.config.sample_rate,
                              input_channel=engine.config.input_channel)
    frames = 0
    sum_squares = 0.0
    peak = 0.0
    try:
        source.start()
        if not source.verify_audio_stream():
            failed = source
            failed.stop()
            source = engine._try_alsa_fallback(failed)
            if source is None:
                raise RuntimeError(f"PortAudio opened {failed.device_name} but no audio frames were received")
        deadline = time.monotonic() + min(5.0, max(0.5, request.duration_seconds))
        while time.monotonic() < deadline:
            chunk = source.read_chunk()
            if chunk is None or not len(chunk):
                continue
            frames += len(chunk)
            sum_squares += float(np.sum(np.square(chunk, dtype=np.float64)))
            peak = max(peak, float(np.max(np.abs(chunk))))
    except Exception as exc:
        raise HTTPException(status_code=422, detail={
            "success": False,
            "error": str(exc),
            "suggested_samplerate": getattr(source, "capture_sample_rate", None),
        })
    finally:
        source.stop()
    rms = float(np.sqrt(sum_squares / frames)) if frames else 0.0
    return {
        "success": frames > 0,
        "device_id": request.device_id,
        "device_name": source.device_name,
        "native_samplerate": source.capture_sample_rate,
        "channels": source.capture_channels,
        "capture_channels": source.capture_channels,
        "callback_count": getattr(source, "callback_count", 0),
        "hostapi": source.host_api,
        "capture_backend": "alsa" if source.__class__.__name__ == "ALSAArecordSource" else "portaudio",
        "frames_received": frames,
        "rms": rms,
        "level_dbfs": round(RMSDetector.rms_to_dbfs(rms), 1),
        "peak_dbfs": round(RMSDetector.rms_to_dbfs(peak), 1),
        "error": None if frames else "No audio frames received",
    }


@router.post("/calibrate")
def calibrate_noise(engine=Depends(get_engine)):
    result = engine.calibrate_noise_floor(duration_sec=3.0)
    return result


@router.get("/recordings")
def list_recordings(engine=Depends(get_engine)):
    rec_dir = engine.recordings_dir
    if not os.path.exists(rec_dir):
        return []

    recordings = []
    for fname in os.listdir(rec_dir):
        if fname.endswith(".json"):
            json_path = os.path.join(rec_dir, fname)
            try:
                with open(json_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    rec_id = data.get("recording_id")
                    wav_name = f"{rec_id}.wav"
                    wav_path = os.path.join(rec_dir, wav_name)
                    if os.path.exists(wav_path):
                        data["file_size_bytes"] = os.path.getsize(wav_path)
                    data["filename_wav"] = wav_name
                    data["filename_json"] = fname
                    data["audio_url"] = f"/api/recordings/{rec_id}/audio"
                    recordings.append(data)
            except Exception:
                pass

    recordings.sort(key=lambda r: r.get("recording_id", ""), reverse=True)
    return recordings


@router.get("/recordings/{recording_id}")
def get_recording(recording_id: str, engine=Depends(get_engine)):
    json_path = os.path.join(engine.recordings_dir, f"{recording_id}.json")
    if not os.path.exists(json_path):
        raise HTTPException(status_code=404, detail="Recording metadata not found")
    try:
        with open(json_path, "r", encoding="utf-8") as f:
            data = json.load(f)
            data["audio_url"] = f"/api/recordings/{recording_id}/audio"
            return data
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/recordings/{recording_id}/audio")
def get_recording_audio(recording_id: str, engine=Depends(get_engine)):
    wav_path = os.path.join(engine.recordings_dir, f"{recording_id}.wav")
    if not os.path.exists(wav_path):
        raise HTTPException(status_code=404, detail="WAV file not found")
    return FileResponse(wav_path, media_type="audio/wav", filename=f"{recording_id}.wav")


@router.get("/recordings/{recording_id}/json")
def get_recording_json(recording_id: str, engine=Depends(get_engine)):
    json_path = os.path.join(engine.recordings_dir, f"{recording_id}.json")
    if not os.path.exists(json_path):
        raise HTTPException(status_code=404, detail="JSON metadata not found")
    return FileResponse(json_path, media_type="application/json", filename=f"{recording_id}.json")


@router.delete("/recordings/{recording_id}")
def delete_recording(recording_id: str, engine=Depends(get_engine)):
    wav_path = os.path.join(engine.recordings_dir, f"{recording_id}.wav")
    json_path = os.path.join(engine.recordings_dir, f"{recording_id}.json")
    deleted = False

    if os.path.exists(wav_path):
        try:
            os.remove(wav_path)
            deleted = True
        except Exception:
            pass

    if os.path.exists(json_path):
        try:
            os.remove(json_path)
            deleted = True
        except Exception:
            pass

    if not deleted:
        raise HTTPException(status_code=404, detail="Recording not found")
    return {"success": True, "message": f"Deleted {recording_id}"}
