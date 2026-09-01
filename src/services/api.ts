import { AppSettings, AudioDevice, AudioDiagnostics, CalibrationState, RecordingMeta } from '../types';

const backendOrigin = typeof window === 'undefined'
  ? 'http://127.0.0.1:8000'
  : `${window.location.protocol}//${window.location.hostname}:8000`;
const API_BASE = `${backendOrigin}/api`;
const INPUT_TEST_TIMEOUT_MS = 8_000;

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
      auto_gain_control: false,
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

  async testInput(deviceId: number | string | null, source = 'microphone'): Promise<{ working: boolean; message: string; level_dbfs: number; peak_dbfs: number; frames_received: number; capture_sample_rate?: number }> {
    if (source !== 'gnuradio') {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), INPUT_TEST_TIMEOUT_MS);
      try {
        const numericId = deviceId === null ? null : Number(deviceId);
        const res = await fetch(`${API_BASE}/audio/test-input`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
          body: JSON.stringify({ device_id: Number.isFinite(numericId) ? numericId : null }),
        });
        if (!res.ok) {
          const body = await res.json();
          const detail = body.detail?.error ?? body.detail ?? `HTTP ${res.status}`;
          throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
        }
        const result = await res.json();
        return { ...result, working: result.success, message: result.success ? 'Input working' : result.error,
          capture_sample_rate: result.native_samplerate };
      } catch (error) {
        if (controller.signal.aborted) throw new Error('Input test timed out. Check the device and try again.');
        throw error;
      } finally { window.clearTimeout(timeoutId); }
    }
    const params = new URLSearchParams({ source_type: source });
    if (deviceId !== null) params.set('device_id', String(deviceId));
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), INPUT_TEST_TIMEOUT_MS);

    try {
      const res = await fetch(`${API_BASE}/audio/test?${params}`, {
        method: 'POST',
        signal: controller.signal,
      });
      if (!res.ok) throw new Error((await res.json()).detail || `HTTP ${res.status}`);
      return await res.json();
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error('Input test timed out. Check the device and try again.');
      }
      throw error;
    } finally {
      window.clearTimeout(timeoutId);
    }
  },

  async getAudioDiagnostics(): Promise<AudioDiagnostics> {
    const res = await fetch(`${API_BASE}/audio/diagnostics`);
    if (!res.ok) throw new Error((await res.json()).detail || `HTTP ${res.status}`);
    return await res.json();
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
