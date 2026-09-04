import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  AppSettings,
  AudioDevice,
  AudioSourceType,
  EngineStatus,
  MonitorUpdate,
  RecordingMeta,
} from './types';
import { api } from './services/api';
import { getEngineDisplayState, reconcileSelectedDevice } from './services/deviceReconciliation';
import { StatusIndicator } from './components/StatusIndicator';
import { AudioMeter } from './components/AudioMeter';
import { SourceSelector } from './components/SourceSelector';
import { SettingsPanel } from './components/SettingsPanel';
import { AudioPlayer } from './components/AudioPlayer';
import { RecordingsHistory } from './components/RecordingsHistory';
import { CalibrationModal } from './components/CalibrationModal';
import { MetadataModal } from './components/MetadataModal';
import { TroubleshootUsbModal } from './components/TroubleshootUsbModal';
import { Power, AlertTriangle, RefreshCw, Sparkles, Globe, Activity, Gauge, Sun, Moon, ShieldAlert } from 'lucide-react';
import { useLanguage } from './i18n/LanguageContext';
import { useTheme } from './theme/ThemeContext';

export default function App() {
  const { language, setLanguage, t } = useLanguage();
  const { theme, setTheme, isLight, currentThemeOption } = useTheme();
  const accentColor = currentThemeOption.primaryColor;

  // Application State
  const [settings, setSettings] = useState<AppSettings>({
    config_version: 2,
    source: 'microphone',
    device_id: null,
    audio_backend: 'auto',
    sample_rate: 16000,
    preroll_seconds: 1.5,
    silence_seconds: 2.0,
    input_gain: 1.0,
    auto_gain_control: false,
    // Bootstrap values mirror config.json only until the backend response arrives.
    detection_profile: 'voice_any_source',
    adaptive_noise: true,
    adaptive_threshold: true,
    ambient_learning_seconds: 3,
    ambient_learning_vad_max: .15,
    ambient_window_seconds: 20,
    noise_margin_db: 8,
    minimum_snr_db: 6,
    speech_band_low_hz: 250,
    speech_band_high_hz: 4000,
    vad_start_threshold: .50,
    vad_stop_threshold: .30,
    minimum_speech_ms: 120,
    minimum_total_speech_ms: 300,
    transmission_hangover_seconds: 2,
    keep_internal_pause_ms: 1200,
    frequency_hz: 145000000,
    modulation: 'NFM',
    station_id: 'ST001',
    fifo_path: '/tmp/hackrf_audio.f32',
  });

  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [monitorRequested, setMonitorRequested] = useState(false);
  const [engineRunning, setEngineRunning] = useState(false);
  const [deviceReconnecting, setDeviceReconnecting] = useState(false);
  const [reconnectedMessage, setReconnectedMessage] = useState<string | null>(null);
  const isMonitoring = engineRunning;
  const engineDisplayState = getEngineDisplayState(deviceReconnecting, engineRunning, monitorRequested);
  const captureOpening = deviceReconnecting || (monitorRequested && !engineRunning);
  const [status, setStatus] = useState<EngineStatus>('idle');
  const [durationSec, setDurationSec] = useState(0);
  const [levelDbfs, setLevelDbfs] = useState(-90);
  const [speechProb, setSpeechProb] = useState(0);
  const [voiceDetected, setVoiceDetected] = useState(false);
  const [ambientNoiseDbfs, setAmbientNoiseDbfs] = useState<number>(-60);
  const [effectiveGain, setEffectiveGain] = useState<number>(1.0);
  const [peakDbfs, setPeakDbfs] = useState(-90);
  const [telemetry, setTelemetry] = useState<MonitorUpdate | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [isTestingInput, setIsTestingInput] = useState(false);
  const [liveWaveform, setLiveWaveform] = useState<number[]>(() => new Array(128).fill(0));
  const [spectrum, setSpectrum] = useState<number[]>(() => new Array(32).fill(0));
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [uptimeSeconds, setUptimeSeconds] = useState(0);

  // Recordings
  const [recordings, setRecordings] = useState<RecordingMeta[]>([]);
  const [selectedRecording, setSelectedRecording] = useState<RecordingMeta | null>(null);
  const [metaModalRecording, setMetaModalRecording] = useState<RecordingMeta | null>(null);
  const [isCalibModalOpen, setIsCalibModalOpen] = useState(false);
  const [isTroubleshootModalOpen, setIsTroubleshootModalOpen] = useState(false);

  // Dynamic Browser Tab Title Recording Indicator (Pulsing Red)
  useEffect(() => {
    const isRecordingNow = status === 'recording' || status === 'voice_detected' || status === 'communication_active';
    
    if (isRecordingNow) {
      let pulse = false;
      const interval = setInterval(() => {
        pulse = !pulse;
        const dot = pulse ? '🔴' : '⭕';
        const dur = durationSec > 0 ? ` [${durationSec.toFixed(0)}s]` : '';
        document.title = `${dot} REC${dur} | Auto Voice Recorder`;
      }, 500);

      return () => {
        clearInterval(interval);
        document.title = isMonitoring ? '🟢 [SURVEILLANCE] Auto Voice Recorder' : 'Auto Voice Recorder';
      };
    } else if (isMonitoring) {
      document.title = '🟢 [SURVEILLANCE] Auto Voice Recorder';
    } else {
      document.title = 'Auto Voice Recorder';
    }
  }, [status, isMonitoring, durationSec]);

  // Audio Engine Ref
  const wsRef = useRef<WebSocket | null>(null);
  const monitoringRef = useRef(false);
  const reconnectingRef = useRef(false);

  const connectMonitorSocket = useCallback(() => {
    wsRef.current?.close();
    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(`${protocol}//${window.location.hostname}:8000/ws/monitor`);
      socket.onmessage = (event) => {
        try {
          const update = JSON.parse(event.data) as MonitorUpdate;
          if (update.event === 'recording_saved') {
            api.getRecordings().then(setRecordings).catch(() => {});
            return;
          }
          setTelemetry(update);
          if (update.level_dbfs !== undefined) setLevelDbfs(update.level_dbfs);
          if (update.peak_dbfs !== undefined) setPeakDbfs(update.peak_dbfs);
          if (update.noise_floor_dbfs !== undefined) setAmbientNoiseDbfs(update.noise_floor_dbfs);
          if (update.ambient_noise_dbfs !== undefined) setAmbientNoiseDbfs(update.ambient_noise_dbfs);
          if (update.effective_gain !== undefined) setEffectiveGain(update.effective_gain);
          if (update.speech_probability !== undefined) setSpeechProb(update.speech_probability);
          if (update.voice_detected !== undefined) setVoiceDetected(Boolean(update.voice_detected));
          if (Array.isArray(update.waveform)) setLiveWaveform(update.waveform);
          if (Array.isArray(update.spectrum)) setSpectrum(update.spectrum);
          if (update.status) setStatus(update.status);
          if (update.engine_running !== undefined) {
            const running = Boolean(update.engine_running);
            setEngineRunning(running);
          }
          if (update.monitor_requested !== undefined) {
            const requested = Boolean(update.monitor_requested);
            setMonitorRequested(requested);
            monitoringRef.current = requested;
          }
          if (update.device_reconnecting !== undefined) {
            const reconnecting = Boolean(update.device_reconnecting);
            if (reconnectingRef.current && !reconnecting && update.engine_running) {
              const name = update.resolved_device_name ?? update.configured_device_name ?? 'Audio device';
              setReconnectedMessage(`✓ ${name} RECONNECTED`);
              window.setTimeout(() => setReconnectedMessage(null), 3000);
            }
            reconnectingRef.current = reconnecting;
            setDeviceReconnecting(reconnecting);
          }
          if (update.engine_running && update.device_identity_match && update.resolved_device_id !== undefined) {
            setSettings(current => {
              if (String(current.device_id) === String(update.resolved_device_id)) return current;
              const synchronized = {
                ...current,
                device_id: update.resolved_device_id ?? current.device_id,
                device_name: update.resolved_device_name ?? current.device_name,
                selected_device_available: true,
              };
              void api.saveSettings(synchronized);
              return synchronized;
            });
          }
          if (update.communication_duration_seconds !== undefined) setDurationSec(update.communication_duration_seconds);
          if ('error_message' in update) setErrorMessage(update.error_message ?? null);
        } catch {
          // ignore malformed ws messages
        }
      };
      socket.onerror = () => {
        setErrorMessage('WebSocket monitoring connection failed');
      };
      socket.onclose = () => {
        if (wsRef.current === socket) wsRef.current = null;
        if (monitoringRef.current) window.setTimeout(connectMonitorSocket, 1000);
      };
      wsRef.current = socket;
    } catch {
      // WS connection fallback
    }
  }, []);

  // Uptime ticker
  useEffect(() => {
    const timer = setInterval(() => {
      setUptimeSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const formatUptime = (totalSeconds: number) => {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes
      .toString()
      .padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  const formatProfileAge = (seconds?: number | null) => {
    if (seconds === undefined || seconds === null) return '—';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
  };

  // Load initial settings and devices
  useEffect(() => {
    async function init() {
      const [loadedSettings, loadedDevices, loadedRecordings] = await Promise.all([
        api.getSettings(),
        api.getAudioDevices(),
        api.getRecordings(),
      ]);

      if (loadedSettings.source !== 'gnuradio') {
        const reconciled = reconcileSelectedDevice(loadedDevices, loadedSettings);
        Object.assign(loadedSettings, reconciled);
        if (reconciled.selected_device_available) await api.saveSettings(loadedSettings);
      }
      setSettings(loadedSettings);
      setDevices(loadedDevices);
      setRecordings(loadedRecordings);
      // Telemetry is authoritative for monitor intent, including a reconnect
      // already in progress when the page is opened or refreshed.
      connectMonitorSocket();
      if (loadedRecordings.length > 0) {
        setSelectedRecording(loadedRecordings[0]);
      }
    }
    init();
  }, [connectMonitorSocket]);

  // Sync settings updates to Audio Engine and API
  const handleUpdateSettings = useCallback(
    async (partial: Partial<AppSettings>) => {
      const updated: AppSettings = { ...settings, ...partial };
      setSettings(updated);
      await api.saveSettings(updated);
    },
    [settings]
  );

  // Start / Stop monitoring
  const toggleMonitoring = async () => {
    setErrorMessage(null);

    if (monitorRequested) {
      // Stop
      monitoringRef.current = false;
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      await api.stopMonitoring();
      setMonitorRequested(false);
      setEngineRunning(false);
      setDeviceReconnecting(false);
      setStatus('idle');
      setLevelDbfs(-90);
      setSpeechProb(0);
      setVoiceDetected(false);
      setDurationSec(0);
      setLiveWaveform(new Array(128).fill(0));
      setSpectrum(new Array(32).fill(0));
    } else {
      // Start
      try {
        if (settings.source !== 'gnuradio' && settings.device_id === null) {
          throw new Error('NO DEVICE: select an audio input before monitoring');
        }
        setStatus('opening');
        setMonitorRequested(true);
        monitoringRef.current = true;
        await api.startMonitoring(settings);
        connectMonitorSocket();
        setEngineRunning(true);
        setStatus('listening');
      } catch (error) {
        setMonitorRequested(false);
        monitoringRef.current = false;
        setErrorMessage(error instanceof Error ? error.message : 'Unable to start monitoring');
        setStatus('error');
      }
    }
  };

  // Run calibration
  const runCalibration = async () => {
    if (captureOpening) throw new Error('Calibration unavailable while the audio device is opening');
    const result = await api.calibrateNoise();
    localStorage.setItem(`audio_calibration:${settings.device_id ?? settings.device_name}`, JSON.stringify(result));
    return result;
  };

  const applyCalibrationThreshold = (recommendedMargin: number) => {
    // Calibration and the event gate now share the raw-level domain.
    handleUpdateSettings({ noise_margin_db: recommendedMargin });
  };

  const testInput = async () => {
    setIsTestingInput(true);
    setTestResult(null);
    try {
      const result = await api.testInput(settings.device_id, settings.source);
      setTestResult(result.working
        ? `Input working · Level ${result.level_dbfs.toFixed(1)} dBFS · Peak ${result.peak_dbfs.toFixed(1)} dBFS`
        : 'No audio data received');
    } catch (error) {
      setTestResult(error instanceof Error ? error.message : 'Unable to open device');
    } finally {
      setIsTestingInput(false);
    }
  };

  // State for manual device refresh
  const [isRefreshingDevices, setIsRefreshingDevices] = useState(false);

  const handleRefreshDevices = useCallback(async () => {
    setIsRefreshingDevices(true);
    try {
      const freshDevices = await api.getAudioDevices();
      setDevices(freshDevices);
      if (!(monitorRequested && deviceReconnecting)) {
        const reconciled = reconcileSelectedDevice(freshDevices, settings);
        setSettings(current => ({ ...current, ...reconciled }));
        if (reconciled.selected_device_available) void handleUpdateSettings(reconciled);
      }
    } catch {
      // ignore
    } finally {
      setIsRefreshingDevices(false);
    }
  }, [settings, handleUpdateSettings, monitorRequested, deviceReconnecting]);

  // Periodic polling for hotplugged USB audio devices when not actively monitoring
  useEffect(() => {
    if (monitorRequested) return;
    const timer = setInterval(() => {
      api.getAudioDevices().then((fresh) => {
        setDevices((prev) => {
            if (JSON.stringify(prev) !== JSON.stringify(fresh)) {
              return fresh;
            }
            return prev;
        });
        setSettings((current) => {
          const reconciled = { ...current, ...reconcileSelectedDevice(fresh, current) };
          if (JSON.stringify(reconciled) !== JSON.stringify(current)) void api.saveSettings(reconciled);
          return reconciled;
        });
      }).catch(() => {});
    }, 4000);
    return () => clearInterval(timer);
  }, [monitorRequested]);

  const retryMonitoring = async () => {
    if (!monitorRequested) await toggleMonitoring();
    else if (deviceReconnecting) await handleRefreshDevices();
  };

  const applyManualDeviceOverride = async (partial: Partial<AppSettings>) => {
    const resume = monitorRequested;
    setErrorMessage(null);
    try {
      if (resume) {
        monitoringRef.current = false;
        await api.stopMonitoring();
        setMonitorRequested(false);
        setEngineRunning(false);
        setDeviceReconnecting(false);
      }
      const updated = { ...settings, ...partial };
      setSettings(updated);
      await api.saveSettings(updated);
      if (resume) {
        setMonitorRequested(true);
        monitoringRef.current = true;
        setStatus('opening');
        await api.startMonitoring(updated);
        connectMonitorSocket();
        setEngineRunning(true);
        setStatus('listening');
      }
    } catch (error) {
      monitoringRef.current = false;
      setMonitorRequested(false);
      setEngineRunning(false);
      setDeviceReconnecting(false);
      setStatus('error');
      setErrorMessage(error instanceof Error ? error.message : 'Unable to start monitoring');
    }
  };

  const handleSourceChange = (source: AudioSourceType) => {
    if (source === 'gnuradio') {
      void applyManualDeviceOverride({ source });
      return;
    }

    const candidateDevices = devices.filter((device) => {
      if (source === 'usb') {
        const nameLower = (device.name || '').toLowerCase();
        return (
          device.type === 'usb' ||
          device.type === 'line' ||
          nameLower.includes('usb') ||
          nameLower.includes('codec') ||
          nameLower.includes('sound') ||
          nameLower.includes('audio') ||
          nameLower.includes('dac')
        );
      }
      return true;
    });

    const pool = candidateDevices.length > 0 ? candidateDevices : devices;
    const selectedStillVisible = pool.find(
      (device) => String(device.id) === String(settings.device_id)
    );
    const selectedDevice = selectedStillVisible ?? pool.find((device) => device.is_default)
      ?? pool[0];

    // Persist source and device together.
    void applyManualDeviceOverride({
      source,
      device_id: selectedDevice?.id ?? null,
      device_name: selectedDevice?.name,
    });
  };

  const handleDeleteRecording = async (id: string) => {
    await api.deleteRecording(id);
    setRecordings((prev) => prev.filter((r) => r.recording_id !== id));
    if (selectedRecording?.recording_id === id) {
      const remaining = recordings.filter((r) => r.recording_id !== id);
      setSelectedRecording(remaining.length > 0 ? remaining[0] : null);
    }
  };

  const handleDeleteRecordingsBatch = async (ids: string[]) => {
    const idSet = new Set(ids);
    await api.deleteRecordingsBatch(ids);
    setRecordings((prev) => prev.filter((r) => !idSet.has(r.recording_id)));
    if (selectedRecording && idSet.has(selectedRecording.recording_id)) {
      const remaining = recordings.filter((r) => !idSet.has(r.recording_id));
      setSelectedRecording(remaining.length > 0 ? remaining[0] : null);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--bg-page)] text-[var(--text-primary)] flex flex-col justify-between p-4 lg:p-8 font-mono select-none transition-colors duration-200">
      <div className="w-full max-w-7xl mx-auto flex-1 flex flex-col">
        
        {/* Header / Hardware Top Bar */}
        <header id="main-header" className="flex flex-wrap items-center justify-between border-b border-[#1A1B1F] pb-4 mb-6 gap-4">
          <div className="flex items-center gap-3">
            <div
              style={{
                backgroundColor: accentColor,
                boxShadow: `0 0 8px ${accentColor}`,
              }}
              className="w-2.5 h-2.5 rounded-full"
            />
            <h1 className="text-sm font-bold tracking-[0.2em] uppercase text-[#E0E0E0]">
              {t.appTitle}
            </h1>
            <span className="text-[10px] text-[#606060] border border-[#1A1B1F] px-2 py-0.5 rounded bg-[#111215]">
              {t.version}
            </span>
          </div>

          <div className="flex items-center gap-3 sm:gap-4 text-[10px] text-[#606060]">
            <div className="hidden sm:block">
              {t.uptime} <span className="text-[#A0A0A0]">{formatUptime(uptimeSeconds)}</span>
            </div>
            <div className="hidden md:block">
              {t.device} <span className="text-[#A0A0A0] uppercase">{settings.source}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span
                style={
                  engineDisplayState === 'active'
                    ? {
                        backgroundColor: accentColor,
                        boxShadow: `0 0 4px ${accentColor}`,
                      }
                    : undefined
                }
                className={`w-1.5 h-1.5 rounded-full ${engineDisplayState !== 'active' ? 'bg-[#404040]' : ''}`}
              />
              <span>{t.engine} {engineDisplayState === 'reconnecting' ? 'RECONNECTING'
                : engineDisplayState === 'active' ? t.engineActive
                : engineDisplayState === 'waiting' ? 'STARTING / WAITING' : t.engineReady}</span>
            </div>

            {/* Theme Toggle & Diagnostics Toolbar */}
            <div className="flex items-center gap-2">
              <button
                id="btn-troubleshoot-usb-header"
                type="button"
                onClick={() => setIsTroubleshootModalOpen(true)}
                className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] rounded bg-[#111215] hover:bg-[#1A1B1F] border border-amber-500/40 text-amber-400 hover:text-amber-300 font-bold transition-all cursor-pointer shadow-[0_0_6px_rgba(245,158,11,0.15)]"
                title="Vérifier les permissions Linux, /dev/bus/usb/ et le matériel audio"
              >
                <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
                <span className="hidden sm:inline">Dépanner USB</span>
              </button>

              {/* Dark / White Theme Toggle Switch */}
              <div id="theme-switch-header" className="flex items-center border border-[#2A2B2F] rounded bg-[#111215] p-0.5 text-[10px]">
                <button
                  id="theme-dark-btn"
                  type="button"
                  onClick={() => setTheme('kali-dark')}
                  style={
                    !isLight
                      ? {
                          backgroundColor: accentColor,
                          color: '#0A0B0D',
                        }
                      : undefined
                  }
                  className={`flex items-center gap-1 px-2 py-0.5 rounded font-bold transition-all ${
                    !isLight
                      ? 'shadow-sm'
                      : 'text-[#808080] hover:text-[#E0E0E0]'
                  }`}
                  title={t.themeDark}
                >
                  <Moon className="w-3 h-3" />
                  <span className="hidden sm:inline">{t.themeDark}</span>
                </button>
                <button
                  id="theme-light-btn"
                  type="button"
                  onClick={() => setTheme('white-terminal')}
                  style={
                    isLight
                      ? {
                          backgroundColor: accentColor,
                          color: '#FFFFFF',
                        }
                      : undefined
                  }
                  className={`flex items-center gap-1 px-2 py-0.5 rounded font-bold transition-all ${
                    isLight
                      ? 'shadow-sm'
                      : 'text-[#808080] hover:text-[#E0E0E0]'
                  }`}
                  title={t.themeLight}
                >
                  <Sun className="w-3 h-3" />
                  <span className="hidden sm:inline">{t.themeLight}</span>
                </button>
              </div>

              {/* Language Selector */}
              <div className="flex items-center border border-[#2A2B2F] rounded bg-[#111215] p-0.5 text-[10px]">
                <button
                  id="lang-en-btn"
                  type="button"
                  onClick={() => setLanguage('en')}
                  style={
                    language === 'en'
                      ? {
                          backgroundColor: accentColor,
                          color: isLight ? '#FFFFFF' : '#0A0B0D',
                        }
                      : undefined
                  }
                  className={`px-2 py-0.5 rounded font-bold transition-colors ${
                    language === 'en'
                      ? ''
                      : 'text-[#808080] hover:text-[#E0E0E0]'
                  }`}
                  title="Switch to English"
                >
                  EN
                </button>
                <button
                  id="lang-fr-btn"
                  type="button"
                  onClick={() => setLanguage('fr')}
                  style={
                    language === 'fr'
                      ? {
                          backgroundColor: accentColor,
                          color: isLight ? '#FFFFFF' : '#0A0B0D',
                        }
                      : undefined
                  }
                  className={`px-2 py-0.5 rounded font-bold transition-colors ${
                    language === 'fr'
                      ? ''
                      : 'text-[#808080] hover:text-[#E0E0E0]'
                  }`}
                  title="Passer en Français"
                >
                  FR
                </button>
              </div>
            </div>
          </div>
        </header>

        {/* Error notification banner */}
        {errorMessage && (
          <div id="error-banner" className="mb-6 p-3 bg-[#FF4444]/10 border border-[#FF4444]/40 rounded text-xs text-[#FF4444] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
            {(!monitorRequested || deviceReconnecting) && <button
              id="btn-retry-error"
              type="button"
              onClick={retryMonitoring}
              className="px-2.5 py-1 bg-[#FF4444]/20 hover:bg-[#FF4444]/30 text-white rounded text-[11px] flex items-center gap-1 transition-colors uppercase tracking-wider"
            >
              <RefreshCw className="w-3 h-3" />
              {t.retry}
            </button>}
          </div>
        )}
        {reconnectedMessage && (
          <div role="status" className="mb-6 p-3 bg-[#00FF66]/10 border border-[#00FF66]/40 rounded text-xs text-[#00FF66]">
            {reconnectedMessage}
          </div>
        )}

        {/* Main Hardware Grid */}
        <main className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8">
          
          {/* Left Column: Configuration & Controls (Col 4) */}
          <section className="lg:col-span-4 flex flex-col gap-6">
            
            {/* Input Source Block */}
            <div className="p-4 bg-[#111215] border border-[#1A1B1F] rounded-lg">
              <SourceSelector
                source={settings.source}
                deviceId={settings.device_id}
                devices={devices}
                disabled={engineRunning}
                isRefreshing={isRefreshingDevices}
                onRefreshDevices={handleRefreshDevices}
                connectionStatus={status}
                onOpenTroubleshoot={() => setIsTroubleshootModalOpen(true)}
                onSourceChange={handleSourceChange}
                onDeviceChange={(devId: string | number) => {
                  const dev = devices.find((d) => String(d.id) === String(devId));
                  void applyManualDeviceOverride({
                    device_id: Number(devId), device_name: dev?.name,
                    device_hostapi: dev?.hostapi,
                    device_max_input_channels: dev?.max_input_channels,
                    device_default_samplerate: dev?.default_samplerate,
                    device_alsa_card_id: dev?.alsa_card_id ?? undefined,
                    device_alsa_device: dev?.alsa_device ?? undefined,
                  });
                }}
              />
              {settings.source !== 'gnuradio' && (
                <div className="mt-3 space-y-2">
                  <button type="button" onClick={testInput}
                    disabled={isTestingInput || monitorRequested || deviceReconnecting}
                    className="w-full py-2 border border-[#2A2B2F] rounded text-[10px] uppercase text-[#00F0FF] disabled:opacity-50">
                    {isTestingInput ? 'Testing input (3s)…' : 'Test Input'}
                  </button>
                  {testResult && <p className="text-[10px] text-[#A0A0A0]" role="status">{testResult}</p>}
                  {telemetry && (
                    <details className="text-[10px] border border-[#202226] rounded p-2 text-[#A0A0A0]">
                      <summary className="cursor-pointer uppercase text-[#00F0FF]">Diagnostics / Advanced</summary>
                      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 mt-2">
                        <dt>Configured Device</dt><dd>{telemetry.configured_device_name ?? settings.device_name ?? '—'}</dd>
                        <dt>Resolved Device</dt><dd>{telemetry.resolved_device_name ?? '—'}</dd>
                        <dt>Configured ID</dt><dd>{telemetry.configured_device_id ?? settings.device_id ?? '—'}</dd>
                        <dt>Resolved ID</dt><dd>{telemetry.resolved_device_id ?? '—'}</dd>
                        <dt>Device Available</dt><dd>{telemetry.selected_device_available ? 'Yes' : 'No'}</dd>
                        <dt>Monitor Requested</dt><dd>{monitorRequested ? 'Yes' : 'No'}</dd>
                        <dt>Engine Running</dt><dd>{engineRunning ? 'Yes' : 'No'}</dd>
                        <dt>Reconnecting</dt><dd>{deviceReconnecting ? 'Yes' : 'No'}</dd>
                        <dt>Reconnect Attempt</dt><dd>{telemetry.reconnect_attempt ?? 0}</dd>
                        <dt>Reconnect Elapsed</dt><dd>{telemetry.reconnect_elapsed_seconds ?? 0}s</dd>
                        <dt>Capture Backend</dt><dd>{telemetry.capture_backend ?? telemetry.hostapi ?? '—'}</dd>
                        <dt>ALSA Device</dt><dd>{telemetry.alsa_device ?? '—'}</dd>
                        <dt>Native Rate</dt><dd>{telemetry.capture_sample_rate ?? '—'} Hz</dd>
                        <dt>Processing Rate</dt><dd>{telemetry.processing_sample_rate ?? 16000} Hz</dd>
                        <dt>Capture Channels</dt><dd>{telemetry.capture_channels ?? '—'}</dd>
                        <dt>Input Channel</dt><dd>{telemetry.input_channel ?? settings.input_channel ?? 'auto'}</dd>
                        <dt>Callbacks</dt><dd>{telemetry.callback_count ?? 0}</dd>
                        <dt>Frames</dt><dd>{telemetry.frames_received ?? 0}</dd>
                        <dt>Current RMS</dt><dd>{telemetry.level_dbfs?.toFixed(1)} dBFS</dd>
                        <dt>Peak</dt><dd>{telemetry.peak_dbfs?.toFixed(1) ?? '—'} dBFS</dd>
                        <dt>Last Frame</dt><dd>{telemetry.last_audio_frame_ms ?? '—'} ms</dd>
                        <dt>Ambient Profile</dt><dd>{telemetry.ambient_profile_loaded ? 'Cached' : 'Learning'}</dd>
                        <dt>Profile age</dt><dd>{formatProfileAge(telemetry.ambient_profile_age_seconds)}</dd>
                        <dt>Detection Profile</dt><dd>{telemetry.detection_profile ?? settings.detection_profile}</dd>
                        <dt>Effective VAD</dt><dd>{telemetry.effective_vad_start_threshold ?? '—'} / {telemetry.effective_vad_stop_threshold ?? '—'}</dd>
                        <dt>Effective SNR</dt><dd>{telemetry.effective_minimum_snr_db ?? '—'} dB</dd>
                      </dl>
                      <button type="button" className="mt-3 w-full py-1 border border-[#00F0FF]/40 text-[#00F0FF] uppercase"
                        disabled={captureOpening}
                        onClick={async () => {
                          try {
                            const update = await api.resetAmbientProfile();
                            setTelemetry(update);
                            if (update.status) setStatus(update.status);
                          } catch (error) {
                            setErrorMessage(error instanceof Error ? error.message : 'Ambient reset failed');
                          }
                        }}>
                        Recalibrate Ambient
                      </button>
                    </details>
                  )}
                </div>
              )}
            </div>

            {/* Detection Parameters Panel */}
            <div className="p-4 bg-[#111215] border border-[#1A1B1F] rounded-lg">
              <SettingsPanel
                settings={settings}
                disabled={captureOpening}
                ambientNoiseDbfs={ambientNoiseDbfs}
                effectiveGain={effectiveGain}
                onUpdateSettings={handleUpdateSettings}
                onOpenCalibration={() => setIsCalibModalOpen(true)}
              />
            </div>

            {/* Action Buttons */}
            <div className="space-y-3">
              <button
                id="btn-toggle-monitoring"
                type="button"
                onClick={toggleMonitoring}
                style={
                  !monitorRequested
                    ? ({
                        backgroundColor: accentColor,
                        color: '#0A0B0D',
                        '--accent-glow-color': `${accentColor}55`,
                        '--accent-glow-color-bright': `${accentColor}A6`,
                        '--accent-ring-color': `${accentColor}40`,
                        '--accent-ring-color-faint': `${accentColor}20`,
                      } as React.CSSProperties)
                    : undefined
                }
                className={`w-full py-3.5 px-4 font-mono font-bold text-xs uppercase tracking-[0.15em] rounded transition-all flex items-center justify-center gap-2 cursor-pointer ${
                  monitorRequested
                    ? 'bg-[#FF4444] hover:bg-[#FF2222] text-white shadow-[0_0_15px_rgba(255,68,68,0.4)]'
                    : 'hover:brightness-110 animate-surveillance-breathe'
                }`}
              >
                <Power className={`w-4 h-4 transition-transform duration-300 ${!monitorRequested ? 'group-hover:scale-110' : ''}`} />
                {monitorRequested ? t.terminateSurveillance : status === 'opening'
                  ? `Opening ${settings.device_name ?? 'audio device'}...` : t.startSurveillance}
              </button>

              <button
                id="btn-trigger-calibration-main"
                type="button"
                onClick={() => setIsCalibModalOpen(true)}
                disabled={captureOpening}
                className="w-full py-2.5 px-4 border border-[#2A2B2F] hover:border-[#00F0FF] text-[#A0A0A0] hover:text-[#00F0FF] bg-[#111215] font-mono text-[11px] uppercase tracking-wider rounded transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:pointer-events-none"
                style={{
                  borderColor: '#2A2B2F',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = accentColor;
                  e.currentTarget.style.color = accentColor;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = '#2A2B2F';
                  e.currentTarget.style.color = '#A0A0A0';
                }}
              >
                <Sparkles className="w-3.5 h-3.5" />
                {t.calibrateNoiseFloor}
              </button>
            </div>
          </section>

          {/* Right Column: Live Telemetry & Recordings History (Col 8) */}
          <section className="lg:col-span-8 flex flex-col gap-6">
            
            {/* Live Monitoring & Signal Visualization Panel */}
            <div className="p-5 bg-[#111215] border border-[#1A1B1F] rounded-lg flex flex-col gap-5">
              <div className="flex items-center justify-between border-b border-[#1A1B1F] pb-3">
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${isMonitoring ? 'bg-[#FF4444] animate-pulse shadow-[0_0_6px_#FF4444]' : 'bg-[#404040]'}`}></div>
                  <span className="text-xs uppercase tracking-wider text-[#A0A0A0] font-bold">
                    {t.liveTelemetry}
                  </span>
                </div>
                <StatusIndicator status={status} durationSec={durationSec} />
              </div>

              {/* Informative Sound Card & Live Acquisition Banner */}
              {deviceReconnecting ? (
                <div id="soundcard-reconnecting-banner" className="p-3 bg-[#FFB800]/10 border border-[#FFB800]/30 rounded text-xs text-[#FFB800]">
                  <div className="font-bold">⚠ {settings.device_name ?? 'AUDIO DEVICE'} DISCONNECTED</div>
                  <div>RECONNECTING… · Attempt {telemetry?.reconnect_attempt ?? 0} · {telemetry?.reconnect_elapsed_seconds ?? 0}s</div>
                  <div className="mt-1 text-[10px]">Waiting for the configured device; no fallback input will be selected.</div>
                </div>
              ) : !engineRunning ? (
                <div id="soundcard-standby-banner" className="p-3 bg-[#151619] border border-[#2A2B2F] rounded text-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5">
                  <div className="flex items-center gap-2 text-[#A0A0A0]">
                    <Activity className="w-4 h-4 text-[#00F0FF] shrink-0" />
                    <span>{t.soundCardInactiveNotice}</span>
                  </div>
                  <button
                    id="btn-quick-start-monitor"
                    type="button"
                    onClick={toggleMonitoring}
                    className="px-3 py-1 bg-[#00F0FF] hover:bg-[#00F0FF]/80 text-[#0A0B0D] font-bold rounded text-[11px] uppercase tracking-wider transition-all shadow-[0_0_10px_rgba(0,240,255,0.3)] shrink-0"
                  >
                    {t.startSurveillance}
                  </button>
                </div>
              ) : isMonitoring && levelDbfs <= -75 ? (
                <div id="soundcard-quiet-banner" className="p-3 bg-[#FFB800]/10 border border-[#FFB800]/30 rounded text-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-[#FFB800]">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>{t.soundCardQuietNotice}</span>
                  </div>
                  <button
                    id="btn-quick-boost-gain"
                    type="button"
                    onClick={() => {
                      const nextGain = Math.min(8.0, (settings.input_gain ?? 1.0) * 2.0);
                      handleUpdateSettings({ input_gain: nextGain });
                    }}
                    className="px-2.5 py-1 bg-[#FFB800]/20 hover:bg-[#FFB800]/30 text-[#FFB800] border border-[#FFB800]/40 rounded text-[10px] uppercase font-mono tracking-wider transition-colors shrink-0"
                  >
                    +6dB Gain ({(settings.input_gain ?? 1.0) * 2.0}x)
                  </button>
                </div>
              ) : null}

              {/* Hardware LED Meter */}
              <AudioMeter
                levelDbfs={levelDbfs}
                thresholdDbfs={telemetry?.event_start_threshold_dbfs ?? -38}
                speechProb={speechProb}
                vadThreshold={settings.vad_start_threshold ?? .50}
                voiceDetected={voiceDetected}
                isMonitoring={isMonitoring}
                ambientNoiseDbfs={ambientNoiseDbfs}
                liveWaveform={liveWaveform}
                spectrum={spectrum}
                analyserNode={null}
                sampleRate={settings.sample_rate}
              />

              {isMonitoring && (() => {
                const vadOn = (telemetry?.vad_smoothed_probability ?? 0) >=
                  (telemetry?.effective_vad_start_threshold ?? .50);
                const badges = [
                  ['EVENT', Boolean(telemetry?.event_active)],
                  ['VOICE', Boolean(telemetry?.effective_speech_confirmed)],
                  ['REC', Boolean(telemetry?.recording)],
                ] as const;
                return <div className="grid grid-cols-3 gap-2" aria-label="Voice decision indicators">
                  {badges.map(([label, active]) => <div key={label} className={`p-2 text-center border rounded text-[10px] font-bold ${active ? 'border-[#00FF88] text-[#00FF88] bg-[#00FF88]/10' : 'border-[#303238] text-[#707070]'}`}>
                    {label} {active ? 'ON' : 'OFF'}
                  </div>)}
                </div>;
              })()}

              {isMonitoring && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]" aria-label="Permanent audio levels">
                  {[
                    ['Current / RMS', `${levelDbfs.toFixed(1)} dBFS`],
                    ['Peak', `${peakDbfs.toFixed(1)} dBFS`],
                    ['Noise floor', `${ambientNoiseDbfs.toFixed(1)} dBFS`],
                    ['Dynamic threshold', `${(telemetry?.dynamic_threshold_dbfs ?? -90).toFixed(1)} dBFS`],
                    ['SNR', `${(telemetry?.snr_db ?? 0).toFixed(1)} dB`],
                    ['Speech band', `${(telemetry?.speech_band_snr_db ?? 0).toFixed(1)} dB`],
                    ['Speech', speechProb.toFixed(2)],
                    ['Event', telemetry?.ambient_learning ? 'LEARNING AMBIENT' : ({
                      speech: 'VOICE',
                      intra_phrase_pause: 'PAUSE',
                      transmission_hangover: 'WAITING END OF TRANSMISSION',
                    }[telemetry?.transmission_state ?? ''] ?? (
                      telemetry?.session_state === 'waiting_reply' ? 'WAITING FOR REPLY' :
                      telemetry?.session_state === 'saving_communication' ? 'SAVING COMMUNICATION' :
                      telemetry?.event_active ? 'EVENT ACTIVE' : voiceDetected ? 'VOICE' : status.replaceAll('_', ' ').toUpperCase()
                    ))],
                  ].map(([label, value]) => (
                    <div key={label} className="p-2 bg-[#0A0B0D] border border-[#1A1B1F] rounded">
                      <div className="text-[#606060] uppercase">{label}</div><div className="text-[#E0E0E0] mt-1">{value}</div>
                    </div>
                  ))}
                </div>
              )}

              {isMonitoring && (
                <details className="p-3 bg-[#0A0B0D] border border-[#1A1B1F] rounded text-[10px]">
                  <summary className="cursor-pointer uppercase text-[#A0A0A0]">Voice Pipeline / Diagnostics</summary>
                  <div className="grid grid-cols-2 gap-2 mt-3 text-[#707070]">
                    <span>Input</span><span className="text-[#D0D0D0] uppercase">{telemetry?.input_signal_quality ?? '—'}</span>
                    <span>Selected channel</span><span className="text-[#D0D0D0] uppercase">{settings.input_channel === 'auto' ? `AUTO → CH${(telemetry?.selected_channel_index ?? 0) + 1}` : telemetry?.selected_channel?.replace('_', ' ') ?? settings.input_channel}</span>
                    <span>CH1 / CH2 RMS</span><span className="text-[#D0D0D0]">{telemetry?.channel_1_rms_dbfs?.toFixed(1) ?? '—'} / {telemetry?.channel_2_rms_dbfs?.toFixed(1) ?? '—'} dBFS</span>
                    <span>Raw / processed level</span><span className="text-[#D0D0D0]">{telemetry?.raw_level_dbfs?.toFixed(1) ?? '—'} / {telemetry?.processed_level_dbfs?.toFixed(1) ?? '—'} dBFS</span>
                    <span>Raw ambient ready</span><span className="text-[#D0D0D0]">{telemetry?.raw_ambient_ready ? 'YES' : 'LEARNING'}</span>
                    <span>Raw ambient / event delta</span><span className="text-[#D0D0D0]">{telemetry?.raw_ambient_ready ? `${telemetry.raw_noise_floor_dbfs?.toFixed(1)} dBFS / +${telemetry.event_delta_db?.toFixed(1)} dB` : 'LEARNING / —'}</span>
                    <span>Event active</span><span className="text-[#D0D0D0]">{telemetry?.event_active ? 'YES' : 'NO'}</span>
                    <span>Detection gain</span><span className="text-[#D0D0D0]">{telemetry?.effective_gain?.toFixed(2) ?? '—'}×</span>
                    <span>Device</span><span className="text-[#D0D0D0]">{telemetry?.device_name ?? settings.device_name ?? 'Default input'}</span>
                    <span>Backend state</span><span className="text-[#D0D0D0]">{telemetry?.device_connected ? 'Connected' : 'No audio input'}</span>
                    <span>Signal state</span><span className="text-[#D0D0D0] uppercase">{telemetry?.signal_state?.replaceAll('_', ' ') ?? 'Starting'}</span>
                    <span>Capture / processing</span><span className="text-[#D0D0D0]">{telemetry?.capture_sample_rate ?? '—'} / {telemetry?.processing_sample_rate ?? 16000} Hz</span>
                    <span>Channels</span><span className="text-[#D0D0D0]">{telemetry?.channels ?? 1}</span>
                    <span>Frames received</span><span className="text-[#D0D0D0]">{telemetry?.frames_received?.toLocaleString() ?? 0}</span>
                    <span>Last audio frame</span><span className="text-[#D0D0D0]">{telemetry?.last_audio_frame_ms == null ? 'Never' : `${telemetry.last_audio_frame_ms} ms ago`}</span>
                    <span>VAD Engine</span><span className="text-[#D0D0D0]">{telemetry?.vad_backend === 'silero_onnx' ? 'Silero ONNX' : telemetry?.vad_backend === 'acoustic_fallback' ? 'Acoustic fallback — ⚠ degraded detection' : telemetry?.vad_backend?.replaceAll('_', ' ') ?? 'Starting'}</span>
                    <span>VAD raw / smoothed</span><span className="text-[#D0D0D0]">{telemetry?.vad_raw_probability?.toFixed(2) ?? '—'} / {telemetry?.vad_smoothed_probability?.toFixed(2) ?? speechProb.toFixed(2)}</span>
                    <span>VAD start / continue</span><span className="text-[#D0D0D0]">{telemetry?.effective_vad_start_threshold ?? '—'} / {telemetry?.vad_continue_threshold ?? '—'}</span>
                    <span>Speech candidate</span><span className="text-[#D0D0D0]">{telemetry?.speech_candidate ? 'YES' : 'NO'}</span>
                    <span>Speech confirmed</span><span className="text-[#D0D0D0]">{telemetry?.speech_confirmed ? 'YES' : 'NO'}</span>
                    <span>Effective speech</span><span className="text-[#D0D0D0]">{telemetry?.effective_speech_confirmed ? 'YES' : 'NO'}</span>
                    <span>Recorder voice / active</span><span className="text-[#D0D0D0]">{telemetry?.voice_detected ? 'YES' : 'NO'} / {telemetry?.recording ? 'ACTIVE' : 'IDLE'}</span>
                    <span>Speech reason</span><span className="text-[#D0D0D0]">{telemetry?.speech_reject_reason?.replaceAll('_', ' ') ?? '—'}</span>
                    <span className="text-[#FFB800]">Diagnosis</span><span className="text-[#FFB800] uppercase">{telemetry?.voice_pipeline_diagnosis?.replaceAll('_', ' ') ?? '—'}</span>
                    <span>Hint</span><span className="text-[#D0D0D0]">{telemetry?.voice_pipeline_hint ?? '—'}</span>
                    {telemetry?.vad_model_loaded === false && <><span className="text-[#FFB800]">VAD warning</span><span className="text-[#FFB800]">⚠ Silero unavailable</span></>}
                  </div>
                </details>
              )}

              {/* 4-Stat Telemetry Hardware Block including Dedicated Signal-to-Noise Ratio (SNR) */}
              {(() => {
                const snrDb = (isMonitoring && ambientNoiseDbfs !== undefined && levelDbfs > ambientNoiseDbfs)
                  ? Math.max(0, levelDbfs - ambientNoiseDbfs)
                  : 0;

                let snrQualityText = t.snrPoor;
                let snrColor = '#80828A';
                let snrBadgeBg = 'bg-[#15161A] border-[#252830] text-[#70727A]';
                let snrBarPercent = 0;

                if (isMonitoring && ambientNoiseDbfs !== undefined) {
                  snrBarPercent = Math.min(100, Math.max(0, (snrDb / 30) * 100));
                  if (snrDb >= 20) {
                    snrQualityText = t.snrExcellent;
                    snrColor = '#00F0FF';
                    snrBadgeBg = 'bg-[#00F0FF]/15 border-[#00F0FF]/40 text-[#00F0FF] shadow-[0_0_8px_rgba(0,240,255,0.25)]';
                  } else if (snrDb >= 12) {
                    snrQualityText = t.snrGood;
                    snrColor = '#00FF66';
                    snrBadgeBg = 'bg-[#00FF66]/15 border-[#00FF66]/40 text-[#00FF66] shadow-[0_0_8px_rgba(0,255,102,0.2)]';
                  } else if (snrDb >= 6) {
                    snrQualityText = t.snrFair;
                    snrColor = '#FFB800';
                    snrBadgeBg = 'bg-[#FFB800]/15 border-[#FFB800]/40 text-[#FFB800]';
                  } else {
                    snrQualityText = t.snrPoor;
                    snrColor = '#FF4444';
                    snrBadgeBg = 'bg-[#FF4444]/10 border-[#FF4444]/30 text-[#FF4444]';
                  }
                }

                return (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-1">
                    {/* Dedicated Signal-to-Noise Ratio (SNR) Telemetry Card */}
                    <div id="snr-telemetry-card" className="p-3 bg-[#0A0B0D] border border-[#1A1B1F] rounded flex flex-col justify-between space-y-2 relative overflow-hidden group hover:border-[#2A2B35] transition-colors">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5 text-[9px] text-[#606060] uppercase tracking-wider font-semibold">
                          <Gauge className="w-3 h-3 text-[#00F0FF]" />
                          <span>{t.snrMetric}</span>
                        </div>
                        <span className={`text-[8px] font-mono px-1.5 py-0.5 rounded border uppercase font-bold tracking-wider ${snrBadgeBg}`}>
                          {isMonitoring ? snrQualityText : t.systemStandby}
                        </span>
                      </div>

                      <div className="flex items-baseline justify-between">
                        <div style={{ color: isMonitoring ? snrColor : '#50525A' }} className="text-xl font-mono font-bold tracking-tight">
                          {isMonitoring ? `+${snrDb.toFixed(1)}` : '--.-'} <span className="text-xs font-normal text-[#70727A]">dB</span>
                        </div>
                        <div className="text-[9px] font-mono text-[#50525A] text-right" title="Signal dBFS minus Calibrated Ambient Noise Floor">
                          {isMonitoring && ambientNoiseDbfs !== undefined ? `Δ ${levelDbfs.toFixed(0)} - (${ambientNoiseDbfs.toFixed(0)})` : 'Δ --'}
                        </div>
                      </div>

                      {/* SNR Visual Scale Bar (0 to 30 dB dynamic range) */}
                      <div className="space-y-1">
                        <div className="w-full bg-[#141518] h-1.5 rounded-full overflow-hidden border border-[#202228] flex">
                          <div
                            style={{
                              width: `${isMonitoring ? snrBarPercent : 0}%`,
                              backgroundColor: snrColor,
                              boxShadow: isMonitoring ? `0 0 6px ${snrColor}` : 'none',
                            }}
                            className="h-full transition-all duration-150 rounded-full"
                          />
                        </div>
                        <div className="flex justify-between text-[7.5px] font-mono text-[#40424A]">
                          <span>0dB</span>
                          <span>+12dB</span>
                          <span>+24dB+</span>
                        </div>
                      </div>
                    </div>

                    {/* VAD Confidence Metric */}
                    <div className="p-3 bg-[#0A0B0D] border border-[#1A1B1F] rounded flex flex-col justify-between space-y-2">
                      <div className="text-[9px] text-[#606060] uppercase tracking-wider">{t.vadConfidenceMetric}</div>
                      <div className="flex items-baseline justify-between">
                        <div style={{ color: accentColor }} className="text-xl font-mono font-bold">
                          {isMonitoring ? speechProb.toFixed(2) : '--'}
                        </div>
                        <div className="text-[9px] font-mono text-[#50525A]">
                          / {(settings.vad_start_threshold ?? .50).toFixed(2)}
                        </div>
                      </div>
                      <div className="w-full bg-[#141518] h-1.5 rounded-full overflow-hidden border border-[#202228]">
                        <div
                          style={{
                            width: `${isMonitoring ? Math.min(100, Math.round(speechProb * 100)) : 0}%`,
                            backgroundColor: accentColor,
                          }}
                          className="h-full transition-all duration-100 rounded-full"
                        />
                      </div>
                    </div>

                    {/* Recording Duration Metric */}
                    <div className="p-3 bg-[#0A0B0D] border border-[#1A1B1F] rounded flex flex-col justify-between space-y-2">
                      <div className="text-[9px] text-[#606060] uppercase tracking-wider">{t.recDuration}</div>
                      <div className="text-xl font-mono font-bold text-[#E0E0E0]">
                        {durationSec > 0 ? `${durationSec.toFixed(1)}s` : '00:00'}
                      </div>
                      <div className="text-[9px] font-mono text-[#50525A]">
                        {status === 'RECORDING' ? t.statusRecording : t.statusIdle}
                      </div>
                    </div>

                    {/* Format Codec Metric */}
                    <div className="p-3 bg-[#0A0B0D] border border-[#1A1B1F] rounded flex flex-col justify-between space-y-2">
                      <div className="text-[9px] text-[#606060] uppercase tracking-wider">{t.formatCodec}</div>
                      <div className="text-xl font-mono font-bold text-[#A0A0A0] truncate">
                        16k PCM
                      </div>
                      <div className="text-[9px] font-mono text-[#50525A]">
                        Float32 / Mono
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Active / Last Recording Player */}
            {selectedRecording && (
              <div id="last-recording-section" className="space-y-2">
                <div className="text-[10px] text-[#606060] uppercase tracking-wider font-bold">
                  {t.activePlayback}
                </div>
                <AudioPlayer
                  recording={selectedRecording}
                  onDelete={handleDeleteRecording}
                  onOpenMeta={(meta) => setMetaModalRecording(meta)}
                />
              </div>
            )}

            {/* Session Recordings History Table */}
            <div className="flex-1">
              <RecordingsHistory
                recordings={recordings}
                selectedId={selectedRecording?.recording_id || null}
                onSelect={(rec) => setSelectedRecording(rec)}
                onDelete={handleDeleteRecording}
                onDeleteBatch={handleDeleteRecordingsBatch}
                onOpenMeta={(meta) => setMetaModalRecording(meta)}
              />
            </div>
          </section>
        </main>

        {/* Footer / Hardware Status Bar */}
        <footer className="mt-8 pt-4 border-t border-[#1A1B1F] flex flex-wrap justify-between items-center text-[10px] text-[#606060] gap-4 font-mono">
          <div className="flex items-center gap-6">
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#00FF44] shadow-[0_0_4px_#00FF44]"></span>
              {t.backendConnected}
            </span>
            <span className="flex items-center gap-1.5">
              <span
                style={{
                  backgroundColor: accentColor,
                  boxShadow: `0 0 4px ${accentColor}`,
                }}
                className="w-1.5 h-1.5 rounded-full"
              />
              {t.sileroVadReady}
            </span>
          </div>

          <div>
            {t.targetFifo}: <span className="text-[#A0A0A0]">/tmp/hackrf_audio.f32</span> | {t.port}: <span className="text-[#A0A0A0]">localhost:8000</span>
          </div>
        </footer>
      </div>

      {/* Noise Floor Calibration Modal */}
      <CalibrationModal
        isOpen={isCalibModalOpen}
        onClose={() => setIsCalibModalOpen(false)}
        onRunCalibration={runCalibration}
        onApplyThreshold={applyCalibrationThreshold}
      />

      {/* Metadata JSON Modal */}
      <MetadataModal
        recording={metaModalRecording}
        onClose={() => setMetaModalRecording(null)}
      />

      {/* USB / Kali Linux Hardware Troubleshooting Modal */}
      <TroubleshootUsbModal
        isOpen={isTroubleshootModalOpen}
        onClose={() => setIsTroubleshootModalOpen(false)}
        onRefreshDevices={handleRefreshDevices}
      />
    </div>
  );
}
