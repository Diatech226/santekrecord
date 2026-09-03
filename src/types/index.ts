export type AudioSourceType = 'microphone' | 'usb' | 'gnuradio';

export type DetectionMode = 'db_vad' | 'db_only' | 'vad_only';

export type EngineStatus =
  | 'idle'
  | 'opening'
  | 'learning_ambient'
  | 'listening'
  | 'signal_candidate'
  | 'voice_confirmed'
  | 'voice_detected'
  | 'recording'
  | 'silence'
  | 'hangover'
  | 'finalizing'
  | 'trimming'
  | 'saving'
  | 'communication_active'
  | 'transmission_hangover'
  | 'waiting_reply'
  | 'saving_communication'
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
  intra_phrase_pause_seconds?: number;
  transmission_end_timeout_seconds?: number;
  communication_end_timeout_seconds?: number;
  ambient_confirm_ms?: number;
  ambient_return_spectral_threshold?: number;
  max_communication_seconds?: number;
  // Auto Trim Dead Air / Silence Post-Processing
  auto_trim_silence?: boolean;
  trim_margin_seconds?: number;
  // Sound Card Gain & Channel Routing
  input_gain?: number;
  input_channel?: 'auto' | 'channel_1' | 'channel_2';
  // Automatic Gain Control (AGC) based on ambient noise floor measurements
  auto_gain_control?: boolean;
  detection_profile?: 'voice_any_source' | 'radio_room' | 'general_voice';
  adaptive_noise?: boolean;
  adaptive_threshold?: boolean;
  ambient_learning_seconds?: number;
  ambient_learning_vad_max?: number;
  cold_start_vad_threshold?: number;
  ambient_window_seconds?: number;
  noise_margin_db?: number;
  minimum_snr_db?: number;
  speech_band_low_hz?: number;
  speech_band_high_hz?: number;
  vad_start_threshold?: number;
  vad_stop_threshold?: number;
  minimum_speech_ms?: number;
  minimum_total_speech_ms?: number;
  transmission_hangover_seconds?: number;
  keep_internal_pause_ms?: number;
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
  vad_raw_probability?: number;
  vad_smoothed_probability?: number;
  voice_detected: boolean;
  recording: boolean;
  status: EngineStatus;
  current_duration_sec?: number;
  peak_dbfs?: number;
  rms_dbfs?: number;
  noise_floor_dbfs?: number;
  raw_noise_floor_dbfs?: number;
  event_delta_db?: number;
  threshold_dbfs?: number;
  dynamic_threshold_dbfs?: number;
  event_active?: boolean;
  event_start_threshold_dbfs?: number;
  event_continue_threshold_dbfs?: number;
  event_end_threshold_dbfs?: number;
  snr_db?: number;
  speech_band_snr_db?: number;
  spectral_change?: number;
  radio_activity?: boolean;
  ambient_learning?: boolean;
  ambient_spectrum?: number[];
  vad_backend?: string;
  vad_model_loaded?: boolean;
  vad_error?: string | null;
  cold_start_voice_active?: boolean;
  effective_speech_confirmed?: boolean;
  ambient_learning_paused_for_voice?: boolean;
  speech_candidate?: boolean;
  speech_confirmed?: boolean;
  speech_reject_reason?: string;
  minimum_snr_db?: number;
  ambient_learned_seconds?: number;
  ambient_profile_loaded?: boolean;
  ambient_profile_age_seconds?: number | null;
  ambient_profile_key?: string;
  ambient_profile_source?: 'cached' | 'learning';
  detection_profile?: 'voice_any_source' | 'radio_room' | 'general_voice';
  configured_vad_start_threshold?: number;
  configured_vad_stop_threshold?: number;
  configured_minimum_snr_db?: number;
  configured_minimum_speech_ms?: number;
  effective_vad_start_threshold?: number;
  effective_vad_stop_threshold?: number;
  effective_minimum_snr_db?: number;
  effective_minimum_speech_ms?: number;
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
  selected_channel?: string;
  selected_channel_index?: number;
  channel_1_rms_dbfs?: number;
  channel_2_rms_dbfs?: number;
  raw_level_dbfs?: number;
  processed_level_dbfs?: number;
  raw_peak_dbfs?: number;
  processed_peak_dbfs?: number;
  sample_rms?: number;
  sample_abs_max?: number;
  input_signal_quality?: 'silent' | 'very_low' | 'low' | 'usable' | 'strong' | 'clipping';
  signal_present_but_vad_inactive?: boolean;
  voice_pipeline_diagnosis?: string;
  voice_pipeline_hint?: string;
  vad_continue_threshold?: number;
  communication_active?: boolean;
  communication_id?: string | null;
  current_transmission?: number;
  transmission_count?: number;
  communication_duration_seconds?: number;
  time_since_last_speech?: number | null;
  session_state?: string;
  transmission_state?: 'idle' | 'speech' | 'intra_phrase_pause' | 'transmission_hangover';
  return_to_ambient?: boolean;
  ambient_confirm_ms?: number;
  quiet_seconds?: number;
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
  transmissions?: TransmissionAnnotation[];
}

export interface SpeechAnnotation { start_sec: number; end_sec: number; start_sample?: number; end_sample?: number }
export interface TransmissionAnnotation {
  id: number | string; start_sec: number; end_sec: number; start_sample?: number; end_sample?: number;
  speaker?: string; speech_segments?: SpeechAnnotation[]; false_detection?: boolean;
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
