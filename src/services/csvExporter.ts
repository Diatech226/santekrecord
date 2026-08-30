import { RecordingMeta } from '../types';

/**
 * Escapes a cell value for CSV formatting according to RFC 4180
 */
function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  const str = String(value);
  // If string contains comma, double quotes, newline, or carriage return, wrap in quotes and escape internal quotes
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Generates RFC-4180 compliant CSV string from an array of RecordingMeta objects
 */
export function generateRecordingsCsvString(recordings: RecordingMeta[]): string {
  const headers = [
    'Recording ID',
    'Timestamp Start',
    'Timestamp End',
    'Duration (s)',
    'WAV File',
    'JSON File',
    'Audio Source',
    'Input Device',
    'Sample Rate (Hz)',
    'Channels',
    'Trigger Mode',
    'Threshold (dBFS)',
    'VAD Confidence Threshold',
    'File Size (Bytes)',
    'Annotation Status',
    'Upload Status',
    'Frequency (Hz)',
    'Modulation',
    'Station ID',
  ];

  const rows = recordings.map((rec) => {
    return [
      escapeCsvCell(rec.recording_id),
      escapeCsvCell(rec.timestamp_start),
      escapeCsvCell(rec.timestamp_end),
      escapeCsvCell(rec.duration_seconds !== undefined ? Number(rec.duration_seconds.toFixed(3)) : ''),
      escapeCsvCell(rec.filename_wav || `${rec.recording_id}.wav`),
      escapeCsvCell(rec.filename_json || `${rec.recording_id}.json`),
      escapeCsvCell(rec.source),
      escapeCsvCell(rec.device || 'Default'),
      escapeCsvCell(rec.sample_rate || 16000),
      escapeCsvCell(rec.channels || 1),
      escapeCsvCell(rec.trigger_mode),
      escapeCsvCell(rec.trigger_threshold_dbfs !== undefined ? rec.trigger_threshold_dbfs : ''),
      escapeCsvCell(rec.vad_threshold !== undefined ? rec.vad_threshold : ''),
      escapeCsvCell(rec.file_size_bytes !== undefined ? rec.file_size_bytes : ''),
      escapeCsvCell(rec.annotation_status || 'unlabeled'),
      escapeCsvCell(rec.upload_status || 'stored_locally'),
      escapeCsvCell(rec.frequency_hz !== undefined ? rec.frequency_hz : ''),
      escapeCsvCell(rec.modulation || ''),
      escapeCsvCell(rec.station_id || ''),
    ].join(',');
  });

  // Include UTF-8 BOM (\uFEFF) for broad compatibility with Excel and other spreadsheet viewers
  return `\uFEFF${headers.join(',')}\r\n${rows.join('\r\n')}`;
}

/**
 * Exports recordings to a CSV file and triggers a browser download
 */
export function downloadRecordingsCsv(recordings: RecordingMeta[], customFilename?: string): void {
  if (!recordings || recordings.length === 0) {
    throw new Error('No recordings available to export as CSV');
  }

  const csvContent = generateRecordingsCsvString(recordings);
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });

  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  const dateStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
  const filename = customFilename || `recordings_metadata_${dateStr}.csv`;

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.id = 'download-csv-temp-link';
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();

  setTimeout(() => {
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, 300);
}
