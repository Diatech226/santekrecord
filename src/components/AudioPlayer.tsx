import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Play, Pause, Download, Trash2, FileText, Activity, Check, Loader2 } from 'lucide-react';
import { RecordingMeta } from '../types';
import { useLanguage } from '../i18n/LanguageContext';
import { WaveformCanvas } from './WaveformCanvas';
import { downloadRecordingWav } from '../services/wavDownloader';

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
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const audioUrl = recording.audio_url || `/api/recordings/${recording.recording_id}/audio`;

  const speedOptions = [0.5, 1.0, 1.5];

  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(recording.duration_seconds || 0);
    setHasDownloaded(false);
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

  const togglePlay = () => {
    if (!audioRef.current) return;
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

      {/* Interactive Canvas Waveform Visualization */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-[9px] text-[#606060] uppercase tracking-wider font-semibold">
          <span className="flex items-center gap-1">
            <Activity className="w-2.5 h-2.5 text-[#00F0FF]" />
            Waveform Amplitude
          </span>
          <span className="text-[#00F0FF] font-mono">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
        </div>
        <WaveformCanvas
          audioUrl={audioUrl}
          recordingId={recording.recording_id}
          currentTime={currentTime}
          duration={duration}
          isPlaying={isPlaying}
          onSeek={handleWaveformSeek}
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
