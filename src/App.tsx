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
import { AudioProcessorEngine } from './services/audioProcessor';
import { StatusIndicator } from './components/StatusIndicator';
import { AudioMeter } from './components/AudioMeter';
import { SourceSelector } from './components/SourceSelector';
import { SettingsPanel } from './components/SettingsPanel';
import { AudioPlayer } from './components/AudioPlayer';
import { RecordingsHistory } from './components/RecordingsHistory';
import { CalibrationModal } from './components/CalibrationModal';
import { MetadataModal } from './components/MetadataModal';
import { Power, AlertTriangle, RefreshCw, Sparkles, Globe, Activity, Gauge, Sun, Moon } from 'lucide-react';
import { useLanguage } from './i18n/LanguageContext';
import { useTheme } from './theme/ThemeContext';

export default function App() {
  const { language, setLanguage, t } = useLanguage();
  const { theme, setTheme, isLight, currentThemeOption } = useTheme();
  const accentColor = currentThemeOption.primaryColor;

  // Application State
  const [settings, setSettings] = useState<AppSettings>({
    source: 'microphone',
    device_id: 'default-mic',
    sample_rate: 16000,
    trigger_mode: 'db_vad',
    threshold_dbfs: -38,
    vad_threshold: 0.6,
    preroll_seconds: 1.0,
    silence_seconds: 2.0,
    frequency_hz: 145000000,
    modulation: 'NFM',
    station_id: 'ST001',
    fifo_path: '/tmp/hackrf_audio.f32',
  });

  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [status, setStatus] = useState<EngineStatus>('idle');
  const [durationSec, setDurationSec] = useState(0);
  const [levelDbfs, setLevelDbfs] = useState(-90);
  const [speechProb, setSpeechProb] = useState(0);
  const [voiceDetected, setVoiceDetected] = useState(false);
  const [ambientNoiseDbfs, setAmbientNoiseDbfs] = useState<number>(-60);
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

  // Dynamic Browser Tab Title Recording Indicator (Pulsing Red)
  useEffect(() => {
    const isRecordingNow = status === 'recording' || status === 'voice_detected';
    
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
  const engineRef = useRef<AudioProcessorEngine | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const connectMonitorSocket = useCallback(() => {
    wsRef.current?.close();
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${window.location.hostname}:8000/ws/monitor`);
    socket.onmessage = (event) => {
      const update = JSON.parse(event.data) as MonitorUpdate;
      if (update.event === 'recording_saved') return;
      setTelemetry(update);
      setLevelDbfs(update.level_dbfs ?? -100);
      setPeakDbfs(update.peak_dbfs ?? update.level_dbfs ?? -100);
      setAmbientNoiseDbfs(update.noise_floor_dbfs ?? -100);
      setSpeechProb(update.speech_probability ?? 0);
      setVoiceDetected(Boolean(update.voice_detected));
      setStatus(update.status ?? 'listening');
      setErrorMessage(update.error_message || null);
    };
    socket.onerror = () => setErrorMessage('Monitoring WebSocket disconnected');
    wsRef.current = socket;
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

  // Load initial settings and devices
  useEffect(() => {
    async function init() {
      const [loadedSettings, loadedDevices, loadedRecordings] = await Promise.all([
        api.getSettings(),
        api.getAudioDevices(),
        api.getRecordings(),
      ]);

      setSettings(loadedSettings);
      setDevices(loadedDevices);
      setRecordings(loadedRecordings);
      if (loadedRecordings.length > 0) {
        setSelectedRecording(loadedRecordings[0]);
      }
    }
    init();
  }, []);

  // Sync settings updates to Audio Engine and API
  const handleUpdateSettings = useCallback(
    async (partial: Partial<AppSettings>) => {
      const updated: AppSettings = { ...settings, ...partial };
      setSettings(updated);
      await api.saveSettings(updated);
      if (engineRef.current) {
        engineRef.current.updateSettings(updated);
      }
    },
    [settings]
  );

  // Handle incoming recording completion
  const handleRecordingComplete = useCallback(
    async (meta: RecordingMeta, blob: Blob) => {
      const savedMeta = await api.saveRecording(meta, blob);
      setRecordings((prev) => [savedMeta, ...prev.filter((r) => r.recording_id !== savedMeta.recording_id)]);
      setSelectedRecording(savedMeta);
    },
    []
  );

  // Start / Stop monitoring
  const toggleMonitoring = async () => {
    setErrorMessage(null);

    if (isMonitoring) {
      // Stop
      if (engineRef.current) {
        engineRef.current.stop();
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      await api.stopMonitoring();
      setIsMonitoring(false);
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
        await api.startMonitoring(settings);
        connectMonitorSocket();
        // Refresh available audio device list now that microphone permission was granted
        api.getAudioDevices().then((devs) => setDevices(devs)).catch(() => {});
        setIsMonitoring(true);
        setStatus('listening');
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : 'Unable to start monitoring');
        setStatus('error');
      }
    }
  };

  // Run calibration
  const runCalibration = async () => {
    const result = await api.calibrateNoise();
    localStorage.setItem(`audio_calibration:${settings.device_id ?? settings.device_name}`, JSON.stringify(result));
    return result;
  };

  const applyCalibrationThreshold = (recommended: number) => {
    handleUpdateSettings({ threshold_dbfs: recommended });
  };

  const testInput = async () => {
    setIsTestingInput(true);
    setTestResult(null);
    try {
      const result = await api.testInput(settings.device_id);
      setTestResult(result.working
        ? `Input working · Level ${result.level_dbfs.toFixed(1)} dBFS · Peak ${result.peak_dbfs.toFixed(1)} dBFS`
        : 'No audio data received');
    } catch (error) {
      setTestResult(error instanceof Error ? error.message : 'Unable to open device');
    } finally {
      setIsTestingInput(false);
    }
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
                  isMonitoring
                    ? {
                        backgroundColor: accentColor,
                        boxShadow: `0 0 4px ${accentColor}`,
                      }
                    : undefined
                }
                className={`w-1.5 h-1.5 rounded-full ${!isMonitoring ? 'bg-[#404040]' : ''}`}
              />
              <span>{t.engine} {isMonitoring ? t.engineActive : t.engineReady}</span>
            </div>

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
        </header>

        {/* Error notification banner */}
        {errorMessage && (
          <div id="error-banner" className="mb-6 p-3 bg-[#FF4444]/10 border border-[#FF4444]/40 rounded text-xs text-[#FF4444] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
            <button
              id="btn-retry-error"
              type="button"
              onClick={toggleMonitoring}
              className="px-2.5 py-1 bg-[#FF4444]/20 hover:bg-[#FF4444]/30 text-white rounded text-[11px] flex items-center gap-1 transition-colors uppercase tracking-wider"
            >
              <RefreshCw className="w-3 h-3" />
              {t.retry}
            </button>
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
                disabled={isMonitoring}
                onSourceChange={(src: AudioSourceType) => handleUpdateSettings({ source: src })}
                onDeviceChange={(devId: string | number) => {
                  const dev = devices.find((d) => String(d.id) === String(devId));
                  handleUpdateSettings({ device_id: devId, device_name: dev?.name });
                }}
              />
              {settings.source !== 'gnuradio' && (
                <div className="mt-3 space-y-2">
                  <button type="button" onClick={testInput} disabled={isTestingInput || isMonitoring}
                    className="w-full py-2 border border-[#2A2B2F] rounded text-[10px] uppercase text-[#00F0FF] disabled:opacity-50">
                    {isTestingInput ? 'Testing input (3s)…' : 'Test Input'}
                  </button>
                  {testResult && <p className="text-[10px] text-[#A0A0A0]" role="status">{testResult}</p>}
                </div>
              )}
            </div>

            {/* Detection Parameters Panel */}
            <div className="p-4 bg-[#111215] border border-[#1A1B1F] rounded-lg">
              <SettingsPanel
                settings={settings}
                disabled={isMonitoring}
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
                  !isMonitoring
                    ? {
                        backgroundColor: accentColor,
                        color: '#0A0B0D',
                        boxShadow: `0 0 15px ${accentColor}59`,
                      }
                    : undefined
                }
                className={`w-full py-3.5 px-4 font-mono font-bold text-xs uppercase tracking-[0.15em] rounded transition-all flex items-center justify-center gap-2 ${
                  isMonitoring
                    ? 'bg-[#FF4444] hover:bg-[#FF2222] text-white shadow-[0_0_15px_rgba(255,68,68,0.4)]'
                    : 'hover:brightness-110'
                }`}
              >
                <Power className="w-4 h-4" />
                {isMonitoring ? t.terminateSurveillance : t.startSurveillance}
              </button>

              <button
                id="btn-trigger-calibration-main"
                type="button"
                onClick={() => setIsCalibModalOpen(true)}
                className="w-full py-2.5 px-4 border border-[#2A2B2F] hover:border-[#00F0FF] text-[#A0A0A0] hover:text-[#00F0FF] bg-[#111215] font-mono text-[11px] uppercase tracking-wider rounded transition-colors flex items-center justify-center gap-2"
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
              {!isMonitoring ? (
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
                thresholdDbfs={settings.threshold_dbfs}
                speechProb={speechProb}
                vadThreshold={settings.vad_threshold}
                voiceDetected={voiceDetected}
                isMonitoring={isMonitoring}
                ambientNoiseDbfs={ambientNoiseDbfs}
                liveWaveform={liveWaveform}
                spectrum={spectrum}
              />

              {isMonitoring && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]" aria-label="Permanent audio levels">
                  {[
                    ['Current / RMS', `${levelDbfs.toFixed(1)} dBFS`],
                    ['Peak', `${peakDbfs.toFixed(1)} dBFS`],
                    ['Noise floor', `${ambientNoiseDbfs.toFixed(1)} dBFS`],
                    ['Trigger', `${settings.threshold_dbfs.toFixed(1)} dBFS`],
                  ].map(([label, value]) => (
                    <div key={label} className="p-2 bg-[#0A0B0D] border border-[#1A1B1F] rounded">
                      <div className="text-[#606060] uppercase">{label}</div><div className="text-[#E0E0E0] mt-1">{value}</div>
                    </div>
                  ))}
                </div>
              )}

              {isMonitoring && (
                <details className="p-3 bg-[#0A0B0D] border border-[#1A1B1F] rounded text-[10px]">
                  <summary className="cursor-pointer uppercase text-[#A0A0A0]">Diagnostics / Advanced</summary>
                  <div className="grid grid-cols-2 gap-2 mt-3 text-[#707070]">
                    <span>Device</span><span className="text-[#D0D0D0]">{telemetry?.device_name ?? settings.device_name ?? 'Default input'}</span>
                    <span>Backend state</span><span className="text-[#D0D0D0]">{telemetry?.device_connected ? 'Connected' : 'No audio input'}</span>
                    <span>Signal state</span><span className="text-[#D0D0D0] uppercase">{telemetry?.signal_state?.replaceAll('_', ' ') ?? 'Starting'}</span>
                    <span>Capture / processing</span><span className="text-[#D0D0D0]">{telemetry?.capture_sample_rate ?? '—'} / {telemetry?.processing_sample_rate ?? 16000} Hz</span>
                    <span>Channels</span><span className="text-[#D0D0D0]">{telemetry?.channels ?? 1}</span>
                    <span>Frames received</span><span className="text-[#D0D0D0]">{telemetry?.frames_received?.toLocaleString() ?? 0}</span>
                    <span>Last audio frame</span><span className="text-[#D0D0D0]">{telemetry?.last_audio_frame_ms == null ? 'Never' : `${telemetry.last_audio_frame_ms} ms ago`}</span>
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
                          / {settings.vad_threshold.toFixed(2)}
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
    </div>
  );
}
