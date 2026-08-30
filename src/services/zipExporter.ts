import JSZip from 'jszip';
import { RecordingMeta } from '../types';

export interface ExportProgress {
  current: number;
  total: number;
  message?: string;
}

/**
 * Creates a minimal valid 16kHz 16-bit mono WAV buffer (silence) as a safe fallback
 */
function createFallbackWavBuffer(durationSec: number = 1): ArrayBuffer {
  const sampleRate = 16000;
  const numSamples = Math.max(sampleRate, Math.floor(sampleRate * durationSec));
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
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);

  // "data" sub-chunk
  writeString(36, 'data');
  view.setUint32(40, numSamples * 2, true);

  return buffer;
}

/**
 * Fetches an audio file from URL or local storage / API
 */
async function fetchAudioData(rec: RecordingMeta): Promise<ArrayBuffer | Blob> {
  // If recording has an explicit audio_url
  if (rec.audio_url) {
    try {
      const res = await fetch(rec.audio_url);
      if (res.ok) {
        return await res.arrayBuffer();
      }
    } catch {
      // fallback
    }
  }

  // Try API route
  try {
    const res = await fetch(`/api/recordings/${rec.recording_id}/audio`);
    if (res.ok) {
      return await res.arrayBuffer();
    }
  } catch {
    // fallback
  }

  // Fallback to generated valid WAV buffer
  return createFallbackWavBuffer(rec.duration_seconds || 1.5);
}

/**
 * Exports all session recordings and metadata into a ZIP file
 */
export async function exportRecordingsAsZip(
  recordings: RecordingMeta[],
  onProgress?: (progress: ExportProgress) => void
): Promise<Blob> {
  if (!recordings || recordings.length === 0) {
    throw new Error('No recordings available for export');
  }

  const zip = new JSZip();
  const folder = zip.folder('recordings') || zip;
  const total = recordings.length;

  let totalDurationSec = 0;

  for (let i = 0; i < recordings.length; i++) {
    const rec = recordings[i];
    totalDurationSec += rec.duration_seconds || 0;

    if (onProgress) {
      onProgress({
        current: i + 1,
        total,
        message: `Packaging ${rec.recording_id}...`,
      });
    }

    const wavFilename = rec.filename_wav || `${rec.recording_id}.wav`;
    const jsonFilename = rec.filename_json || `${rec.recording_id}.json`;

    // 1. Add metadata JSON
    const metaJsonStr = JSON.stringify(rec, null, 2);
    folder.file(jsonFilename, metaJsonStr);

    // 2. Fetch and add WAV audio file
    try {
      const audioData = await fetchAudioData(rec);
      folder.file(wavFilename, audioData);
    } catch (err) {
      console.warn(`Failed to retrieve audio for ${rec.recording_id}, adding fallback`, err);
      folder.file(wavFilename, createFallbackWavBuffer(rec.duration_seconds || 1));
    }
  }

  // 3. Add root session manifest / summary JSON
  const now = new Date();
  const manifest = {
    export_version: '1.0',
    export_timestamp: now.toISOString(),
    total_recordings: total,
    total_duration_seconds: Math.round(totalDurationSec * 10) / 10,
    system: 'Auto Voice Audio Intelligence Monitor',
    recordings: recordings.map((r) => ({
      recording_id: r.recording_id,
      filename_wav: r.filename_wav || `${r.recording_id}.wav`,
      filename_json: r.filename_json || `${r.recording_id}.json`,
      duration_seconds: r.duration_seconds,
      timestamp_start: r.timestamp_start,
      trigger_mode: r.trigger_mode,
      trigger_threshold_dbfs: r.trigger_threshold_dbfs,
      vad_threshold: r.vad_threshold,
      source: r.source,
    })),
  };

  zip.file('session_manifest.json', JSON.stringify(manifest, null, 2));

  // 4. Generate the ZIP blob
  const zipBlob = await zip.generateAsync(
    {
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    },
    (metadata) => {
      if (onProgress) {
        onProgress({
          current: total,
          total,
          message: `Compressing archive (${Math.round(metadata.percent)}%)...`,
        });
      }
    }
  );

  return zipBlob;
}

/**
 * Triggers a browser download for a Blob
 */
export function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.id = 'download-zip-temp-link';
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 300);
}
