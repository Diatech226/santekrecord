import json
import os
from typing import Optional, Dict, Any, List
from pydantic import BaseModel, Field


class RecordingMetadata(BaseModel):
    recording_id: str = Field(..., description="Timestamp-based ID format: YYYY-MM-DD_HH-MM-SS")
    source: str = Field(..., description="Audio input source (microphone, usb, gnuradio)")
    device: str = Field(..., description="Hardware device or pipe label")
    sample_rate: int = Field(default=16000, description="Audio sample rate (16000 Hz)")
    channels: int = Field(default=1, description="Number of audio channels (1 = mono)")
    timestamp_start: str = Field(..., description="ISO 8601 recording start time")
    timestamp_end: str = Field(..., description="ISO 8601 recording end time")
    duration_seconds: float = Field(default=0.0, description="Total recording duration in seconds")
    trigger_mode: str = Field(default="db_vad", description="Trigger mode (db_vad, db_only, vad_only)")
    trigger_threshold_dbfs: float = Field(default=-38.0, description="Configured RMS trigger threshold")
    vad_threshold: float = Field(default=0.60, description="Configured VAD speech confidence threshold")
    annotation_status: str = Field(default="pending", description="Annotation / transcription status")
    upload_status: str = Field(default="pending", description="Sync status")
    
    # Optional SDR fields
    frequency_hz: Optional[int] = None
    modulation: Optional[str] = None
    station_id: Optional[str] = None
    profile: str = "radio_room"
    noise_floor_dbfs: Optional[float] = None
    dynamic_threshold_dbfs: Optional[float] = None
    average_snr_db: Optional[float] = None
    speech_band_snr_db: Optional[float] = None
    vad_backend: str = "unknown"
    vad_start_threshold: float = 0.65
    vad_stop_threshold: float = 0.35
    speech_duration_seconds: float = 0.0
    raw_event_duration_seconds: float = 0.0
    saved_duration_seconds: float = 0.0
    trimmed_leading_seconds: float = 0.0
    trimmed_trailing_seconds: float = 0.0
    speech_segment_count: int = 0
    ambient_profile_version: int = 1
    communication_id: Optional[str] = None
    transmission_count: int = 0
    transmissions: List[Dict[str, Any]] = Field(default_factory=list)
    communication_end_reason: Optional[str] = None
    total_speech_duration_seconds: float = 0.0
    total_radio_activity_seconds: float = 0.0
    inter_transmission_gap_seconds: List[float] = Field(default_factory=list)


def save_metadata(meta: RecordingMetadata, output_dir: str = "recordings") -> str:
    os.makedirs(output_dir, exist_ok=True)
    filename = f"{meta.recording_id}.json"
    file_path = os.path.join(output_dir, filename)
    with open(file_path, "w", encoding="utf-8") as f:
        f.write(meta.model_dump_json(indent=2))
    return file_path
