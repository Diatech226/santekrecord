import { AppSettings, AudioDevice, CalibrationState, RecordingMeta } from '../types';

// The bundled Express server serves the UI on :3000 while the real
// sounddevice engine runs in FastAPI on :8000 (see start_kali.sh).
const API_BASE = typeof window !== 'undefined'
  ? `${window.location.protocol}//${window.location.hostname}:8000/api`
  : '/api';

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
    try {
      const res = await fetch(`${API_BASE}/audio/devices`);
      if (res.ok) {
        return await res.json();
      }
    } catch {
      // fallback
    }

    // Browser audio devices enumeration fallback
    if (typeof navigator !== 'undefined' && navigator.mediaDevices?.enumerateDevices) {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = devices
          .filter((d) => d.kind === 'audioinput')
          .map((d, index) => {
            const isUsb = d.label.toLowerCase().includes('usb') || d.label.toLowerCase().includes('external');
            const isLine = d.label.toLowerCase().includes('line');
            return {
              id: d.deviceId || `device-${index}`,
              name: d.label || `Audio Input ${index + 1}`,
              max_input_channels: 1,
              default_samplerate: 16000,
              is_default: index === 0,
              type: isUsb ? ('usb' as const) : isLine ? ('line' as const) : ('microphone' as const),
            };
          });

        if (audioInputs.length > 0) {
          return audioInputs;
        }
      } catch {
        // permission denied or unsupported
      }
    }

    return [
      {
        id: 'default-mic',
        name: 'Default System Microphone (sounddevice 0)',
        max_input_channels: 1,
        default_samplerate: 16000,
        is_default: true,
        type: 'microphone',
      },
      {
        id: 'usb-soundcard',
        name: 'USB Audio Device Line-In (sounddevice 1)',
        max_input_channels: 2,
        default_samplerate: 16000,
        is_default: false,
        type: 'usb',
      },
      {
        id: 'gnuradio-fifo',
        name: 'GNU Radio FIFO (/tmp/hackrf_audio.f32)',
        max_input_channels: 1,
        default_samplerate: 16000,
        is_default: false,
        type: 'other',
      },
    ];
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
      source: 'microphone',
      device_id: 'default-mic',
      sample_rate: 16000,
      trigger_mode: 'db_vad',
      threshold_dbfs: -38,
      vad_threshold: 0.6,
      preroll_seconds: 1.0,
      silence_seconds: 2.0,
      auto_trim_silence: true,
      trim_margin_seconds: 0.2,
      input_gain: 1.0,
      input_channel: 'auto',
      frequency_hz: 145000000,
      modulation: 'NFM',
      station_id: 'ST001',
      fifo_path: '/tmp/hackrf_audio.f32',
    };
  },

  async saveSettings(settings: AppSettings): Promise<AppSettings> {
    localStorage.setItem('auto_recorder_settings', JSON.stringify(settings));
    try {
      const res = await fetch(`${API_BASE}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      if (res.ok) {
        return await res.json();
      }
    } catch {
      // saved to localstorage
    }
    return settings;
  },

  async startMonitoring(settings?: AppSettings): Promise<{ success: boolean; message: string }> {
    try {
      const res = await fetch(`${API_BASE}/monitor/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: settings ? JSON.stringify(settings) : undefined,
      });
      if (!res.ok) throw new Error((await res.json()).detail || `HTTP ${res.status}`);
      return await res.json();
    } catch (error) {
      throw error instanceof Error ? error : new Error('Unable to start audio backend');
    }
  },

  async testInput(deviceId: number | string | null) {
    const query = deviceId === null ? '' : `?device_id=${encodeURIComponent(String(deviceId))}`;
    const res = await fetch(`${API_BASE}/audio/test${query}`, { method: 'POST' });
    if (!res.ok) throw new Error((await res.json()).detail || `HTTP ${res.status}`);
    return await res.json() as { working: boolean; message: string; level_dbfs: number; peak_dbfs: number; frames_received: number };
  },

  async calibrateNoise(): Promise<{ noise_floor_dbfs: number; recommended_threshold_dbfs: number }> {
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
    return { success: true, message: 'Monitoring stopped' };
  },

  async getRecordings(): Promise<RecordingMeta[]> {
    try {
      const res = await fetch(`${API_BASE}/recordings`);
      if (res.ok) {
        return await res.json();
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
