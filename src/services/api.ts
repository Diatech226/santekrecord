import { AppSettings, AudioDevice, AudioDiagnostics, CalibrationState, MonitorUpdate, RecordingMeta, UsbTroubleshootResult } from '../types';

const backendOrigin = typeof window === 'undefined'
  ? 'http://127.0.0.1:8000'
  : `${window.location.protocol}//${window.location.hostname}:8000`;
const API_BASE = `${backendOrigin}/api`;

export const api = {
  async getHealth(): Promise<{ status: string; engine: string; timestamp: string }> {
    try {
      const res = await fetch(`${API_BASE}/health`);
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      return await res.json();
    } catch {
      return { status: 'offline', engine: 'browser-fallback', timestamp: new Date().toISOString() };
    }
  },

  async getAudioDevices(): Promise<AudioDevice[]> {
    // 1. Try FastAPI backend on :8000
    try {
      const res = await fetch(`${API_BASE}/audio/devices`);
      if (res.ok) {
        const data = (await res.json()) as AudioDevice[];
        if (Array.isArray(data) && data.length > 0) {
          return data;
        }
      }
    } catch {
      // fallback
    }

    // Browser device ids cannot be opened by the Python/PortAudio recorder.
    // Returning no entries is preferable to displaying fictitious interfaces.
    return [];
  },

  async getSettings(): Promise<AppSettings> {
    try {
      const res = await fetch(`${API_BASE}/settings`);
      if (res.ok) {
        return await res.json();
      }
    } catch {
      // use localstorage fallback
    }

    const saved = localStorage.getItem('auto_recorder_settings');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        // ignore
      }
    }

    return {
      config_version: 2,
      source: 'microphone',
      device_id: null,
      device_name: undefined,
      audio_backend: 'auto',
      sample_rate: 16000,
      preroll_seconds: 1.5,
      silence_seconds: 2.0,
      auto_trim_silence: true,
      trim_margin_seconds: 0.2,
      input_gain: 1.0,
      input_channel: 'auto',
      auto_gain_control: false,
      detection_profile: 'voice_any_source',
      adaptive_noise: true,
      adaptive_threshold: true,
      ambient_learning_seconds: 3,
      ambient_learning_vad_max: 0.15,
      ambient_window_seconds: 20,
      noise_margin_db: 8,
      minimum_snr_db: 6,
      vad_start_threshold: 0.50,
      vad_stop_threshold: 0.30,
      minimum_speech_ms: 128,
      minimum_total_speech_ms: 300,
      frequency_hz: 145000000,
      modulation: 'NFM',
      station_id: 'ST001',
      fifo_path: '/tmp/hackrf_audio.f32',
    };
  },

  async saveSettings(settings: AppSettings): Promise<AppSettings> {
    localStorage.setItem('auto_recorder_settings', JSON.stringify(settings));
    let res: Response;
    try {
      res = await fetch(`${API_BASE}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
    } catch {
      // The backend is unreachable: offline mode intentionally keeps the local copy.
      return settings;
    }
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        detail = body.detail ?? body.error ?? detail;
      } catch {
        // Keep the HTTP status when the backend did not return JSON.
      }
      throw new Error(`Settings saved locally but rejected by FastAPI: ${detail}`);
    }
    return await res.json();
  },

  async startMonitoring(settings?: AppSettings): Promise<{ success: boolean; message: string }> {
    try {
      const res = await fetch(`${API_BASE}/monitor/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: settings ? JSON.stringify(settings) : undefined,
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? body.detail ?? `HTTP ${res.status}`);
      }
      return await res.json();
    } catch (error) {
      throw error instanceof Error ? error : new Error('Unable to start audio backend');
    }
  },

  async getAudioDiagnostics(): Promise<AudioDiagnostics> {
    const res = await fetch(`${API_BASE}/audio/diagnostics`);
    if (!res.ok) throw new Error((await res.json()).detail || `HTTP ${res.status}`);
    return await res.json();
  },

  async resetAmbientProfile(): Promise<MonitorUpdate> {
    const res = await fetch(`${API_BASE}/audio/ambient-profile`, { method: 'DELETE' });
    if (!res.ok) throw new Error((await res.json()).detail || `HTTP ${res.status}`);
    return await res.json();
  },

  async getDiagnostics(): Promise<AudioDiagnostics> {
    try {
      const res = await fetch(`${API_BASE}/audio/diagnostics`);
      if (res.ok) {
        return await res.json();
      }
    } catch {
      // fallback
    }

    try {
      const res = await fetch('/api/audio/diagnostics');
      if (res.ok) {
        return await res.json();
      }
    } catch {
      // fallback
    }

    return {
      platform: typeof navigator !== 'undefined' ? navigator.platform : 'browser',
      portaudio_available: false,
      default_input_device: null,
      devices: [],
      selected_device: null,
      stream_active: false,
      frames_received: 0,
      last_frame_ms: null,
      native_samplerate: 48000,
      processing_samplerate: 16000,
      error: null,
    };
  },

  async getUsbDiagnostic(): Promise<UsbTroubleshootResult> {
    // 1. Try FastAPI backend on :8000
    try {
      const res = await fetch(`${API_BASE}/system/usb-diagnostic`);
      if (res.ok) {
        return await res.json();
      }
    } catch {
      // fallback
    }

    // 2. Try same-origin /api/system/usb-diagnostic
    try {
      const res = await fetch('/api/system/usb-diagnostic');
      if (res.ok) {
        return await res.json();
      }
    } catch {
      // fallback
    }

    throw new Error('FastAPI hardware diagnostics are unavailable');
  },

  async calibrateNoise(): Promise<{ noise_floor_dbfs: number; recommended_threshold_dbfs: number; margin_db: number; quiet_seconds: number }> {
    const res = await fetch(`${API_BASE}/calibrate`, { method: 'POST' });
    if (!res.ok) throw new Error((await res.json()).detail || `HTTP ${res.status}`);
    return await res.json();
  },

  async stopMonitoring(): Promise<{ success: boolean; message: string }> {
    try {
      const res = await fetch(`${API_BASE}/monitor/stop`, {
        method: 'POST',
      });
      if (res.ok) {
        return await res.json();
      }
    } catch {
      // client-side audio engine handling
    }
    throw new Error('FastAPI audio backend is unavailable');
  },

  async getRecordings(): Promise<RecordingMeta[]> {
    try {
      const res = await fetch(`${API_BASE}/recordings`);
      if (res.ok) {
        const recordings = await res.json() as RecordingMeta[];
        return recordings.map((recording) => ({
          ...recording,
          audio_url: recording.audio_url?.startsWith('/') ? `${backendOrigin}${recording.audio_url}` : recording.audio_url,
        }));
      }
    } catch {
      // fallback
    }

    const saved = localStorage.getItem('auto_recordings_list');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        // ignore
      }
    }
    return [];
  },

  async deleteRecording(id: string): Promise<boolean> {
    try {
      const res = await fetch(`${API_BASE}/recordings/${id}`, {
        method: 'DELETE',
      });
      if (res.ok) return true;
    } catch {
      // fallback
    }

    const saved = localStorage.getItem('auto_recordings_list');
    if (saved) {
      try {
        const list: RecordingMeta[] = JSON.parse(saved);
        const filtered = list.filter((r) => r.recording_id !== id);
        localStorage.setItem('auto_recordings_list', JSON.stringify(filtered));
        return true;
      } catch {
        // ignore
      }
    }
    return true;
  },

  async deleteRecordingsBatch(ids: string[]): Promise<boolean> {
    if (!ids || ids.length === 0) return true;
    try {
      await Promise.all(
        ids.map((id) =>
          fetch(`${API_BASE}/recordings/${id}`, { method: 'DELETE' }).catch(() => null)
        )
      );
    } catch {
      // fallback
    }

    const saved = localStorage.getItem('auto_recordings_list');
    if (saved) {
      try {
        const idSet = new Set(ids);
        const list: RecordingMeta[] = JSON.parse(saved);
        const filtered = list.filter((r) => !idSet.has(r.recording_id));
        localStorage.setItem('auto_recordings_list', JSON.stringify(filtered));
        return true;
      } catch {
        // ignore
      }
    }
    return true;
  },

  async saveRecording(meta: RecordingMeta, audioBlob?: Blob): Promise<RecordingMeta> {
    // Try uploading to server
    if (audioBlob) {
      try {
        const formData = new FormData();
        formData.append('audio', audioBlob, meta.filename_wav);
        formData.append('meta', JSON.stringify(meta));

        const res = await fetch(`${API_BASE}/recordings/upload`, {
          method: 'POST',
          body: formData,
        });
        if (res.ok) {
          return await res.json();
        }
      } catch {
        // fallback
      }
    }

    // Save locally
    const saved = localStorage.getItem('auto_recordings_list');
    let list: RecordingMeta[] = [];
    if (saved) {
      try {
        list = JSON.parse(saved);
      } catch {
        list = [];
      }
    }

    // Prepend new recording
    const updated = [meta, ...list.filter((r) => r.recording_id !== meta.recording_id)].slice(0, 50);
    localStorage.setItem('auto_recordings_list', JSON.stringify(updated));
    return meta;
  },
};
