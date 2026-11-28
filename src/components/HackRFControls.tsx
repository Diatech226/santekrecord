import { useEffect, useRef, useState } from 'react';
import { api, liveAudioUrl } from '../services/api';
import { AppSettings, HackRFScanAction, MonitorUpdate } from '../types';

interface Props {
  settings: AppSettings;
  telemetry: MonitorUpdate | null;
  onTuned: (settings: AppSettings, update: MonitorUpdate) => void;
  onUpdate: (update: MonitorUpdate) => void;
}

export function HackRFControls({ settings, telemetry, onTuned, onUpdate }: Props) {
  const [devices, setDevices] = useState<{ serial: string; label: string }[]>([]);
  const [serial, setSerial] = useState(settings.hackrf_serial ?? '');
  const [mhz, setMhz] = useState(String((settings.frequency_hz ?? 145000000) / 1e6));
  const [startMhz, setStartMhz] = useState(mhz);
  const [endMhz, setEndMhz] = useState(String(Math.min(6000, Number(mhz) + 0.1)));
  const [stepKhz, setStepKhz] = useState('12.5');
  const [hangMs, setHangMs] = useState('900');
  const [signalDbfs, setSignalDbfs] = useState('-48');
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState('');
  const playback = useRef<{ context: AudioContext; socket: WebSocket } | null>(null);
  const applied = telemetry?.applied_frequency_hz;
  const recording = Boolean(telemetry?.recording && applied);
  const receiving = Boolean(applied);
  const scan = telemetry?.hackrf_scan;
  const autoRecord = telemetry?.hackrf_auto_record ?? true;
  const scanStart = scan?.start_hz;
  const scanEnd = scan?.end_hz;
  const scanStep = scan?.step_hz;
  const scanHang = scan?.hang_ms;
  const scanThreshold = scan?.signal_dbfs;
  let receiveStatus = '';
  if (telemetry?.manual_recording) receiveStatus = 'Enregistrement manuel';
  else if (scan?.paused) receiveStatus = 'En pause';
  else if (telemetry?.voice_detected && (!scan || scan.signal)) receiveStatus = 'Voix détectée';
  else if (scan?.signal) receiveStatus = 'Signal détecté';
  else if (scan) receiveStatus = 'Scan en cours';

  async function refresh() {
    try {
      const found = await api.getHackRFDevices();
      setDevices(found);
      setSerial(previous => found.some(device => device.serial === previous)
        ? previous : (found[0]?.serial ?? ''));
      setError(found.length ? '' : 'Aucun HackRF One USB détecté. Activez le mode HackRF du PortaPack.');
    } catch (cause) {
      setError(String(cause));
    }
  }

  function stopListening() {
    const current = playback.current;
    playback.current = null;
    current?.socket.close();
    if (current) void current.context.close();
  }

  useEffect(() => {
    void refresh();
    return stopListening;
  }, []);

  useEffect(() => {
    if (!receiving) {
      stopListening();
      setListening(false);
    }
  }, [receiving]);

  useEffect(() => {
    if (scanStart !== undefined && scanEnd !== undefined && scanStep !== undefined &&
        scanHang !== undefined && scanThreshold !== undefined) {
      setStartMhz(String(scanStart / 1e6));
      setEndMhz(String(scanEnd / 1e6));
      setStepKhz(String(scanStep / 1e3));
      setHangMs(String(scanHang));
      setSignalDbfs(String(scanThreshold));
    }
  }, [scanStart, scanEnd, scanStep, scanHang, scanThreshold]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  function controlScan(action: HackRFScanAction) {
    void run(async () => onUpdate(await api.controlHackRFScan(action)));
  }

  function toggleListening() {
    if (playback.current) {
      stopListening();
      setListening(false);
      return;
    }
    let context: AudioContext | undefined;
    try {
      context = new AudioContext();
      const audioContext = context;
      void audioContext.resume().catch(cause => setError(String(cause)));
      const socket = new WebSocket(liveAudioUrl);
      socket.binaryType = 'arraybuffer';
      playback.current = { context: audioContext, socket };
      let nextTime = 0;
      socket.onmessage = ({ data }) => {
        if (playback.current?.socket !== socket || !data.byteLength) return;
        const now = audioContext.currentTime;
        if (nextTime > now + 0.25) return;
        const pcm = new Float32Array(data);
        const buffer = audioContext.createBuffer(1, pcm.length, 16000);
        buffer.copyToChannel(pcm, 0);
        const source = audioContext.createBufferSource();
        source.buffer = buffer;
        source.connect(audioContext.destination);
        nextTime = nextTime < now ? now + 0.06 : nextTime;
        source.start(nextTime);
        nextTime += buffer.duration;
      };
      socket.onclose = () => {
        if (playback.current?.socket !== socket) return;
        stopListening();
        setListening(false);
        setError('Le flux d’écoute a été interrompu.');
      };
      setListening(true);
    } catch (cause) {
      if (context) void context.close();
      setError(String(cause));
    }
  }

  return (
    <div className="mt-4 space-y-3 text-xs font-mono text-[#E0E0E0]">
      <label className="block">
        HackRF USB
        <select className="ml-2 bg-[#151619] border rounded p-1" value={serial}
          disabled={busy || recording || Boolean(scan)} onChange={event => setSerial(event.target.value)}>
          {!devices.length && <option value="">Aucun appareil</option>}
          {devices.map(device => <option key={device.serial} value={device.serial}>{device.label}</option>)}
        </select>
      </label>
      <button type="button" disabled={busy || recording || Boolean(scan)} onClick={() => void refresh()}>Rafraîchir les HackRF</button>
      <form className="flex flex-wrap gap-2" onSubmit={event => {
        event.preventDefault();
        void run(async () => {
          const frequency_hz = Math.round(Number(mhz) * 1e6);
          if (!serial || !Number.isFinite(frequency_hz) || frequency_hz < 1e6 || frequency_hz > 6e9) {
            throw new Error('Sélectionnez un HackRF et saisissez une fréquence entre 1 et 6 000 MHz.');
          }
          const updated: AppSettings = {
            ...settings, source: 'hackrf', hackrf_serial: serial, frequency_hz, sample_rate: 16000, modulation: 'NFM',
            device_id: null, device_name: devices.find(device => device.serial === serial)?.label,
          };
          const update = await api.startMonitoring(updated);
          onTuned(updated, update);
        });
      }}>
        <label>
          Fréquence (MHz)
          <input className="ml-2 w-28 bg-[#151619] border rounded p-1" type="number" required
            min="1" max="6000" step="0.000001" disabled={busy || recording || Boolean(scan)} value={mhz}
            onChange={event => setMhz(event.target.value)} />
        </label>
        <button className="border rounded px-2" disabled={busy || recording || Boolean(scan)} type="submit">Appliquer · NFM</button>
      </form>
      <form className="space-y-2 border-y border-[#2A2B2F] py-3" onSubmit={event => {
        event.preventDefault();
        void run(async () => {
          const start_hz = Math.round(Number(startMhz) * 1e6);
          const end_hz = Math.round(Number(endMhz) * 1e6);
          const step_hz = Math.round(Number(stepKhz) * 1e3);
          if (!serial || end_hz - start_hz < step_hz) {
            throw new Error('Sélectionnez un HackRF et une plage contenant au moins deux canaux.');
          }
          const update = await api.startHackRFScan({
            start_hz, end_hz, step_hz, hang_ms: Number(hangMs), signal_dbfs: Number(signalDbfs),
          }, serial);
          onTuned(await api.getSettings(), update);
        });
      }}>
        <fieldset className="grid grid-cols-2 gap-2" disabled={busy || Boolean(scan)}>
          <legend className="mb-2 font-semibold">Balayage NFM</legend>
          {([
            ['Début (MHz)', startMhz, setStartMhz, 1, 6000, 0.000001],
            ['Fin (MHz)', endMhz, setEndMhz, 1, 6000, 0.000001],
            ['Pas (kHz)', stepKhz, setStepKhz, 1, 5999000, 0.001],
            ['Temporisation (ms)', hangMs, setHangMs, 100, 10000, 1],
            ['Seuil RF (dBFS)', signalDbfs, setSignalDbfs, -100, 0, 0.1],
          ] as const).map(([label, value, setValue, min, max, step]) => (
            <label key={label} className="min-w-0">
              {label}
              <input className="mt-1 w-full bg-[#151619] border rounded p-1"
                type="number" required min={min} max={max} step={step} value={value}
                onChange={event => setValue(event.target.value)} />
            </label>
          ))}
        </fieldset>
        <div className="flex flex-wrap gap-3">
          <button type="submit" disabled={busy || recording || Boolean(scan)}>Démarrer</button>
          <button type="button" disabled={!scan || busy || Boolean(telemetry?.manual_recording && scan.paused)}
            onClick={() => controlScan(scan?.paused ? 'resume' : 'pause')}>
            {scan?.paused ? 'Reprendre' : 'Pause'}
          </button>
          <button type="button" disabled={!scan || busy || telemetry?.manual_recording}
            onClick={() => controlScan('next')}>Canal suivant</button>
          <button type="button" disabled={!scan || busy} onClick={() => controlScan('stop')}>Arrêter le scan</button>
        </div>
      </form>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={autoRecord} disabled={busy}
          onChange={event => {
            const enabled = event.target.checked;
            void run(async () => onUpdate(await api.setHackRFAutoRecording(enabled)));
          }} />
        Autoenregistrement vocal
      </label>
      <p role="status">{receiveStatus && `${receiveStatus} · `}{applied ? `Réception · ${applied / 1e6} MHz · NFM` : 'Aucune fréquence appliquée'}</p>
      <div className="flex flex-wrap gap-3">
        <button type="button" disabled={!applied} aria-pressed={listening} onClick={toggleListening}>
          {listening ? 'Muet' : 'Écouter en direct'}
        </button>
        <button type="button" disabled={!applied || busy || telemetry?.manual_recording}
          onClick={() => void run(async () => onUpdate(await api.setManualRecording(true)))}>Enregistrer</button>
        <button type="button" disabled={!recording || busy}
          onClick={() => void run(async () => onUpdate(await api.setManualRecording(false)))}>Arrêter l’enregistrement</button>
      </div>
      {error && <p role="alert" className="text-red-400">{error}</p>}
    </div>
  );
}
