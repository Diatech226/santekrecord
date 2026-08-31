import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import {
  RotateCcw,
  Zap,
  Activity,
  AlertCircle,
  HelpCircle,
  Eye,
  Sliders,
  CheckCircle2,
  Volume2,
} from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext';
import { useTheme } from '../theme/ThemeContext';

export interface FftSpectrumVisualizerProps {
  isMonitoring: boolean;
  analyserNode?: AnalyserNode | null;
  sampleRate?: number;
  spectrum?: number[]; // fallback 32-band spectrum
  thresholdDbfs?: number;
  ambientNoiseDbfs?: number;
  voiceDetected?: boolean;
}

export type FreqScaleMode = 'log' | 'linear';
export type FreqRangePreset = 'full' | 'voice' | 'low';

export interface DetectedInterference {
  id: string;
  name: string;
  category: 'mains' | 'ground_loop' | 'tone' | 'coil_whine' | 'rumble' | 'speech' | 'buzz';
  freqHz: number;
  levelDbfs: number;
  severity: 'info' | 'warning' | 'critical';
  mitigation: string;
  badgeColor: string;
}

// Reference Interference Frequencies for Harmonic Guides & Detection
const KNOWN_INTERFERENCES = [
  { freq: 50, name: '50 Hz Mains AC (UK/EU)', category: 'mains', tolerance: 3.5, color: '#FF4444' },
  { freq: 60, name: '60 Hz Mains AC (US)', category: 'mains', tolerance: 3.5, color: '#FF4444' },
  { freq: 100, name: '100 Hz Harmonic (50Hz x2)', category: 'ground_loop', tolerance: 5, color: '#FF8800' },
  { freq: 120, name: '120 Hz Harmonic (60Hz x2)', category: 'ground_loop', tolerance: 5, color: '#FF8800' },
  { freq: 150, name: '150 Hz 3rd Harmonic (50Hz x3)', category: 'buzz', tolerance: 6, color: '#FFAA00' },
  { freq: 180, name: '180 Hz 3rd Harmonic (60Hz x3)', category: 'buzz', tolerance: 6, color: '#FFAA00' },
  { freq: 1000, name: '1.0 kHz Test Tone / Whistle', category: 'tone', tolerance: 35, color: '#00F0FF' },
  { freq: 4000, name: '4.0 kHz Switching Ripple / Coil', category: 'coil_whine', tolerance: 200, color: '#FF3366' },
  { freq: 6000, name: '6.0 kHz SMPS Power Supply Whine', category: 'coil_whine', tolerance: 350, color: '#FF0055' },
];

export const FftSpectrumVisualizer: React.FC<FftSpectrumVisualizerProps> = ({
  isMonitoring,
  analyserNode,
  sampleRate = 16000,
  spectrum,
  thresholdDbfs = -38,
  ambientNoiseDbfs = -60,
  voiceDetected = false,
}) => {
  const { t } = useLanguage();
  const { currentThemeOption } = useTheme();
  const accentColor = currentThemeOption.primaryColor;

  // Visualizer settings
  const [scaleMode, setScaleMode] = useState<FreqScaleMode>('log');
  const [rangePreset, setRangePreset] = useState<FreqRangePreset>('full');
  const [showHarmonicGuides, setShowHarmonicGuides] = useState<boolean>(true);
  const [showPeakHold, setShowPeakHold] = useState<boolean>(true);
  const [showMitigationTips, setShowMitigationTips] = useState<boolean>(false);

  // Canvas and interaction refs
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const peakHoldBufferRef = useRef<Float32Array | null>(null);

  // Live telemetry states
  const [peakFreq, setPeakFreq] = useState<number>(0);
  const [peakMagnitudeDbfs, setPeakMagnitudeDbfs] = useState<number>(-100);
  const [spectralCentroidHz, setSpectralCentroidHz] = useState<number>(0);
  const [spectralFlatness, setSpectralFlatness] = useState<number>(0);
  const [detectedSources, setDetectedSources] = useState<DetectedInterference[]>([]);
  const [hoveredPoint, setHoveredPoint] = useState<{
    freqHz: number;
    dbfs: number;
    nearestInterference?: string;
  } | null>(null);

  // Frequency range bounds (in Hz)
  const [minFreq, maxFreq] = useMemo(() => {
    const nyquist = sampleRate / 2;
    if (rangePreset === 'low') return [20, Math.min(500, nyquist)];
    if (rangePreset === 'voice') return [20, Math.min(4000, nyquist)];
    return [20, Math.min(8000, nyquist)];
  }, [rangePreset, sampleRate]);

  // Reset Peak Hold buffer
  const handleResetPeakHold = useCallback(() => {
    if (peakHoldBufferRef.current) {
      peakHoldBufferRef.current.fill(-100);
    }
  }, []);

  // Main Canvas Rendering Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    const fftSize = analyserNode ? analyserNode.frequencyBinCount : 512;
    const floatData = new Float32Array(fftSize);

    // Initialize or resize peak hold buffer
    if (!peakHoldBufferRef.current || peakHoldBufferRef.current.length !== fftSize) {
      peakHoldBufferRef.current = new Float32Array(fftSize).fill(-100);
    }

    const decayRate = 0.35; // dB decay per frame for peak hold
    let lastDiagUpdateTime = 0;

    const render = () => {
      const width = canvas.width;
      const height = canvas.height;

      // Handle Device Pixel Ratio scaling cleanly
      ctx.save();

      // Clear Canvas Background (deep radar dark)
      ctx.fillStyle = '#060709';
      ctx.fillRect(0, 0, width, height);

      // Acquire Frequency Data
      let currentSampleRate = sampleRate || 16000;
      let binCount = fftSize;

      if (isMonitoring && analyserNode) {
        try {
          analyserNode.getFloatFrequencyData(floatData);
          currentSampleRate = analyserNode.context.sampleRate || currentSampleRate;
          binCount = analyserNode.frequencyBinCount;
        } catch {
          // Fallback if node temporarily detached
          floatData.fill(-100);
        }
      } else if (isMonitoring && spectrum && spectrum.length > 0) {
        // Fallback: interpolate synthetic 32-band spectrum across FFT bins
        for (let i = 0; i < binCount; i++) {
          const specIdx = Math.min(
            spectrum.length - 1,
            Math.floor((i / binCount) * spectrum.length)
          );
          const energyNorm = spectrum[specIdx] || 0;
          floatData[i] = -90 + energyNorm * 80;
        }
      } else {
        floatData.fill(-100);
      }

      // Update Peak Hold buffer
      const peakHold = peakHoldBufferRef.current;
      if (peakHold) {
        for (let i = 0; i < binCount; i++) {
          const val = floatData[i];
          if (isMonitoring && val > peakHold[i]) {
            peakHold[i] = val;
          } else {
            peakHold[i] = Math.max(-100, peakHold[i] - decayRate);
          }
        }
      }

      // Geometry & Padding
      const padLeft = 46;
      const padRight = 16;
      const padTop = 22;
      const padBottom = 26;
      const plotWidth = width - padLeft - padRight;
      const plotHeight = height - padTop - padBottom;

      // dBFS Scale (-100 dBFS to 0 dBFS)
      const minDbfs = -100;
      const maxDbfs = 0;
      const dbToY = (db: number) => {
        const clamped = Math.max(minDbfs, Math.min(maxDbfs, db));
        const norm = (clamped - minDbfs) / (maxDbfs - minDbfs);
        return padTop + plotHeight * (1 - norm);
      };

      // Frequency to X coordinate conversion (Logarithmic or Linear)
      const freqToX = (freqHz: number) => {
        const clampedF = Math.max(minFreq, Math.min(maxFreq, freqHz));
        if (scaleMode === 'log') {
          const logMin = Math.log10(minFreq);
          const logMax = Math.log10(maxFreq);
          const norm = (Math.log10(clampedF) - logMin) / (logMax - logMin);
          return padLeft + norm * plotWidth;
        } else {
          const norm = (clampedF - minFreq) / (maxFreq - minFreq);
          return padLeft + norm * plotWidth;
        }
      };

      // Bin index to Frequency in Hz
      const binToFreq = (binIdx: number) => {
        return (binIdx * currentSampleRate) / (binCount * 2);
      };

      // Frequency to Bin index
      const freqToBin = (freqHz: number) => {
        return Math.round((freqHz * binCount * 2) / currentSampleRate);
      };

      // 1. Draw Grid Lines & Calibrated Y-Labels
      const dbTicks = [0, -20, -40, -60, -80, -100];
      ctx.strokeStyle = '#14161B';
      ctx.lineWidth = 1;
      ctx.font = '9px JetBrains Mono, monospace';
      ctx.fillStyle = '#686B76';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';

      dbTicks.forEach((db) => {
        const y = dbToY(db);
        ctx.beginPath();
        ctx.moveTo(padLeft, y);
        ctx.lineTo(width - padRight, y);
        ctx.stroke();

        ctx.fillStyle = db === 0 ? '#FFFFFF' : db >= -40 ? '#A0A2AA' : '#555862';
        ctx.fillText(`${db}dB`, padLeft - 6, y);
      });

      // 2. Draw Frequency Grid Lines & X-Labels
      const standardFreqTicks = [
        50, 60, 100, 120, 200, 300, 500, 1000, 2000, 3400, 4000, 6000, 8000,
      ];
      const visibleFreqTicks = standardFreqTicks.filter(
        (f) => f >= minFreq && f <= maxFreq
      );

      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';

      visibleFreqTicks.forEach((f) => {
        const x = freqToX(f);
        const isMajor = f === 50 || f === 60 || f === 100 || f === 1000 || f === 4000;

        ctx.strokeStyle = isMajor ? '#1E2128' : '#111317';
        ctx.setLineDash(isMajor ? [2, 3] : [1, 4]);
        ctx.beginPath();
        ctx.moveTo(x, padTop);
        ctx.lineTo(x, height - padBottom);
        ctx.stroke();
        ctx.setLineDash([]);

        // Label format (50Hz, 1kHz, 3.4k, etc.)
        const label = f >= 1000 ? `${(f / 1000).toFixed(f % 1000 === 0 ? 0 : 1)}k` : `${f}`;
        ctx.fillStyle = isMajor ? '#8A8D98' : '#4E5058';
        ctx.fillText(label, x, height - padBottom + 6);
      });

      // 3. Highlighted Interference & Acoustic Formant Regions
      if (showHarmonicGuides) {
        // Voice Formant Region: 300 Hz – 3400 Hz
        if (minFreq < 3400 && maxFreq > 300) {
          const vLeft = Math.max(padLeft, freqToX(300));
          const vRight = Math.min(width - padRight, freqToX(3400));
          if (vRight > vLeft) {
            ctx.fillStyle = voiceDetected ? 'rgba(0, 240, 255, 0.07)' : 'rgba(0, 240, 255, 0.03)';
            ctx.fillRect(vLeft, padTop, vRight - vLeft, plotHeight);

            // Shaded top label
            ctx.fillStyle = voiceDetected ? accentColor : '#00F0FF';
            ctx.font = '8px JetBrains Mono, monospace';
            ctx.textAlign = 'center';
            ctx.fillText('SPEECH FORMANTS (300Hz-3.4kHz)', (vLeft + vRight) / 2, padTop + 3);
          }
        }

        // Low Mains Hum Region: 45 Hz - 65 Hz
        if (minFreq <= 65 && maxFreq >= 45) {
          const mLeft = Math.max(padLeft, freqToX(45));
          const mRight = Math.min(width - padRight, freqToX(65));
          ctx.fillStyle = 'rgba(255, 68, 68, 0.06)';
          ctx.fillRect(mLeft, padTop, mRight - mLeft, plotHeight);
        }

        // Discrete Harmonic Guide Vertical Markers
        KNOWN_INTERFERENCES.forEach((item) => {
          if (item.freq >= minFreq && item.freq <= maxFreq) {
            const x = freqToX(item.freq);
            ctx.strokeStyle = item.color;
            ctx.globalAlpha = 0.55;
            ctx.setLineDash([3, 3]);
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x, padTop + 14);
            ctx.lineTo(x, height - padBottom);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.globalAlpha = 1.0;

            // Small indicator tag at top
            ctx.fillStyle = item.color;
            ctx.fillRect(x - 2, padTop + 10, 4, 4);
          }
        });
      }

      // 4. Threshold & Ambient Noise Level Horizontal Lines
      if (thresholdDbfs !== undefined && thresholdDbfs > minDbfs) {
        const trgY = dbToY(thresholdDbfs);
        ctx.strokeStyle = accentColor;
        ctx.globalAlpha = 0.7;
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(padLeft, trgY);
        ctx.lineTo(width - padRight, trgY);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = accentColor;
        ctx.font = '8px JetBrains Mono, monospace';
        ctx.textAlign = 'right';
        ctx.fillText(`TRG ${thresholdDbfs}dB`, width - padRight - 4, trgY - 3);
        ctx.globalAlpha = 1.0;
      }

      if (ambientNoiseDbfs !== undefined && ambientNoiseDbfs > minDbfs) {
        const ambY = dbToY(ambientNoiseDbfs);
        ctx.strokeStyle = '#00F0FF';
        ctx.globalAlpha = 0.45;
        ctx.setLineDash([2, 3]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(padLeft, ambY);
        ctx.lineTo(width - padRight, ambY);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1.0;
      }

      // 5. Build Spectrum Curve Points
      const startBin = Math.max(1, freqToBin(minFreq));
      const endBin = Math.min(binCount - 1, freqToBin(maxFreq));
      const samplePoints: { x: number; y: number; dbfs: number; freq: number; bin: number }[] = [];

      // Determine horizontal step to prevent redundant canvas operations
      const totalBinsToDraw = Math.max(1, endBin - startBin);
      const binStep = Math.max(1, Math.floor(totalBinsToDraw / plotWidth));

      for (let b = startBin; b <= endBin; b += binStep) {
        const freq = binToFreq(b);
        const dbfs = floatData[b] ?? -100;
        const x = freqToX(freq);
        const y = dbToY(dbfs);
        samplePoints.push({ x, y, dbfs, freq, bin: b });
      }

      // 6. Draw Peak Hold Envelope Line
      if (showPeakHold && peakHold && samplePoints.length > 0) {
        ctx.strokeStyle = '#FFB800';
        ctx.globalAlpha = 0.75;
        ctx.lineWidth = 1.25;
        ctx.beginPath();

        samplePoints.forEach((pt, idx) => {
          const peakDb = peakHold[pt.bin] ?? -100;
          const peakY = dbToY(peakDb);
          if (idx === 0) {
            ctx.moveTo(pt.x, peakY);
          } else {
            ctx.lineTo(pt.x, peakY);
          }
        });
        ctx.stroke();
        ctx.globalAlpha = 1.0;
      }

      // 7. Draw Filled Gradient Under FFT Spectrum Curve
      if (samplePoints.length > 1) {
        const bottomY = height - padBottom;
        const gradient = ctx.createLinearGradient(0, padTop, 0, bottomY);
        gradient.addColorStop(0, `${accentColor}88`);
        gradient.addColorStop(0.3, `${accentColor}33`);
        gradient.addColorStop(0.7, '#00F0FF15');
        gradient.addColorStop(1, 'rgba(0, 240, 255, 0.0)');

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.moveTo(samplePoints[0].x, bottomY);

        samplePoints.forEach((pt) => {
          ctx.lineTo(pt.x, pt.y);
        });

        ctx.lineTo(samplePoints[samplePoints.length - 1].x, bottomY);
        ctx.closePath();
        ctx.fill();

        // 8. Draw High-Intensity Glowing Spectrum Trace Line
        ctx.strokeStyle = isMonitoring ? (voiceDetected ? accentColor : '#00F0FF') : '#3A3C44';
        ctx.lineWidth = 1.75;
        ctx.beginPath();

        samplePoints.forEach((pt, idx) => {
          if (idx === 0) {
            ctx.moveTo(pt.x, pt.y);
          } else {
            ctx.lineTo(pt.x, pt.y);
          }
        });
        ctx.stroke();
      }

      // 9. Real-Time Interference Diagnostics & Peak Peak Analysis (throttled to 10 FPS for React state)
      const now = performance.now();
      if (now - lastDiagUpdateTime > 100) {
        lastDiagUpdateTime = now;

        let maxVal = -100;
        let maxValFreq = 0;
        let weightedFreqSum = 0;
        let totalEnergySum = 0;
        let sumLogEnergy = 0;
        let countedBins = 0;

        const detectedList: DetectedInterference[] = [];

        // Scan bins for spectral peaks and centroid
        for (let b = startBin; b <= endBin; b++) {
          const db = floatData[b];
          const f = binToFreq(b);
          const linearEnergy = Math.pow(10, db / 20);

          if (db > maxVal) {
            maxVal = db;
            maxValFreq = f;
          }

          if (linearEnergy > 1e-5) {
            weightedFreqSum += f * linearEnergy;
            totalEnergySum += linearEnergy;
            sumLogEnergy += Math.log(Math.max(1e-7, linearEnergy));
            countedBins++;
          }
        }

        // Spectral Centroid & Flatness
        const centroid = totalEnergySum > 0 ? weightedFreqSum / totalEnergySum : 0;
        const geoMean = countedBins > 0 ? Math.exp(sumLogEnergy / countedBins) : 0;
        const arithMean = countedBins > 0 ? totalEnergySum / countedBins : 1;
        const flatness = arithMean > 0 ? Math.min(1.0, geoMean / arithMean) : 0;

        // Specific Interference Pattern Matching
        if (isMonitoring && maxVal > -80) {
          // Check 50 Hz Mains Hum (UK / EU 230V)
          const bin50 = freqToBin(50);
          const db50 = floatData[bin50] ?? -100;
          if (db50 >= -60 && db50 > ambientNoiseDbfs + 6) {
            detectedList.push({
              id: 'mains_50',
              name: t.interferenceMains50,
              category: 'mains',
              freqHz: 50,
              levelDbfs: Math.round(db50 * 10) / 10,
              severity: db50 > -40 ? 'critical' : 'warning',
              mitigation: t.mainsHumMitigation,
              badgeColor: '#FF4444',
            });
          }

          // Check 60 Hz Mains Hum (US / Americas 120V)
          const bin60 = freqToBin(60);
          const db60 = floatData[bin60] ?? -100;
          if (db60 >= -60 && db60 > ambientNoiseDbfs + 6) {
            detectedList.push({
              id: 'mains_60',
              name: t.interferenceMains60,
              category: 'mains',
              freqHz: 60,
              levelDbfs: Math.round(db60 * 10) / 10,
              severity: db60 > -40 ? 'critical' : 'warning',
              mitigation: t.mainsHumMitigation,
              badgeColor: '#FF4444',
            });
          }

          // Check 100/120 Hz Harmonic Rectifier / Ground Loop Buzz
          const bin100 = freqToBin(100);
          const bin120 = freqToBin(120);
          const db100 = floatData[bin100] ?? -100;
          const db120 = floatData[bin120] ?? -100;
          const peakHarmonic = Math.max(db100, db120);
          const harmonicFreq = db100 >= db120 ? 100 : 120;

          if (peakHarmonic >= -62 && peakHarmonic > ambientNoiseDbfs + 6) {
            detectedList.push({
              id: `harmonic_${harmonicFreq}`,
              name: t.interferenceHarmonic100_120,
              category: 'ground_loop',
              freqHz: harmonicFreq,
              levelDbfs: Math.round(peakHarmonic * 10) / 10,
              severity: peakHarmonic > -42 ? 'critical' : 'warning',
              mitigation: t.groundLoopMitigation,
              badgeColor: '#FF8800',
            });
          }

          // Check 1 kHz Test Tone / Whistle
          const bin1k = freqToBin(1000);
          const db1k = floatData[bin1k] ?? -100;
          if (db1k >= -50 && db1k > ambientNoiseDbfs + 12) {
            detectedList.push({
              id: 'tone_1k',
              name: t.interferenceTone1k,
              category: 'tone',
              freqHz: 1000,
              levelDbfs: Math.round(db1k * 10) / 10,
              severity: 'warning',
              mitigation: 'Inspect audio interface test tone / microphone feedback loop.',
              badgeColor: '#00F0FF',
            });
          }

          // Check High-Frequency Coil Whine / SMPS Switching Noise (3.5 kHz - 8.0 kHz)
          const startHighBin = freqToBin(3500);
          const endHighBin = freqToBin(8000);
          let maxHighDb = -100;
          let maxHighFreq = 4000;

          for (let hb = startHighBin; hb <= endHighBin; hb++) {
            const hdb = floatData[hb] ?? -100;
            if (hdb > maxHighDb) {
              maxHighDb = hdb;
              maxHighFreq = binToFreq(hb);
            }
          }

          if (maxHighDb >= -55 && maxHighDb > ambientNoiseDbfs + 10) {
            detectedList.push({
              id: 'coil_whine',
              name: `${t.interferenceCoilWhine} (${Math.round(maxHighFreq)} Hz)`,
              category: 'coil_whine',
              freqHz: Math.round(maxHighFreq),
              levelDbfs: Math.round(maxHighDb * 10) / 10,
              severity: maxHighDb > -40 ? 'critical' : 'warning',
              mitigation: t.coilWhineMitigation,
              badgeColor: '#FF3366',
            });
          }

          // Check Sub-Acoustic HVAC / Room Rumble (< 80 Hz broadband)
          const bin30 = freqToBin(30);
          const bin40 = freqToBin(40);
          const avgRumble = ((floatData[bin30] || -100) + (floatData[bin40] || -100)) / 2;
          if (avgRumble >= -50 && avgRumble > ambientNoiseDbfs + 8 && !detectedList.some((d) => d.category === 'mains')) {
            detectedList.push({
              id: 'room_rumble',
              name: t.interferenceRoomRumble,
              category: 'rumble',
              freqHz: 35,
              levelDbfs: Math.round(avgRumble * 10) / 10,
              severity: 'info',
              mitigation: 'Engage 80Hz rumble high-pass filter or decouple mic shock mount.',
              badgeColor: '#A080FF',
            });
          }
        }

        setPeakFreq(Math.round(maxValFreq));
        setPeakMagnitudeDbfs(Math.round(maxVal * 10) / 10);
        setSpectralCentroidHz(Math.round(centroid));
        setSpectralFlatness(Math.round(flatness * 100) / 100);
        setDetectedSources(detectedList);
      }

      ctx.restore();
      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [
    isMonitoring,
    analyserNode,
    sampleRate,
    spectrum,
    scaleMode,
    rangePreset,
    minFreq,
    maxFreq,
    showHarmonicGuides,
    showPeakHold,
    thresholdDbfs,
    ambientNoiseDbfs,
    voiceDetected,
    accentColor,
    t,
  ]);

  // Handle Mouse Hover on Canvas for Interactive Crosshair Reticle
  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const padLeft = 46;
    const padRight = 16;
    const padTop = 22;
    const padBottom = 26;
    const plotWidth = canvas.width - padLeft - padRight;
    const plotHeight = canvas.height - padTop - padBottom;

    const mouseX = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const mouseY = ((e.clientY - rect.top) / rect.height) * canvas.height;

    if (
      mouseX < padLeft ||
      mouseX > canvas.width - padRight ||
      mouseY < padTop ||
      mouseY > canvas.height - padBottom
    ) {
      setHoveredPoint(null);
      return;
    }

    // Convert mouse X to Frequency (Hz)
    const normX = Math.max(0, Math.min(1, (mouseX - padLeft) / plotWidth));
    let freqHz = minFreq;
    if (scaleMode === 'log') {
      const logMin = Math.log10(minFreq);
      const logMax = Math.log10(maxFreq);
      freqHz = Math.pow(10, logMin + normX * (logMax - logMin));
    } else {
      freqHz = minFreq + normX * (maxFreq - minFreq);
    }

    // Convert mouse Y to dBFS
    const normY = Math.max(0, Math.min(1, (mouseY - padTop) / plotHeight));
    const dbfs = 0 - normY * 100;

    // Check nearest known interference match
    let matchText: string | undefined = undefined;
    for (const item of KNOWN_INTERFERENCES) {
      if (Math.abs(item.freq - freqHz) <= item.tolerance) {
        matchText = item.name;
        break;
      }
    }

    setHoveredPoint({
      freqHz: Math.round(freqHz * 10) / 10,
      dbfs: Math.round(dbfs * 10) / 10,
      nearestInterference: matchText,
    });
  };

  const handleMouseLeave = () => {
    setHoveredPoint(null);
  };

  return (
    <div
      ref={containerRef}
      id="fft-spectrum-visualizer-container"
      className="bg-[#0A0B0D] border-2 border-[#202226] p-3 relative space-y-3 font-mono select-none"
    >
      {/* Industrial corner accents */}
      <div
        style={{ borderColor: `${accentColor}66` }}
        className="absolute -top-[2px] -left-[2px] w-2 h-2 border-t-2 border-l-2"
      />
      <div
        style={{ borderColor: `${accentColor}66` }}
        className="absolute -top-[2px] -right-[2px] w-2 h-2 border-t-2 border-r-2"
      />
      <div
        style={{ borderColor: `${accentColor}66` }}
        className="absolute -bottom-[2px] -left-[2px] w-2 h-2 border-b-2 border-l-2"
      />
      <div
        style={{ borderColor: `${accentColor}66` }}
        className="absolute -bottom-[2px] -right-[2px] w-2 h-2 border-b-2 border-r-2"
      />

      {/* Header Bar: Title, Interactive Scale / Range Controls & Peak Hold Reset */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1A1B1F] pb-2 text-[10px] uppercase tracking-widest text-[#A0A0A0]">
        <div className="flex items-center gap-2">
          <Zap
            style={{ color: accentColor }}
            className="w-3.5 h-3.5 animate-pulse"
          />
          <span className="font-bold text-[#E0E0E0] tracking-wider">
            {t.fftSpectrum}
          </span>
          <span className="text-[#60626A] text-[9px] hidden sm:inline">
            [{scaleMode.toUpperCase()} | 2048 FFT]
          </span>
        </div>

        {/* Diagnostic Action Controls */}
        <div className="flex items-center gap-1.5 flex-wrap text-[9px]">
          {/* Frequency Scale Toggle (Logarithmic vs Linear) */}
          <div className="flex items-center bg-[#121418] border border-[#202226] p-0.5">
            <span className="text-[#60626A] text-[8px] px-1 mr-0.5">{t.frequencyScale}:</span>
            <button
              id="fft-scale-log-btn"
              type="button"
              onClick={() => setScaleMode('log')}
              className={`px-1.5 py-0.5 font-bold transition-colors ${
                scaleMode === 'log'
                  ? 'bg-[#2A2D35] text-[#FFFFFF] shadow-xs'
                  : 'text-[#60626A] hover:text-[#C0C0C0]'
              }`}
            >
              LOG
            </button>
            <button
              id="fft-scale-lin-btn"
              type="button"
              onClick={() => setScaleMode('linear')}
              className={`px-1.5 py-0.5 font-bold transition-colors ${
                scaleMode === 'linear'
                  ? 'bg-[#2A2D35] text-[#FFFFFF] shadow-xs'
                  : 'text-[#60626A] hover:text-[#C0C0C0]'
              }`}
            >
              LIN
            </button>
          </div>

          {/* Frequency Range Preset Selector */}
          <div className="flex items-center bg-[#121418] border border-[#202226] p-0.5">
            <span className="text-[#60626A] text-[8px] px-1 mr-0.5">{t.frequencyRange}:</span>
            <button
              id="fft-range-full-btn"
              type="button"
              onClick={() => setRangePreset('full')}
              title={t.rangeFull}
              className={`px-1.5 py-0.5 font-bold transition-colors ${
                rangePreset === 'full'
                  ? 'bg-[#2A2D35] text-[#00F0FF]'
                  : 'text-[#60626A] hover:text-[#C0C0C0]'
              }`}
            >
              8k
            </button>
            <button
              id="fft-range-voice-btn"
              type="button"
              onClick={() => setRangePreset('voice')}
              title={t.rangeVoice}
              className={`px-1.5 py-0.5 font-bold transition-colors ${
                rangePreset === 'voice'
                  ? 'bg-[#2A2D35] text-[#00F0FF]'
                  : 'text-[#60626A] hover:text-[#C0C0C0]'
              }`}
            >
              4k
            </button>
            <button
              id="fft-range-low-btn"
              type="button"
              onClick={() => setRangePreset('low')}
              title={t.rangeLowHum}
              className={`px-1.5 py-0.5 font-bold transition-colors ${
                rangePreset === 'low'
                  ? 'bg-[#2A2D35] text-[#FFB800]'
                  : 'text-[#60626A] hover:text-[#C0C0C0]'
              }`}
            >
              500Hz
            </button>
          </div>

          {/* Harmonic Markers Toggle */}
          <button
            id="fft-toggle-guides-btn"
            type="button"
            onClick={() => setShowHarmonicGuides((prev) => !prev)}
            title="Toggle Harmonic Interference Guides (50/60Hz, 120Hz, 1kHz)"
            className={`px-1.5 py-0.5 border text-[9px] flex items-center gap-1 transition-colors ${
              showHarmonicGuides
                ? 'bg-[#181B22] border-[#303440] text-[#00F0FF]'
                : 'bg-[#101114] border-[#202226] text-[#555862]'
            }`}
          >
            <Eye className="w-2.5 h-2.5" />
            <span className="hidden sm:inline">{t.harmonicMarkers}</span>
          </button>

          {/* Peak Hold Toggle & Reset */}
          <div className="flex items-center gap-1">
            <button
              id="fft-toggle-peak-btn"
              type="button"
              onClick={() => setShowPeakHold((prev) => !prev)}
              className={`px-1.5 py-0.5 border text-[9px] transition-colors ${
                showPeakHold
                  ? 'bg-[#181B22] border-[#303440] text-[#FFB800]'
                  : 'bg-[#101114] border-[#202226] text-[#555862]'
              }`}
            >
              PEAK
            </button>
            <button
              id="fft-reset-peak-btn"
              type="button"
              onClick={handleResetPeakHold}
              title="Reset Peak Hold Envelope"
              className="p-1 bg-[#141518] hover:bg-[#202228] text-[#80828A] hover:text-[#FFB800] border border-[#202226] transition-colors"
            >
              <RotateCcw className="w-2.5 h-2.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Main Canvas Stage */}
      <div className="relative bg-[#050608] border border-[#1E2024] p-1 overflow-hidden">
        {/* Floating Reticle Telemetry Tooltip on Hover */}
        {hoveredPoint && (
          <div className="absolute right-3 top-2.5 bg-[#101216]/95 border border-[#303440] px-2.5 py-1.5 text-[9px] font-mono text-[#E0E0E0] shadow-xl z-20 pointer-events-none space-y-0.5 backdrop-blur-xs">
            <div className="flex items-center gap-2">
              <span className="text-[#00F0FF] font-bold">{hoveredPoint.freqHz} Hz</span>
              <span className="text-[#303440]">|</span>
              <span className="text-[#FFFFFF] font-bold">{hoveredPoint.dbfs} dBFS</span>
            </div>
            {hoveredPoint.nearestInterference && (
              <div className="text-[#FF8800] font-bold text-[8.5px] flex items-center gap-1">
                <AlertCircle className="w-3 h-3 shrink-0" />
                <span>{hoveredPoint.nearestInterference}</span>
              </div>
            )}
          </div>
        )}

        {/* Real-Time HTML5 Canvas Element */}
        <canvas
          ref={canvasRef}
          width={640}
          height={200}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          className="w-full h-44 sm:h-52 md:h-56 cursor-crosshair block"
        />

        {/* Live Peak Reticle Overlay on Top Left */}
        <div className="absolute left-14 top-2.5 pointer-events-none flex items-center gap-2.5 text-[8.5px] font-mono text-[#707480] bg-[#060709]/80 px-2 py-0.5 border border-[#181A20] z-10">
          <span>
            {t.peakFrequency}:{' '}
            <span className="text-[#00F0FF] font-bold text-[9.5px]">
              {isMonitoring ? `${peakFreq} Hz` : '-- Hz'}
            </span>
          </span>
          <span className="text-[#303238]">|</span>
          <span>
            MAG:{' '}
            <span className="text-[#FFFFFF] font-bold">
              {isMonitoring ? `${peakMagnitudeDbfs} dBFS` : '-- dBFS'}
            </span>
          </span>
          <span className="text-[#303238]">|</span>
          <span className="hidden md:inline">
            CENTROID:{' '}
            <span className="text-[#A0A2AA]">
              {isMonitoring ? `${spectralCentroidHz} Hz` : '-- Hz'}
            </span>
          </span>
        </div>
      </div>

      {/* Environmental Interference Source Detection Matrix */}
      <div className="bg-[#06080B] border border-[#181B22] p-2.5 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#14161C] pb-1.5 text-[9.5px]">
          <div className="flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5 text-[#FFB800]" />
            <span className="font-bold text-[#D0D2D8] tracking-wider">
              {t.detectedInterference}
            </span>
            <span
              className={`px-1.5 py-0.2 text-[8px] font-bold border ${
                detectedSources.length > 0
                  ? 'bg-amber-500/15 border-amber-500/50 text-amber-300 animate-pulse'
                  : 'bg-[#101216] border-[#202228] text-[#00FF66]'
              }`}
            >
              {isMonitoring
                ? detectedSources.length > 0
                  ? `${detectedSources.length} SOURCES ACTIVE`
                  : 'SPECTRUM CLEAN'
                : t.systemStandby}
            </span>
          </div>

          <button
            id="fft-toggle-mitigation-btn"
            type="button"
            onClick={() => setShowMitigationTips((prev) => !prev)}
            className="text-[8.5px] text-[#707480] hover:text-[#00F0FF] flex items-center gap-1 transition-colors"
          >
            <HelpCircle className="w-3 h-3" />
            <span>{t.interferenceMitigation}</span>
          </button>
        </div>

        {/* Detected Sources Badge Grid */}
        {detectedSources.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 pt-1">
            {detectedSources.map((item) => (
              <div
                key={item.id}
                style={{ borderColor: `${item.badgeColor}40` }}
                className="bg-[#0C0E14] border p-2 rounded-xs flex flex-col justify-between gap-1 shadow-xs"
              >
                <div className="flex items-start justify-between gap-1.5">
                  <div className="flex items-center gap-1.5">
                    <span
                      style={{ backgroundColor: item.badgeColor }}
                      className="w-1.5 h-1.5 rounded-full shrink-0 animate-ping"
                    />
                    <span
                      style={{ color: item.badgeColor }}
                      className="font-bold text-[9px] leading-tight"
                    >
                      {item.name}
                    </span>
                  </div>
                  <span
                    className={`text-[8px] font-bold px-1 py-0.2 border shrink-0 ${
                      item.severity === 'critical'
                        ? 'bg-red-500/20 border-red-500/60 text-red-400'
                        : 'bg-amber-500/20 border-amber-500/60 text-amber-300'
                    }`}
                  >
                    {item.levelDbfs} dB
                  </span>
                </div>

                {showMitigationTips && (
                  <div className="text-[8px] text-[#8A8E99] leading-normal pt-1 border-t border-[#181A22]">
                    <span className="text-[#00F0FF] font-semibold">Tip: </span>
                    {item.mitigation}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="py-2 px-3 text-[9px] text-[#555864] flex items-center gap-2 bg-[#090A0E] border border-[#14161C]">
            <CheckCircle2 className="w-3.5 h-3.5 text-[#00FF66]/70 shrink-0" />
            <span>
              {isMonitoring
                ? t.noInterferenceDetected
                : 'Start surveillance monitoring to detect environmental interference, mains ground loops, and harmonic hum.'}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
