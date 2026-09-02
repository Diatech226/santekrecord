export type AudioSourceType = 'microphone' | 'usb' | 'gnuradio';

export type DetectionMode = 'db_vad' | 'db_only' | 'vad_only';

export type EngineStatus =
  | 'idle'
  | 'opening'
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
  available?: boolean;
  device_kind?: 'hardware' | 'virtual' | 'default';
}

export interface AudioDiagnostics {
  platform: string;
  portaudio_available: boolean;
  default_input_device: number | null;
  devices: AudioDevice[];
  selected_device: AudioDevice | null;
  stream_active: boolean;
  frames_received: number;
  last_frame_ms: number | null;
  native_samplerate: number;
  processing_samplerate: number;
  hostapi?: string;
  error?: string | null;
}

export interface UsbDiagnosticCheck {
  id: string;
  name: string;
  category: 'groups' | 'permissions' | 'devices' | 'services';
  status: 'pass' | 'warn' | 'fail';
  message: string;
  details?: string;
  fix_command?: string;
}

export interface UsbTroubleshootResult {
  timestamp: string;
  platform: string;
  user: string;
  groups: string[];
  in_audio_group: boolean;
  in_plugdev_group: boolean;
  dev_snd_exists: boolean;
  dev_snd_readable: boolean;
  dev_snd_nodes_count: number;
  dev_bus_usb_exists: boolean;
  dev_bus_usb_readable: boolean;
  usb_devices: Array<{ id?: string; name: string }>;
  sound_cards: Array<{ id: string | number; name: string }>;
  audio_server: string;
  checks: UsbDiagnosticCheck[];
  overall_status: 'ok' | 'warning' | 'error';
}

export interface AppSettings {
  source: AudioSourceType;
  device_id: number | string | null;
  device_name?: string;
  audio_backend?: 'auto' | 'portaudio' | 'alsa';
  sample_rate: number;
  trigger_mode: DetectionMode;
  threshold_dbfs: number;
  vad_threshold: number;
  preroll_seconds: number;
  silence_seconds: number;
  // Auto Trim Dead Air / Silence Post-Processing
  auto_trim_silence?: boolean;
  trim_margin_seconds?: number;
  // Sound Card Gain & Channel Routing
  input_gain?: number;
  input_channel?: 'auto' | 'channel_1' | 'channel_2';
  // Automatic Gain Control (AGC) based on ambient noise floor measurements
  auto_gain_control?: boolean;
  // HackRF / GNU Radio specific
  frequency_hz?: number;
  modulation?: string;
  station_id?: string;
  fifo_path?: string;
}

export interface MonitorUpdate {
  event?: string;
  timestamp?: number;
  level_dbfs: number;
  speech_probability: number;
  voice_detected: boolean;
  recording: boolean;
  status: EngineStatus;
  current_duration_sec?: number;
  peak_dbfs?: number;
  rms_dbfs?: number;
  noise_floor_dbfs?: number;
  threshold_dbfs?: number;
  device_connected?: boolean;
  audio_frames_received?: boolean;
  frames_received?: number;
  last_audio_frame_ms?: number | null;
  signal_state?: 'no_device' | 'no_audio_data' | 'silence' | 'low_signal' | 'signal' | 'voice';
  device_name?: string;
  capture_sample_rate?: number;
  processing_sample_rate?: number;
  channels?: number;
  ambient_noise_dbfs?: number;
  effective_gain?: number;
  agc_active?: boolean;
  waveform?: number[];
  spectrum?: number[];
  active_source?: string;
  error_message?: string | null;
  callback_count?: number;
  capture_channels?: number;
  capture_backend?: string;
  alsa_device?: string | null;
  hostapi?: string;
  input_channel?: string;
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
