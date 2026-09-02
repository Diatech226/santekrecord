import json
import os
from typing import Optional, Literal
from pydantic import BaseModel, Field

CONFIG_PATH = os.environ.get("RECORDER_CONFIG_PATH", "config.json")


class AppConfig(BaseModel):
    source: Literal["microphone", "usb", "gnuradio"] = Field(
        default="microphone", description="Active audio input source"
    )
    device_id: Optional[int | str] = Field(
        default=None, description="Index or identifier of sounddevice hardware device"
    )
    device_name: Optional[str] = Field(
        default="Default System Microphone", description="Friendly device label"
    )
    sample_rate: int = Field(
        default=16000, description="Sampling rate in Hz (standard 16000 for VAD and Whisper)"
    )
    trigger_mode: Literal["db_vad", "db_only", "vad_only"] = Field(
        default="db_vad", description="Voice detection algorithm mode"
    )
    threshold_dbfs: float = Field(
        default=-38.0, description="Minimum RMS level in dBFS to qualify as signal"
    )
    vad_threshold: float = Field(
        default=0.60, description="Silero VAD speech confidence trigger threshold (0.0 to 1.0)"
    )
    preroll_seconds: float = Field(
        default=1.0, description="Circular buffer duration saved before trigger event"
    )
    silence_seconds: float = Field(
        default=2.0, description="Silence hang time in seconds before stopping recording"
    )
    auto_trim_silence: bool = Field(default=True, description="Trim dead air after recording")
    trim_margin_seconds: float = Field(default=0.2, ge=0.0, le=2.0)
    input_gain: float = Field(default=1.0, ge=0.1, le=8.0)
    input_channel: Literal["auto", "channel_1", "channel_2"] = Field(default="auto")
    auto_gain_control: bool = Field(default=False)
    
    # HackRF / GNU Radio configuration
    fifo_path: str = Field(
        default="/tmp/hackrf_audio.f32", description="FIFO named pipe path from GNU Radio"
    )
    frequency_hz: Optional[int] = Field(
        default=145000000, description="Tuned SDR RF center frequency in Hz"
    )
    modulation: Optional[str] = Field(
        default="NFM", description="SDR demodulation mode (NFM, WFM, AM, USB, LSB)"
    )
    station_id: Optional[str] = Field(
        default="ST001", description="Identifier station or channel tag"
    )


def load_config() -> AppConfig:
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
                return AppConfig(**data)
        except Exception as e:
            print(f"[Config] Error loading {CONFIG_PATH}: {e}. Using defaults.")
    
    config = AppConfig()
    save_config(config)
    return config


def save_config(config: AppConfig) -> AppConfig:
    try:
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            f.write(config.model_dump_json(indent=2))
    except Exception as e:
        print(f"[Config] Error saving config: {e}")
    return config
