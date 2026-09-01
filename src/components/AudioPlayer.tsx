import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Play,
  Pause,
  Download,
  Trash2,
  FileText,
  Activity,
  Check,
  Loader2,
  ZoomIn,
  ZoomOut,
  Maximize2,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  Volume2,
} from 'lucide-react';
import { RecordingMeta } from '../types';
import { useLanguage } from '../i18n/LanguageContext';
import { WaveformCanvas } from './WaveformCanvas';
import { downloadRecordingWav } from '../services/wavDownloader';
import { getRecordingNormalizationMetrics, NormalizationMetrics } from '../services/audioNormalizer';

interface Props {
  recording: RecordingMeta;
  onDelete?: (id: string) => void;
  onOpenMeta?: (meta: RecordingMeta) => void;
}

export const AudioPlayer: React.FC<Props> = ({
  recording,
  onDelete,
  onOpenMeta,
}) => {
  const { t } = useLanguage();
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(recording.duration_seconds || 0);
  const [playbackRate, setPlaybackRate] = useState<number>(1.0);
  const [isDownloading, setIsDownloading] = useState(false);
  const [hasDownloaded, setHasDownloaded] = useState(false);
  
  // Real-Time Audio Normalization (Playback Peak Boost without altering source WAV)
  const [isNormalizeEnabled, setIsNormalizeEnabled] = useState<boolean>(false);
  const [normMetrics, setNormMetrics] = useState<NormalizationMetrics | null>(null);

  // Waveform Zoom & Inspection state
  const [zoom, setZoom] = useState<number>(1.0);
  const [panOffset, setPanOffset] = useState<number>(0.0);
  const [autoFollowPlayhead, setAutoFollowPlayhead] = useState<boolean>(true);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const compressorRef = useRef<DynamicsCompressorNode | null>(null);

  const audioUrl = recording.audio_url || `/api/recordings/${recording.recording_id}/audio`;

  const speedOptions = [0.5, 1.0, 1.5];
  const zoomPresets = [1.0, 2.0, 4.0, 8.0, 16.0];

  // Fetch or calculate recording normalization metrics on change
  useEffect(() => {
    let isCancelled = false;
    getRecordingNormalizationMetrics(recording.recording_id, audioUrl).then((metrics) => {
      if (!isCancelled) {
        setNormMetrics(metrics);
      }
    });
    return () => {
      isCancelled = true;
    };
  }, [recording.recording_id, audioUrl]);

  // Initialize Web Audio graph for the player element
  const initWebAudio = useCallback(() => {
    if (!audioRef.current || sourceNodeRef.current) return;
    try {
      const AudioCtxClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtxClass) return;

      const ctx = new AudioCtxClass();
      const source = ctx.createMediaElementSource(audioRef.current);
      const gain = ctx.createGain();
      const compressor = ctx.createDynamicsCompressor();

      // Transparent safety limiter configuration
      compressor.threshold.setValueAtTime(-1.0, ctx.currentTime);
      compressor.knee.setValueAtTime(3.0, ctx.currentTime);
      compressor.ratio.setValueAtTime(20.0, ctx.currentTime);
      compressor.attack.setValueAtTime(0.003, ctx.currentTime);
      compressor.release.setValueAtTime(0.1, ctx.currentTime);

      const targetGain = isNormalizeEnabled && normMetrics ? normMetrics.boostMultiplier : 1.0;
      gain.gain.setValueAtTime(targetGain, ctx.currentTime);

      source.connect(gain);
      gain.connect(compressor);
      compressor.connect(ctx.destination);

      audioCtxRef.current = ctx;
      sourceNodeRef.current = source;
      gainNodeRef.current = gain;
      compressorRef.current = compressor;
    } catch (err) {
      console.warn('Web Audio playback routing setup:', err);
    }
  }, [isNormalizeEnabled, normMetrics]);

  // Adjust Gain dynamically when normalization toggle or metrics change
  useEffect(() => {
    if (gainNodeRef.current && audioCtxRef.current) {
      const targetGain = isNormalizeEnabled && normMetrics ? normMetrics.boostMultiplier : 1.0;
      gainNodeRef.current.gain.setTargetAtTime(targetGain, audioCtxRef.current.currentTime, 0.02);
    }
  }, [isNormalizeEnabled, normMetrics]);

  // Clean up AudioContext on unmount
  useEffect(() => {
    return () => {
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close().catch(() => {});
      }
    };
  }, []);

  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(recording.duration_seconds || 0);
    setHasDownloaded(false);
    setZoom(1.0);
    setPanOffset(0.0);
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate;
    }
  }, [recording.recording_id, recording.duration_seconds, playbackRate]);

  const handleSpeedChange = (speed: number) => {
    setPlaybackRate(speed);
    if (audioRef.current) {
      audioRef.current.playbackRate = speed;
    }
  };

  const toggleNormalize = () => {
    initWebAudio();
    if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }
    setIsNormalizeEnabled((prev) => !prev);
  };

  const handleZoomIn = () => {
    setZoom((prev) => {
      const next = prev < 2 ? 2 : prev < 4 ? 4 : prev < 8 ? 8 : prev < 16 ? 16 : 16;
      return next;
    });
  };

  const handleZoomOut = () => {
    setZoom((prev) => {
      const next = prev > 8 ? 8 : prev > 4 ? 4 : prev > 2 ? 2 : 1;
      if (next === 1) setPanOffset(0);
      return next;
    });
  };

  const handleResetZoom = () => {
    setZoom(1.0);
    setPanOffset(0.0);
  };

  const handleNudgePan = (direction: 'left' | 'right') => {
    if (zoom <= 1) return;
    const step = 0.15 / zoom;
    setPanOffset((prev) => {
      if (direction === 'left') return Math.max(0, prev - step);
      return Math.min(1, prev + step);
    });
  };

  const togglePlay = () => {
    if (!audioRef.current) return;
    initWebAudio();
    if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play().then(() => {
        setIsPlaying(true);
      }).catch(() => {
        setIsPlaying(false);
      });
    }
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
      if (audioRef.current.duration && !isNaN(audioRef.current.duration)) {
        setDuration(audioRef.current.duration);
      }
    }
  };

  const handleEnded = () => {
    setIsPlaying(false);
    setCurrentTime(0);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = Number(e.target.value);
    setCurrentTime(time);
    if (audioRef.current) {
      audioRef.current.currentTime = time;
    }
  };

  const handleWaveformSeek = useCallback((time: number) => {
    setCurrentTime(time);
    if (audioRef.current) {
      audioRef.current.currentTime = time;
    }
  }, []);

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const formatPreciseTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    const ms = Math.floor((sec % 1) * 100);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
  };

  // Calculated visible window
  const safeDur = Math.max(duration || 0.1, 0.1);
  const visibleDur = safeDur / zoom;
  const maxPanDur = Math.max(0, safeDur - visibleDur);
  const visibleStart = maxPanDur > 0 ? panOffset * maxPanDur : 0;
  const visibleEnd = visibleStart + visibleDur;

  const handleDownloadWav = async () => {
    if (isDownloading) return;
    try {
      setIsDownloading(true);
      await downloadRecordingWav(recording);
      setHasDownloaded(true);
      setTimeout(() => setHasDownloaded(false), 2000);
    } catch (err) {
      console.error('Failed to download WAV via Blob URL:', err);
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div id={`player-${recording.recording_id}`} className="p-3.5 bg-[#111215] border border-[#1A1B1F] rounded-lg font-mono text-xs space-y-3">
      <audio
        ref={audioRef}
        src={audioUrl}
        onTimeUpdate={handleTimeUpdate}
        onEnded={handleEnded}
        onLoadedMetadata={() => {
          if (audioRef.current?.duration) {
            setDuration(audioRef.current.duration);
          }
        }}
      />

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 overflow-hidden">
          <span className="text-[#E0E0E0] font-mono text-xs truncate font-semibold">
            {recording.filename_wav || `${recording.recording_id}.wav`}
          </span>
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#151619] border border-[#2A2B2F] text-[#00F0FF] uppercase">
            {recording.source}
          </span>
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#151619] border border-[#1F2228] text-[#808080]">
            {duration > 0 ? `${duration.toFixed(1)}s` : '--'}
          </span>
          {normMetrics && normMetrics.originalPeakDbfs > -90 && (
            <span
              className="text-[9px] px-1.5 py-0.5 rounded bg-[#151619] border border-[#1F2228] text-[#808080] hidden sm:inline"
              title={`${t.originalPeak}: ${normMetrics.originalPeakDbfs.toFixed(1)} dBFS`}
            >
              Peak: {normMetrics.originalPeakDbfs.toFixed(1)} dBFS
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {onOpenMeta && (
            <button
              id={`meta-btn-${recording.recording_id}`}
              type="button"
              title={t.viewJsonMeta}
              onClick={() => onOpenMeta(recording)}
              className="p-1.5 rounded bg-[#151619] hover:bg-[#2A2B2F] border border-[#2A2B2F] text-[#A0A0A0] hover:text-[#00F0FF] transition-colors"
            >
              <FileText className="w-3.5 h-3.5" />
            </button>
          )}

          <button
            id={`download-wav-btn-${recording.recording_id}`}
            type="button"
            title={t.downloadWav}
            onClick={handleDownloadWav}
            disabled={isDownloading}
            className={`px-2 py-1 rounded border text-[11px] flex items-center gap-1.5 transition-all font-mono uppercase tracking-wider font-semibold shadow-xs ${
              hasDownloaded
                ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400'
                : 'bg-[#00F0FF]/10 hover:bg-[#00F0FF]/20 border-[#00F0FF]/40 text-[#00F0FF] hover:border-[#00F0FF]'
            } disabled:opacity-50`}
          >
            {isDownloading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : hasDownloaded ? (
              <Check className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <Download className="w-3.5 h-3.5" />
            )}
            <span className="hidden sm:inline">{t.downloadWav}</span>
          </button>

          {onDelete && (
            <button
              id={`delete-btn-${recording.recording_id}`}
              type="button"
              title={t.deleteRecording}
              onClick={() => onDelete(recording.recording_id)}
              className="p-1.5 rounded bg-[#151619] hover:bg-[#FF4444]/20 border border-[#2A2B2F] text-[#606060] hover:text-[#FF4444] transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Interactive Waveform Header with Zoom & Inspection Controls */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2 flex-wrap text-[9px] text-[#606060] uppercase tracking-wider font-semibold">
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1 text-[#808490]">
              <Activity className="w-2.5 h-2.5 text-[#00F0FF]" />
              Waveform
            </span>
            {zoom > 1 && (
              <span className="text-[#00F0FF] bg-[#00F0FF]/10 px-1.5 py-0.5 rounded border border-[#00F0FF]/30 text-[8.5px] font-mono">
                {t.zoomWindow}: {formatPreciseTime(visibleStart)} - {formatPreciseTime(visibleEnd)} ({visibleDur.toFixed(2)}s)
              </span>
            )}
            {isNormalizeEnabled && (
              <span
                id={`norm-active-badge-${recording.recording_id}`}
                className="text-[#00F0FF] bg-[#00F0FF]/10 px-1.5 py-0.5 rounded border border-[#00F0FF]/30 text-[8.5px] font-mono flex items-center gap-1"
                title={`${t.originalPeak}: ${normMetrics?.originalPeakDbfs.toFixed(1) ?? '--'} dBFS → Target: -0.9 dBFS`}
              >
                <Volume2 className="w-2.5 h-2.5 text-[#00F0FF] animate-pulse" />
                <span>{t.normalizedBadge}</span>
                {normMetrics && normMetrics.boostDb > 0 && (
                  <span className="font-bold">+{normMetrics.boostDb.toFixed(1)} dB</span>
                )}
              </span>
            )}
          </div>

          {/* Zoom Controls Toolbar */}
          <div className="flex items-center gap-1">
            {/* Zoom Out Button */}
            <button
              id={`zoom-out-btn-${recording.recording_id}`}
              type="button"
              onClick={handleZoomOut}
              disabled={zoom <= 1}
              title={t.zoomOut}
              className="p-1 rounded bg-[#151619] hover:bg-[#202228] disabled:opacity-40 disabled:hover:bg-[#151619] border border-[#202226] text-[#A0A2AA] hover:text-[#00F0FF] transition-colors"
            >
              <ZoomOut className="w-2.5 h-2.5" />
            </button>

            {/* Quick Zoom Presets (1x, 2x, 4x, 8x, 16x) */}
            <div className="flex items-center bg-[#151619] border border-[#202226] rounded p-0.5">
              {zoomPresets.map((preset) => (
                <button
                  key={preset}
                  id={`zoom-preset-${preset}x-${recording.recording_id}`}
                  type="button"
                  onClick={() => {
                    setZoom(preset);
                    if (preset === 1) setPanOffset(0);
                  }}
                  title={`${t.waveformZoom}: ${preset}x`}
                  className={`px-1.5 py-0.5 text-[8.5px] font-mono rounded font-bold transition-all ${
                    zoom === preset
                      ? 'bg-[#00F0FF] text-[#0A0B0D] shadow-xs'
                      : 'text-[#656872] hover:text-[#D0D2DA]'
                  }`}
                >
                  {preset}x
                </button>
              ))}
            </div>

            {/* Zoom In Button */}
            <button
              id={`zoom-in-btn-${recording.recording_id}`}
              type="button"
              onClick={handleZoomIn}
              disabled={zoom >= 16}
              title={t.zoomIn}
              className="p-1 rounded bg-[#151619] hover:bg-[#202228] disabled:opacity-40 disabled:hover:bg-[#151619] border border-[#202226] text-[#A0A2AA] hover:text-[#00F0FF] transition-colors"
            >
              <ZoomIn className="w-2.5 h-2.5" />
            </button>

            {/* Reset Zoom Button */}
            {zoom > 1 && (
              <button
                id={`zoom-reset-btn-${recording.recording_id}`}
                type="button"
                onClick={handleResetZoom}
                title={t.zoomReset}
                className="px-1.5 py-0.5 rounded bg-[#1A1B20] hover:bg-[#252830] border border-[#2C2E38] text-[#00F0FF] text-[8.5px] font-mono flex items-center gap-0.5 transition-colors"
              >
                <Maximize2 className="w-2.5 h-2.5" />
                <span>{t.zoomFit}</span>
              </button>
            )}

            {/* Pan Nudge Controls when Zoomed */}
            {zoom > 1 && (
              <div className="flex items-center gap-0.5 ml-1">
                <button
                  id={`pan-left-btn-${recording.recording_id}`}
                  type="button"
                  onClick={() => handleNudgePan('left')}
                  disabled={panOffset <= 0}
                  title={t.panLeft}
                  className="p-1 rounded bg-[#151619] hover:bg-[#202228] disabled:opacity-30 border border-[#202226] text-[#A0A2AA] hover:text-[#00F0FF] transition-colors"
                >
                  <ChevronLeft className="w-2.5 h-2.5" />
                </button>
                <button
                  id={`pan-right-btn-${recording.recording_id}`}
                  type="button"
                  onClick={() => handleNudgePan('right')}
                  disabled={panOffset >= 1}
                  title={t.panRight}
                  className="p-1 rounded bg-[#151619] hover:bg-[#202228] disabled:opacity-30 border border-[#202226] text-[#A0A2AA] hover:text-[#00F0FF] transition-colors"
                >
                  <ChevronRight className="w-2.5 h-2.5" />
                </button>
                <button
                  id={`auto-follow-btn-${recording.recording_id}`}
                  type="button"
                  onClick={() => setAutoFollowPlayhead((prev) => !prev)}
                  title={t.autoScrollPlayhead}
                  className={`p-1 rounded border transition-colors ${
                    autoFollowPlayhead
                      ? 'bg-[#00F0FF]/15 border-[#00F0FF]/40 text-[#00F0FF]'
                      : 'bg-[#151619] border-[#202226] text-[#555862]'
                  }`}
                >
                  <Crosshair className="w-2.5 h-2.5" />
                </button>
              </div>
            )}

            <span className="text-[#00F0FF] font-mono ml-1 text-[9.5px]">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </div>
        </div>

        {/* High-Resolution Zoomable Waveform Canvas */}
        <WaveformCanvas
          audioUrl={audioUrl}
          recordingId={recording.recording_id}
          currentTime={currentTime}
          duration={duration}
          isPlaying={isPlaying}
          onSeek={handleWaveformSeek}
          zoom={zoom}
          panOffset={panOffset}
          onPanChange={setPanOffset}
          onZoomChange={setZoom}
          autoFollowPlayhead={autoFollowPlayhead}
        />
      </div>

      {/* Hardware Scrubbing Player Bar */}
      <div className="flex items-center gap-3 bg-[#0A0B0D] p-2 rounded border border-[#1A1B1F]">
        <button
          id={`play-toggle-${recording.recording_id}`}
          type="button"
          onClick={togglePlay}
          className="bg-[#2A2B2F] hover:bg-[#00F0FF] text-[#00F0FF] hover:text-[#0A0B0D] rounded-full p-2 transition-all shrink-0"
        >
          {isPlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3 ml-0.5" />}
        </button>

        <div className="flex-1 flex flex-col gap-1">
          <div className="relative w-full flex items-center">
            <input
              id={`seek-${recording.recording_id}`}
              type="range"
              min="0"
              max={duration || 1}
              step="0.05"
              value={currentTime}
              onChange={handleSeek}
              className="w-full accent-[#00F0FF] h-1.5 bg-[#1A1B1F] rounded appearance-none cursor-pointer"
            />
          </div>
        </div>

        <span className="text-[10px] font-mono text-[#606060] whitespace-nowrap">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>

        {/* Real-Time Audio Normalization Toggle (Boosts playback peak to standard level without modifying file) */}
        <button
          id={`normalize-toggle-${recording.recording_id}`}
          type="button"
          role="switch"
          aria-checked={isNormalizeEnabled}
          onClick={toggleNormalize}
          title={`${t.normalizeAudioDesc}${
            normMetrics
              ? ` • ${t.originalPeak}: ${normMetrics.originalPeakDbfs.toFixed(1)} dBFS → ${t.boostApplied}: +${normMetrics.boostDb.toFixed(1)} dB`
              : ''
          }`}
          className={`px-2 py-1 rounded border text-[9px] font-mono font-bold uppercase tracking-wider flex items-center gap-1.5 transition-all shadow-xs shrink-0 ${
            isNormalizeEnabled
              ? 'bg-[#00F0FF]/20 border-[#00F0FF] text-[#00F0FF] shadow-[0_0_8px_rgba(0,240,255,0.25)]'
              : 'bg-[#151619] hover:bg-[#1E2025] border-[#2A2B2F] text-[#70727A] hover:text-[#E0E0E0]'
          }`}
        >
          <Volume2 className={`w-3 h-3 ${isNormalizeEnabled ? 'text-[#00F0FF] animate-pulse' : 'text-[#70727A]'}`} />
          <span>{t.normalizedBadge}</span>
          {isNormalizeEnabled && normMetrics && normMetrics.boostDb > 0 && (
            <span className="text-[8px] px-1 py-0.2 rounded bg-[#00F0FF]/30 text-[#00F0FF] font-mono">
              +{normMetrics.boostDb.toFixed(1)}dB
            </span>
          )}
        </button>

        {/* Playback Speed Selector (0.5x, 1.0x, 1.5x) */}
        <div id={`speed-selector-${recording.recording_id}`} className="flex items-center border border-[#1F2228] bg-[#151619] rounded p-0.5 shrink-0">
          {speedOptions.map((speed) => {
            const isActive = playbackRate === speed;
            return (
              <button
                key={speed}
                id={`speed-${speed}x-${recording.recording_id}`}
                type="button"
                onClick={() => handleSpeedChange(speed)}
                title={`${t.playbackSpeed}: ${speed}x`}
                className={`px-1.5 py-0.5 text-[9px] font-mono rounded font-bold transition-all ${
                  isActive
                    ? 'bg-[#00F0FF] text-[#0A0B0D] shadow-xs'
                    : 'text-[#70727A] hover:text-[#E0E0E0]'
                }`}
              >
                {speed.toFixed(1)}x
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

