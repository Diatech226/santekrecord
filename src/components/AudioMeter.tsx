import React, { useEffect, useState, useRef } from 'react';
import * as d3 from 'd3';
import { RotateCcw, Activity, Zap, Layers } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext';
import { useTheme } from '../theme/ThemeContext';
import { SpectralHeatmap } from './SpectralHeatmap';
import { FftSpectrumVisualizer } from './FftSpectrumVisualizer';

interface Props {
  levelDbfs: number;
  thresholdDbfs: number;
  speechProb: number;
  vadThreshold: number;
  voiceDetected: boolean;
  isMonitoring: boolean;
  ambientNoiseDbfs?: number;
  liveWaveform?: number[];
  spectrum?: number[];
  analyserNode?: AnalyserNode | null;
  sampleRate?: number;
}

interface SignalPoint {
  time: number;
  dbfs: number;
}

export const AudioMeter: React.FC<Props> = ({
  levelDbfs,
  thresholdDbfs,
  speechProb,
  vadThreshold,
  voiceDetected,
  isMonitoring,
  ambientNoiseDbfs,
  liveWaveform,
  spectrum,
  analyserNode,
  sampleRate,
}) => {
  const { t } = useLanguage();
  const { currentThemeOption } = useTheme();
  const accentColor = currentThemeOption.primaryColor;

  // Spectral display mode: FFT Spectrum Analyzer, Waterfall Spectrogram, or Combined
  const [spectralViewMode, setSpectralViewMode] = useState<'spectrum' | 'heatmap' | 'combined'>('spectrum');

  // Full diagnostic range: even very quiet hardware remains visible.
  const minDbfs = -100;
  const maxDbfs = 0;
  const clampedDbfs = Math.max(minDbfs, Math.min(maxDbfs, isMonitoring ? levelDbfs : -70));

  // Persistent Peak Hold state: tracks maximum signal reached until manual reset
  const [peakHoldDbfs, setPeakHoldDbfs] = useState<number | null>(null);

  // Update peak hold when monitoring and current level exceeds previous peak
  useEffect(() => {
    if (isMonitoring && levelDbfs > minDbfs) {
      setPeakHoldDbfs((prevPeak) => {
        if (prevPeak === null) return levelDbfs;
        return Math.max(prevPeak, levelDbfs);
      });
    }
  }, [isMonitoring, levelDbfs]);

  // Manual reset handler for Peak Hold
  const handleResetPeak = () => {
    if (isMonitoring && levelDbfs > minDbfs) {
      setPeakHoldDbfs(levelDbfs);
    } else {
      setPeakHoldDbfs(null);
    }
  };

  // Percentage for continuous bar
  const percent = Math.max(0, Math.min(100, ((clampedDbfs - minDbfs) / (maxDbfs - minDbfs)) * 100));
  const thresholdPercent = Math.max(0, Math.min(100, ((thresholdDbfs - minDbfs) / (maxDbfs - minDbfs)) * 100));
  
  // Peak Hold percentage position
  const peakClamped = peakHoldDbfs !== null ? Math.max(minDbfs, Math.min(maxDbfs, peakHoldDbfs)) : null;
  const peakPercent = peakClamped !== null ? Math.max(0, Math.min(100, ((peakClamped - minDbfs) / (maxDbfs - minDbfs)) * 100)) : null;

  // Segment count for technical hardware LED meter
  const totalSegments = 28;
  const activeSegments = isMonitoring ? Math.round((percent / 100) * totalSegments) : 0;
  const thresholdSegmentIndex = Math.round((thresholdPercent / 100) * totalSegments);

  const isAboveThreshold = isMonitoring && levelDbfs >= thresholdDbfs;
  const isVadActive = isMonitoring && speechProb >= vadThreshold;

  // 10-second rolling dBFS history, fed by the backend WebSocket telemetry.
  const [history, setHistory] = useState<SignalPoint[]>(() => {
    const now = Date.now();
    // Keep a visible baseline before the first hardware frame arrives.
    const initial: SignalPoint[] = [];
    for (let i = 50; i >= 0; i--) {
      initial.push({ time: now - i * 100, dbfs: -70 });
    }
    return initial;
  });

  // Persistent Ambient Noise Floor Real-Time Sparkline History (40 rolling samples)
  const [ambientHistory, setAmbientHistory] = useState<number[]>(() => Array(40).fill(-60));
  const latestAmbientRef = useRef<number>(ambientNoiseDbfs ?? -60);
  latestAmbientRef.current = ambientNoiseDbfs ?? -60;

  useEffect(() => {
    const interval = setInterval(() => {
      const val = isMonitoring ? latestAmbientRef.current : -60;
      setAmbientHistory((prev) => [...prev.slice(1), val]);
    }, 200); // 5 Hz sampling for smooth sparkline telemetry

    return () => clearInterval(interval);
  }, [isMonitoring]);

  const latestLevelRef = useRef<number>(levelDbfs);
  latestLevelRef.current = isMonitoring ? levelDbfs : -70;

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      const currentLevel = latestLevelRef.current;

      setHistory((prev) => {
        const windowStart = now - 10000;
        const filtered = prev.filter((p) => p.time >= windowStart);
        return [...filtered, { time: now, dbfs: currentLevel }];
      });
    }, 125); // 8 Hz: responsive without transmitting/rendering raw waveforms

    return () => clearInterval(interval);
  }, []);

  // SVG dimensions for D3 waveform rendering
  const svgWidth = 560;
  const svgHeight = 110;
  const margin = { top: 12, right: 12, bottom: 22, left: 38 };
  const innerWidth = svgWidth - margin.left - margin.right;
  const innerHeight = svgHeight - margin.top - margin.bottom;

  // D3 Scales & Generators
  const now = history.length > 0 ? history[history.length - 1].time : Date.now();
  const xScale = d3.scaleLinear()
    .domain([now - 10000, now])
    .range([0, innerWidth]);

  const yScale = d3.scaleLinear()
    .domain([minDbfs, maxDbfs])
    .range([innerHeight, 0]);

  const lineGenerator = d3.line<SignalPoint>()
    .x((d) => xScale(d.time))
    .y((d) => yScale(Math.max(minDbfs, Math.min(maxDbfs, d.dbfs))))
    .curve(d3.curveMonotoneX);

  const areaGenerator = d3.area<SignalPoint>()
    .x((d) => xScale(d.time))
    .y0(innerHeight)
    .y1((d) => yScale(Math.max(minDbfs, Math.min(maxDbfs, d.dbfs))))
    .curve(d3.curveMonotoneX);

  const linePath = lineGenerator(history) || '';
  const areaPath = areaGenerator(history) || '';
  const thresholdY = yScale(Math.max(minDbfs, Math.min(maxDbfs, thresholdDbfs)));
  const peakY = peakClamped !== null ? yScale(peakClamped) : null;
  const ambientY = (isMonitoring && ambientNoiseDbfs !== undefined && ambientNoiseDbfs > minDbfs)
    ? yScale(Math.max(minDbfs, Math.min(maxDbfs, ambientNoiseDbfs)))
    : null;

  // Grid tick values for calibrated measurements
  const calibratedTicks = [
    { db: -60, label: '-60dB', percent: (( -60 - minDbfs) / (maxDbfs - minDbfs)) * 100 },
    { db: -40, label: '-40dB', percent: (( -40 - minDbfs) / (maxDbfs - minDbfs)) * 100 },
    { db: -20, label: '-20dB', percent: (( -20 - minDbfs) / (maxDbfs - minDbfs)) * 100 },
    { db: 0,   label: '0dB',   percent: 100 },
  ];

  const yTicks = [0, -20, -40, -60, -80, -100];
  const timeTicks = [10, 8, 6, 4, 2, 0];

  // Ambient Noise Floor Sparkline Calculations
  const sparkWidth = 560;
  const sparkHeight = 44;
  const sparkMinDbfs = -75;
  const sparkMaxDbfs = -30;

  const validAmbientHistory = ambientHistory.filter((v) => v > -90);
  const currentAmbient = isMonitoring ? (ambientNoiseDbfs ?? -60) : -60;
  const minAmbient = validAmbientHistory.length > 0 ? Math.min(...validAmbientHistory) : currentAmbient;
  const maxAmbient = validAmbientHistory.length > 0 ? Math.max(...validAmbientHistory) : currentAmbient;
  const avgAmbient = validAmbientHistory.length > 0 ? validAmbientHistory.reduce((a, b) => a + b, 0) / validAmbientHistory.length : currentAmbient;

  // Noise classification
  let noiseQuality = t.ambientQuiet;
  let noiseQualityBadgeClass = 'text-[#00F0FF] border-[#00F0FF]/40 bg-[#00F0FF]/10';
  if (currentAmbient > -45) {
    noiseQuality = t.ambientNoisy;
    noiseQualityBadgeClass = 'text-[#FF4444] border-[#FF4444]/40 bg-[#FF4444]/10';
  } else if (currentAmbient > -55) {
    noiseQuality = t.ambientModerate;
    noiseQualityBadgeClass = 'text-[#FFB800] border-[#FFB800]/40 bg-[#FFB800]/10';
  }

  const sparkPoints = ambientHistory.map((val, idx) => {
    const x = (idx / (ambientHistory.length - 1)) * sparkWidth;
    const clampedVal = Math.max(sparkMinDbfs, Math.min(sparkMaxDbfs, val));
    const y = sparkHeight - ((clampedVal - sparkMinDbfs) / (sparkMaxDbfs - sparkMinDbfs)) * (sparkHeight - 10) - 5;
    return { x, y, val };
  });

  const sparkLinePath = sparkPoints.length > 0
    ? `M ${sparkPoints.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' L ')}`
    : '';

  const sparkAreaPath = sparkPoints.length > 0
    ? `M 0,${sparkHeight} L ${sparkPoints.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' L ')} L ${sparkWidth},${sparkHeight} Z`
    : '';

  const latestSparkPoint = sparkPoints[sparkPoints.length - 1];

  // Real-Time Live Audio Buffer Waveform (Oscilloscope) Calculations
  const rawWaveform = isMonitoring && liveWaveform && liveWaveform.length > 0
    ? liveWaveform
    : new Array(128).fill(0);

  // Input Clarity & Diagnostic Metrics
  let maxAbsSample = 0;
  let sumSquare = 0;
  for (let i = 0; i < rawWaveform.length; i++) {
    const val = rawWaveform[i];
    const abs = Math.abs(val);
    if (abs > maxAbsSample) maxAbsSample = abs;
    sumSquare += val * val;
  }

  const bufferRms = Math.sqrt(sumSquare / Math.max(1, rawWaveform.length));
  const isClipping = maxAbsSample >= 0.96;
  const crestFactorDb = bufferRms > 1e-4 ? 20 * Math.log10(maxAbsSample / bufferRms) : 0;
  const snrEstimateDb = (ambientNoiseDbfs !== undefined && levelDbfs > ambientNoiseDbfs)
    ? Math.max(0, levelDbfs - ambientNoiseDbfs)
    : 0;

  let clarityLabel = t.systemStandby;
  let clarityBadgeStyle = 'text-[#70727A] border-[#202226] bg-[#121316]';

  if (isMonitoring) {
    if (isClipping) {
      clarityLabel = t.clarityClipping;
      clarityBadgeStyle = 'text-[#FF4444] border-[#FF4444]/60 bg-[#FF4444]/15 animate-pulse';
    } else if (maxAbsSample > 0.12 && crestFactorDb >= 7 && crestFactorDb <= 24) {
      clarityLabel = t.clarityPristine;
      clarityBadgeStyle = 'text-[#00F0FF] border-[#00F0FF]/50 bg-[#00F0FF]/15';
    } else if (maxAbsSample > 0.04) {
      clarityLabel = t.clarityOptimal;
      clarityBadgeStyle = 'text-[#00FF66] border-[#00FF66]/50 bg-[#00FF66]/15';
    } else {
      clarityLabel = t.clarityLow;
      clarityBadgeStyle = 'text-[#FFB800] border-[#FFB800]/50 bg-[#FFB800]/15';
    }
  }

  // Waveform SVG Dimensions
  const waveWidth = 560;
  const waveHeight = 88;
  const centerY = waveHeight / 2;

  const wavePoints = rawWaveform.map((val, idx) => {
    const x = (idx / (rawWaveform.length - 1)) * waveWidth;
    const clamped = Math.max(-1.0, Math.min(1.0, val));
    const y = centerY - clamped * (centerY - 8);
    return { x, y, val };
  });

  const waveLinePath = wavePoints.length > 0
    ? `M ${wavePoints.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' L ')}`
    : `M 0,${centerY} L ${waveWidth},${centerY}`;

  const waveAreaPath = wavePoints.length > 0
    ? `M 0,${centerY} L ${wavePoints.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' L ')} L ${waveWidth},${centerY} Z`
    : '';

  return (
    <div id="audio-meter-block" className="AudioMeter space-y-4 font-mono select-none">
      {/* Industrial Enclosure: Audio Level Section */}
      <div className="bg-[#0A0B0D] border-2 border-[#202226] p-3.5 relative space-y-3">
        {/* Hardware Corner Accents */}
        <div className="absolute -top-[2px] -left-[2px] w-2 h-2 border-t-2 border-l-2 border-[#00F0FF]" />
        <div className="absolute -top-[2px] -right-[2px] w-2 h-2 border-t-2 border-r-2 border-[#00F0FF]" />
        <div className="absolute -bottom-[2px] -left-[2px] w-2 h-2 border-b-2 border-l-2 border-[#00F0FF]" />
        <div className="absolute -bottom-[2px] -right-[2px] w-2 h-2 border-b-2 border-r-2 border-[#00F0FF]" />

        {/* Header Telemetry */}
        <div className="flex flex-wrap items-center justify-between text-[10px] uppercase tracking-widest text-[#A0A0A0] border-b border-[#1A1B1F] pb-2 gap-2">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 bg-[#00F0FF] shadow-[0_0_6px_#00F0FF]" />
            <span className="font-bold text-[#E0E0E0] tracking-wider">{t.rmsSignalLevel}</span>
            <span className="text-[9px] text-[#50525A] bg-[#121316] border border-[#202226] px-1.5 py-0.2">CAL-16K</span>
          </div>

          <div className="flex items-center gap-2.5 sm:gap-3 flex-wrap">
            {/* Live dBFS Readout */}
            <span
              className={`font-mono text-xs font-bold tracking-wider ${
                isAboveThreshold ? 'text-[#00F0FF] drop-shadow-[0_0_8px_rgba(0,240,255,0.6)]' : 'text-[#E0E0E0]'
              }`}
            >
              {isMonitoring ? `${levelDbfs.toFixed(1)} dBFS` : '--.- dBFS'}
            </span>

            {/* Ambient Noise Floor Readout */}
            {isMonitoring && ambientNoiseDbfs !== undefined && (
              <>
                <span className="text-[#303238]">|</span>
                <span className="text-[#70727A] text-[10px]" title={t.ambientFloor}>
                  {t.ambientNoise}: <span className="text-[#00F0FF]/80 font-bold font-mono text-[11px]">{ambientNoiseDbfs.toFixed(1)} dB</span>
                </span>
                <span className="text-[#303238]">|</span>
                {/* Real-time SNR Delta Readout */}
                <span className="text-[#70727A] text-[10px]" title={`Signal (${levelDbfs.toFixed(1)} dBFS) - Ambient Noise (${ambientNoiseDbfs.toFixed(1)} dBFS)`}>
                  SNR: <span className={`font-bold font-mono text-[11px] ${
                    snrEstimateDb >= 20 ? 'text-[#00F0FF]' : snrEstimateDb >= 12 ? 'text-[#00FF66]' : snrEstimateDb >= 6 ? 'text-[#FFB800]' : 'text-[#80828A]'
                  }`}>
                    +{snrEstimateDb.toFixed(1)} dB
                  </span>
                </span>
              </>
            )}

            <span className="text-[#303238]">|</span>

            {/* Persistent Peak Hold Readout & Reset Trigger */}
            <div className="flex items-center gap-1.5">
              <span className="text-[#70727A] text-[10px]">{t.peak}:</span>
              <span className="text-[#FFB800] font-bold font-mono text-[11px] drop-shadow-[0_0_6px_rgba(255,184,0,0.35)]">
                {peakHoldDbfs !== null ? `${peakHoldDbfs.toFixed(1)} dB` : '--.- dB'}
              </span>
              <button
                id="btn-reset-peak-hold"
                type="button"
                onClick={handleResetPeak}
                title="Reset Peak Hold indicator"
                className="px-1.5 py-0.5 bg-[#16171B] hover:bg-[#20222A] active:bg-[#FFB800]/20 text-[#8A8D96] hover:text-[#FFB800] border border-[#2A2B35] text-[8px] font-bold font-mono uppercase tracking-wider flex items-center gap-1 transition-colors cursor-pointer"
              >
                <RotateCcw className="w-2.5 h-2.5" />
                {t.resetPeak}
              </button>
            </div>

            <span className="text-[#303238]">|</span>

            {/* Trigger Threshold */}
            <span className="text-[#70727A] text-[10px]">
              {t.trg}: <span style={{ color: accentColor }} className="font-bold">{thresholdDbfs} dB</span>
            </span>
          </div>
        </div>

        {/* LED Segmented Visual Bar with Industrial Housing */}
        <div className="space-y-1">
          <div className="h-7 bg-[#050608] border border-[#2A2B2F] p-1 flex items-center gap-[3px] relative shadow-inner overflow-visible">
            {Array.from({ length: totalSegments }).map((_, idx) => {
              const isActive = idx < activeSegments;
              const isThresholdMarker = idx === thresholdSegmentIndex;

              let segmentClass = 'bg-[#141518] border border-[#1A1B1F]';
              if (isActive) {
                if (idx >= totalSegments - 3) {
                  segmentClass = 'bg-[#FF4444] border-[#FF4444] shadow-[0_0_6px_#FF4444]'; // Peak / Red
                } else if (idx >= totalSegments - 7) {
                  return (
                    <div
                      key={idx}
                      style={{
                        backgroundColor: accentColor,
                        borderColor: accentColor,
                        boxShadow: `0 0 6px ${accentColor}`,
                      }}
                      className="flex-1 h-full relative border"
                    >
                      {isThresholdMarker && (
                        <div
                          title={`Trigger Threshold: ${thresholdDbfs} dBFS`}
                          className="absolute -top-1.5 -bottom-1.5 left-1/2 -translate-x-1/2 w-[2px] bg-[#FFFFFF] z-20 shadow-[0_0_6px_#FFFFFF]"
                        />
                      )}
                    </div>
                  );
                } else {
                  const opacityPercent = Math.min(100, Math.max(30, Math.round((idx / (totalSegments - 7)) * 100)));
                  return (
                    <div
                      key={idx}
                      style={{
                        backgroundColor: accentColor,
                        borderColor: `${accentColor}80`,
                        opacity: opacityPercent / 100,
                      }}
                      className="flex-1 h-full relative border"
                    >
                      {isThresholdMarker && (
                        <div
                          title={`Trigger Threshold: ${thresholdDbfs} dBFS`}
                          className="absolute -top-1.5 -bottom-1.5 left-1/2 -translate-x-1/2 w-[2px] bg-[#FFFFFF] z-20 shadow-[0_0_6px_#FFFFFF]"
                        />
                      )}
                    </div>
                  );
                }
              }

              return (
                <div
                  key={idx}
                  className={`flex-1 h-full relative transition-colors duration-75 ${segmentClass}`}
                >
                  {isThresholdMarker && (
                    <div
                      title={`Trigger Threshold: ${thresholdDbfs} dBFS`}
                      className="absolute -top-1.5 -bottom-1.5 left-1/2 -translate-x-1/2 w-[2px] bg-[#FFFFFF] z-20 shadow-[0_0_6px_#FFFFFF]"
                    />
                  )}
                </div>
              );
            })}

            {/* Persistent Peak Hold Indicator Line on LED Bar */}
            {peakPercent !== null && (
              <div
                id="peak-hold-led-indicator"
                title={`${t.peakHold}: ${peakHoldDbfs?.toFixed(1)} dBFS`}
                style={{ left: `${peakPercent}%` }}
                onClick={handleResetPeak}
                className="absolute -top-2 -bottom-2 -translate-x-1/2 w-[3px] bg-[#FFB800] z-30 shadow-[0_0_10px_#FFB800] cursor-pointer group"
              >
                {/* Triangular top pointer */}
                <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[3px] border-l-transparent border-r-[3px] border-r-transparent border-t-[4px] border-t-[#FFB800]" />
              </div>
            )}
          </div>

          {/* Calibrated Hardware Tick Marks Ruler (-60dB, -40dB, -20dB, 0dB) */}
          <div className="relative h-6 w-full text-[9px] font-mono text-[#70727A] pt-0.5">
            {/* Horizontal baseline guide */}
            <div className="absolute top-0 left-0 right-0 h-[1px] bg-[#2A2B2F]" />

            {/* Sub-ticks every 10 dB across the span */}
            {[-70, -60, -50, -40, -30, -20, -10, 0].map((val) => {
              const posPercent = ((val - minDbfs) / (maxDbfs - minDbfs)) * 100;
              const isMajor = val === -60 || val === -40 || val === -20 || val === 0;
              return (
                <div
                  key={val}
                  style={{ left: `${posPercent}%` }}
                  className={`absolute top-0 -translate-x-1/2 ${
                    isMajor ? 'h-2 w-[1.5px] bg-[#00F0FF]/80' : 'h-1 w-[1px] bg-[#3A3C42]'
                  }`}
                />
              );
            })}

            {/* Major Calibrated Labels */}
            {calibratedTicks.map((tick) => (
              <div
                key={tick.label}
                style={{ left: `${tick.percent}%` }}
                className="absolute top-2.5 -translate-x-1/2 flex flex-col items-center pointer-events-none"
              >
                <span className={`font-mono text-[9px] font-bold tracking-tight ${
                  clampedDbfs >= tick.db && isMonitoring ? 'text-[#00F0FF]' : 'text-[#8A8D96]'
                }`}>
                  {tick.label}
                </span>
              </div>
            ))}

            {/* Baseline minimum notch -70dB */}
            <div className="absolute top-2.5 left-0 -translate-x-0 font-mono text-[9px] text-[#4A4C52]">
              -70dB
            </div>
          </div>
        </div>
      </div>

      {/* Persistent Ambient Noise Floor Real-Time SVG Sparkline */}
      <div id="ambient-noise-sparkline-panel" className="bg-[#0A0B0D] border-2 border-[#202226] p-3 relative space-y-2">
        {/* Subtle industrial corner accents */}
        <div style={{ borderColor: `${accentColor}66` }} className="absolute -top-[2px] -left-[2px] w-2 h-2 border-t-2 border-l-2" />
        <div style={{ borderColor: `${accentColor}66` }} className="absolute -top-[2px] -right-[2px] w-2 h-2 border-t-2 border-r-2" />
        <div style={{ borderColor: `${accentColor}66` }} className="absolute -bottom-[2px] -left-[2px] w-2 h-2 border-b-2 border-l-2" />
        <div style={{ borderColor: `${accentColor}66` }} className="absolute -bottom-[2px] -right-[2px] w-2 h-2 border-b-2 border-r-2" />

        {/* Telemetry & Stats Header */}
        <div className="flex flex-wrap items-center justify-between text-[10px] uppercase tracking-widest text-[#A0A0A0] border-b border-[#1A1B1F] pb-1.5 gap-2">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 bg-[#00F0FF] shadow-[0_0_6px_#00F0FF] animate-pulse" />
            <span className="font-bold text-[#E0E0E0] tracking-wider">{t.ambientFloorSparkline}</span>
            <span className={`text-[8px] font-bold px-1.5 py-0.5 border ${noiseQualityBadgeClass}`}>
              {isMonitoring ? noiseQuality : t.systemStandby}
            </span>
          </div>

          <div className="flex items-center gap-2.5 sm:gap-3 text-[10px] font-mono flex-wrap">
            <span className="text-[#70727A]">
              CUR: <span className="text-[#00F0FF] font-bold text-[11px]">{isMonitoring ? `${currentAmbient.toFixed(1)} dB` : '--.- dB'}</span>
            </span>
            <span className="text-[#303238]">|</span>
            <span className="text-[#70727A]">
              {t.ambientMin}: <span className="text-[#E0E0E0]">{isMonitoring ? `${minAmbient.toFixed(1)} dB` : '--.- dB'}</span>
            </span>
            <span className="text-[#303238]">|</span>
            <span className="text-[#70727A]">
              {t.ambientMax}: <span className="text-[#E0E0E0]">{isMonitoring ? `${maxAmbient.toFixed(1)} dB` : '--.- dB'}</span>
            </span>
            <span className="text-[#303238]">|</span>
            <span className="text-[#70727A]">
              {t.ambientAvg}: <span className="text-[#A0A0A0]">{isMonitoring ? `${avgAmbient.toFixed(1)} dB` : '--.- dB'}</span>
            </span>
          </div>
        </div>

        {/* Real-time SVG Sparkline Graph */}
        <div className="relative bg-[#050608] border border-[#1E2024] p-1.5 overflow-hidden">
          <svg
            viewBox={`0 0 ${sparkWidth} ${sparkHeight}`}
            className="w-full h-11 lg:h-12 overflow-visible"
            preserveAspectRatio="none"
          >
            <defs>
              <linearGradient id="ambient-spark-gradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#00F0FF" stopOpacity="0.35" />
                <stop offset="75%" stopColor="#00F0FF" stopOpacity="0.08" />
                <stop offset="100%" stopColor="#00F0FF" stopOpacity="0.0" />
              </linearGradient>
              <filter id="spark-glow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="1.5" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {/* Reference Grid Lines (-70dB, -55dB, -40dB) */}
            {[-70, -55, -40].map((val) => {
              const y = sparkHeight - ((val - sparkMinDbfs) / (sparkMaxDbfs - sparkMinDbfs)) * (sparkHeight - 10) - 5;
              return (
                <g key={val}>
                  <line
                    x1={0}
                    y1={y}
                    x2={sparkWidth}
                    y2={y}
                    stroke="#16181D"
                    strokeWidth="1"
                    strokeDasharray="2,3"
                  />
                  <text
                    x={sparkWidth - 4}
                    y={y - 2}
                    textAnchor="end"
                    fontSize="7"
                    fill="#454852"
                    fontFamily="JetBrains Mono, monospace"
                  >
                    {val}dB
                  </text>
                </g>
              );
            })}

            {/* Sparkline Area Fill */}
            <path
              d={sparkAreaPath}
              fill="url(#ambient-spark-gradient)"
            />

            {/* Sparkline Stroke Path */}
            <path
              d={sparkLinePath}
              fill="none"
              stroke="#00F0FF"
              strokeWidth="1.5"
              filter="url(#spark-glow)"
            />

            {/* Real-time Leading Edge Pulse Dot */}
            {isMonitoring && latestSparkPoint && (
              <g>
                <circle
                  cx={latestSparkPoint.x}
                  cy={latestSparkPoint.y}
                  r="3"
                  fill="#00F0FF"
                  className="animate-ping opacity-75"
                />
                <circle
                  cx={latestSparkPoint.x}
                  cy={latestSparkPoint.y}
                  r="2"
                  fill="#FFFFFF"
                />
              </g>
            )}
          </svg>
        </div>
      </div>

      {/* 5-Second Scrolling D3.js RMS Signal History */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[10px] text-[#A0A0A0] uppercase tracking-wider">
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 bg-[#00F0FF] shadow-[0_0_4px_#00F0FF]" />
            <span className="font-bold text-[#E0E0E0]">{t.timeSeriesTelemetry}</span>
          </span>
          <span className="text-[9px] font-mono text-[#70727A]">
            {isAboveThreshold ? (
              <span className="text-[#FF4444] font-bold tracking-wider animate-pulse">{t.thresholdBreach}</span>
            ) : isMonitoring ? (
              <span className="text-[#00F0FF]">{t.liveSampling}</span>
            ) : (
              t.systemStandby
            )}
          </span>
        </div>

        <div className="relative bg-[#0A0B0D] border-2 border-[#202226] p-2 overflow-hidden">
          {/* Subtle industrial corner brackets */}
          <div style={{ borderColor: `${accentColor}66` }} className="absolute top-0 left-0 w-1.5 h-1.5 border-t border-l" />
          <div style={{ borderColor: `${accentColor}66` }} className="absolute top-0 right-0 w-1.5 h-1.5 border-t border-r" />
          <div style={{ borderColor: `${accentColor}66` }} className="absolute bottom-0 left-0 w-1.5 h-1.5 border-b border-l" />
          <div style={{ borderColor: `${accentColor}66` }} className="absolute bottom-0 right-0 w-1.5 h-1.5 border-b border-r" />

          <svg
            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
            className="w-full h-24 lg:h-28 overflow-visible"
            preserveAspectRatio="none"
          >
            <defs>
              {/* Signal Fill Gradient */}
              <linearGradient id="signal-gradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={accentColor} stopOpacity="0.45" />
                <stop offset="60%" stopColor={accentColor} stopOpacity="0.12" />
                <stop offset="100%" stopColor={accentColor} stopOpacity="0.0" />
              </linearGradient>

              {/* Glow Filter */}
              <filter id="cyan-glow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="2" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            <g transform={`translate(${margin.left}, ${margin.top})`}>
              {/* Background Grid Lines & Calibrated Y-Labels (-60, -40, -20, 0 dB) */}
              {yTicks.map((tickVal) => {
                const yPos = yScale(tickVal);
                return (
                  <g key={tickVal}>
                    <line
                      x1={0}
                      y1={yPos}
                      x2={innerWidth}
                      y2={yPos}
                      stroke={tickVal === 0 ? '#2A2B2F' : '#1A1B1F'}
                      strokeWidth={tickVal === 0 ? '1.5' : '1'}
                      strokeDasharray={tickVal === 0 ? undefined : '2,2'}
                    />
                    {/* High contrast monospace label */}
                    <text
                      x={-6}
                      y={yPos + 3}
                      textAnchor="end"
                      fontSize="9"
                      fontWeight="bold"
                      fill={tickVal === 0 ? '#E0E0E0' : '#8A8D96'}
                      fontFamily="JetBrains Mono, monospace"
                    >
                      {tickVal}dB
                    </text>
                  </g>
                );
              })}

              {/* Time Grid Lines (0s to -5s) */}
              {timeTicks.map((sec) => {
                const xPos = (innerWidth / 5) * (5 - sec);
                return (
                  <g key={sec}>
                    <line
                      x1={xPos}
                      y1={0}
                      x2={xPos}
                      y2={innerHeight}
                      stroke="#141518"
                      strokeWidth="1"
                    />
                    <text
                      x={xPos}
                      y={innerHeight + 14}
                      textAnchor="middle"
                      fontSize="8"
                      fontWeight="600"
                      fill="#60626A"
                      fontFamily="JetBrains Mono, monospace"
                    >
                      {sec === 0 ? t.now : `-${sec}s`}
                    </text>
                  </g>
                );
              })}

              {/* Calibrated Threshold Horizontal Guide */}
              <line
                x1={0}
                y1={thresholdY}
                x2={innerWidth}
                y2={thresholdY}
                stroke={accentColor}
                strokeWidth="1.25"
                strokeDasharray="4,3"
                opacity="0.8"
              />
              <text
                x={innerWidth - 4}
                y={thresholdY - 3}
                textAnchor="end"
                fontSize="8"
                fontWeight="bold"
                fill={accentColor}
                fontFamily="JetBrains Mono, monospace"
                opacity="0.9"
              >
                {t.trg} {thresholdDbfs}dB
              </text>

              {/* Ambient Background Noise Horizontal Guide Line */}
              {ambientY !== null && (
                <g id="ambient-noise-graph-line" className="ambient-floor-guide">
                  <line
                    x1={0}
                    y1={ambientY}
                    x2={innerWidth}
                    y2={ambientY}
                    stroke="#00F0FF"
                    strokeWidth="1"
                    strokeDasharray="2,3"
                    opacity="0.45"
                  />
                  <text
                    x={6}
                    y={ambientY - 3}
                    textAnchor="start"
                    fontSize="7.5"
                    fontWeight="600"
                    fill="#00F0FF"
                    fontFamily="JetBrains Mono, monospace"
                    opacity="0.75"
                  >
                    {t.ambientNoise}: {ambientNoiseDbfs?.toFixed(1)}dB
                  </text>
                </g>
              )}

              {/* Persistent Peak Hold Horizontal Indicator Line on D3 Graph */}
              {peakY !== null && (
                <g id="peak-hold-graph-line" className="peak-hold-guide">
                  <line
                    x1={0}
                    y1={peakY}
                    x2={innerWidth}
                    y2={peakY}
                    stroke="#FFB800"
                    strokeWidth="1.25"
                    strokeDasharray="5,3"
                    opacity="0.85"
                  />
                  <text
                    x={innerWidth - 4}
                    y={peakY - 3}
                    textAnchor="end"
                    fontSize="8"
                    fontWeight="bold"
                    fill="#FFB800"
                    fontFamily="JetBrains Mono, monospace"
                    opacity="0.95"
                  >
                    {t.peakHold} {peakHoldDbfs?.toFixed(1)}dB
                  </text>
                </g>
              )}

              {/* Area Fill */}
              <path
                d={areaPath}
                fill="url(#signal-gradient)"
              />

              {/* D3 Main Signal Path */}
              <path
                d={linePath}
                fill="none"
                stroke={accentColor}
                strokeWidth="1.75"
                filter="url(#cyan-glow)"
              />

              {/* Live Head Circle at NOW point */}
              {history.length > 0 && isMonitoring && (
                <circle
                  cx={innerWidth}
                  cy={yScale(Math.max(minDbfs, Math.min(maxDbfs, latestLevelRef.current)))}
                  r="3.5"
                  fill={isAboveThreshold ? '#FF4444' : accentColor}
                  className={isAboveThreshold ? 'animate-ping' : ''}
                />
              )}
            </g>
          </svg>
        </div>
      </div>

      {/* Real-Time Live Audio Buffer Waveform (PCM Oscilloscope) */}
      <div id="live-waveform-buffer-panel" className="bg-[#0A0B0D] border-2 border-[#202226] p-3 relative space-y-2">
        {/* Subtle industrial corner accents */}
        <div style={{ borderColor: `${accentColor}66` }} className="absolute -top-[2px] -left-[2px] w-2 h-2 border-t-2 border-l-2" />
        <div style={{ borderColor: `${accentColor}66` }} className="absolute -top-[2px] -right-[2px] w-2 h-2 border-t-2 border-r-2" />
        <div style={{ borderColor: `${accentColor}66` }} className="absolute -bottom-[2px] -left-[2px] w-2 h-2 border-b-2 border-l-2" />
        <div style={{ borderColor: `${accentColor}66` }} className="absolute -bottom-[2px] -right-[2px] w-2 h-2 border-b-2 border-r-2" />

        {/* Header & Clarity Telemetry */}
        <div className="flex flex-wrap items-center justify-between text-[10px] uppercase tracking-widest text-[#A0A0A0] border-b border-[#1A1B1F] pb-1.5 gap-2">
          <div className="flex items-center gap-2">
            <span
              style={{
                backgroundColor: isClipping ? '#FF4444' : (voiceDetected ? accentColor : '#00F0FF'),
                boxShadow: isClipping ? '0 0 8px #FF4444' : `0 0 6px ${voiceDetected ? accentColor : '#00F0FF'}`,
              }}
              className="w-1.5 h-1.5 rounded-full animate-pulse"
            />
            <span className="font-bold text-[#E0E0E0] tracking-wider">{t.liveWaveformBuffer}</span>
            <span className={`text-[8px] font-bold px-1.5 py-0.5 border ${clarityBadgeStyle}`}>
              {clarityLabel}
            </span>
          </div>

          <div className="flex items-center gap-2.5 sm:gap-3 text-[10px] font-mono flex-wrap">
            <span className="text-[#70727A]">
              PEAK: <span className={isClipping ? 'text-[#FF4444] font-bold' : 'text-[#E0E0E0]'}>
                {isMonitoring ? `${(maxAbsSample * 100).toFixed(0)}% FS` : '--%'}
              </span>
            </span>
            <span className="text-[#303238]">|</span>
            <span className="text-[#70727A]" title={t.crestFactor}>
              CF: <span className="text-[#00F0FF]">{isMonitoring ? `${crestFactorDb.toFixed(1)} dB` : '--.- dB'}</span>
            </span>
            <span className="text-[#303238]">|</span>
            <span className="text-[#70727A]" title={t.snrEstimate}>
              SNR: <span className="text-[#00FF66]">{isMonitoring ? `+${snrEstimateDb.toFixed(0)} dB` : '-- dB'}</span>
            </span>
            <span className="text-[#303238]">|</span>
            <span className="text-[#50525A] text-[9px]">
              {t.bufferWindow}
            </span>
          </div>
        </div>

        {/* Oscilloscope SVG Display */}
        <div className={`relative bg-[#050608] border ${isClipping ? 'border-[#FF4444]/60' : 'border-[#1E2024]'} p-1.5 overflow-hidden transition-colors`}>
          <svg
            viewBox={`0 0 ${waveWidth} ${waveHeight}`}
            className="w-full h-16 lg:h-20 overflow-visible"
            preserveAspectRatio="none"
          >
            <defs>
              <linearGradient id="waveform-area-gradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={accentColor} stopOpacity="0.30" />
                <stop offset="50%" stopColor={accentColor} stopOpacity="0.05" />
                <stop offset="100%" stopColor={accentColor} stopOpacity="0.30" />
              </linearGradient>

              <filter id="waveform-glow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="1.75" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {/* Clipping Limit Lines (+0.95 & -0.95 FS) */}
            <line
              x1={0}
              y1={centerY - 0.95 * (centerY - 8)}
              x2={waveWidth}
              y2={centerY - 0.95 * (centerY - 8)}
              stroke="#FF4444"
              strokeWidth="0.75"
              strokeDasharray="3,4"
              opacity="0.35"
            />
            <line
              x1={0}
              y1={centerY + 0.95 * (centerY - 8)}
              x2={waveWidth}
              y2={centerY + 0.95 * (centerY - 8)}
              stroke="#FF4444"
              strokeWidth="0.75"
              strokeDasharray="3,4"
              opacity="0.35"
            />

            {/* Scale Horizontal Reference Grid Lines (+0.5, 0.0 datum, -0.5) */}
            {[-0.5, 0.0, 0.5].map((scaleVal) => {
              const yPos = centerY - scaleVal * (centerY - 8);
              const isDatum = scaleVal === 0.0;
              return (
                <g key={scaleVal}>
                  <line
                    x1={0}
                    y1={yPos}
                    x2={waveWidth}
                    y2={yPos}
                    stroke={isDatum ? '#282A30' : '#14161B'}
                    strokeWidth={isDatum ? '1.25' : '1'}
                    strokeDasharray={isDatum ? '3,3' : '1,4'}
                  />
                  <text
                    x={4}
                    y={yPos - 2}
                    fontSize="7"
                    fill={isDatum ? '#686B76' : '#3E414B'}
                    fontFamily="JetBrains Mono, monospace"
                  >
                    {isDatum ? '0.0V' : `${scaleVal > 0 ? '+' : ''}${scaleVal} FS`}
                  </text>
                </g>
              );
            })}

            {/* Time Window Vertical Grid Divisions (0ms, 32ms, 64ms, 96ms, 128ms) */}
            {[0, 32, 64, 96, 128].map((ms) => {
              const xPos = (ms / 128) * waveWidth;
              return (
                <g key={ms}>
                  <line
                    x1={xPos}
                    y1={0}
                    x2={xPos}
                    y2={waveHeight}
                    stroke="#131418"
                    strokeWidth="1"
                    strokeDasharray="2,3"
                  />
                  <text
                    x={Math.max(4, Math.min(waveWidth - 4, xPos))}
                    y={waveHeight - 3}
                    textAnchor={ms === 0 ? 'start' : ms === 128 ? 'end' : 'middle'}
                    fontSize="7"
                    fill="#40424A"
                    fontFamily="JetBrains Mono, monospace"
                  >
                    {ms}ms
                  </text>
                </g>
              );
            })}

            {/* Waveform Area Fill to Baseline */}
            <path
              d={waveAreaPath}
              fill="url(#waveform-area-gradient)"
            />

            {/* Real-Time Waveform PCM Signal Line */}
            <path
              d={waveLinePath}
              fill="none"
              stroke={isClipping ? '#FF4444' : accentColor}
              strokeWidth="1.75"
              filter="url(#waveform-glow)"
            />

            {/* Dynamic Zero-Crossing Pulse Point */}
            {isMonitoring && (
              <g>
                <circle
                  cx={waveWidth / 2}
                  cy={centerY}
                  r="2"
                  fill="#50525A"
                  opacity="0.6"
                />
              </g>
            )}
          </svg>
        </div>
      </div>

      {/* Spectral Display Switcher (FFT Spectrum Analyzer / Waterfall Spectrogram / Combined) */}
      <div className="flex items-center justify-between gap-2 px-1 text-[10px] uppercase font-mono tracking-wider">
        <div className="flex items-center gap-1">
          <button
            id="btn-spectral-view-fft"
            type="button"
            onClick={() => setSpectralViewMode('spectrum')}
            style={
              spectralViewMode === 'spectrum'
                ? { borderColor: accentColor, color: accentColor }
                : undefined
            }
            className={`px-2.5 py-1 text-[10px] font-bold border transition-colors flex items-center gap-1.5 ${
              spectralViewMode === 'spectrum'
                ? 'bg-[#181A20] text-white'
                : 'bg-[#0E0F12] border-[#22242A] text-[#70727A] hover:text-[#C0C0C0]'
            }`}
          >
            <Zap className="w-3 h-3" />
            <span>{t.viewSpectrum}</span>
          </button>

          <button
            id="btn-spectral-view-heatmap"
            type="button"
            onClick={() => setSpectralViewMode('heatmap')}
            style={
              spectralViewMode === 'heatmap'
                ? { borderColor: accentColor, color: accentColor }
                : undefined
            }
            className={`px-2.5 py-1 text-[10px] font-bold border transition-colors flex items-center gap-1.5 ${
              spectralViewMode === 'heatmap'
                ? 'bg-[#181A20] text-white'
                : 'bg-[#0E0F12] border-[#22242A] text-[#70727A] hover:text-[#C0C0C0]'
            }`}
          >
            <Activity className="w-3 h-3" />
            <span>{t.viewHeatmap}</span>
          </button>

          <button
            id="btn-spectral-view-combined"
            type="button"
            onClick={() => setSpectralViewMode('combined')}
            style={
              spectralViewMode === 'combined'
                ? { borderColor: accentColor, color: accentColor }
                : undefined
            }
            className={`px-2 py-1 text-[10px] font-bold border transition-colors hidden sm:flex items-center gap-1.5 ${
              spectralViewMode === 'combined'
                ? 'bg-[#181A20] text-white'
                : 'bg-[#0E0F12] border-[#22242A] text-[#70727A] hover:text-[#C0C0C0]'
            }`}
          >
            <Layers className="w-3 h-3" />
            <span>{t.viewCombined}</span>
          </button>
        </div>

        <span className="text-[9px] text-[#555864] hidden md:inline">
          {spectralViewMode === 'spectrum' ? t.fftSpectrumSub : t.spectralResolution}
        </span>
      </div>

      {/* Real-Time FFT Frequency-Domain Spectrum Analyzer (Canvas FFT & Interference Detection) */}
      {(spectralViewMode === 'spectrum' || spectralViewMode === 'combined') && (
        <FftSpectrumVisualizer
          isMonitoring={isMonitoring}
          analyserNode={analyserNode}
          sampleRate={sampleRate}
          spectrum={spectrum}
          thresholdDbfs={thresholdDbfs}
          ambientNoiseDbfs={ambientNoiseDbfs}
          voiceDetected={voiceDetected}
        />
      )}

      {/* Real-Time Frequency Distribution Spectral Heat Map (D3 Canvas Spectrogram & Waterfall) */}
      {(spectralViewMode === 'heatmap' || spectralViewMode === 'combined') && (
        <SpectralHeatmap
          isMonitoring={isMonitoring}
          spectrum={spectrum}
          voiceDetected={voiceDetected}
          speechProb={speechProb}
          levelDbfs={levelDbfs}
          ambientNoiseDbfs={ambientNoiseDbfs}
        />
      )}

      {/* Voice Activity Row with Industrial Status Indicators */}
      <div className="flex items-center justify-between p-3 bg-[#0A0B0D] border-2 border-[#202226] relative">
        <div className="flex items-center gap-2.5">
          <span className="text-[10px] text-[#70727A] uppercase tracking-widest font-bold">{t.vadClassifier}</span>
          <span
            style={{
              backgroundColor: voiceDetected ? `${accentColor}25` : undefined,
              color: voiceDetected ? accentColor : undefined,
              borderColor: voiceDetected ? accentColor : undefined,
              boxShadow: voiceDetected ? `0 0 8px ${accentColor}66` : undefined,
            }}
            className={`text-xs px-2.5 py-0.5 font-mono uppercase tracking-wider font-bold ${
              voiceDetected
                ? 'border'
                : 'bg-[#121316] text-[#50525A] border border-[#202226]'
            }`}
          >
            {isMonitoring ? (voiceDetected ? t.speechActive : t.noSpeech) : t.statusIdle}
          </span>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span className="text-[10px] text-[#70727A] uppercase font-bold">{t.confidence}</span>
          <span
            style={{ color: isVadActive ? accentColor : undefined }}
            className={`font-mono text-sm ${
              isVadActive ? 'font-bold' : 'text-[#A0A0A0]'
            }`}
          >
            {isMonitoring ? speechProb.toFixed(2) : '--'}
          </span>
          <span className="text-[#303238]">/</span>
          <span className="text-[#70727A] text-[10px] font-mono">{vadThreshold.toFixed(2)}</span>
        </div>
      </div>
    </div>
  );
};
