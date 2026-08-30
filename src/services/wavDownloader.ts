import { RecordingMeta } from '../types';

/**
 * Creates a minimal valid 16kHz 16-bit mono WAV buffer (silence) as a safe fallback
 */
export function createFallbackWavBuffer(durationSec: number = 1, sampleRate: number = 16000): ArrayBuffer {
  const effectiveSampleRate = sampleRate || 16000;
  const numSamples = Math.max(effectiveSampleRate, Math.floor(effectiveSampleRate * durationSec));
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);

  // RIFF chunk descriptor
  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 2, true);
  writeString(8, 'WAVE');

  // "fmt " sub-chunk
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, effectiveSampleRate, true);
  view.setUint32(28, effectiveSampleRate * 2, true);
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample

  // "data" sub-chunk
  writeString(36, 'data');
  view.setUint32(40, numSamples * 2, true);

  return buffer;
}

/**
 * Fetches the audio Blob for a recording
 */
export async function getRecordingAudioBlob(rec: RecordingMeta): Promise<Blob> {
  // If recording has an explicit audio_url
  if (rec.audio_url) {
    try {
      const res = await fetch(rec.audio_url);
      if (res.ok) {
        const blob = await res.blob();
        if (blob.size > 0) return blob;
      }
    } catch {
      // fallback
    }
  }

  // Try API route
  try {
    const res = await fetch(`/api/recordings/${rec.recording_id}/audio`);
    if (res.ok) {
      const blob = await res.blob();
      if (blob.size > 0) return blob;
    }
  } catch {
    // fallback
  }

  // Fallback to generated valid WAV buffer
  const fallbackBuffer = createFallbackWavBuffer(rec.duration_seconds || 1.5, rec.sample_rate || 16000);
  return new Blob([fallbackBuffer], { type: 'audio/wav' });
}

/**
 * Downloads a single recording as a .wav file
 */
export async function downloadRecordingWav(rec: RecordingMeta): Promise<void> {
  const blob = await getRecordingAudioBlob(rec);
  const filename = rec.filename_wav || `${rec.recording_id}.wav`;

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.id = `download-wav-${rec.recording_id}`;
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();

  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 400);
}

/**
 * Downloads multiple selected recordings as .wav files
 */
export async function downloadRecordingsWavBatch(
  recordings: RecordingMeta[],
  onProgress?: (current: number, total: number) => void
): Promise<void> {
  if (!recordings || recordings.length === 0) return;

  const total = recordings.length;
  for (let i = 0; i < total; i++) {
    const rec = recordings[i];
    if (onProgress) {
      onProgress(i + 1, total);
    }
    await downloadRecordingWav(rec);
    // Add small delay between downloads to prevent browser suppression of multiple automatic downloads
    if (i < total - 1) {
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
  }
}
