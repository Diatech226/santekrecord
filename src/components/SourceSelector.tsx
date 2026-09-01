import React from 'react';
import { AudioDevice, AudioSourceType } from '../types';
import { Mic, Usb, Radio } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext';

interface Props {
  source: AudioSourceType;
  deviceId: string | number | null;
  devices: AudioDevice[];
  disabled?: boolean;
  onSourceChange: (source: AudioSourceType) => void;
  onDeviceChange: (deviceId: string | number) => void;
}

export const SourceSelector: React.FC<Props> = ({
  source,
  deviceId,
  devices,
  disabled = false,
  onSourceChange,
  onDeviceChange,
}) => {
  const { t } = useLanguage();

  const filteredDevices = devices.filter((device) =>
    source === 'usb' ? device.type === 'usb' || device.type === 'line' : device.type === 'microphone'
  );

  return (
    <div id="source-selector-block" className="space-y-4 font-mono">
      {/* Source Choice */}
      <div className="space-y-1.5">
        <label htmlFor="source-type-select" className="text-[10px] text-[#A0A0A0] uppercase tracking-wider block">
          {t.inputSource}
        </label>
        <div className="grid grid-cols-3 gap-2">
          <button
            id="source-btn-mic"
            type="button"
            disabled={disabled}
            onClick={() => onSourceChange('microphone')}
            className={`flex items-center justify-center gap-1.5 py-2 px-2 text-xs rounded border transition-all ${
              source === 'microphone'
                ? 'bg-[#151619] border-[#00F0FF] text-[#00F0FF] font-semibold shadow-[0_0_8px_rgba(0,240,255,0.2)]'
                : 'bg-[#151619] border-[#2A2B2F] text-[#A0A0A0] hover:text-[#E0E0E0] hover:border-[#404040]'
            } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <Mic className="w-3.5 h-3.5" />
            <span className="truncate">{t.microphone}</span>
          </button>

          <button
            id="source-btn-usb"
            type="button"
            disabled={disabled}
            onClick={() => onSourceChange('usb')}
            className={`flex items-center justify-center gap-1.5 py-2 px-2 text-xs rounded border transition-all ${
              source === 'usb'
                ? 'bg-[#151619] border-[#00F0FF] text-[#00F0FF] font-semibold shadow-[0_0_8px_rgba(0,240,255,0.2)]'
                : 'bg-[#151619] border-[#2A2B2F] text-[#A0A0A0] hover:text-[#E0E0E0] hover:border-[#404040]'
            } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <Usb className="w-3.5 h-3.5" />
            <span className="truncate">{t.usbSound}</span>
          </button>

          <button
            id="source-btn-gnuradio"
            type="button"
            disabled={disabled}
            onClick={() => onSourceChange('gnuradio')}
            className={`flex items-center justify-center gap-1.5 py-2 px-2 text-xs rounded border transition-all ${
              source === 'gnuradio'
                ? 'bg-[#151619] border-[#00F0FF] text-[#00F0FF] font-semibold shadow-[0_0_8px_rgba(0,240,255,0.2)]'
                : 'bg-[#151619] border-[#2A2B2F] text-[#A0A0A0] hover:text-[#E0E0E0] hover:border-[#404040]'
            } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <Radio className="w-3.5 h-3.5" />
            <span className="truncate">{t.hackrfGnu}</span>
          </button>
        </div>
      </div>

      {/* Device dropdown or HackRF FIFO info */}
      {source !== 'gnuradio' ? (
        <div className="space-y-1.5">
          <label htmlFor="device-select" className="text-[10px] text-[#A0A0A0] uppercase tracking-wider block">
            {t.deviceInterface}
          </label>
          <select
            id="device-select"
            disabled={disabled}
            value={deviceId !== null && deviceId !== undefined ? String(deviceId) : ''}
            onChange={(e) => onDeviceChange(e.target.value)}
            className="w-full text-xs bg-[#151619] border border-[#2A2B2F] text-[#E0E0E0] rounded p-2 focus:outline-none focus:border-[#00F0FF] cursor-pointer disabled:opacity-50"
          >
            {filteredDevices.length === 0 && (
              <option value="">Aucune entrée détectée par ALSA/PipeWire</option>
            )}
            {filteredDevices.map((dev) => (
              <option key={dev.id} value={String(dev.id)}>
                [{dev.hostapi || 'audio'} · {dev.device_kind || 'hardware'}] {dev.name} {dev.is_default ? '(défaut)' : ''}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <div className="p-3 bg-[#0A0B0D] border border-[#1A1B1F] rounded text-xs space-y-1.5">
          <div className="flex justify-between text-[11px]">
            <span className="text-[#606060] uppercase">{t.fifoStream}</span>
            <span className="text-[#00F0FF] font-mono">/tmp/hackrf_audio.f32</span>
          </div>
          <div className="flex justify-between text-[10px] text-[#A0A0A0]">
            <span>{t.formatFloat32}</span>
            <span className="font-mono text-[#606060]">{t.rate16k}</span>
          </div>
        </div>
      )}
    </div>
  );
};
