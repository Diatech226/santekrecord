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
import { Power, AlertTriangle, RefreshCw, Sparkles, Globe, Palette } from 'lucide-react';
import { useLanguage } from './i18n/LanguageContext';
import { useTheme } from './theme/ThemeContext';

export default function App() {
  const { language, setLanguage, t } = useLanguage();
  const { theme, setTheme, currentThemeOption, themeOptions } = useTheme();
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
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [uptimeSeconds, setUptimeSeconds] = useState(0);

  // Recordings
  const [recordings, setRecordings] = useState<RecordingMeta[]>([]);
  const [selectedRecording, setSelectedRecording] = useState<RecordingMeta | null>(null);
  const [metaModalRecording, setMetaModalRecording] = useState<RecordingMeta | null>(null);
  const [isCalibModalOpen, setIsCalibModalOpen] = useState(false);

  // Audio Engine Ref
  const engineRef = useRef<AudioProcessorEngine | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

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
    } else {
      // Start
      const engine = new AudioProcessorEngine(settings);
      engineRef.current = engine;

      engine.setCallbacks(
        (update: MonitorUpdate) => {
          setLevelDbfs(update.level_dbfs);
          setSpeechProb(update.speech_probability);
          setVoiceDetected(update.voice_detected);
          setStatus(update.status);
          if (update.current_duration_sec !== undefined) {
            setDurationSec(update.current_duration_sec);
          }
        },
        handleRecordingComplete,
        (err) => {
          setErrorMessage(err);
          setStatus('error');
          setIsMonitoring(false);
        }
      );

      const ok = await engine.start();
      if (ok) {
        await api.startMonitoring(settings);
        setIsMonitoring(true);
        setStatus('listening');
      }
    }
  };

  // Run calibration
  const runCalibration = async () => {
    if (!engineRef.current || !isMonitoring) {
      const tempEngine = new AudioProcessorEngine(settings);
      await tempEngine.start();
      const res = await tempEngine.runCalibration(5);
      tempEngine.stop();
      return res;
    }
    return await engineRef.current.runCalibration(5);
  };

  const applyCalibrationThreshold = (recommended: number) => {
    handleUpdateSettings({ threshold_dbfs: recommended });
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
    <div className="min-h-screen bg-[#0A0B0D] text-[#E0E0E0] flex flex-col justify-between p-4 lg:p-8 font-mono select-none">
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

          <div className="flex items-center gap-4 sm:gap-6 text-[10px] text-[#606060]">
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

            {/* Language Selector */}
            <div className="flex items-center border border-[#2A2B2F] rounded bg-[#111215] p-0.5 text-[10px] ml-1">
              <button
                id="lang-en-btn"
                type="button"
                onClick={() => setLanguage('en')}
                style={
                  language === 'en'
                    ? {
                        backgroundColor: accentColor,
                        color: '#0A0B0D',
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
                        color: '#0A0B0D',
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

              {/* Hardware LED Meter */}
              <AudioMeter
                levelDbfs={levelDbfs}
                thresholdDbfs={settings.threshold_dbfs}
                speechProb={speechProb}
                vadThreshold={settings.vad_threshold}
                voiceDetected={voiceDetected}
                isMonitoring={isMonitoring}
              />

              {/* 3-Stat Telemetry Hardware Block */}
              <div className="grid grid-cols-3 gap-3 pt-1">
                <div className="p-3 bg-[#0A0B0D] border border-[#1A1B1F] rounded">
                  <div className="text-[9px] text-[#606060] uppercase tracking-wider mb-1">{t.vadConfidenceMetric}</div>
                  <div style={{ color: accentColor }} className="text-base lg:text-lg font-mono font-bold">
                    {isMonitoring ? speechProb.toFixed(2) : '--'}
                  </div>
                </div>

                <div className="p-3 bg-[#0A0B0D] border border-[#1A1B1F] rounded">
                  <div className="text-[9px] text-[#606060] uppercase tracking-wider mb-1">{t.recDuration}</div>
                  <div className="text-base lg:text-lg font-mono font-bold text-[#E0E0E0]">
                    {durationSec > 0 ? `${durationSec.toFixed(1)}s` : '00:00'}
                  </div>
                </div>

                <div className="p-3 bg-[#0A0B0D] border border-[#1A1B1F] rounded">
                  <div className="text-[9px] text-[#606060] uppercase tracking-wider mb-1">{t.formatCodec}</div>
                  <div className="text-base lg:text-lg font-mono font-bold text-[#A0A0A0] truncate">
                    16k PCM
                  </div>
                </div>
              </div>
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
