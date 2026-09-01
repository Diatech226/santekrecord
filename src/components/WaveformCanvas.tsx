import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useTheme } from '../theme/ThemeContext';

interface Props {
  audioUrl: string;
  recordingId: string;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  onSeek: (time: number) => void;
  zoom?: number;
  panOffset?: number;
  onPanChange?: (pan: number) => void;
  onZoomChange?: (zoom: number) => void;
  autoFollowPlayhead?: boolean;
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

// Global caches for full-resolution raw audio data & downsampled global peaks
export const rawAudioBufferCache = new Map<string, Float32Array>();
export const globalPeaksCache = new Map<string, number[]>();

export const WaveformCanvas: React.FC<Props> = ({
  audioUrl,
  recordingId,
  currentTime,
  duration,
  isPlaying,
  onSeek,
  zoom = 1.0,
  panOffset = 0.0,
  onPanChange,
  onZoomChange,
  autoFollowPlayhead = true,
}) => {
  const { currentThemeOption } = useTheme();
  const accentColor = currentThemeOption.primaryColor;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const minimapCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const minimapContainerRef = useRef<HTMLDivElement | null>(null);

  const [rawChannelData, setRawChannelData] = useState<Float32Array | null>(() => rawAudioBufferCache.get(recordingId) || null);
  const [globalPeaks, setGlobalPeaks] = useState<number[]>(() => globalPeaksCache.get(recordingId) || []);
  const [isLoading, setIsLoading] = useState<boolean>(!rawAudioBufferCache.has(recordingId) && !globalPeaksCache.has(recordingId));
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [isDraggingSeek, setIsDraggingSeek] = useState(false);
  const [isDraggingMinimap, setIsDraggingMinimap] = useState(false);

  // Generate fallback pseudo-random audio waveform peaks with realistic speech patterns
  const generateRealisticFallbackPeaks = useCallback((recId: string, dur: number): number[] => {
    const numBars = 140;
    const result: number[] = [];
    let seed = 0;
    for (let i = 0; i < recId.length; i++) {
      seed = (seed * 31 + recId.charCodeAt(i)) & 0xffffffff;
    }
    const pseudoRandom = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };

    const numBursts = Math.max(2, Math.round(dur * 2));
    const burstCenters: number[] = [];
    for (let b = 0; b < numBursts; b++) {
      burstCenters.push(pseudoRandom());
    }

    for (let i = 0; i < numBars; i++) {
      const normalizedPos = i / numBars;
      let burstFactor = 0.08;

      for (const center of burstCenters) {
        const dist = Math.abs(normalizedPos - center);
        if (dist < 0.08) {
          const burstAmp = Math.cos((dist / 0.08) * (Math.PI / 2));
          burstFactor = Math.max(burstFactor, burstAmp * 0.9);
        }
      }

      const noise = pseudoRandom() * 0.35 + 0.1;
      const val = Math.min(1.0, Math.max(0.06, burstFactor * (0.6 + noise * 0.4)));
      result.push(val);
    }
    return result;
  }, []);

  // Fetch and decode real audio peaks
  useEffect(() => {
    let isCancelled = false;

    if (rawAudioBufferCache.has(recordingId)) {
      setRawChannelData(rawAudioBufferCache.get(recordingId)!);
      setGlobalPeaks(globalPeaksCache.get(recordingId) || []);
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

        const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
        if (isCancelled) return;

        const channelData = audioBuffer.getChannelData(0);
        // Store raw Float32Array in cache for dynamic high-res zoomed resampling
        rawAudioBufferCache.set(recordingId, channelData);

        const totalSamples = channelData.length;
        const numBars = 140;
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

        const normalized = extractedPeaks.map((p) => Math.min(1, Math.max(0.06, p / maxVal)));
        globalPeaksCache.set(recordingId, normalized);

        if (!isCancelled) {
          setRawChannelData(channelData);
          setGlobalPeaks(normalized);
          setIsLoading(false);
        }
      } catch {
        if (!isCancelled) {
          const fallback = generateRealisticFallbackPeaks(recordingId, duration || 3);
          globalPeaksCache.set(recordingId, fallback);
          setGlobalPeaks(fallback);
          setIsLoading(false);
        }
      }
    };

    extractAudioPeaks();

    return () => {
      isCancelled = true;
    };
  }, [audioUrl, recordingId, duration, generateRealisticFallbackPeaks]);

  // Safe effective duration
  const safeDuration = Math.max(duration || 0.1, 0.1);
  const currentZoom = Math.max(1, zoom);
  const visibleDuration = safeDuration / currentZoom;
  const maxPanDuration = Math.max(0, safeDuration - visibleDuration);
  const clampedPan = Math.max(0, Math.min(1, panOffset));
  const visibleStartTime = maxPanDuration > 0 ? clampedPan * maxPanDuration : 0;
  const visibleEndTime = visibleStartTime + visibleDuration;

  // Auto-follow playhead during playback when zoomed
  useEffect(() => {
    if (!isPlaying || !autoFollowPlayhead || currentZoom <= 1 || maxPanDuration <= 0) return;

    if (currentTime > visibleEndTime - visibleDuration * 0.15 || currentTime < visibleStartTime) {
      const targetStart = Math.max(0, Math.min(maxPanDuration, currentTime - visibleDuration * 0.3));
      const targetPan = targetStart / maxPanDuration;
      onPanChange?.(targetPan);
    }
  }, [isPlaying, currentTime, autoFollowPlayhead, currentZoom, maxPanDuration, visibleDuration, visibleStartTime, visibleEndTime, onPanChange]);

  // High-Resolution Resampling for the active visible window
  const getVisiblePeaks = useCallback((): number[] => {
    const numBars = 140;

    if (rawChannelData && rawChannelData.length > 0) {
      const totalSamples = rawChannelData.length;
      const startSample = Math.max(0, Math.floor((visibleStartTime / safeDuration) * totalSamples));
      const endSample = Math.min(totalSamples, Math.ceil((visibleEndTime / safeDuration) * totalSamples));
      const windowSamples = Math.max(1, endSample - startSample);
      const samplesPerBar = Math.max(1, Math.floor(windowSamples / numBars));

      const peaksResult: number[] = [];
      let windowMax = 0.001;

      for (let i = 0; i < numBars; i++) {
        const barStart = startSample + i * samplesPerBar;
        const barEnd = Math.min(barStart + samplesPerBar, endSample);
        let peak = 0;
        for (let j = barStart; j < barEnd; j++) {
          const abs = Math.abs(rawChannelData[j]);
          if (abs > peak) peak = abs;
        }
        peaksResult.push(peak);
        if (peak > windowMax) windowMax = peak;
      }

      return peaksResult.map((p) => Math.min(1, Math.max(0.06, p / windowMax)));
    }

    // Fallback: interpolate globalPeaks across the visible slice
    const sourcePeaks = globalPeaks.length > 0 ? globalPeaks : generateRealisticFallbackPeaks(recordingId, safeDuration);
    const startNorm = visibleStartTime / safeDuration;
    const endNorm = visibleEndTime / safeDuration;
    const peaksResult: number[] = [];

    for (let i = 0; i < numBars; i++) {
      const pos = startNorm + (i / numBars) * (endNorm - startNorm);
      const srcIdx = Math.max(0, Math.min(sourcePeaks.length - 1, Math.floor(pos * sourcePeaks.length)));
      peaksResult.push(sourcePeaks[srcIdx] || 0.1);
    }

    return peaksResult;
  }, [rawChannelData, globalPeaks, visibleStartTime, visibleEndTime, safeDuration, generateRealisticFallbackPeaks, recordingId]);

  // Main Zoomed Waveform Canvas Render
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = container.clientWidth;
    const height = 54; // Slightly taller for grid timestamps

    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
    }

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    // 1. Background
    ctx.fillStyle = '#090A0D';
    ctx.fillRect(0, 0, width, height);

    // 2. Center horizontal line
    const centerY = height / 2 + 4; // Shifted slightly down for top time header
    ctx.strokeStyle = '#181A20';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, centerY);
    ctx.lineTo(width, centerY);
    ctx.stroke();

    // 3. Dynamic Time Grid & Ticks in Zoom Mode
    const stepCount = currentZoom > 4 ? 6 : currentZoom > 1.5 ? 4 : 3;
    const timeStep = visibleDuration / stepCount;

    ctx.fillStyle = '#484C58';
    ctx.font = '8px JetBrains Mono, monospace';
    ctx.textAlign = 'center';

    for (let step = 0; step <= stepCount; step++) {
      const x = (width / stepCount) * step;
      const tickTime = visibleStartTime + step * timeStep;
      
      // Vertical grid line
      ctx.strokeStyle = '#14161C';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, 10);
      ctx.lineTo(x, height);
      ctx.stroke();

      // Time tag at top
      if (currentZoom > 1) {
        const timeLabel = tickTime < 60
          ? `${tickTime.toFixed(2)}s`
          : `${Math.floor(tickTime / 60)}:${(tickTime % 60).toFixed(1).padStart(4, '0')}`;
        
        let labelX = x;
        if (step === 0) labelX = Math.max(14, x);
        if (step === stepCount) labelX = Math.min(width - 14, x);
        ctx.fillText(timeLabel, labelX, 8);
      }
    }

    // 4. Render Resampled Zoomed Peaks
    const visiblePeaks = getVisiblePeaks();
    const numBars = visiblePeaks.length;
    const totalGapRatio = 0.28;
    const barPlusGap = width / numBars;
    const barWidth = Math.max(1.2, barPlusGap * (1 - totalGapRatio));
    const gap = barPlusGap - barWidth;

    const playheadRatioInView = (currentTime - visibleStartTime) / visibleDuration;
    const playheadX = playheadRatioInView * width;

    for (let i = 0; i < numBars; i++) {
      const barCenterRatio = (i + 0.5) / numBars;
      const x = i * (barWidth + gap);
      const isPlayed = barCenterRatio <= playheadRatioInView;

      const peakVal = visiblePeaks[i];
      const maxHalfHeight = (height - 18) / 2;
      const barHalfHeight = Math.max(2, peakVal * maxHalfHeight);

      const topY = centerY - barHalfHeight;
      const barHeight = barHalfHeight * 2;

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

      const radius = Math.min(barWidth / 2, 1.5);
      ctx.beginPath();
      ctx.roundRect(x, topY, barWidth, barHeight, radius);
      ctx.fill();
    }

    ctx.shadowBlur = 0;

    // 5. Playhead Line & Cursor
    if (playheadX >= 0 && playheadX <= width) {
      // Glow line
      ctx.strokeStyle = `${accentColor}4D`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(playheadX, 0);
      ctx.lineTo(playheadX, height);
      ctx.stroke();

      // Core line
      ctx.strokeStyle = accentColor;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(playheadX, 0);
      ctx.lineTo(playheadX, height);
      ctx.stroke();

      // Top Pip
      ctx.fillStyle = accentColor;
      ctx.beginPath();
      ctx.arc(playheadX, 4, 2.5, 0, Math.PI * 2);
      ctx.fill();

      // Bottom Pip
      ctx.beginPath();
      ctx.arc(playheadX, height - 3, 2.5, 0, Math.PI * 2);
      ctx.fill();
    } else if (currentZoom > 1) {
      // Out-of-viewport playhead indicators (Directional arrows on left/right edges)
      if (currentTime < visibleStartTime) {
        ctx.fillStyle = accentColor;
        ctx.beginPath();
        ctx.moveTo(2, centerY);
        ctx.lineTo(7, centerY - 4);
        ctx.lineTo(7, centerY + 4);
        ctx.closePath();
        ctx.fill();
      } else if (currentTime > visibleEndTime) {
        ctx.fillStyle = accentColor;
        ctx.beginPath();
        ctx.moveTo(width - 2, centerY);
        ctx.lineTo(width - 7, centerY - 4);
        ctx.lineTo(width - 7, centerY + 4);
        ctx.closePath();
        ctx.fill();
      }
    }

    // 6. Hover Indicator
    if (hoverTime !== null && hoverTime >= visibleStartTime && hoverTime <= visibleEndTime) {
      const hoverRatioInView = (hoverTime - visibleStartTime) / visibleDuration;
      const hoverX = hoverRatioInView * width;

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
  }, [getVisiblePeaks, currentZoom, visibleDuration, visibleStartTime, visibleEndTime, currentTime, hoverTime, accentColor]);

  // Minimap (Full-overview timeline track) Render
  const renderMinimap = useCallback(() => {
    const canvas = minimapCanvasRef.current;
    const container = minimapContainerRef.current;
    if (!canvas || !container || currentZoom <= 1) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = container.clientWidth;
    const height = 16;

    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
    }

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    // Background
    ctx.fillStyle = '#060709';
    ctx.fillRect(0, 0, width, height);

    // Global waveform envelope
    const allPeaks = globalPeaks.length > 0 ? globalPeaks : generateRealisticFallbackPeaks(recordingId, safeDuration);
    const numBars = allPeaks.length;
    const barW = width / numBars;
    const centerY = height / 2;

    for (let i = 0; i < numBars; i++) {
      const x = i * barW;
      const h = Math.max(1, allPeaks[i] * (height / 2 - 1));
      ctx.fillStyle = '#1D212A';
      ctx.fillRect(x, centerY - h, Math.max(1, barW - 0.5), h * 2);
    }

    // Viewport Highlight Box (Lens)
    const viewLeftNorm = visibleStartTime / safeDuration;
    const viewRightNorm = visibleEndTime / safeDuration;
    const lensX = viewLeftNorm * width;
    const lensW = Math.max(8, (viewRightNorm - viewLeftNorm) * width);

    // Lens background tint
    ctx.fillStyle = `${accentColor}1A`;
    ctx.fillRect(lensX, 0, lensW, height);

    // Lens border
    ctx.strokeStyle = `${accentColor}99`;
    ctx.lineWidth = 1;
    ctx.strokeRect(lensX + 0.5, 0.5, lensW - 1, height - 1);

    // Left and Right drag handles
    ctx.fillStyle = accentColor;
    ctx.fillRect(lensX, 2, 2, height - 4);
    ctx.fillRect(lensX + lensW - 2, 2, 2, height - 4);

    // Overall Playhead Line on Minimap
    const fullPlayheadX = (currentTime / safeDuration) * width;
    if (fullPlayheadX >= 0 && fullPlayheadX <= width) {
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(fullPlayheadX, 0);
      ctx.lineTo(fullPlayheadX, height);
      ctx.stroke();
    }

    ctx.restore();
  }, [currentZoom, globalPeaks, visibleStartTime, visibleEndTime, safeDuration, accentColor, currentTime, generateRealisticFallbackPeaks, recordingId]);

  // RequestAnimationFrame redraw loop
  useEffect(() => {
    let animId: number;
    const tick = () => {
      renderCanvas();
      renderMinimap();
      if (isPlaying) {
        animId = requestAnimationFrame(tick);
      }
    };

    tick();

    return () => {
      if (animId) cancelAnimationFrame(animId);
    };
  }, [isPlaying, renderCanvas, renderMinimap]);

  // ResizeObserver
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      renderCanvas();
      renderMinimap();
    });
    observer.observe(container);

    return () => observer.disconnect();
  }, [renderCanvas, renderMinimap]);

  // Calculate Seek Timestamp from clientX
  const calculateSeekTime = (clientX: number): number => {
    const container = containerRef.current;
    if (!container) return 0;
    const rect = container.getBoundingClientRect();
    const offsetX = Math.max(0, Math.min(rect.width, clientX - rect.left));
    const ratioInView = offsetX / rect.width;
    return visibleStartTime + ratioInView * visibleDuration;
  };

  // Pointer Seeking Handlers on Main Canvas
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    setIsDraggingSeek(true);
    const newTime = calculateSeekTime(e.clientX);
    onSeek(newTime);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const newTime = calculateSeekTime(e.clientX);
    setHoverTime(newTime);
    if (isDraggingSeek) {
      onSeek(newTime);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDraggingSeek) {
      setIsDraggingSeek(false);
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }
  };

  const handlePointerLeave = () => {
    setHoverTime(null);
    setIsDraggingSeek(false);
  };

  // Wheel Zoom & Wheel Pan Handler
  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;

    // Shift + Wheel or horizontal trackpad: Pan timeline
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      if (maxPanDuration > 0 && onPanChange) {
        const delta = (e.deltaX || e.deltaY) * 0.0015;
        const newPan = Math.max(0, Math.min(1, clampedPan + delta));
        onPanChange(newPan);
      }
      return;
    }

    // Vertical wheel: Zoom in/out centered around cursor
    if (onZoomChange) {
      const zoomFactor = e.deltaY < 0 ? 1.25 : 0.8;
      const nextZoom = Math.max(1, Math.min(16, currentZoom * zoomFactor));
      
      if (nextZoom !== currentZoom) {
        onZoomChange(Math.round(nextZoom * 10) / 10);

        // Adjust pan to zoom towards mouse cursor position
        if (maxPanDuration > 0 && onPanChange) {
          const rect = container.getBoundingClientRect();
          const mouseRatio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
          const mouseTime = visibleStartTime + mouseRatio * visibleDuration;
          const newVisibleDur = safeDuration / nextZoom;
          const newMaxPan = Math.max(0, safeDuration - newVisibleDur);
          if (newMaxPan > 0) {
            const newStart = Math.max(0, Math.min(newMaxPan, mouseTime - mouseRatio * newVisibleDur));
            onPanChange(newStart / newMaxPan);
          }
        }
      }
    }
  };

  // Minimap Pointer Interaction (Click & Drag Lens Pan)
  const handleMinimapPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const container = minimapContainerRef.current;
    if (!container || maxPanDuration <= 0) return;

    setIsDraggingMinimap(true);
    const rect = container.getBoundingClientRect();
    const offsetX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const targetNorm = offsetX / rect.width;
    const targetCenterTime = targetNorm * safeDuration;
    const targetStart = Math.max(0, Math.min(maxPanDuration, targetCenterTime - visibleDuration / 2));
    onPanChange?.(targetStart / maxPanDuration);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handleMinimapPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingMinimap) return;
    const container = minimapContainerRef.current;
    if (!container || maxPanDuration <= 0) return;

    const rect = container.getBoundingClientRect();
    const offsetX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const targetNorm = offsetX / rect.width;
    const targetCenterTime = targetNorm * safeDuration;
    const targetStart = Math.max(0, Math.min(maxPanDuration, targetCenterTime - visibleDuration / 2));
    onPanChange?.(targetStart / maxPanDuration);
  };

  const handleMinimapPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDraggingMinimap) {
      setIsDraggingMinimap(false);
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }
  };

  const formatHoverTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    const ms = Math.floor((sec % 1) * 1000);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
  };

  return (
    <div className="space-y-1">
      {/* Main Waveform Canvas */}
      <div
        ref={containerRef}
        id={`waveform-container-${recordingId}`}
        className="relative w-full h-[54px] bg-[#090A0D] rounded border border-[#1A1B1F] overflow-hidden select-none cursor-crosshair group"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerLeave}
        onWheel={handleWheel}
        title="Click/Drag to scrub · Scroll to Zoom · Shift+Scroll to Pan"
      >
        <canvas
          ref={canvasRef}
          id={`waveform-canvas-${recordingId}`}
          className="w-full h-full block"
        />

        {/* Floating Hover Timestamp Tooltip */}
        {hoverTime !== null && hoverTime >= visibleStartTime && hoverTime <= visibleEndTime && (
          <div
            className="absolute top-1 pointer-events-none transform -translate-x-1/2 px-1.5 py-0.5 rounded bg-[#181A20]/95 border border-[#00F0FF]/50 text-[#00F0FF] font-mono text-[8px] font-bold shadow-lg z-10"
            style={{
              left: `${Math.min(94, Math.max(6, ((hoverTime - visibleStartTime) / visibleDuration) * 100))}%`,
            }}
          >
            {formatHoverTime(hoverTime)}
          </div>
        )}

        {/* Loading Indicator */}
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#090A0D]/60 pointer-events-none">
            <span className="text-[9px] font-mono text-[#505560] tracking-widest uppercase animate-pulse">
              DECODING AUDIO WAVEFORM...
            </span>
          </div>
        )}
      </div>

      {/* Interactive Minimap Overview Track when Zoomed */}
      {currentZoom > 1 && (
        <div
          ref={minimapContainerRef}
          id={`waveform-minimap-${recordingId}`}
          className="relative w-full h-4 bg-[#060709] rounded border border-[#181920] overflow-hidden cursor-ew-resize select-none"
          onPointerDown={handleMinimapPointerDown}
          onPointerMove={handleMinimapPointerMove}
          onPointerUp={handleMinimapPointerUp}
          title="Drag lens or click to pan across full timeline"
        >
          <canvas
            ref={minimapCanvasRef}
            id={`waveform-minimap-canvas-${recordingId}`}
            className="w-full h-full block"
          />
        </div>
      )}
    </div>
  );
};
