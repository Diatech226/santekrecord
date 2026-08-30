export type AudioSourceType = 'microphone' | 'usb' | 'gnuradio';

export type DetectionMode = 'db_vad' | 'db_only' | 'vad_only';

export type EngineStatus =
  | 'idle'
  | 'listening'
  | 'voice_detected'
  | 'recording'
  | 'silence'
  | 'saving'
  | 'error';

export interface AudioDevice {
  id: number | string;
  name: string;
  hostapi?: string;
  max_input_channels: number;
  default_samplerate: number;
  is_default?: boolean;
  type: 'microphone' | 'usb' | 'line' | 'other';
}

export interface AppSettings {
  source: AudioSourceType;
  device_id: number | string | null;
  device_name?: string;
  sample_rate: number;
  trigger_mode: DetectionMode;
  threshold_dbfs: number;
  vad_threshold: number;
  preroll_seconds: number;
  silence_seconds: number;
  // Auto Trim Dead Air / Silence Post-Processing
  auto_trim_silence?: boolean;
  trim_margin_seconds?: number;
  // HackRF / GNU Radio specific
  frequency_hz?: number;
  modulation?: string;
  station_id?: string;
  fifo_path?: string;
}

export interface MonitorUpdate {
  level_dbfs: number;
  speech_probability: number;
  voice_detected: boolean;
  recording: boolean;
  status: EngineStatus;
  current_duration_sec?: number;
  peak_dbfs?: number;
  active_source?: string;
  error_message?: string | null;
}

export interface TrimInfo {
  leading_trimmed_sec: number;
  trailing_trimmed_sec: number;
  total_trimmed_sec: number;
}

export interface RecordingMeta {
  recording_id: string;
  filename_wav: string;
  filename_json: string;
  source: AudioSourceType;
  device: string;
  sample_rate: number;
  channels: number;
  timestamp_start: string;
  timestamp_end: string;
  duration_seconds: number;
  original_duration_seconds?: number;
  is_trimmed?: boolean;
  trimmed_dead_air_sec?: number;
  trim_info?: TrimInfo;
  trigger_mode: DetectionMode;
  trigger_threshold_dbfs: number;
  vad_threshold: number;
  annotation_status: string;
  upload_status: string;
  file_size_bytes?: number;
  audio_url?: string;
  // SDR attributes
  frequency_hz?: number;
  modulation?: string;
  station_id?: string;
}

export interface CalibrationState {
  is_calibrating: boolean;
  progress: number;
  elapsed_sec: number;
  total_sec: number;
  noise_floor_dbfs: number | null;
  recommended_threshold_dbfs: number | null;
  margin_db: number;
}
