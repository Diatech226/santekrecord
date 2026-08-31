import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import * as d3 from 'd3';
import { useLanguage } from '../i18n/LanguageContext';
import { useTheme } from '../theme/ThemeContext';

export interface SpectralHeatmapProps {
  isMonitoring: boolean;
  spectrum?: number[]; // Array of 32 normalized frequency energy values [0.0 - 1.0]
  voiceDetected: boolean;
  speechProb: number;
  levelDbfs: number;
  ambientNoiseDbfs?: number;
}

export type ColorPaletteType = 'inferno' | 'turbo' | 'plasma' | 'cyber';

// 32 frequency band center frequency points (50 Hz to 8000 Hz log-spaced)
export const FREQUENCY_BANDS_HZ = [
  50, 75, 110, 160, 220, 300, 390, 500,
  630, 800, 1000, 1250, 1550, 1900, 2300, 2800,
  3300, 3900, 4500, 5200, 5900, 6600, 7300, 8000,
  // 32 bands total
  8800, 9600, 10500, 11500, 12500, 13500, 14500, 16000,
].slice(0, 32);

export const SpectralHeatmap: React.FC<SpectralHeatmapProps> = ({
  isMonitoring,
  spectrum,
  voiceDetected,
  speechProb,
  levelDbfs,
  ambientNoiseDbfs = -60,
}) => {
  const { t } = useLanguage();
  const { currentThemeOption } = useTheme();
  const accentColor = currentThemeOption.primaryColor;

  const [palette, setPalette] = useState<ColorPaletteType>('inferno');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Buffer of historical spectral slices: 70 columns x 32 frequency rows
  const numColumns = 70;
  const numBands = 32;
  const historyRef = useRef<number[][]>(
    Array.from({ length: numColumns }, () => new Array(numBands).fill(0))
  );

  // Current hovered info for interactive crosshair telemetry
  const [hoveredBand, setHoveredBand] = useState<{ freqHz: number; valDb: number; bandIdx: number } | null>(null);

  // D3 Color Interpolator based on selected palette
  const getColor = useCallback((val: number): string => {
    // val is 0.0 to 1.0 (clamped)
    const v = Math.max(0, Math.min(1, val));
    if (palette === 'turbo') {
      return d3.interpolateTurbo(v);
    }
    if (palette === 'plasma') {
      return d3.interpolatePlasma(v);
    }
    if (palette === 'cyber') {
      // Custom Cyber palette: Deep Slate -> Cyan -> Green -> Yellow -> Accent -> White
      const cyberScale = d3.scaleLinear<string>()
        .domain([0, 0.25, 0.5, 0.75, 0.9, 1.0])
        .range(['#050B14', '#007ACC', '#00FF99', '#FFE600', accentColor, '#FFFFFF'])
        .clamp(true);
      return cyberScale(v);
    }
    // Default: Inferno (ideal for human thermal perception & frequency formants)
    return d3.interpolateInferno(v);
  }, [palette, accentColor]);

  // Real-time Energy Distribution Analysis
  const currentBands = useMemo(() => {
    if (!isMonitoring || !spectrum || spectrum.length === 0) {
      return new Array(numBands).fill(0);
    }
    return spectrum.slice(0, numBands);
  }, [isMonitoring, spectrum]);

  // Spectral Energy Breakdown: Low Noise (<250Hz, bands 0-4), Voice Formants (300-3400Hz, bands 5-16), High Hiss (>4000Hz, bands 17-31)
  const {
    lowNoiseEnergyPct,
    voiceFormantEnergyPct,
    highHissEnergyPct,
    peakFreqHz,
    peakBandIdx,
    signatureType,
  } = useMemo(() => {
    let lowSum = 0;
    let voiceSum = 0;
    let highSum = 0;
    let maxVal = 0;
    let maxIdx = 0;

    for (let i = 0; i < currentBands.length; i++) {
      const val = currentBands[i];
      if (val > maxVal) {
        maxVal = val;
        maxIdx = i;
      }
      if (i <= 4) {
        lowSum += val;
      } else if (i <= 16) {
        voiceSum += val;
      } else {
        highSum += val;
      }
    }

    const total = lowSum + voiceSum + highSum;
    const lowPct = total > 0 ? Math.round((lowSum / total) * 100) : 0;
    const voicePct = total > 0 ? Math.round((voiceSum / total) * 100) : 0;
    const highPct = total > 0 ? Math.round((highSum / total) * 100) : 0;

    const peakHz = FREQUENCY_BANDS_HZ[maxIdx] || 1000;

    let signature = t.systemStandby;
    if (isMonitoring) {
      if (voiceDetected || (voicePct >= 48 && speechProb > 0.35)) {
        signature = t.voiceSignature;
      } else if (lowPct >= 55) {
        signature = `${t.noiseSignature} (RUMBLE)`;
      } else if (highPct >= 55) {
        signature = `${t.noiseSignature} (HISS)`;
      } else {
        signature = t.noiseSignature;
      }
    }

    return {
      lowNoiseEnergyPct: lowPct,
      voiceFormantEnergyPct: voicePct,
      highHissEnergyPct: highPct,
      peakFreqHz: peakHz,
      peakBandIdx: maxIdx,
      signatureType: signature,
    };
  }, [currentBands, isMonitoring, voiceDetected, speechProb, t]);

  // Update ring buffer on incoming spectrum updates
  useEffect(() => {
    const newSlice = isMonitoring && spectrum && spectrum.length > 0
      ? spectrum.slice(0, numBands)
      : new Array(numBands).fill(0);

    if (historyRef.current) {
      historyRef.current.shift();
      historyRef.current.push(newSlice);
    }
  }, [isMonitoring, spectrum]);

  // D3 Canvas Rendering Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;

    const render = () => {
      const width = canvas.width;
      const height = canvas.height;

      // Clear Canvas Background
      ctx.fillStyle = '#05070A';
      ctx.fillRect(0, 0, width, height);

      const history = historyRef.current;
      const cellWidth = width / numColumns;
      const cellHeight = height / numBands;

      // Draw 2D Spectrogram cells (Frequency Y-axis is inverted: low frequencies at bottom, high at top)
      for (let c = 0; c < numColumns; c++) {
        const colSlice = history[c];
        const x = c * cellWidth;

        for (let b = 0; b < numBands; b++) {
          const val = colSlice[b] || 0;
          // Invert band index so low frequencies are at the bottom (b = 0 -> bottom)
          const y = height - (b + 1) * cellHeight;

          ctx.fillStyle = getColor(val);
          ctx.fillRect(Math.floor(x), Math.floor(y), Math.ceil(cellWidth) + 1, Math.ceil(cellHeight) + 1);
        }
      }

      // Draw Region Highlight Bands & Guideline Overlays
      // Voice Formant Region: Bands 5 to 16 (approx 300 Hz - 3400 Hz)
      const voiceBottomY = height - 5 * cellHeight;
      const voiceTopY = height - 17 * cellHeight;
      const voiceHeight = voiceBottomY - voiceTopY;

      // Subtle Voice Band focus overlay
      ctx.save();
      ctx.strokeStyle = voiceDetected ? `${accentColor}CC` : 'rgba(0, 240, 255, 0.35)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);

      // Top line of voice band (3.4 kHz)
      ctx.beginPath();
      ctx.moveTo(0, voiceTopY);
      ctx.lineTo(width, voiceTopY);
      ctx.stroke();

      // Bottom line of voice band (300 Hz)
      ctx.beginPath();
      ctx.moveTo(0, voiceBottomY);
      ctx.lineTo(width, voiceBottomY);
      ctx.stroke();

      // Low rumble boundary line (250 Hz)
      const rumbleY = height - 4 * cellHeight;
      ctx.strokeStyle = 'rgba(255, 184, 0, 0.25)';
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.moveTo(0, rumbleY);
      ctx.lineTo(width, rumbleY);
      ctx.stroke();

      // Time Division Vertical Markers (-4s, -3s, -2s, -1s, NOW)
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.setLineDash([2, 3]);
      const timeDivisions = 4;
      for (let i = 1; i < timeDivisions; i++) {
        const tx = (i / timeDivisions) * width;
        ctx.beginPath();
        ctx.moveTo(tx, 0);
        ctx.lineTo(tx, height);
        ctx.stroke();
      }

      // Voice Formant Region Bracket Indicator on Right
      ctx.setLineDash([]);
      ctx.fillStyle = voiceDetected ? accentColor : '#00F0FF';
      ctx.globalAlpha = 0.85;
      ctx.fillRect(width - 3, voiceTopY, 3, voiceHeight);

      ctx.restore();

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [getColor, voiceDetected, accentColor]);

  // Handle canvas mouse move for interactive frequency query
  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mouseY = e.clientY - rect.top;
    const normY = Math.max(0, Math.min(1, mouseY / rect.height));
    
    // Invert Y to get band index (0 at bottom)
    const bandIdx = Math.max(0, Math.min(numBands - 1, Math.floor((1 - normY) * numBands)));
    const freqHz = FREQUENCY_BANDS_HZ[bandIdx] || 1000;
    const energyVal = currentBands[bandIdx] || 0;
    const dbEstimate = -80 + energyVal * 80;

    setHoveredBand({ freqHz, valDb: Math.round(dbEstimate), bandIdx });
  };

  const handleCanvasMouseLeave = () => {
    setHoveredBand(null);
  };

  // Color Legend Gradient scale data
  const legendStops = useMemo(() => {
    const stops = [];
    for (let i = 0; i <= 10; i++) {
      const fraction = i / 10;
      stops.push({
        pct: `${fraction * 100}%`,
        color: getColor(fraction),
      });
    }
    return stops;
  }, [getColor]);

  return (
    <div id="spectral-heatmap-container" className="bg-[#0A0B0D] border-2 border-[#202226] p-3 relative space-y-3 font-mono">
      {/* Industrial corner brackets */}
      <div style={{ borderColor: `${accentColor}66` }} className="absolute -top-[2px] -left-[2px] w-2 h-2 border-t-2 border-l-2" />
      <div style={{ borderColor: `${accentColor}66` }} className="absolute -top-[2px] -right-[2px] w-2 h-2 border-t-2 border-r-2" />
      <div style={{ borderColor: `${accentColor}66` }} className="absolute -bottom-[2px] -left-[2px] w-2 h-2 border-b-2 border-l-2" />
      <div style={{ borderColor: `${accentColor}66` }} className="absolute -bottom-[2px] -right-[2px] w-2 h-2 border-b-2 border-r-2" />

      {/* Header bar: Title, Signature Classification & Palette Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1A1B1F] pb-2 text-[10px] uppercase tracking-widest text-[#A0A0A0]">
        <div className="flex items-center gap-2">
          <span
            style={{
              backgroundColor: voiceDetected ? accentColor : isMonitoring ? '#00FF66' : '#50525A',
              boxShadow: voiceDetected ? `0 0 8px ${accentColor}` : isMonitoring ? '0 0 6px #00FF66' : 'none',
            }}
            className="w-2 h-2 rounded-full animate-pulse"
          />
          <span className="font-bold text-[#E0E0E0] tracking-wider">{t.spectralHeatmap}</span>
          <span className="text-[#60626A] text-[9px]">[{t.spectralResolution}]</span>
        </div>

        {/* Live Acoustic Classification & Diagnostics */}
        <div className="flex items-center gap-2 text-[10px]">
          {/* Target Signature Badge */}
          <div
            className={`px-2 py-0.5 border font-bold text-[9px] transition-colors ${
              voiceDetected
                ? 'bg-amber-500/15 border-amber-500/60 text-amber-300'
                : isMonitoring
                ? 'bg-[#121316] border-[#2A2C32] text-[#80FFB0]'
                : 'bg-[#121316] border-[#202226] text-[#60626A]'
            }`}
          >
            {signatureType}
          </div>

          {/* Palette Selector */}
          <div className="flex items-center gap-1 bg-[#121418] border border-[#202226] px-1.5 py-0.5 rounded-none">
            <span className="text-[#60626A] text-[8px] mr-1">{t.colorMap}:</span>
            {(['inferno', 'turbo', 'plasma', 'cyber'] as ColorPaletteType[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPalette(p)}
                className={`px-1.5 py-0.5 text-[8px] uppercase font-bold transition-colors ${
                  palette === p
                    ? 'bg-[#2A2D35] text-[#FFFFFF] shadow-sm'
                    : 'text-[#60626A] hover:text-[#C0C0C0]'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main Visualizer Stage: D3 Spectrogram Canvas + Real-Time FFT Energy Bars */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-stretch">
        {/* Left/Center: D3 Spectrogram Waterfall (10 Columns) */}
        <div className="md:col-span-9 relative flex flex-col justify-between bg-[#050608] border border-[#1E2024] p-1.5">
          {/* Frequency & Region Axis Labels (Left Overlay) */}
          <div className="absolute left-2.5 top-2 bottom-2 pointer-events-none flex flex-col justify-between text-[8px] font-mono text-[#585B66] select-none z-10">
            <span className="text-[#FF8888] bg-[#050608]/80 px-1 border border-[#FF8888]/20">8 kHz (HIGH HISS)</span>
            <span className="text-[#00F0FF] bg-[#050608]/80 px-1 border border-[#00F0FF]/30">3.4 kHz (VOICE TOP)</span>
            <span className="text-[#00FF66] bg-[#050608]/80 px-1 border border-[#00FF66]/30">1.0 kHz (FORMANT CORE)</span>
            <span className="text-[#00F0FF] bg-[#050608]/80 px-1 border border-[#00F0FF]/30">300 Hz (VOICE BASE)</span>
            <span className="text-[#FFB800] bg-[#050608]/80 px-1 border border-[#FFB800]/20">50 Hz (HUM/RUMBLE)</span>
          </div>

          {/* Real-Time Crosshair / Telemetry Tooltip */}
          {hoveredBand && (
            <div className="absolute right-3 top-2 bg-[#121418]/95 border border-[#303238] px-2 py-1 text-[9px] text-[#E0E0E0] shadow-lg z-20 pointer-events-none">
              <div className="text-[#00F0FF] font-bold">{hoveredBand.freqHz} Hz</div>
              <div className="text-[#A0A0A0]">Power: <span className="text-white">{hoveredBand.valDb} dBFS</span></div>
            </div>
          )}

          {/* D3 Canvas Element */}
          <canvas
            ref={canvasRef}
            width={560}
            height={160}
            onMouseMove={handleCanvasMouseMove}
            onMouseLeave={handleCanvasMouseLeave}
            className="w-full h-36 md:h-44 cursor-crosshair block"
          />

          {/* Time Division Footer Bar */}
          <div className="flex items-center justify-between text-[8px] font-mono text-[#50525A] pt-1 px-1 border-t border-[#13151A]">
            <span>-5.0s</span>
            <span>-3.75s</span>
            <span>-2.5s</span>
            <span>-1.25s</span>
            <span className="text-[#00FF66] font-bold">{t.now} (LIVE)</span>
          </div>
        </div>

        {/* Right: Instantaneous 32-Band Power Spectrum & Frequency Diagnostics (3 Columns) */}
        <div className="md:col-span-3 flex flex-col justify-between bg-[#050608] border border-[#1E2024] p-2 space-y-2">
          <div className="flex items-center justify-between text-[9px] text-[#80828A] border-b border-[#1A1C22] pb-1">
            <span className="font-bold text-[#D0D2D8]">{t.spectralIntensity}</span>
            <span className="text-[#00F0FF] font-bold">{isMonitoring ? `${peakFreqHz} Hz` : '-- Hz'}</span>
          </div>

          {/* Instantaneous Frequency Bars (Stacked Vertically or Equalizer Columns) */}
          <div className="h-28 flex items-end gap-[1px] bg-[#0A0C10] p-1 border border-[#14161C] overflow-hidden">
            {currentBands.map((val, idx) => {
              const isVoiceRegion = idx >= 5 && idx <= 16;
              const isLowRumble = idx <= 4;
              const isPeak = idx === peakBandIdx && isMonitoring;
              const heightPct = Math.max(2, Math.min(100, Math.round(val * 100)));

              let barColor = isVoiceRegion ? '#00F0FF' : isLowRumble ? '#FFB800' : '#FF4488';
              if (isPeak) barColor = '#FFFFFF';

              return (
                <div
                  key={idx}
                  className="flex-1 flex flex-col justify-end h-full group relative"
                  title={`${FREQUENCY_BANDS_HZ[idx]} Hz: ${Math.round(val * 100)}%`}
                >
                  <div
                    style={{
                      height: `${heightPct}%`,
                      backgroundColor: barColor,
                      boxShadow: isPeak ? `0 0 6px ${accentColor}` : 'none',
                    }}
                    className={`w-full transition-all duration-75 ${isPeak ? 'animate-pulse' : ''}`}
                  />
                </div>
              );
            })}
          </div>

          {/* Spectral Region Breakdown Meters */}
          <div className="space-y-1 text-[8px] font-mono">
            {/* Voice Formant Energy */}
            <div className="flex items-center justify-between">
              <span className="text-[#00F0FF]">{t.voiceBandEnergy}:</span>
              <span className="font-bold text-white">{isMonitoring ? `${voiceFormantEnergyPct}%` : '--%'}</span>
            </div>
            <div className="w-full bg-[#1A1D24] h-1 rounded-none overflow-hidden">
              <div
                style={{ width: `${isMonitoring ? voiceFormantEnergyPct : 0}%`, backgroundColor: '#00F0FF' }}
                className="h-full transition-all duration-100"
              />
            </div>

            {/* Low Rumble Energy */}
            <div className="flex items-center justify-between pt-0.5">
              <span className="text-[#FFB800]">{t.lowNoiseEnergy}:</span>
              <span className="font-bold text-[#A0A2AA]">{isMonitoring ? `${lowNoiseEnergyPct}%` : '--%'}</span>
            </div>
            <div className="w-full bg-[#1A1D24] h-1 rounded-none overflow-hidden">
              <div
                style={{ width: `${isMonitoring ? lowNoiseEnergyPct : 0}%`, backgroundColor: '#FFB800' }}
                className="h-full transition-all duration-100"
              />
            </div>

            {/* High Hiss Energy */}
            <div className="flex items-center justify-between pt-0.5">
              <span className="text-[#FF6688]">{t.highHissEnergy}:</span>
              <span className="font-bold text-[#A0A2AA]">{isMonitoring ? `${highHissEnergyPct}%` : '--%'}</span>
            </div>
            <div className="w-full bg-[#1A1D24] h-1 rounded-none overflow-hidden">
              <div
                style={{ width: `${isMonitoring ? highHissEnergyPct : 0}%`, backgroundColor: '#FF6688' }}
                className="h-full transition-all duration-100"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Footer Diagnostic & Color Scale Reference Legend */}
      <div className="flex flex-wrap items-center justify-between text-[8px] text-[#70727A] pt-1 border-t border-[#16181D] gap-2">
        {/* Region Color Keys */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 bg-[#FFB800]" />
            <span>{t.lowRumbleLabel}</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 bg-[#00F0FF]" />
            <span className="text-[#C0D8E8] font-bold">{t.voiceRegionLabel}</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 bg-[#FF6688]" />
            <span>{t.highHissLabel}</span>
          </div>
        </div>

        {/* Dynamic Color Scale dB Gradient Bar */}
        <div className="flex items-center gap-2">
          <span>-80 dBFS</span>
          <div
            style={{
              background: `linear-gradient(to right, ${legendStops.map(s => `${s.color} ${s.pct}`).join(', ')})`,
            }}
            className="w-24 md:w-32 h-2 border border-[#202226]"
          />
          <span className="text-[#FFFFFF] font-bold">0 dBFS</span>
        </div>
      </div>
    </div>
  );
};
