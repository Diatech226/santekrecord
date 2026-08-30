import React from 'react';
import { AppSettings, DetectionMode } from '../types';
import { Sliders, Palette, Check, Scissors } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext';
import { useTheme } from '../theme/ThemeContext';

interface Props {
  settings: AppSettings;
  disabled?: boolean;
  onUpdateSettings: (newSettings: Partial<AppSettings>) => void;
  onOpenCalibration: () => void;
}

export const SettingsPanel: React.FC<Props> = ({
  settings,
  disabled = false,
  onUpdateSettings,
  onOpenCalibration,
}) => {
  const { t } = useLanguage();
  const { theme, setTheme, themeOptions, currentThemeOption } = useTheme();

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

        {/* Detection Mode */}
        <div className="space-y-1.5">
          <label htmlFor="detection-mode-select" className="text-[10px] text-[#A0A0A0] uppercase tracking-wider block">
            {t.triggerMode}
          </label>
          <select
            id="detection-mode-select"
            disabled={disabled}
            value={settings.trigger_mode}
            onChange={(e) => onUpdateSettings({ trigger_mode: e.target.value as DetectionMode })}
            className="w-full text-xs bg-[#151619] border border-[#2A2B2F] text-[#E0E0E0] rounded p-2 focus:outline-none focus:border-[#00F0FF] cursor-pointer disabled:opacity-50"
          >
            <option value="db_vad">{t.modeDbVad}</option>
            <option value="db_only">{t.modeDbOnly}</option>
            <option value="vad_only">{t.modeVadOnly}</option>
          </select>
        </div>

        {/* Threshold Slider */}
        {(settings.trigger_mode === 'db_vad' || settings.trigger_mode === 'db_only') && (
          <div className="space-y-2">
            <div className="flex justify-between text-[10px]">
              <span className="text-[#A0A0A0] uppercase tracking-wider">{t.dbThreshold}</span>
              <span className="text-[#00F0FF] font-mono font-bold">{settings.threshold_dbfs} dBFS</span>
            </div>
            <input
              id="threshold-slider"
              type="range"
              min="-60"
              max="-15"
              step="1"
              disabled={disabled}
              value={settings.threshold_dbfs}
              onChange={(e) => onUpdateSettings({ threshold_dbfs: Number(e.target.value) })}
              className="w-full accent-[#00F0FF] h-1.5 bg-[#1A1B1F] rounded-lg appearance-none cursor-pointer disabled:opacity-50"
            />
            <div className="flex justify-between text-[9px] text-[#606060] font-mono">
              <span>{t.sensitive}</span>
              <span>{t.loud}</span>
            </div>
          </div>
        )}

        {/* Voice Confidence (VAD Threshold) Slider */}
        {(settings.trigger_mode === 'db_vad' || settings.trigger_mode === 'vad_only') && (
          <div className="space-y-2">
            <div className="flex justify-between text-[10px]">
              <span className="text-[#A0A0A0] uppercase tracking-wider">{t.vadConfidence}</span>
              <span className="text-[#00F0FF] font-mono font-bold">{settings.vad_threshold.toFixed(2)}</span>
            </div>
            <input
              id="vad-confidence-slider"
              type="range"
              min="0.20"
              max="0.95"
              step="0.05"
              disabled={disabled}
              value={settings.vad_threshold}
              onChange={(e) => onUpdateSettings({ vad_threshold: Number(e.target.value) })}
              className="w-full accent-[#00F0FF] h-1.5 bg-[#1A1B1F] rounded-lg appearance-none cursor-pointer disabled:opacity-50"
            />
            <div className="flex justify-between text-[9px] text-[#606060] font-mono">
              <span>{t.permissive}</span>
              <span>{t.strictVoice}</span>
            </div>
          </div>
        )}

        {/* Grid: Pre-buffer & Stop after silence */}
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

      {/* 3. Kali-Inspired Theme Settings Section */}
      <div id="theme-settings-section" className="space-y-3 pt-2 border-t border-[#1A1B1F]">
        <div className="flex items-center justify-between pb-1 text-xs">
          <span className="text-[10px] font-bold text-[#606060] uppercase tracking-widest flex items-center gap-1.5">
            <Palette className="w-3 h-3 text-[#606060]" />
            {t.colorScheme}
          </span>
          <span
            className="text-[9px] px-1.5 py-0.5 rounded font-mono uppercase font-bold tracking-wider"
            style={{
              backgroundColor: `${currentThemeOption.primaryColor}1A`,
              borderColor: currentThemeOption.primaryColor,
              color: currentThemeOption.primaryColor,
              borderWidth: '1px',
            }}
          >
            {currentThemeOption.tag}
          </span>
        </div>

        {/* Theme Selectors Grid */}
        <div className="grid grid-cols-2 gap-2">
          {themeOptions.map((opt) => {
            const isSelected = theme === opt.id;
            const themeName = (t as unknown as Record<string, string>)[opt.nameKey] || opt.defaultName;

            return (
              <button
                key={opt.id}
                id={`theme-option-${opt.id}`}
                type="button"
                onClick={() => setTheme(opt.id)}
                className={`p-2 rounded border text-left flex flex-col justify-between gap-1.5 transition-all duration-150 relative overflow-hidden group ${
                  isSelected
                    ? 'bg-[#151619] shadow-sm'
                    : 'bg-[#0E0F12] hover:bg-[#151619] opacity-80 hover:opacity-100'
                }`}
                style={{
                  borderColor: isSelected ? opt.primaryColor : '#22252C',
                  boxShadow: isSelected ? `0 0 10px ${opt.primaryColor}30` : undefined,
                }}
              >
                {/* Top preview row */}
                <div className="flex items-center justify-between w-full">
                  <div className="flex items-center gap-1.5">
                    {/* Visual Color Swatch */}
                    <div
                      className="w-3 h-3 rounded-full flex items-center justify-center border shadow-sm"
                      style={{
                        backgroundColor: opt.primaryColor,
                        borderColor: '#FFFFFF40',
                      }}
                    />
                    <span
                      className="text-[9px] font-mono font-bold tracking-wider uppercase truncate"
                      style={{
                        color: isSelected ? opt.primaryColor : '#A0A0A0',
                      }}
                    >
                      {opt.tag}
                    </span>
                  </div>

                  {isSelected && (
                    <Check
                      className="w-3 h-3 shrink-0"
                      style={{ color: opt.primaryColor }}
                    />
                  )}
                </div>

                {/* Theme Title */}
                <div
                  className="text-[10px] font-mono leading-tight truncate"
                  style={{
                    color: isSelected ? '#FFFFFF' : '#888888',
                  }}
                >
                  {themeName}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
