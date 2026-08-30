import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useTheme } from '../theme/ThemeContext';

interface Props {
  audioUrl: string;
  recordingId: string;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  onSeek: (time: number) => void;
}

// Global AudioContext cache to prevent leaking multiple contexts
let globalAudioCtx: AudioContext | null = null;
function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtxClass) return null;
  if (!globalAudioCtx || globalAudioCtx.state === 'closed') {
    globalAudioCtx = new AudioCtxClass();
  }
  return globalAudioCtx;
}

// Global waveform cache to avoid re-decoding audio data for already loaded recordings
const waveformCache = new Map<string, number[]>();

export const WaveformCanvas: React.FC<Props> = ({
  audioUrl,
  recordingId,
  currentTime,
  duration,
  isPlaying,
  onSeek,
}) => {
  const { currentThemeOption } = useTheme();
  const accentColor = currentThemeOption.primaryColor;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [peaks, setPeaks] = useState<number[]>(() => waveformCache.get(recordingId) || []);
  const [isLoading, setIsLoading] = useState<boolean>(peaks.length === 0);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Generate fallback pseudo-random audio waveform peaks with realistic speech patterns
  const generateRealisticFallbackPeaks = useCallback((recId: string, dur: number): number[] => {
    const numBars = 120;
    const result: number[] = [];
    // Simple deterministic hash from recordingId
    let seed = 0;
    for (let i = 0; i < recId.length; i++) {
      seed = (seed * 31 + recId.charCodeAt(i)) & 0xffffffff;
    }
    const pseudoRandom = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };

    // Simulate syllables, pauses, and speech bursts
    const numBursts = Math.max(2, Math.round(dur * 2));
    const burstCenters: number[] = [];
    for (let b = 0; b < numBursts; b++) {
      burstCenters.push(pseudoRandom());
    }

    for (let i = 0; i < numBars; i++) {
      const normalizedPos = i / numBars;
      let burstFactor = 0.08; // baseline ambient noise floor

      for (const center of burstCenters) {
        const dist = Math.abs(normalizedPos - center);
        if (dist < 0.08) {
          const burstAmp = Math.cos((dist / 0.08) * (Math.PI / 2));
          burstFactor = Math.max(burstFactor, burstAmp * 0.9);
        }
      }

      // Add high frequency jitter / harmonics
      const noise = pseudoRandom() * 0.35 + 0.1;
      const val = Math.min(1.0, Math.max(0.06, burstFactor * (0.6 + noise * 0.4)));
      result.push(val);
    }
    return result;
  }, []);

  // Fetch and decode real audio peaks
  useEffect(() => {
    let isCancelled = false;

    if (waveformCache.has(recordingId)) {
      setPeaks(waveformCache.get(recordingId)!);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    const extractAudioPeaks = async () => {
      try {
        const response = await fetch(audioUrl);
        if (!response.ok) throw new Error('Audio fetch failed');
        const arrayBuffer = await response.arrayBuffer();

        const ctx = getAudioContext();
        if (!ctx) throw new Error('WebAudio unsupported');

        // decodeAudioData consumes arrayBuffer, so we slice it
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
        if (isCancelled) return;

        const channelData = audioBuffer.getChannelData(0);
        const totalSamples = channelData.length;
        const numBars = 120;
        const samplesPerBar = Math.floor(totalSamples / numBars);
        const extractedPeaks: number[] = [];

        let maxVal = 0.001;
        for (let i = 0; i < numBars; i++) {
          const start = i * samplesPerBar;
          const end = Math.min(start + samplesPerBar, totalSamples);
          let peak = 0;
          for (let j = start; j < end; j++) {
            const abs = Math.abs(channelData[j]);
            if (abs > peak) peak = abs;
          }
          extractedPeaks.push(peak);
          if (peak > maxVal) maxVal = peak;
        }

        // Normalize peaks
        const normalized = extractedPeaks.map((p) => Math.min(1, Math.max(0.06, p / maxVal)));
        waveformCache.set(recordingId, normalized);

        if (!isCancelled) {
          setPeaks(normalized);
          setIsLoading(false);
        }
      } catch {
        if (!isCancelled) {
          // Fallback to realistic deterministic speech envelope
          const fallback = generateRealisticFallbackPeaks(recordingId, duration || 3);
          waveformCache.set(recordingId, fallback);
          setPeaks(fallback);
          setIsLoading(false);
        }
      }
    };

    extractAudioPeaks();

    return () => {
      isCancelled = true;
    };
  }, [audioUrl, recordingId, duration, generateRealisticFallbackPeaks]);

  // Draw waveform on canvas whenever currentTime, peaks, hover, or size changes
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = container.clientWidth;
    const height = 48; // Compact hardware height

    // Adjust canvas resolution for high-DPI screens
    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
    }

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    // 1. Background
    ctx.fillStyle = '#0B0C0E';
    ctx.fillRect(0, 0, width, height);

    // 2. Subtle horizontal center line & grid lines
    const centerY = height / 2;
    ctx.strokeStyle = '#181A20';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, centerY);
    ctx.lineTo(width, centerY);
    ctx.stroke();

    // Time division ticks (e.g. 4 vertical subtle division lines)
    ctx.strokeStyle = '#14161C';
    for (let step = 1; step < 4; step++) {
      const x = (width / 4) * step;
      ctx.beginPath();
      ctx.moveTo(x, 2);
      ctx.lineTo(x, height - 2);
      ctx.stroke();
    }

    const dataToRender = peaks.length > 0 ? peaks : generateRealisticFallbackPeaks(recordingId, duration || 3);
    const numBars = dataToRender.length;
    const totalGapRatio = 0.28;
    const barPlusGap = width / numBars;
    const barWidth = Math.max(1.2, barPlusGap * (1 - totalGapRatio));
    const gap = barPlusGap - barWidth;

    const progressRatio = duration > 0 ? Math.min(1, Math.max(0, currentTime / duration)) : 0;
    const playheadX = progressRatio * width;

    // 3. Render Waveform Bars
    for (let i = 0; i < numBars; i++) {
      const barCenterNormalized = (i + 0.5) / numBars;
      const x = i * (barWidth + gap);
      const isPlayed = barCenterNormalized <= progressRatio;

      const peakVal = dataToRender[i];
      const maxHalfHeight = (height - 8) / 2;
      const barHalfHeight = Math.max(2, peakVal * maxHalfHeight);

      const topY = centerY - barHalfHeight;
      const barHeight = barHalfHeight * 2;

      // Color selection with gradient for played section
      if (isPlayed) {
        const gradient = ctx.createLinearGradient(0, topY, 0, topY + barHeight);
        gradient.addColorStop(0, accentColor);
        gradient.addColorStop(0.5, accentColor);
        gradient.addColorStop(1, `${accentColor}99`);
        ctx.fillStyle = gradient;
        ctx.shadowColor = `${accentColor}66`;
        ctx.shadowBlur = 4;
      } else {
        ctx.fillStyle = '#262A35';
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
      }

      // Draw rounded vertical pill
      const radius = Math.min(barWidth / 2, 1.5);
      ctx.beginPath();
      ctx.roundRect(x, topY, barWidth, barHeight, radius);
      ctx.fill();
    }

    // Reset shadow
    ctx.shadowBlur = 0;

    // 4. Draw Playhead Line & Glowing Cursor Pip
    if (playheadX > 0 && playheadX <= width) {
      // Glow line
      ctx.strokeStyle = `${accentColor}4D`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(playheadX, 0);
      ctx.lineTo(playheadX, height);
      ctx.stroke();

      // Sharp center cursor
      ctx.strokeStyle = accentColor;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(playheadX, 0);
      ctx.lineTo(playheadX, height);
      ctx.stroke();

      // Top diamond / pip
      ctx.fillStyle = accentColor;
      ctx.beginPath();
      ctx.arc(playheadX, 3, 2.5, 0, Math.PI * 2);
      ctx.fill();

      // Bottom pip
      ctx.beginPath();
      ctx.arc(playheadX, height - 3, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // 5. Draw Hover Indicator & Time Tag if hovering
    if (hoverTime !== null && duration > 0) {
      const hoverRatio = Math.min(1, Math.max(0, hoverTime / duration));
      const hoverX = hoverRatio * width;

      // Dashed hover line
      ctx.setLineDash([2, 2]);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(hoverX, 0);
      ctx.lineTo(hoverX, height);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.restore();
  }, [peaks, currentTime, duration, hoverTime, recordingId, generateRealisticFallbackPeaks]);

  // RequestAnimationFrame redraw loop for smooth playback
  useEffect(() => {
    let animId: number;
    const tick = () => {
      renderCanvas();
      if (isPlaying) {
        animId = requestAnimationFrame(tick);
      }
    };

    tick();

    return () => {
      if (animId) cancelAnimationFrame(animId);
    };
  }, [isPlaying, renderCanvas]);

  // Redraw on window resize
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      renderCanvas();
    });
    observer.observe(container);

    return () => observer.disconnect();
  }, [renderCanvas]);

  // Interaction handlers (Click & Drag Seeking)
  const calculateSeekTime = (clientX: number): number => {
    const container = containerRef.current;
    if (!container || !duration) return 0;
    const rect = container.getBoundingClientRect();
    const offsetX = Math.max(0, Math.min(rect.width, clientX - rect.left));
    const ratio = offsetX / rect.width;
    return ratio * duration;
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    setIsDragging(true);
    const newTime = calculateSeekTime(e.clientX);
    onSeek(newTime);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const newTime = calculateSeekTime(e.clientX);
    setHoverTime(newTime);
    if (isDragging) {
      onSeek(newTime);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDragging) {
      setIsDragging(false);
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }
  };

  const handlePointerLeave = () => {
    setHoverTime(null);
    setIsDragging(false);
  };

  const formatHoverTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    const ms = Math.floor((sec % 1) * 10);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms}`;
  };

  return (
    <div
      ref={containerRef}
      id={`waveform-container-${recordingId}`}
      className="relative w-full h-12 bg-[#0B0C0E] rounded border border-[#1A1B1F] overflow-hidden select-none cursor-pointer group"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerLeave}
    >
      <canvas
        ref={canvasRef}
        id={`waveform-canvas-${recordingId}`}
        className="w-full h-full block"
      />

      {/* Floating Hover Time Badge */}
      {hoverTime !== null && duration > 0 && (
        <div
          className="absolute top-1 pointer-events-none transform -translate-x-1/2 px-1.5 py-0.5 rounded bg-[#181A20]/90 border border-[#00F0FF]/40 text-[#00F0FF] font-mono text-[8px] font-bold shadow-lg"
          style={{
            left: `${Math.min(94, Math.max(6, (hoverTime / duration) * 100))}%`,
          }}
        >
          {formatHoverTime(hoverTime)}
        </div>
      )}

      {/* Loading indicator overlay */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#0B0C0E]/40 pointer-events-none">
          <span className="text-[9px] font-mono text-[#505560] tracking-widest uppercase">
            LOADING WAVEFORM...
          </span>
        </div>
      )}
    </div>
  );
};
