import os
import json
import time
import numpy as np
from typing import List, Dict, Any, Optional
from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Depends
from fastapi.responses import FileResponse

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
    if not devices:
        # Fallback list for offline / simulated Linux environment
        devices = [
            {
                "id": 0,
                "name": "Default ALSA / PulseAudio Microphone",
                "max_input_channels": 1,
                "default_samplerate": 16000,
                "is_default": True,
                "type": "microphone",
            },
            {
                "id": 1,
                "name": "USB Audio Device / Line-In",
                "max_input_channels": 2,
                "default_samplerate": 16000,
                "is_default": False,
                "type": "usb",
            },
            {
                "id": "gnuradio-fifo",
                "name": "GNU Radio FIFO (/tmp/hackrf_audio.f32)",
                "max_input_channels": 1,
                "default_samplerate": 16000,
                "is_default": False,
                "type": "other",
            },
        ]
    return devices


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
def test_input(device_id: Optional[int | str] = None, engine=Depends(get_engine)):
    """Open the selected hardware independently and report real samples for 3 seconds."""
    if engine._is_running:
        telemetry = engine.get_telemetry()
        return {"working": telemetry["audio_frames_received"], **telemetry}
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
        "capture_sample_rate": source.capture_sample_rate,
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
