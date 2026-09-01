import React, { useState, useEffect, useCallback } from 'react';
import {
  X,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  Copy,
  Check,
  Activity,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  HelpCircle,
  HardDrive,
  Users,
  RefreshCw,
  Cpu,
  Layers,
} from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext';
import { api } from '../services/api';
import { UsbTroubleshootResult, UsbDiagnosticCheck } from '../types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onRefreshDevices?: () => void;
}

export const TroubleshootUsbModal: React.FC<Props> = ({
  isOpen,
  onClose,
  onRefreshDevices,
}) => {
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState<'guide' | 'diag'>('diag');
  const [loading, setLoading] = useState(false);
  const [diagResult, setDiagResult] = useState<UsbTroubleshootResult | null>(null);
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const runHardwareDiagnostic = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const result = await api.getUsbDiagnostic();
      setDiagResult(result);
      if (onRefreshDevices) {
        onRefreshDevices();
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erreur lors du diagnostic matériel');
    } finally {
      setLoading(false);
    }
  }, [onRefreshDevices]);

  useEffect(() => {
    if (isOpen) {
      void runHardwareDiagnostic();
    }
  }, [isOpen, runHardwareDiagnostic]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleCopy = (text: string) => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => {
        setCopiedCmd(text);
        setTimeout(() => setCopiedCmd(null), 2500);
      }).catch(() => {});
    }
  };

  return (
    <div
      id="troubleshoot-usb-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-3 sm:p-5 backdrop-blur-xs font-mono"
    >
      <div className="w-full max-w-3xl max-h-[90vh] flex flex-col bg-[#111215] border border-[#2A2B2F] rounded-lg shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1A1B1F] bg-[#151619]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-[#1A1B1F] border border-[#2A2B2F] flex items-center justify-center text-[#00F0FF] shadow-[0_0_8px_rgba(0,240,255,0.2)]">
              <ShieldAlert className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-bold text-[#E0E0E0] uppercase tracking-wider">
                  {t.troubleshootUsbTitle}
                </h3>
                <span className="text-[9px] px-1.5 py-0.2 bg-[#00F0FF]/10 text-[#00F0FF] border border-[#00F0FF]/30 rounded">
                  Kali Linux / ALSA
                </span>
              </div>
              <p className="text-[10px] text-[#A0A0A0] mt-0.5">
                {t.troubleshootUsbSub}
              </p>
            </div>
          </div>
          <button
            id="btn-close-troubleshoot-modal"
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="p-1.5 rounded text-[#A0A0A0] hover:text-white hover:bg-[#2A2B2F] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Navigation & Action Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 border-b border-[#1A1B1F] bg-[#0E0F12]">
          <div className="flex gap-1">
            <button
              id="tab-btn-live-diag"
              type="button"
              onClick={() => setActiveTab('diag')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded transition-all cursor-pointer ${
                activeTab === 'diag'
                  ? 'bg-[#1A1B1F] text-[#00F0FF] border border-[#00F0FF]/40 shadow-[0_0_6px_rgba(0,240,255,0.15)] font-semibold'
                  : 'text-[#A0A0A0] hover:text-[#E0E0E0] hover:bg-[#151619]'
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              <span>{t.troubleshootTabsLiveDiag}</span>
            </button>
            <button
              id="tab-btn-guide"
              type="button"
              onClick={() => setActiveTab('guide')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded transition-all cursor-pointer ${
                activeTab === 'guide'
                  ? 'bg-[#1A1B1F] text-[#00F0FF] border border-[#00F0FF]/40 shadow-[0_0_6px_rgba(0,240,255,0.15)] font-semibold'
                  : 'text-[#A0A0A0] hover:text-[#E0E0E0] hover:bg-[#151619]'
              }`}
            >
              <HelpCircle className="w-3.5 h-3.5" />
              <span>{t.troubleshootTabsGuide}</span>
            </button>
          </div>

          <button
            id="btn-trigger-hardware-diag"
            type="button"
            disabled={loading}
            onClick={() => void runHardwareDiagnostic()}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#00F0FF]/15 hover:bg-[#00F0FF]/25 border border-[#00F0FF]/50 text-[#00F0FF] hover:text-white rounded text-xs transition-all disabled:opacity-50 cursor-pointer font-bold shadow-[0_0_8px_rgba(0,240,255,0.15)]"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>{loading ? t.troubleshootRunningDiag : t.troubleshootRunDiagBtn}</span>
          </button>
        </div>

        {/* Modal Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5 text-xs">
          {errorMsg && (
            <div className="p-3 bg-red-950/40 border border-red-800/60 rounded flex items-center gap-2 text-red-300">
              <XCircle className="w-4 h-4 shrink-0 text-red-400" />
              <span>{errorMsg}</span>
            </div>
          )}

          {activeTab === 'diag' ? (
            /* Tab 1: Live Diagnostic Matrix */
            <div className="space-y-4">
              {/* Overall Status Banner */}
              {diagResult && (
                <div
                  className={`p-3.5 rounded border flex items-center justify-between gap-3 ${
                    diagResult.overall_status === 'ok'
                      ? 'bg-emerald-950/20 border-emerald-800/40 text-emerald-300'
                      : diagResult.overall_status === 'warning'
                      ? 'bg-amber-950/20 border-amber-800/40 text-amber-300'
                      : 'bg-red-950/25 border-red-800/50 text-red-300'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    {diagResult.overall_status === 'ok' ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                    ) : diagResult.overall_status === 'warning' ? (
                      <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
                    ) : (
                      <XCircle className="w-5 h-5 text-red-400 shrink-0" />
                    )}
                    <div>
                      <div className="font-bold text-xs">
                        {diagResult.overall_status === 'ok'
                          ? t.troubleshootDiagSuccess
                          : diagResult.overall_status === 'warning'
                          ? t.troubleshootDiagWarning
                          : t.troubleshootDiagError}
                      </div>
                      <div className="text-[10px] opacity-80 mt-0.5">
                        Utilisateur actuel: <span className="font-mono font-semibold">{diagResult.user}</span> · Détecté à {diagResult.timestamp}
                      </div>
                    </div>
                  </div>

                  <div className="text-right text-[10px] font-mono shrink-0">
                    <span className="px-2 py-0.5 rounded bg-[#111215] border border-current font-bold uppercase tracking-wider">
                      {diagResult.overall_status}
                    </span>
                  </div>
                </div>
              )}

              {/* Quick Stat Tiles */}
              {diagResult && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <div className="p-2.5 bg-[#0D0E11] border border-[#1E2025] rounded space-y-1">
                    <div className="flex items-center justify-between text-[10px] text-[#606060]">
                      <span className="uppercase tracking-wider flex items-center gap-1">
                        <Users className="w-3 h-3 text-[#00F0FF]" />
                        audio group
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`w-2 h-2 rounded-full ${
                          diagResult.in_audio_group ? 'bg-[#00FF44] shadow-[0_0_4px_#00FF44]' : 'bg-red-500'
                        }`}
                      />
                      <span className="text-xs font-bold text-[#E0E0E0]">
                        {diagResult.in_audio_group ? 'MEMBRE' : 'NON MEMBRE'}
                      </span>
                    </div>
                  </div>

                  <div className="p-2.5 bg-[#0D0E11] border border-[#1E2025] rounded space-y-1">
                    <div className="flex items-center justify-between text-[10px] text-[#606060]">
                      <span className="uppercase tracking-wider flex items-center gap-1">
                        <Cpu className="w-3 h-3 text-[#00F0FF]" />
                        plugdev (USB)
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`w-2 h-2 rounded-full ${
                          diagResult.in_plugdev_group ? 'bg-[#00FF44] shadow-[0_0_4px_#00FF44]' : 'bg-amber-500'
                        }`}
                      />
                      <span className="text-xs font-bold text-[#E0E0E0]">
                        {diagResult.in_plugdev_group ? 'MEMBRE' : 'ABSENT'}
                      </span>
                    </div>
                  </div>

                  <div className="p-2.5 bg-[#0D0E11] border border-[#1E2025] rounded space-y-1">
                    <div className="flex items-center justify-between text-[10px] text-[#606060]">
                      <span className="uppercase tracking-wider flex items-center gap-1">
                        <HardDrive className="w-3 h-3 text-[#00F0FF]" />
                        /dev/snd
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`w-2 h-2 rounded-full ${
                          diagResult.dev_snd_readable ? 'bg-[#00FF44] shadow-[0_0_4px_#00FF44]' : 'bg-amber-500'
                        }`}
                      />
                      <span className="text-xs font-bold text-[#E0E0E0]">
                        {diagResult.dev_snd_readable ? `${diagResult.dev_snd_nodes_count} nœuds PCM` : 'Inaccessible'}
                      </span>
                    </div>
                  </div>

                  <div className="p-2.5 bg-[#0D0E11] border border-[#1E2025] rounded space-y-1">
                    <div className="flex items-center justify-between text-[10px] text-[#606060]">
                      <span className="uppercase tracking-wider flex items-center gap-1">
                        <Layers className="w-3 h-3 text-[#00F0FF]" />
                        Serveur Audio
                      </span>
                    </div>
                    <div className="text-xs font-bold text-[#00F0FF] truncate">
                      {diagResult.audio_server || 'PipeWire'}
                    </div>
                  </div>
                </div>
              )}

              {/* Granular Permission Checks List */}
              <div className="space-y-2.5">
                <div className="text-[10px] font-bold text-[#606060] uppercase tracking-wider">
                  Résultats des Contrôles Matériels & Systèmes
                </div>

                {diagResult?.checks.map((check: UsbDiagnosticCheck) => (
                  <div
                    key={check.id}
                    className={`p-3 rounded border transition-colors ${
                      check.status === 'pass'
                        ? 'bg-[#151619] border-[#22242A]'
                        : check.status === 'warn'
                        ? 'bg-amber-950/15 border-amber-800/40'
                        : 'bg-red-950/20 border-red-800/50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2">
                        {check.status === 'pass' ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
                        ) : check.status === 'warn' ? (
                          <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
                        ) : (
                          <XCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                        )}
                        <div>
                          <div className="font-bold text-xs text-[#E0E0E0]">
                            {check.name}
                          </div>
                          <div className="text-[11px] text-[#A0A0A0] mt-0.5">
                            {check.message}
                          </div>
                          {check.details && (
                            <div className="text-[10px] text-[#70727A] mt-1 font-mono">
                              {check.details}
                            </div>
                          )}
                        </div>
                      </div>

                      <span
                        className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider shrink-0 ${
                          check.status === 'pass'
                            ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                            : check.status === 'warn'
                            ? 'bg-amber-950 text-amber-300 border border-amber-800'
                            : 'bg-red-950 text-red-300 border border-red-800'
                        }`}
                      >
                        {check.status.toUpperCase()}
                      </span>
                    </div>

                    {/* Inline Fix Command if check is warning or failure */}
                    {check.fix_command && (
                      <div className="mt-2.5 pt-2 border-t border-[#1E2026] flex items-center justify-between gap-2 bg-[#0A0B0D] p-2 rounded">
                        <div className="flex items-center gap-2 overflow-hidden text-emerald-400 font-mono text-[10.5px]">
                          <Terminal className="w-3.5 h-3.5 shrink-0 text-[#606060]" />
                          <code className="truncate">{check.fix_command}</code>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleCopy(check.fix_command!)}
                          className="flex items-center gap-1 px-2 py-1 bg-[#1A1B1F] hover:bg-[#2A2B2F] text-[#00F0FF] rounded text-[10px] shrink-0 border border-[#2A2B2F] transition-colors cursor-pointer"
                        >
                          {copiedCmd === check.fix_command ? (
                            <>
                              <Check className="w-3 h-3 text-emerald-400" />
                              <span className="text-emerald-400">{t.troubleshootCopied}</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3" />
                              <span>{t.troubleshootCopyCmd}</span>
                            </>
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Hardware Inventory Probed */}
              {diagResult && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
                  <div className="p-3 bg-[#0D0E11] border border-[#1E2025] rounded space-y-2">
                    <div className="text-[10px] font-bold text-[#606060] uppercase tracking-wider flex items-center gap-1.5">
                      <HardDrive className="w-3 h-3 text-[#00F0FF]" />
                      Cartes Son ALSA (/proc/asound/cards)
                    </div>
                    {diagResult.sound_cards.length === 0 ? (
                      <div className="text-[10px] text-[#606060] italic">
                        Aucune carte son enregistrée dans ALSA
                      </div>
                    ) : (
                      <div className="space-y-1 font-mono text-[10.5px] text-[#E0E0E0]">
                        {diagResult.sound_cards.map((c, idx) => (
                          <div key={idx} className="p-1.5 bg-[#151619] rounded border border-[#22242A]">
                            {c.name}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="p-3 bg-[#0D0E11] border border-[#1E2025] rounded space-y-2">
                    <div className="text-[10px] font-bold text-[#606060] uppercase tracking-wider flex items-center gap-1.5">
                      <Cpu className="w-3 h-3 text-[#00F0FF]" />
                      Périphériques USB Détectés (lsusb)
                    </div>
                    {diagResult.usb_devices.length === 0 ? (
                      <div className="text-[10px] text-[#606060] italic">
                        Aucun périphérique USB spécifique détecté
                      </div>
                    ) : (
                      <div className="space-y-1 font-mono text-[10.5px] text-[#E0E0E0]">
                        {diagResult.usb_devices.map((u, idx) => (
                          <div key={idx} className="p-1.5 bg-[#151619] rounded border border-[#22242A] truncate">
                            {u.id ? `${u.id}: ` : ''}{u.name}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* Tab 2: Step-by-Step Instructions Guide */
            <div className="space-y-4">
              <div className="text-xs text-[#A0A0A0] leading-relaxed">
                Sur <strong>Kali Linux</strong> et les distributions Linux dérivées de Debian, l'accès direct aux flux PCM audio et aux descripteurs USB bruts est restreint aux membres des groupes de sécurité système. Suivez ces étapes pour débloquer votre carte son USB.
              </div>

              {/* Step 1: User groups */}
              <div className="p-3.5 bg-[#151619] border border-[#22242A] rounded space-y-2.5">
                <div className="flex items-center gap-2 text-xs font-bold text-[#E0E0E0]">
                  <span className="w-5 h-5 rounded-full bg-[#00F0FF]/15 text-[#00F0FF] border border-[#00F0FF]/40 flex items-center justify-center text-[10px]">
                    1
                  </span>
                  <span>{t.troubleshootStep1Title}</span>
                </div>
                <p className="text-[11px] text-[#A0A0A0] pl-7">
                  {t.troubleshootStep1Desc}
                </p>
                <div className="ml-7 p-2 bg-[#0A0B0D] border border-[#1A1B1F] rounded flex items-center justify-between gap-2">
                  <code className="text-emerald-400 text-[10.5px] font-mono">
                    sudo usermod -aG audio,plugdev $USER && newgrp audio
                  </code>
                  <button
                    type="button"
                    onClick={() => handleCopy('sudo usermod -aG audio,plugdev $USER && newgrp audio')}
                    className="flex items-center gap-1 px-2 py-1 bg-[#1A1B1F] hover:bg-[#2A2B2F] text-[#00F0FF] rounded text-[10px] shrink-0 border border-[#2A2B2F]"
                  >
                    {copiedCmd === 'sudo usermod -aG audio,plugdev $USER && newgrp audio' ? (
                      <Check className="w-3 h-3 text-emerald-400" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                    <span>{t.troubleshootCopyCmd}</span>
                  </button>
                </div>
              </div>

              {/* Step 2: Device node permissions */}
              <div className="p-3.5 bg-[#151619] border border-[#22242A] rounded space-y-2.5">
                <div className="flex items-center gap-2 text-xs font-bold text-[#E0E0E0]">
                  <span className="w-5 h-5 rounded-full bg-[#00F0FF]/15 text-[#00F0FF] border border-[#00F0FF]/40 flex items-center justify-center text-[10px]">
                    2
                  </span>
                  <span>{t.troubleshootStep2Title}</span>
                </div>
                <p className="text-[11px] text-[#A0A0A0] pl-7">
                  {t.troubleshootStep2Desc}
                </p>
                <div className="ml-7 space-y-1.5">
                  <div className="p-2 bg-[#0A0B0D] border border-[#1A1B1F] rounded flex items-center justify-between gap-2">
                    <code className="text-emerald-400 text-[10.5px] font-mono">
                      ls -la /dev/snd/ && ls -ld /dev/bus/usb/*/*
                    </code>
                    <button
                      type="button"
                      onClick={() => handleCopy('ls -la /dev/snd/ && ls -ld /dev/bus/usb/*/*')}
                      className="flex items-center gap-1 px-2 py-1 bg-[#1A1B1F] hover:bg-[#2A2B2F] text-[#00F0FF] rounded text-[10px] shrink-0 border border-[#2A2B2F]"
                    >
                      <Copy className="w-3 h-3" />
                      <span>{t.troubleshootCopyCmd}</span>
                    </button>
                  </div>
                  <div className="p-2 bg-[#0A0B0D] border border-[#1A1B1F] rounded flex items-center justify-between gap-2">
                    <code className="text-[#00F0FF] text-[10.5px] font-mono">
                      sudo chmod -R a+rw /dev/snd/
                    </code>
                    <button
                      type="button"
                      onClick={() => handleCopy('sudo chmod -R a+rw /dev/snd/')}
                      className="flex items-center gap-1 px-2 py-1 bg-[#1A1B1F] hover:bg-[#2A2B2F] text-[#00F0FF] rounded text-[10px] shrink-0 border border-[#2A2B2F]"
                    >
                      <Copy className="w-3 h-3" />
                      <span>{t.troubleshootCopyCmd}</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Step 3: Udev reload */}
              <div className="p-3.5 bg-[#151619] border border-[#22242A] rounded space-y-2.5">
                <div className="flex items-center gap-2 text-xs font-bold text-[#E0E0E0]">
                  <span className="w-5 h-5 rounded-full bg-[#00F0FF]/15 text-[#00F0FF] border border-[#00F0FF]/40 flex items-center justify-center text-[10px]">
                    3
                  </span>
                  <span>{t.troubleshootStep3Title}</span>
                </div>
                <p className="text-[11px] text-[#A0A0A0] pl-7">
                  {t.troubleshootStep3Desc}
                </p>
                <div className="ml-7 p-2 bg-[#0A0B0D] border border-[#1A1B1F] rounded flex items-center justify-between gap-2">
                  <code className="text-emerald-400 text-[10.5px] font-mono">
                    sudo udevadm control --reload-rules && sudo udevadm trigger
                  </code>
                  <button
                    type="button"
                    onClick={() => handleCopy('sudo udevadm control --reload-rules && sudo udevadm trigger')}
                    className="flex items-center gap-1 px-2 py-1 bg-[#1A1B1F] hover:bg-[#2A2B2F] text-[#00F0FF] rounded text-[10px] shrink-0 border border-[#2A2B2F]"
                  >
                    <Copy className="w-3 h-3" />
                    <span>{t.troubleshootCopyCmd}</span>
                  </button>
                </div>
              </div>

              {/* Step 4: Sound daemon restart */}
              <div className="p-3.5 bg-[#151619] border border-[#22242A] rounded space-y-2.5">
                <div className="flex items-center gap-2 text-xs font-bold text-[#E0E0E0]">
                  <span className="w-5 h-5 rounded-full bg-[#00F0FF]/15 text-[#00F0FF] border border-[#00F0FF]/40 flex items-center justify-center text-[10px]">
                    4
                  </span>
                  <span>{t.troubleshootStep4Title}</span>
                </div>
                <p className="text-[11px] text-[#A0A0A0] pl-7">
                  {t.troubleshootStep4Desc}
                </p>
                <div className="ml-7 p-2 bg-[#0A0B0D] border border-[#1A1B1F] rounded flex items-center justify-between gap-2">
                  <code className="text-emerald-400 text-[10.5px] font-mono">
                    {'systemctl --user restart pipewire pipewire-pulse 2>/dev/null || (pulseaudio -k && pulseaudio --start)'}
                  </code>
                  <button
                    type="button"
                    onClick={() => handleCopy('systemctl --user restart pipewire pipewire-pulse 2>/dev/null || (pulseaudio -k && pulseaudio --start)')}
                    className="flex items-center gap-1 px-2 py-1 bg-[#1A1B1F] hover:bg-[#2A2B2F] text-[#00F0FF] rounded text-[10px] shrink-0 border border-[#2A2B2F]"
                  >
                    <Copy className="w-3 h-3" />
                    <span>{t.troubleshootCopyCmd}</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-[#1A1B1F] bg-[#151619] text-[10px] text-[#606060]">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-[#00F0FF]" />
            <span>Kali Linux Audio Security Framework</span>
          </div>

          <button
            id="btn-close-troubleshoot-footer"
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-[#1F2228] hover:bg-[#2A2B2F] text-[#E0E0E0] rounded text-xs border border-[#2A2B2F] transition-colors cursor-pointer"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
};
