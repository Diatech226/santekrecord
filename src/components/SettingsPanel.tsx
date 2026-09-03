import React from 'react';
import { AppSettings } from '../types';
import { Sliders, Scissors } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext';

interface Props {
  settings: AppSettings;
  disabled?: boolean;
  onUpdateSettings: (newSettings: Partial<AppSettings>) => void;
  onOpenCalibration: () => void;
  ambientNoiseDbfs?: number;
  effectiveGain?: number;
}

export const SettingsPanel: React.FC<Props> = ({
  settings,
  disabled = false,
  onUpdateSettings,
  onOpenCalibration,
  ambientNoiseDbfs,
  effectiveGain,
}) => {
  const { t } = useLanguage();

  const isAutoTrimEnabled = settings.auto_trim_silence !== false;
  const trimMargin = settings.trim_margin_seconds ?? 0.2;

  return (
    <div id="settings-panel-block" className="space-y-5 font-mono">
      {/* 1. Detection Parameters Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between pb-1 border-b border-[#1A1B1F] text-xs">
          <span className="text-[10px] font-bold text-[#606060] uppercase tracking-widest flex items-center gap-1.5">
            <Sliders className="w-3 h-3 text-[#606060]" />
            {t.detectionParams}
          </span>
          <button
            id="btn-calibrate-quick"
            type="button"
            disabled={disabled}
            onClick={onOpenCalibration}
            className="text-[10px] px-2 py-0.5 rounded bg-[#151619] hover:bg-[#2A2B2F] text-[#A0A0A0] hover:text-[#00F0FF] border border-[#2A2B2F] transition-colors disabled:opacity-50 uppercase tracking-wider"
          >
            {t.autoCalibrate}
          </button>
        </div>

        {/* The primary product mode is intentionally source-agnostic. */}
        <div className="space-y-1.5">
          <div className="text-[10px] text-[#A0A0A0] uppercase tracking-wider">Recording mode</div>
          <div className="w-full text-xs bg-[#151619] border border-[#00F0FF]/40 text-[#00F0FF] rounded p-2">
            AUTO VOICE RECORDING · ANY SOURCE
          </div>
        </div>

        {
          <details className="text-[10px] border border-[#202226] rounded p-2">
            <summary className="cursor-pointer text-[#00F0FF] uppercase">Advanced VAD thresholds</summary>
            <div className="grid grid-cols-2 gap-2 mt-2">
              {([
                ['VAD Start', 'vad_start_threshold', settings.vad_start_threshold ?? .65, 0, 1, .05],
                ['VAD Continue', 'vad_stop_threshold', settings.vad_stop_threshold ?? .35, 0, 1, .05],
                ['Minimum SNR', 'minimum_snr_db', settings.minimum_snr_db ?? 6, 0, 20, 1],
                ['Minimum Speech', 'minimum_speech_ms', settings.minimum_speech_ms ?? 160, 40, 1000, 20],
              ] as const).map(([label, key, value, min, max, step]) => <label key={key} className="space-y-1">
                <span className="flex justify-between text-[#A0A0A0]"><b>{label}</b><em>{value}{key.endsWith('_ms') ? ' ms' : key.includes('snr') ? ' dB' : ''}</em></span>
                <input type="range" min={min} max={max} step={step} disabled={disabled} value={value}
                  onChange={(e) => onUpdateSettings({ [key]: Number(e.target.value) })}
                  className="w-full accent-[#00F0FF]" />
              </label>)}
            </div>
          </details>
        }

        {/* Pre-record & Stop after silence Grid */}
        <div className="grid grid-cols-2 gap-3">
          {/* Pre-record */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-[10px]">
              <span className="text-[#A0A0A0] uppercase tracking-wider">{t.prerecord}</span>
              <span className="text-[#00F0FF] font-mono">{settings.preroll_seconds.toFixed(1)}s</span>
            </div>
            <input
              id="preroll-slider"
              type="range"
              min="0.0"
              max="5.0"
              step="0.5"
              disabled={disabled}
              value={settings.preroll_seconds}
              onChange={(e) => onUpdateSettings({ preroll_seconds: Number(e.target.value) })}
              className="w-full accent-[#00F0FF] h-1.5 bg-[#1A1B1F] rounded-lg appearance-none cursor-pointer disabled:opacity-50"
            />
            <div className="flex justify-between text-[9px] text-[#606060] font-mono">
              <span>0.0s</span>
              <span>5.0s</span>
            </div>
          </div>

          {/* Stop after silence */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-[10px]">
              <span className="text-[#A0A0A0] uppercase tracking-wider">{t.silenceTail}</span>
              <span className="text-[#00F0FF] font-mono">{settings.silence_seconds.toFixed(1)}s</span>
            </div>
            <input
              id="silence-slider"
              type="range"
              min="0.5"
              max="10.0"
              step="0.5"
              disabled={disabled}
              value={settings.silence_seconds}
              onChange={(e) => onUpdateSettings({ silence_seconds: Number(e.target.value) })}
              className="w-full accent-[#00F0FF] h-1.5 bg-[#1A1B1F] rounded-lg appearance-none cursor-pointer disabled:opacity-50"
            />
            <div className="flex justify-between text-[9px] text-[#606060] font-mono">
              <span>0.5s</span>
              <span>10.0s</span>
            </div>
          </div>
        </div>

        {/* Sound Card Input Gain, Automatic Gain Control & Channel Routing */}
        <div className="p-2.5 rounded bg-[#111215] border border-[#1F2228] space-y-3">
          
          {/* Automatic Gain Control (AGC) Toggle */}
          <div className="space-y-1.5 pb-2.5 border-b border-[#1A1B1F]">
            <div className="flex items-center justify-between">
              <label htmlFor="agc-toggle" className="text-[10px] text-[#E0E0E0] uppercase tracking-wider font-semibold cursor-pointer">
                {t.autoGainControl}
              </label>
              <button
                id="agc-toggle"
                type="button"
                role="switch"
                aria-checked={Boolean(settings.auto_gain_control)}
                disabled={disabled}
                onClick={() => onUpdateSettings({ auto_gain_control: !settings.auto_gain_control })}
                className={`relative inline-flex h-4 w-8 items-center rounded-full transition-colors focus:outline-none disabled:opacity-50 ${
                  settings.auto_gain_control ? 'bg-[#00F0FF]' : 'bg-[#2A2B2F]'
                }`}
              >
                <span
                  className={`inline-block h-3 w-3 transform rounded-full bg-[#0A0B0D] transition-transform ${
                    settings.auto_gain_control ? 'translate-x-4' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>
            <p className="text-[9px] text-[#707070]">{t.autoGainControlDesc}</p>

            {settings.auto_gain_control && (
              <div id="agc-telemetry-badge" className="mt-2 p-2 bg-[#00F0FF]/10 border border-[#00F0FF]/30 rounded space-y-1">
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-[#00F0FF] font-bold flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#00F0FF] animate-pulse"></span>
                    {t.agcActiveBadge}
                  </span>
                  <span className="font-mono text-[#00F0FF] font-bold">
                    {(effectiveGain ?? settings.input_gain ?? 1.0).toFixed(1)}x ({Math.round(20 * Math.log10(effectiveGain ?? settings.input_gain ?? 1.0))} dB)
                  </span>
                </div>
                <div className="flex justify-between text-[9px] text-[#A0A0A0]">
                  <span>{t.agcNoiseFloorTarget}:</span>
                  <span className="font-mono text-[#E0E0E0]">{(ambientNoiseDbfs ?? -60.0).toFixed(1)} dBFS → -48 dBFS</span>
                </div>
              </div>
            )}
          </div>

          {/* Software Gain Boost */}
          <div className={`space-y-1.5 ${settings.auto_gain_control ? 'opacity-50 pointer-events-none' : ''}`}>
            <div className="flex justify-between text-[10px]">
              <span className="text-[#E0E0E0] uppercase tracking-wider font-semibold">
                {t.inputGain} {settings.auto_gain_control && '(AGC Auto-Managed)'}
              </span>
              <span className="text-[#00F0FF] font-mono font-bold">
                {(settings.auto_gain_control ? (effectiveGain ?? settings.input_gain ?? 1.0) : (settings.input_gain ?? 1.0)).toFixed(1)}x ({Math.round(20 * Math.log10(settings.auto_gain_control ? (effectiveGain ?? settings.input_gain ?? 1.0) : (settings.input_gain ?? 1.0)))} dB)
              </span>
            </div>
            <input
              id="input-gain-slider"
              type="range"
              min="1.0"
              max="8.0"
              step="0.5"
              disabled={disabled || Boolean(settings.auto_gain_control)}
              value={settings.input_gain ?? 1.0}
              onChange={(e) => onUpdateSettings({ input_gain: Number(e.target.value) })}
              className="w-full accent-[#00F0FF] h-1.5 bg-[#1A1B1F] rounded-lg appearance-none cursor-pointer disabled:opacity-50"
            />
            <div className="flex justify-between text-[9px] text-[#606060] font-mono">
              <span>1.0x (Standard)</span>
              <span>8.0x (+18 dB Boost)</span>
            </div>
            {!settings.auto_gain_control && (
              <p className="text-[9px] text-[#707070]">{t.inputGainDesc}</p>
            )}
          </div>

          {/* Input Channel Routing */}
          <div className="space-y-1.5 pt-2 border-t border-[#1A1B1F]">
            <label htmlFor="input-channel-select" className="text-[10px] text-[#A0A0A0] uppercase tracking-wider block">
              {t.inputChannel}
            </label>
            <select
              id="input-channel-select"
              disabled={disabled}
              value={settings.input_channel ?? 'auto'}
              onChange={(e) => onUpdateSettings({ input_channel: e.target.value as 'auto' | 'channel_1' | 'channel_2' })}
              className="w-full text-xs bg-[#151619] border border-[#2A2B2F] text-[#E0E0E0] rounded p-2 focus:outline-none focus:border-[#00F0FF] cursor-pointer disabled:opacity-50"
            >
              <option value="auto">{t.channelAuto}</option>
              <option value="channel_1">{t.channel1}</option>
              <option value="channel_2">{t.channel2}</option>
            </select>
          </div>
        </div>
      </div>

      {/* 2. VAD Post-Processing & Silence Trimming Section */}
      <div id="post-processing-section" className="space-y-3 pt-2 border-t border-[#1A1B1F]">
        <div className="flex items-center justify-between pb-1 text-xs">
          <span className="text-[10px] font-bold text-[#606060] uppercase tracking-widest flex items-center gap-1.5">
            <Scissors className="w-3 h-3 text-[#606060]" />
            {t.postProcessing}
          </span>
          <span className="text-[9px] px-1.5 py-0.5 rounded font-mono uppercase bg-[#151619] border border-[#2A2B2F] text-[#00F0FF]">
            VAD-AUTO
          </span>
        </div>

        <div className="p-2.5 rounded bg-[#111215] border border-[#1F2228] space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="space-y-0.5">
              <label htmlFor="auto-trim-toggle" className="text-xs font-semibold text-[#E0E0E0] cursor-pointer">
                {t.autoTrimSilence}
              </label>
              <p className="text-[10px] text-[#707070] leading-tight">
                {t.autoTrimSilenceDesc}
              </p>
            </div>
            <button
              id="auto-trim-toggle"
              type="button"
              role="switch"
              aria-checked={isAutoTrimEnabled}
              disabled={disabled}
              onClick={() => onUpdateSettings({ auto_trim_silence: !isAutoTrimEnabled })}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-50 ${
                isAutoTrimEnabled ? 'bg-[#00F0FF]' : 'bg-[#2A2B2F]'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-[#0A0B0D] shadow ring-0 transition duration-200 ease-in-out ${
                  isAutoTrimEnabled ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {isAutoTrimEnabled && (
            <div className="space-y-1.5 pt-2 border-t border-[#1A1B1F]">
              <div className="flex justify-between text-[10px]">
                <span className="text-[#A0A0A0] uppercase tracking-wider">{t.trimMargin}</span>
                <span className="text-[#00F0FF] font-mono font-bold">{(trimMargin * 1000).toFixed(0)} ms</span>
              </div>
              <input
                id="trim-margin-slider"
                type="range"
                min="0.05"
                max="0.50"
                step="0.05"
                disabled={disabled}
                value={trimMargin}
                onChange={(e) => onUpdateSettings({ trim_margin_seconds: Number(e.target.value) })}
                className="w-full accent-[#00F0FF] h-1.5 bg-[#1A1B1F] rounded-lg appearance-none cursor-pointer disabled:opacity-50"
              />
              <div className="flex justify-between text-[9px] text-[#606060] font-mono">
                <span>50 ms (Tight)</span>
                <span>500 ms (Generous)</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
