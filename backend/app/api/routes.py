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
from fastapi.responses import FileResponse
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
        "stream_active": engine._is_running,
        "frames_received": telemetry["frames_received"],
        "last_frame_ms": telemetry["last_audio_frame_ms"],
        "native_samplerate": telemetry["capture_sample_rate"],
        "processing_samplerate": telemetry["processing_sample_rate"],
        "hostapi": telemetry.get("hostapi"),
        "error": engine.current_error,
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
        raise HTTPException(status_code=500, detail=engine.current_error or "Failed to start audio engine")
    return {"success": True, "message": "Monitoring active"}


@router.post("/monitor/stop")
def stop_monitoring(engine=Depends(get_engine)):
    engine.stop()
    return {"success": True, "message": "Monitoring stopped"}


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
    source = MicrophoneSource(device_id=request.device_id, sample_rate=engine.config.sample_rate)
    frames = 0
    sum_squares = 0.0
    peak = 0.0
    try:
        source.start()
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
        "frames_received": frames,
        "rms": rms,
        "level_dbfs": round(RMSDetector.rms_to_dbfs(rms), 1),
        "peak_dbfs": round(RMSDetector.rms_to_dbfs(peak), 1),
        "error": None if frames else "No audio frames received",
    }


@router.post("/calibrate")
def calibrate_noise(engine=Depends(get_engine)):
    result = engine.calibrate_noise_floor(duration_sec=5.0)
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
