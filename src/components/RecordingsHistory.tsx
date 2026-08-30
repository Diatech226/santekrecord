import React, { useState, useMemo } from 'react';
import { RecordingMeta } from '../types';
import {
  Clock,
  Archive,
  Loader2,
  Check,
  Trash2,
  CheckSquare,
  Square,
  MinusSquare,
  FileSpreadsheet,
  Download,
  ArrowUpDown,
  ChevronUp,
  ChevronDown,
} from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext';
import { exportRecordingsAsZip, triggerBlobDownload, ExportProgress } from '../services/zipExporter';
import { downloadRecordingsCsv } from '../services/csvExporter';
import { downloadRecordingWav, downloadRecordingsWavBatch } from '../services/wavDownloader';

export type SortColumn = 'date' | 'duration' | 'size';
export type SortDirection = 'asc' | 'desc';

interface Props {
  recordings: RecordingMeta[];
  selectedId: string | null;
  onSelect: (recording: RecordingMeta) => void;
  onDelete: (id: string) => void;
  onDeleteBatch?: (ids: string[]) => void;
  onOpenMeta?: (meta: RecordingMeta) => void;
}

export function getRecordingDateValue(rec: RecordingMeta): number {
  if (rec.timestamp_start) {
    const t = new Date(rec.timestamp_start).getTime();
    if (!isNaN(t) && t > 0) return t;
  }
  if (rec.recording_id) {
    const match = rec.recording_id.match(/(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/);
    if (match) {
      const [, y, m, d, h, min, s] = match;
      const parsed = new Date(Number(y), Number(m) - 1, Number(d), Number(h), Number(min), Number(s)).getTime();
      if (!isNaN(parsed)) return parsed;
    }
    const t = new Date(rec.recording_id).getTime();
    if (!isNaN(t) && t > 0) return t;
  }
  return 0;
}

export function getRecordingSize(rec: RecordingMeta): number {
  if (typeof rec.file_size_bytes === 'number' && rec.file_size_bytes > 0) {
    return rec.file_size_bytes;
  }
  const sampleRate = rec.sample_rate || 16000;
  const channels = rec.channels || 1;
  const bytesPerSample = 2; // 16-bit PCM
  return Math.round(44 + (rec.duration_seconds || 0) * sampleRate * channels * bytesPerSample);
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const RecordingsHistory: React.FC<Props> = ({
  recordings,
  selectedId,
  onSelect,
  onDelete,
  onDeleteBatch,
  onOpenMeta,
}) => {
  const { t } = useLanguage();
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null);
  const [exportComplete, setExportComplete] = useState(false);
  const [exportCsvComplete, setExportCsvComplete] = useState(false);
  const [isExportingWav, setIsExportingWav] = useState(false);
  const [exportWavProgress, setExportWavProgress] = useState<{ current: number; total: number } | null>(null);
  const [exportWavComplete, setExportWavComplete] = useState(false);
  const [downloadingRowId, setDownloadingRowId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBatchDeleting, setIsBatchDeleting] = useState(false);

  // Sorting state
  const [sortColumn, setSortColumn] = useState<SortColumn>('date');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  // Handle column header sorting click
  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(column);
      setSortDirection('desc');
    }
  };

  // Sort recordings based on current column and direction
  const sortedRecordings = useMemo(() => {
    return [...recordings].sort((a, b) => {
      let comparison = 0;
      if (sortColumn === 'date') {
        const dateA = getRecordingDateValue(a);
        const dateB = getRecordingDateValue(b);
        comparison = dateA - dateB;
      } else if (sortColumn === 'duration') {
        const durA = a.duration_seconds || 0;
        const durB = b.duration_seconds || 0;
        comparison = durA - durB;
      } else if (sortColumn === 'size') {
        const sizeA = getRecordingSize(a);
        const sizeB = getRecordingSize(b);
        comparison = sizeA - sizeB;
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [recordings, sortColumn, sortDirection]);

  // Toggle individual item selection
  const handleToggleSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Toggle select all
  const handleToggleSelectAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (selectedIds.size === recordings.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(recordings.map((r) => r.recording_id)));
    }
  };

  // Batch delete action
  const handleBatchDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const idsToDelete = Array.from(selectedIds);
    if (idsToDelete.length === 0 || isBatchDeleting) return;

    if (!window.confirm(`${t.confirmBatchDelete} (${idsToDelete.length})`)) {
      return;
    }

    try {
      setIsBatchDeleting(true);
      if (onDeleteBatch) {
        onDeleteBatch(idsToDelete);
      } else {
        // Fallback sequentially
        for (const id of idsToDelete) {
          onDelete(id);
        }
      }
      setSelectedIds(new Set());
    } finally {
      setIsBatchDeleting(false);
    }
  };

  // Batch export action (either selected items or all items)
  const handleExportSelectedOrAll = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (sortedRecordings.length === 0 || isExporting) return;

    const itemsToExport = selectedIds.size > 0
      ? sortedRecordings.filter((r) => selectedIds.has(r.recording_id))
      : sortedRecordings;

    try {
      setIsExporting(true);
      setExportComplete(false);
      setExportProgress({ current: 0, total: itemsToExport.length, message: 'Initializing...' });

      const zipBlob = await exportRecordingsAsZip(itemsToExport, (p) => {
        setExportProgress(p);
      });

      const now = new Date();
      const pad = (n: number) => n.toString().padStart(2, '0');
      const dateStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
      const prefix = selectedIds.size > 0 ? 'selected_recordings' : 'session_recordings';
      const filename = `${prefix}_${dateStr}.zip`;

      triggerBlobDownload(zipBlob, filename);
      setExportComplete(true);
      setTimeout(() => setExportComplete(false), 3000);
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setIsExporting(false);
      setExportProgress(null);
    }
  };

  // Export CSV action for displayed recordings / selected recordings
  const handleExportCsv = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (sortedRecordings.length === 0) return;

    try {
      const itemsToExport = selectedIds.size > 0
        ? sortedRecordings.filter((r) => selectedIds.has(r.recording_id))
        : sortedRecordings;

      const now = new Date();
      const pad = (n: number) => n.toString().padStart(2, '0');
      const dateStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
      const prefix = selectedIds.size > 0 ? 'selected_recordings_metadata' : 'recordings_metadata';
      const filename = `${prefix}_${dateStr}.csv`;

      downloadRecordingsCsv(itemsToExport, filename);
      setExportCsvComplete(true);
      setTimeout(() => setExportCsvComplete(false), 3000);
    } catch (err) {
      console.error('CSV export failed:', err);
    }
  };

  // Export selected recordings as .wav files (or all if none selected)
  const handleExportWav = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (sortedRecordings.length === 0 || isExportingWav) return;

    const itemsToExport = selectedIds.size > 0
      ? sortedRecordings.filter((r) => selectedIds.has(r.recording_id))
      : sortedRecordings;

    try {
      setIsExportingWav(true);
      setExportWavComplete(false);
      setExportWavProgress({ current: 0, total: itemsToExport.length });

      await downloadRecordingsWavBatch(itemsToExport, (current, total) => {
        setExportWavProgress({ current, total });
      });

      setExportWavComplete(true);
      setTimeout(() => setExportWavComplete(false), 3000);
    } catch (err) {
      console.error('WAV export failed:', err);
    } finally {
      setIsExportingWav(false);
      setExportWavProgress(null);
    }
  };

  // Download individual row WAV file
  const handleDownloadSingleWav = async (rec: RecordingMeta, e: React.MouseEvent) => {
    e.stopPropagation();
    if (downloadingRowId) return;

    try {
      setDownloadingRowId(rec.recording_id);
      await downloadRecordingWav(rec);
    } catch (err) {
      console.error(`Failed to download WAV for ${rec.recording_id}:`, err);
    } finally {
      setDownloadingRowId(null);
    }
  };

  if (recordings.length === 0) {
    return (
      <div id="recent-recordings-empty" className="p-6 bg-[#0D0E11] border border-[#1A1B1F] rounded-lg font-mono text-center text-xs text-[#606060]">
        {t.noRecordings}
      </div>
    );
  }

  const formatTime = (ts: string) => {
    try {
      if (ts.includes('_')) {
        const parts = ts.split('_');
        if (parts.length > 1) {
          const timePart = parts[1].replace(/-/g, ':');
          return timePart.slice(0, 5); // "11:52"
        }
      }
      const d = new Date(ts);
      return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
    } catch {
      return ts;
    }
  };

  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const isAllSelected = recordings.length > 0 && selectedIds.size === recordings.length;
  const isPartiallySelected = selectedIds.size > 0 && selectedIds.size < recordings.length;

  return (
    <div id="recent-recordings-block" className="space-y-3 font-mono">
      <div className="flex flex-wrap items-center justify-between text-xs text-[#606060] pb-1.5 border-b border-[#1A1B1F] gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-[10px] font-bold text-[#606060] uppercase tracking-widest flex items-center gap-1.5">
            <Clock className="w-3 h-3 text-[#606060]" />
            {t.sessionRecordings}
          </h2>
          {selectedIds.size > 0 && (
            <span className="text-[10px] bg-[#00F0FF]/15 text-[#00F0FF] border border-[#00F0FF]/30 px-1.5 py-0.5 rounded font-bold">
              {selectedIds.size} {t.selectedCount}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-[#606060] hidden sm:inline">
            {recordings.length} {t.archived}
          </span>

          {/* Batch Delete Button (Visible when items selected) */}
          {selectedIds.size > 0 && (
            <button
              id="batch-delete-btn"
              type="button"
              onClick={handleBatchDelete}
              disabled={isBatchDeleting}
              title={`${t.deleteSelected} (${selectedIds.size})`}
              className="px-2.5 py-1 rounded text-[10px] font-mono uppercase tracking-wider flex items-center gap-1.5 border border-[#FF4444]/40 bg-[#FF4444]/10 hover:bg-[#FF4444]/20 text-[#FF4444] hover:border-[#FF4444] transition-all cursor-pointer font-semibold shadow-[0_0_8px_rgba(255,68,68,0.2)]"
            >
              {isBatchDeleting ? (
                <Loader2 className="w-3 h-3 text-[#FF4444] animate-spin" />
              ) : (
                <Trash2 className="w-3 h-3 text-[#FF4444]" />
              )}
              <span>{t.deleteSelected} ({selectedIds.size})</span>
            </button>
          )}

          {/* Export WAV Button (Downloads selected audio recordings as .wav files) */}
          <button
            id="export-wav-btn"
            type="button"
            onClick={handleExportWav}
            disabled={isExportingWav}
            title={selectedIds.size > 0 ? `${t.exportSelectedWav} (${selectedIds.size})` : t.exportWav}
            className={`px-2.5 py-1 rounded text-[10px] font-mono uppercase tracking-wider flex items-center gap-1.5 border transition-all ${
              exportWavComplete
                ? 'bg-[#00F0FF]/15 border-[#00F0FF] text-[#00F0FF]'
                : isExportingWav
                ? 'bg-[#151619] border-[#2A2B2F] text-[#A0A0A0] cursor-wait'
                : 'bg-[#151619] hover:bg-[#20222A] active:bg-[#00F0FF]/20 border-[#2A2B2F] hover:border-[#00F0FF] text-[#A0A0A0] hover:text-[#00F0FF]'
            }`}
          >
            {exportWavComplete ? (
              <>
                <Check className="w-3 h-3 text-[#00F0FF]" />
                <span>{t.exportWavSuccess}</span>
              </>
            ) : isExportingWav ? (
              <>
                <Loader2 className="w-3 h-3 text-[#00F0FF] animate-spin" />
                <span>
                  {exportWavProgress
                    ? `${t.exportingWav} (${exportWavProgress.current}/${exportWavProgress.total})`
                    : t.exportingWav}
                </span>
              </>
            ) : (
              <>
                <Download className="w-3 h-3 text-[#00F0FF]" />
                <span>
                  {selectedIds.size > 0
                    ? `${t.exportSelectedWav} (${selectedIds.size})`
                    : t.exportWav}
                </span>
              </>
            )}
          </button>

          {/* Export CSV Button */}
          <button
            id="export-csv-btn"
            type="button"
            onClick={handleExportCsv}
            title={selectedIds.size > 0 ? `${t.exportSelectedCsv} (${selectedIds.size})` : t.exportCsv}
            className={`px-2.5 py-1 rounded text-[10px] font-mono uppercase tracking-wider flex items-center gap-1.5 border transition-all ${
              exportCsvComplete
                ? 'bg-[#00F0FF]/15 border-[#00F0FF] text-[#00F0FF]'
                : 'bg-[#151619] hover:bg-[#20222A] active:bg-[#00F0FF]/20 border-[#2A2B2F] hover:border-[#00F0FF] text-[#A0A0A0] hover:text-[#00F0FF]'
            }`}
          >
            {exportCsvComplete ? (
              <>
                <Check className="w-3 h-3 text-[#00F0FF]" />
                <span>{t.exportCsvSuccess}</span>
              </>
            ) : (
              <>
                <FileSpreadsheet className="w-3 h-3 text-[#00F0FF]" />
                <span>
                  {selectedIds.size > 0
                    ? `${t.exportSelectedCsv} (${selectedIds.size})`
                    : t.exportCsv}
                </span>
              </>
            )}
          </button>

          {/* Export ZIP Button (Export selected or export all) */}
          <button
            id="export-all-zip-btn"
            type="button"
            onClick={handleExportSelectedOrAll}
            disabled={isExporting}
            title={selectedIds.size > 0 ? `${t.exportSelected} (${selectedIds.size})` : t.exportAll}
            className={`px-2.5 py-1 rounded text-[10px] font-mono uppercase tracking-wider flex items-center gap-1.5 border transition-all ${
              exportComplete
                ? 'bg-[#00F0FF]/15 border-[#00F0FF] text-[#00F0FF]'
                : isExporting
                ? 'bg-[#151619] border-[#2A2B2F] text-[#A0A0A0] cursor-wait'
                : 'bg-[#151619] hover:bg-[#20222A] active:bg-[#00F0FF]/20 border-[#2A2B2F] hover:border-[#00F0FF] text-[#A0A0A0] hover:text-[#00F0FF]'
            }`}
          >
            {exportComplete ? (
              <>
                <Check className="w-3 h-3 text-[#00F0FF]" />
                <span>{t.exportSuccess}</span>
              </>
            ) : isExporting ? (
              <>
                <Loader2 className="w-3 h-3 text-[#00F0FF] animate-spin" />
                <span>
                  {exportProgress
                    ? `${t.exporting} (${exportProgress.current}/${exportProgress.total})`
                    : t.exporting}
                </span>
              </>
            ) : (
              <>
                <Archive className="w-3 h-3 text-[#00F0FF]" />
                <span>
                  {selectedIds.size > 0
                    ? `${t.exportSelected} (${selectedIds.size})`
                    : t.exportAll}
                </span>
              </>
            )}
          </button>
        </div>
      </div>

      <div className="border border-[#1A1B1F] rounded-lg bg-[#0D0E11] overflow-hidden flex flex-col">
        {/* Table header with Select-All Checkbox and Interactive Sort Buttons */}
        <div className="grid grid-cols-12 text-[9px] text-[#606060] uppercase border-b border-[#1A1B1F] p-2.5 bg-[#151619] tracking-wider font-semibold items-center">
          <div className="col-span-5 flex items-center gap-2">
            <button
              id="select-all-checkbox-btn"
              type="button"
              onClick={handleToggleSelectAll}
              title={isAllSelected ? t.deselectAll : t.selectAll}
              className="text-[#808080] hover:text-[#00F0FF] focus:outline-none transition-colors p-0.5"
            >
              {isAllSelected ? (
                <CheckSquare className="w-3.5 h-3.5 text-[#00F0FF]" />
              ) : isPartiallySelected ? (
                <MinusSquare className="w-3.5 h-3.5 text-[#00F0FF]" />
              ) : (
                <Square className="w-3.5 h-3.5 text-[#50525A]" />
              )}
            </button>

            {/* Sort by Date / Timestamp */}
            <button
              id="sort-by-date-btn"
              type="button"
              onClick={() => handleSort('date')}
              className={`flex items-center gap-1 text-left text-[9px] uppercase font-semibold transition-colors focus:outline-none select-none group cursor-pointer ${
                sortColumn === 'date' ? 'text-[#00F0FF]' : 'text-[#808080] hover:text-[#E0E0E0]'
              }`}
              title={`Sort by date (${sortColumn === 'date' ? sortDirection : 'desc'})`}
            >
              <span>{t.thTimestamp}</span>
              {sortColumn === 'date' ? (
                sortDirection === 'asc' ? (
                  <ChevronUp className="w-3 h-3 text-[#00F0FF]" />
                ) : (
                  <ChevronDown className="w-3 h-3 text-[#00F0FF]" />
                )
              ) : (
                <ArrowUpDown className="w-3 h-3 opacity-0 group-hover:opacity-70 transition-opacity" />
              )}
            </button>
          </div>

          {/* Sort by Duration */}
          <div className="col-span-2">
            <button
              id="sort-by-duration-btn"
              type="button"
              onClick={() => handleSort('duration')}
              className={`flex items-center gap-1 text-left text-[9px] uppercase font-semibold transition-colors focus:outline-none select-none group cursor-pointer ${
                sortColumn === 'duration' ? 'text-[#00F0FF]' : 'text-[#808080] hover:text-[#E0E0E0]'
              }`}
              title={`Sort by duration (${sortColumn === 'duration' ? sortDirection : 'desc'})`}
            >
              <span>{t.thDuration}</span>
              {sortColumn === 'duration' ? (
                sortDirection === 'asc' ? (
                  <ChevronUp className="w-3 h-3 text-[#00F0FF]" />
                ) : (
                  <ChevronDown className="w-3 h-3 text-[#00F0FF]" />
                )
              ) : (
                <ArrowUpDown className="w-3 h-3 opacity-0 group-hover:opacity-70 transition-opacity" />
              )}
            </button>
          </div>

          {/* Sort by File Size */}
          <div className="col-span-2 text-right flex justify-end">
            <button
              id="sort-by-size-btn"
              type="button"
              onClick={() => handleSort('size')}
              className={`flex items-center gap-1 text-right text-[9px] uppercase font-semibold transition-colors focus:outline-none select-none group cursor-pointer ${
                sortColumn === 'size' ? 'text-[#00F0FF]' : 'text-[#808080] hover:text-[#E0E0E0]'
              }`}
              title={`Sort by file size (${sortColumn === 'size' ? sortDirection : 'desc'})`}
            >
              <span>{t.thSize}</span>
              {sortColumn === 'size' ? (
                sortDirection === 'asc' ? (
                  <ChevronUp className="w-3 h-3 text-[#00F0FF]" />
                ) : (
                  <ChevronDown className="w-3 h-3 text-[#00F0FF]" />
                )
              ) : (
                <ArrowUpDown className="w-3 h-3 opacity-0 group-hover:opacity-70 transition-opacity" />
              )}
            </button>
          </div>

          <div className="col-span-3 text-right">{t.thActions}</div>
        </div>

        {/* Table rows with Multi-Select Checkboxes */}
        <div className="flex flex-col font-mono text-[11px] max-h-64 overflow-y-auto divide-y divide-[#1A1B1F]">
          {sortedRecordings.map((rec) => {
            const isPlayingActive = selectedId === rec.recording_id;
            const isChecked = selectedIds.has(rec.recording_id);
            const filename = rec.filename_wav || `${rec.recording_id}.wav`;
            const durationStr = formatDuration(rec.duration_seconds);
            const sizeBytes = getRecordingSize(rec);
            const sizeStr = formatFileSize(sizeBytes);

            return (
              <div
                key={rec.recording_id}
                onClick={() => onSelect(rec)}
                className={`grid grid-cols-12 p-3 items-center cursor-pointer transition-colors ${
                  isChecked
                    ? 'bg-[#00F0FF]/5 text-[#E0E0E0] border-l-2 border-l-[#00F0FF]'
                    : isPlayingActive
                    ? 'bg-[#151619] text-[#E0E0E0] border-l-2 border-l-[#00F0FF]/60'
                    : 'text-[#A0A0A0] hover:bg-[#151619] hover:text-[#E0E0E0]'
                }`}
              >
                <div className="col-span-5 truncate text-[#E0E0E0] flex items-center gap-2">
                  <button
                    id={`checkbox-${rec.recording_id}`}
                    type="button"
                    onClick={(e) => handleToggleSelect(rec.recording_id, e)}
                    className="text-[#808080] hover:text-[#00F0FF] focus:outline-none transition-colors p-0.5 flex-shrink-0"
                    title={isChecked ? 'Deselect' : 'Select'}
                  >
                    {isChecked ? (
                      <CheckSquare className="w-3.5 h-3.5 text-[#00F0FF]" />
                    ) : (
                      <Square className="w-3.5 h-3.5 text-[#40424A] hover:text-[#00F0FF]" />
                    )}
                  </button>
                  <span className="text-[#606060] text-[9px] flex-shrink-0">{formatTime(rec.recording_id)}</span>
                  <span className="truncate">{filename}</span>
                </div>
                <div className="col-span-2 text-[#A0A0A0]">{durationStr}</div>
                <div className="col-span-2 text-right font-mono text-[#8E9099] font-medium">{sizeStr}</div>
                <div className="col-span-3 text-right flex justify-end items-center gap-2.5" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    onClick={() => onSelect(rec)}
                    className="text-[#00F0FF] hover:underline uppercase text-[10px]"
                  >
                    {t.play}
                  </button>
                  <button
                    id={`download-wav-${rec.recording_id}`}
                    type="button"
                    title={t.exportWav}
                    onClick={(e) => handleDownloadSingleWav(rec, e)}
                    className="text-[#A0A0A0] hover:text-[#00F0FF] hover:underline uppercase text-[10px] flex items-center gap-1"
                  >
                    {downloadingRowId === rec.recording_id ? (
                      <Loader2 className="w-2.5 h-2.5 animate-spin text-[#00F0FF]" />
                    ) : (
                      <Download className="w-2.5 h-2.5" />
                    )}
                    <span>WAV</span>
                  </button>
                  {onOpenMeta && (
                    <button
                      type="button"
                      onClick={() => onOpenMeta(rec)}
                      className="text-[#A0A0A0] hover:text-[#E0E0E0] hover:underline uppercase text-[10px]"
                    >
                      {t.json}
                    </button>
                  )}
                  <button
                    type="button"
                    title={t.del}
                    onClick={() => onDelete(rec.recording_id)}
                    className="text-[#606060] hover:text-[#FF4444] hover:underline uppercase text-[10px]"
                  >
                    {t.del}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
