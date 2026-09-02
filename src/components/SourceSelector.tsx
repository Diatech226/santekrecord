import React from 'react';
import { AudioDevice, AudioSourceType } from '../types';
import { Mic, Usb, Radio, RefreshCw, ShieldAlert } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext';

interface Props {
  source: AudioSourceType;
  deviceId: string | number | null;
  devices: AudioDevice[];
  disabled?: boolean;
  isRefreshing?: boolean;
  onRefreshDevices?: () => void;
  onOpenTroubleshoot?: () => void;
  onSourceChange: (source: AudioSourceType) => void;
  onDeviceChange: (deviceId: string | number) => void;
}

export const SourceSelector: React.FC<Props> = ({
  source,
  deviceId,
  devices,
  disabled = false,
  isRefreshing = false,
  onRefreshDevices,
  onOpenTroubleshoot,
  onSourceChange,
  onDeviceChange,
}) => {
  const { t } = useLanguage();

  // Robust device filtering:
  // When 'usb' is selected, prioritize USB sound cards, Line-in, Hardware interfaces,
  // and devices containing USB / CODEC in their name.
  // Keep source tabs honest: every option remains a PortAudio id usable by the
  // backend, and the USB tab never relabels an internal microphone as USB.
  const filteredDevices = React.useMemo(() => {
    if (source === 'usb') {
      const usbCandidates = devices.filter((device) => {
        const nameLower = (device.name || '').toLowerCase();
        return (
          device.type === 'usb' ||
          device.type === 'line' ||
          nameLower.includes('usb') ||
          nameLower.includes('codec') ||
          nameLower.includes('sound') ||
          nameLower.includes('audio') ||
          nameLower.includes('dac') ||
          nameLower.includes('card')
        );
      });
      return usbCandidates;
    }
    return devices.filter((device) => device.type !== 'usb' && device.type !== 'line');
  }, [devices, source]);

  const getDeviceLabel = (dev: AudioDevice) => {
    const nameLower = (dev.name || '').toLowerCase();
    const isUsb = dev.type === 'usb' || nameLower.includes('usb') || nameLower.includes('codec');
    const typeTag = isUsb ? 'USB' : dev.device_kind === 'virtual' ? 'VIRT' : 'HW';
    const hostTag = dev.hostapi || 'ALSA';
    const defaultTag = dev.is_default ? ' (défaut)' : '';
    const chTag = dev.max_input_channels > 1 ? ` · ${dev.max_input_channels}ch` : '';
    return `[${typeTag} · ${hostTag}${chTag}] ${dev.name}${defaultTag}`;
  };

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
          <div className="flex items-center justify-between">
            <label htmlFor="device-select" className="text-[10px] text-[#A0A0A0] uppercase tracking-wider block">
              {t.deviceInterface}
            </label>
            <div className="flex items-center gap-2">
              {onOpenTroubleshoot && (
                <button
                  id="btn-troubleshoot-usb-source"
                  type="button"
                  onClick={onOpenTroubleshoot}
                  title="Dépanner la carte son USB et vérifier les permissions Linux /dev/bus/usb/ et audio"
                  className="flex items-center gap-1 text-[9.5px] text-amber-400 hover:text-amber-300 transition-colors cursor-pointer"
                >
                  <ShieldAlert className="w-3 h-3" />
                  <span>{t.troubleshootUsb}</span>
                </button>
              )}
              {onRefreshDevices && (
                <button
                  id="btn-refresh-audio-devices"
                  type="button"
                  disabled={disabled || isRefreshing}
                  onClick={onRefreshDevices}
                  title="Rafraîchir la liste des cartes son et micros connectés (re-scan)"
                  className="flex items-center gap-1 text-[9.5px] text-[#00F0FF] hover:text-white transition-colors disabled:opacity-50 cursor-pointer"
                >
                  <RefreshCw className={`w-3 h-3 ${isRefreshing ? 'animate-spin text-[#00F0FF]' : ''}`} />
                  <span>Rafraîchir</span>
                </button>
              )}
            </div>
          </div>

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
                {getDeviceLabel(dev)}
              </option>
            ))}
          </select>

          {source === 'usb' && onOpenTroubleshoot && (
            <div className="flex items-center justify-between text-[10px] text-[#A0A0A0] bg-[#0E0F12] border border-[#1A1B1F] p-2 rounded">
              <span>Carte son non visible ou muette ?</span>
              <button
                type="button"
                onClick={onOpenTroubleshoot}
                className="text-[#00F0FF] hover:underline flex items-center gap-1 cursor-pointer font-semibold"
              >
                <span>Diagnostic permissions Kali Linux</span>
                <span>→</span>
              </button>
            </div>
          )}
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
