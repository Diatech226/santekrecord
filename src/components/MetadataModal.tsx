import React, { useState } from 'react';
import { RecordingMeta } from '../types';
import { X, Copy, Check, FileJson } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext';

interface Props {
  recording: RecordingMeta | null;
  onClose: () => void;
}

export const MetadataModal: React.FC<Props> = ({ recording, onClose }) => {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);

  if (!recording) return null;

  const jsonString = JSON.stringify(recording, null, 2);

  const handleCopy = () => {
    navigator.clipboard.writeText(jsonString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div id="metadata-modal" className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-xs font-mono">
      <div className="w-full max-w-lg bg-[#111215] border border-[#2A2B2F] rounded-lg p-5 shadow-2xl space-y-4 max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between pb-2 border-b border-[#1A1B1F] shrink-0">
          <div className="flex items-center gap-2">
            <FileJson className="w-4 h-4 text-[#00F0FF]" />
            <h3 className="text-xs font-semibold text-[#E0E0E0] uppercase tracking-wider truncate">
              {recording.filename_json || `${recording.recording_id}.json`}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-[#1A1B1F] text-[#606060] hover:text-[#E0E0E0]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-auto bg-[#0A0B0D] p-3.5 rounded border border-[#1A1B1F] text-[11px] text-[#00F0FF] whitespace-pre leading-relaxed font-mono selection:bg-[#00F0FF]/30 selection:text-white">
          {jsonString}
        </div>

        <div className="flex justify-between items-center pt-2 border-t border-[#1A1B1F] shrink-0">
          <span className="text-[10px] text-[#606060]">
            PATH: recordings/{recording.filename_json}
          </span>
          <button
            type="button"
            onClick={handleCopy}
            className="px-3 py-1.5 rounded bg-[#151619] hover:bg-[#2A2B2F] border border-[#2A2B2F] text-[#E0E0E0] text-xs flex items-center gap-1.5 transition-colors uppercase tracking-wider"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-[#00F0FF]" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? t.copied : t.copyJson}
          </button>
        </div>
      </div>
    </div>
  );
};
