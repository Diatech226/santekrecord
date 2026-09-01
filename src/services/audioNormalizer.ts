import { rawAudioBufferCache } from '../components/WaveformCanvas';

export interface NormalizationMetrics {
  originalPeak: number; // Linear peak 0.0 - 1.0
  originalPeakDbfs: number; // Peak in dBFS
  targetPeak: number; // Target peak (default 0.90 = -0.9 dBFS)
  boostMultiplier: number; // Gain multiplier (e.g., 2.5x)
  boostDb: number; // Gain in dB (e.g., +8.0 dB)
  isQuiet: boolean; // True if peak was quiet (< -6 dBFS) and boosted
}

export const STANDARD_TARGET_PEAK = 0.90; // -0.9 dBFS standard headroom peak
export const MAX_SAFE_BOOST_MULTIPLIER = 8.0; // Max +18.0 dB boost

/**
 * Calculates audio peak and dynamic boost required to normalize to standard peak
 */
export function calculateNormalization(
  channelData: Float32Array,
  targetPeak: number = STANDARD_TARGET_PEAK
): NormalizationMetrics {
  let maxPeak = 0;
  const len = channelData.length;
  for (let i = 0; i < len; i++) {
    const abs = Math.abs(channelData[i]);
    if (abs > maxPeak) maxPeak = abs;
  }

  if (maxPeak <= 0.0001) {
    return {
      originalPeak: 0,
      originalPeakDbfs: -90,
      targetPeak,
      boostMultiplier: 1.0,
      boostDb: 0,
      isQuiet: false,
    };
  }

  const originalPeakDbfs = 20 * Math.log10(maxPeak);
  const idealMultiplier = targetPeak / maxPeak;
  // If original peak is already at or above target, no boost needed (multiplier = 1.0)
  const boostMultiplier = Math.max(1.0, Math.min(MAX_SAFE_BOOST_MULTIPLIER, idealMultiplier));
  const boostDb = 20 * Math.log10(boostMultiplier);

  return {
    originalPeak: maxPeak,
    originalPeakDbfs: Math.round(originalPeakDbfs * 10) / 10,
    targetPeak,
    boostMultiplier: Math.round(boostMultiplier * 100) / 100,
    boostDb: Math.round(boostDb * 10) / 10,
    isQuiet: originalPeakDbfs < -6.0 && boostDb > 1.0,
  };
}

/**
 * Retrieves cached audio or fetches and decodes to extract peak metrics
 */
export async function getRecordingNormalizationMetrics(
  recordingId: string,
  audioUrl: string,
  targetPeak: number = STANDARD_TARGET_PEAK
): Promise<NormalizationMetrics> {
  // Check if raw channel data is already cached
  if (rawAudioBufferCache.has(recordingId)) {
    const data = rawAudioBufferCache.get(recordingId)!;
    return calculateNormalization(data, targetPeak);
  }

  try {
    const response = await fetch(audioUrl);
    if (!response.ok) throw new Error('Audio fetch failed');
    const arrayBuffer = await response.arrayBuffer();

    const AudioCtxClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtxClass) {
      throw new Error('WebAudio unsupported');
    }

    const tempCtx = new AudioCtxClass();
    const audioBuffer = await tempCtx.decodeAudioData(arrayBuffer);
    tempCtx.close().catch(() => {});

    const channelData = audioBuffer.getChannelData(0);
    rawAudioBufferCache.set(recordingId, channelData);

    return calculateNormalization(channelData, targetPeak);
  } catch (err) {
    console.warn('Audio normalization analysis error:', err);
    return {
      originalPeak: 0.5,
      originalPeakDbfs: -6.0,
      targetPeak,
      boostMultiplier: 1.0,
      boostDb: 0,
      isQuiet: false,
    };
  }
}
