import json
import os
from typing import Optional, Literal
from pydantic import BaseModel, Field

CONFIG_PATH = os.environ.get("RECORDER_CONFIG_PATH", "config.json")


class AppConfig(BaseModel):
    source: Literal["microphone", "usb", "gnuradio"] = Field(
        default="microphone", description="Active audio input source"
    )
    device_id: Optional[int] = Field(
        default=None, description="Exact PortAudio device index; null until selected"
    )
    device_name: Optional[str] = Field(
        default=None, description="Friendly device label used to recover a stale index"
    )
    audio_backend: Literal["auto", "portaudio", "alsa"] = Field(default="auto")
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
        default=1.5, description="Circular buffer duration saved before trigger event"
    )
    silence_seconds: float = Field(
        default=2.0, description="Silence hang time in seconds before stopping recording"
    )
    intra_phrase_pause_seconds: float = Field(default=1.2, ge=0.0, le=10.0)
    transmission_end_timeout_seconds: float = Field(default=3.0, ge=0.1, le=30.0)
    communication_end_timeout_seconds: float = Field(default=10.0, ge=0.5, le=120.0)
    ambient_confirm_ms: int = Field(default=300, ge=20, le=5000)
    ambient_return_spectral_threshold: float = Field(default=0.12, ge=0.0, le=2.0)
    max_communication_seconds: float = Field(default=300.0, ge=1.0, le=3600.0)
    auto_trim_silence: bool = Field(default=True, description="Trim dead air after recording")
    trim_margin_seconds: float = Field(default=0.2, ge=0.0, le=2.0)
    input_gain: float = Field(default=1.0, ge=0.1, le=8.0)
    input_channel: Literal["auto", "channel_1", "channel_2"] = Field(default="auto")
    auto_gain_control: bool = Field(default=False)
    detection_profile: Literal["voice_any_source", "radio_room", "general_voice"] = "voice_any_source"
    adaptive_noise: bool = True
    adaptive_threshold: bool = True
    ambient_learning_seconds: float = Field(default=3.0, ge=1.0, le=30.0)
    ambient_learning_vad_max: float = Field(default=0.15, ge=0.0, le=0.5)
    cold_start_vad_threshold: float = Field(default=0.75, ge=0.0, le=1.0)
    ambient_window_seconds: float = Field(default=20.0, ge=5.0, le=120.0)
    noise_margin_db: float = Field(default=8.0, ge=1.0, le=30.0)
    minimum_snr_db: float = Field(default=6.0, ge=0.0, le=30.0)
    speech_band_low_hz: float = Field(default=250.0, ge=50.0)
    speech_band_high_hz: float = Field(default=4000.0, ge=500.0)
    vad_start_threshold: float = Field(default=0.65, ge=0.0, le=1.0)
    vad_stop_threshold: float = Field(default=0.35, ge=0.0, le=1.0)
    minimum_speech_ms: int = Field(default=160, ge=50, le=2000)
    minimum_total_speech_ms: int = Field(default=300, ge=50, le=5000)
    transmission_hangover_seconds: float = Field(default=2.0, ge=.3, le=15.0)
    keep_internal_pause_ms: int = Field(default=1200, ge=0, le=5000)
    trim_long_silence_ms: int = Field(default=1400, ge=100, le=10000)
    
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
