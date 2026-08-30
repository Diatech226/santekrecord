import React, { useState, useEffect } from 'react';
import { X, Check, Activity } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onRunCalibration: () => Promise<{ noise_floor_dbfs: number; recommended_threshold_dbfs: number }>;
  onApplyThreshold: (recommendedThreshold: number) => void;
}

export const CalibrationModal: React.FC<Props> = ({
  isOpen,
  onClose,
  onRunCalibration,
  onApplyThreshold,
}) => {
  const { t } = useLanguage();
  const [stage, setStage] = useState<'idle' | 'running' | 'done'>('idle');
  const [countdown, setCountdown] = useState(5);
  const [result, setResult] = useState<{ noise_floor_dbfs: number; recommended_threshold_dbfs: number } | null>(null);

  useEffect(() => {
    if (isOpen) {
      setStage('idle');
      setCountdown(5);
      setResult(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleStart = async () => {
    setStage('running');
    setCountdown(5);

    const timer = setInterval(() => {
      setCountdown((prev) => Math.max(0, prev - 1));
    }, 1000);

    try {
      const res = await onRunCalibration();
      setResult(res);
      setStage('done');
    } catch {
      setStage('idle');
    } finally {
      clearInterval(timer);
    }
  };

  const handleApply = () => {
    if (result) {
      onApplyThreshold(result.recommended_threshold_dbfs);
      onClose();
    }
  };

  return (
    <div id="calibration-modal" className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-xs font-mono">
      <div className="w-full max-w-md bg-[#111215] border border-[#2A2B2F] rounded-lg p-6 shadow-2xl space-y-5">
        <div className="flex items-center justify-between pb-3 border-b border-[#1A1B1F]">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-[#00F0FF] shadow-[0_0_6px_#00F0FF]"></div>
            <h3 className="text-xs font-mono tracking-[0.2em] text-[#E0E0E0] uppercase font-bold">
              {t.calibTitle}
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

        {stage === 'idle' && (
          <div className="space-y-4 text-xs text-[#A0A0A0]">
            <p className="leading-relaxed">
              {t.calibDesc}
            </p>
            <div className="p-3 bg-[#0A0B0D] border border-[#1A1B1F] rounded text-[#808080] space-y-1.5 text-[11px]">
              <div className="text-[#E0E0E0] uppercase font-semibold tracking-wider">{t.calibInstructionsTitle}</div>
              <div>{t.calibStep1}</div>
              <div>{t.calibStep2}</div>
              <div>{t.calibStep3}</div>
            </div>
            <button
              id="start-calib-btn"
              type="button"
              onClick={handleStart}
              className="w-full py-3 bg-[#00F0FF] hover:brightness-110 text-[#0A0B0D] font-bold rounded text-xs uppercase tracking-widest transition-all"
            >
              {t.calibStartBtn}
            </button>
          </div>
        )}

        {stage === 'running' && (
          <div className="space-y-4 py-4 text-center">
            <Activity className="w-8 h-8 text-[#00F0FF] animate-pulse mx-auto shadow-[0_0_10px_#00F0FF]" />
            <div className="text-xs text-[#A0A0A0] uppercase tracking-wider">{t.calibMeasuring}</div>
            <div className="text-3xl font-mono font-bold text-[#00F0FF]">{countdown}s</div>
            <div className="text-[10px] text-[#606060] uppercase">{t.calibQuiet}</div>
          </div>
        )}

        {stage === 'done' && result && (
          <div className="space-y-4 text-xs">
            <div className="p-3.5 bg-[#0A0B0D] border border-[#1A1B1F] rounded space-y-2.5">
              <div className="flex justify-between">
                <span className="text-[#606060] uppercase text-[10px]">{t.calibMeasuredNoise}</span>
                <span className="text-[#E0E0E0] font-mono font-semibold">{result.noise_floor_dbfs} dBFS</span>
              </div>
              <div className="flex justify-between border-t border-[#1A1B1F] pt-2.5 items-center">
                <span className="text-[#A0A0A0] uppercase text-[10px]">{t.calibRecommendedTrg}</span>
                <span className="text-[#00F0FF] font-mono font-bold text-sm">
                  {result.recommended_threshold_dbfs} dBFS
                </span>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleStart}
                className="flex-1 py-2.5 bg-[#151619] hover:bg-[#2A2B2F] border border-[#2A2B2F] text-[#A0A0A0] hover:text-[#E0E0E0] rounded text-xs uppercase tracking-wider transition-colors"
              >
                {t.calibRemeasure}
              </button>
              <button
                id="apply-calib-btn"
                type="button"
                onClick={handleApply}
                className="flex-1 py-2.5 bg-[#00F0FF] hover:brightness-110 text-[#0A0B0D] font-bold rounded text-xs uppercase tracking-widest flex items-center justify-center gap-1.5 transition-all"
              >
                <Check className="w-3.5 h-3.5" />
                {t.calibApplyBtn}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
