import React, { useState } from 'react';
import { Activity, Zap, Layers } from 'lucide-react';
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

  const isVadActive = isMonitoring && speechProb >= vadThreshold;

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
