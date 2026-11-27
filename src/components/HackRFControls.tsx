import { useEffect, useRef, useState } from 'react';
import { api, liveAudioUrl } from '../services/api';
import { AppSettings, MonitorUpdate } from '../types';

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
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState('');
  const playback = useRef<{ context: AudioContext; socket: WebSocket } | null>(null);
  const applied = telemetry?.applied_frequency_hz;
  const recording = Boolean(telemetry?.recording && applied);

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
    stopListening();
    setListening(false);
  }, [applied]);

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
          disabled={busy || recording} onChange={event => setSerial(event.target.value)}>
          {!devices.length && <option value="">Aucun appareil</option>}
          {devices.map(device => <option key={device.serial} value={device.serial}>{device.label}</option>)}
        </select>
      </label>
      <button type="button" disabled={busy || recording} onClick={() => void refresh()}>Rafraîchir les HackRF</button>
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
            min="1" max="6000" step="0.000001" disabled={busy || recording} value={mhz}
            onChange={event => setMhz(event.target.value)} />
        </label>
        <button className="border rounded px-2" disabled={busy || recording} type="submit">Appliquer · NFM</button>
      </form>
      <p role="status">{applied ? `Réception · ${applied / 1e6} MHz · NFM` : 'Aucune fréquence appliquée'}</p>
      <div className="flex flex-wrap gap-3">
        <button type="button" disabled={!applied} aria-pressed={listening} onClick={toggleListening}>
          {listening ? 'Muet' : 'Écouter en direct'}
        </button>
        <button type="button" disabled={!applied || busy || telemetry?.manual_recording}
          onClick={() => void run(async () => onUpdate(await api.setManualRecording(true)))}>Enregistrer</button>
        <button type="button" disabled={!recording || busy}
          onClick={() => void run(async () => onUpdate(await api.setManualRecording(false)))}>Arrêter</button>
      </div>
      {error && <p role="alert" className="text-red-400">{error}</p>}
    </div>
  );
}
