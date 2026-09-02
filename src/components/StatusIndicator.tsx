import React from 'react';
import { EngineStatus } from '../types';
import { useLanguage } from '../i18n/LanguageContext';

interface Props {
  status: EngineStatus;
  durationSec?: number;
}

export const StatusIndicator: React.FC<Props> = ({ status, durationSec = 0 }) => {
  const { t } = useLanguage();

  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const getStatusConfig = () => {
    switch (status) {
      case 'listening':
        return {
          dotClass: 'bg-[#00F0FF] shadow-[0_0_8px_#00F0FF]',
          textClass: 'text-[#00F0FF]',
          label: t.statusListening,
        };
      case 'voice_detected':
        return {
          dotClass: 'bg-[#00F0FF] animate-ping',
          textClass: 'text-[#00F0FF] font-semibold',
          label: t.statusVoiceDetected,
        };
      case 'communication_active':
        return { dotClass: 'bg-[#FF4444] animate-pulse', textClass: 'text-[#FF4444] font-bold', label: `COMMUNICATION ACTIVE (${formatDuration(durationSec)})` };
      case 'waiting_reply':
      case 'transmission_hangover':
        return { dotClass: 'bg-amber-400 animate-pulse', textClass: 'text-amber-400 font-semibold', label: 'WAITING FOR REPLY' };
      case 'saving_communication':
        return { dotClass: 'bg-[#00F0FF] animate-bounce', textClass: 'text-[#00F0FF]', label: 'SAVING COMMUNICATION' };
      case 'recording':
        return {
          dotClass: 'bg-[#FF4444] animate-pulse shadow-[0_0_8px_#FF4444]',
          textClass: 'text-[#FF4444] font-bold',
          label: `${t.statusRecording} (${formatDuration(durationSec)})`,
        };
      case 'silence':
        return {
          dotClass: 'bg-[#A0A0A0]',
          textClass: 'text-[#A0A0A0]',
          label: `${t.statusSilence} (${formatDuration(durationSec)})`,
        };
      case 'saving':
        return {
          dotClass: 'bg-[#00F0FF] animate-bounce',
          textClass: 'text-[#00F0FF]',
          label: t.statusSaving,
        };
      case 'error':
        return {
          dotClass: 'bg-[#FF4444]',
          textClass: 'text-[#FF4444]',
          label: t.statusError,
        };
      case 'idle':
      default:
        return {
          dotClass: 'bg-[#404040]',
          textClass: 'text-[#606060]',
          label: t.statusIdle,
        };
    }
  };

  const config = getStatusConfig();

  return (
    <div id="status-indicator-container" className="flex items-center gap-2 font-mono text-[11px] tracking-wider uppercase">
      <span className="text-[#606060]">{t.status}</span>
      <div className="flex items-center gap-2 px-2.5 py-1 bg-[#151619] border border-[#2A2B2F] rounded">
        <span className={`w-2 h-2 rounded-full inline-block ${config.dotClass}`} />
        <span className={config.textClass}>{config.label}</span>
      </div>
    </div>
  );
};
