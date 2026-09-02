import React, { useMemo, useState } from 'react';
import { Download, Scissors, X } from 'lucide-react';
import { RecordingMeta, TransmissionAnnotation } from '../types';
import { AudioPlayer } from './AudioPlayer';

interface Props { recording: RecordingMeta; onClose: () => void }

export const ReviewAnnotationModal: React.FC<Props> = ({ recording, onClose }) => {
  const [transmissions, setTransmissions] = useState<TransmissionAnnotation[]>(() =>
    (recording.transmissions || []).map((tx, index) => ({ ...tx, id: tx.id ?? index + 1, speaker: tx.speaker || 'Unknown' })));
  const duration = Math.max(recording.duration_seconds, .001);
  const update = (index: number, patch: Partial<TransmissionAnnotation>) =>
    setTransmissions(items => items.map((item, i) => i === index ? { ...item, ...patch } : item));
  const split = (index: number) => setTransmissions(items => {
    const tx = items[index], middle = (tx.start_sec + tx.end_sec) / 2;
    return [...items.slice(0, index), { ...tx, end_sec: middle }, { ...tx, id: `${tx.id}b`, start_sec: middle }, ...items.slice(index + 1)];
  });
  const merge = (index: number) => index && setTransmissions(items => [
    ...items.slice(0, index - 1), { ...items[index - 1], end_sec: items[index].end_sec,
      speech_segments: [...(items[index - 1].speech_segments || []), ...(items[index].speech_segments || [])] }, ...items.slice(index + 1)]);
  const groundTruth = useMemo(() => ({ schema_version: 1, file: recording.filename_wav,
    sample_rate: recording.sample_rate, communications: [{ id: `GT-${recording.recording_id}`,
      start_sec: Math.min(...transmissions.map(x => x.start_sec), 0),
      end_sec: Math.max(...transmissions.map(x => x.end_sec), duration), transmissions: transmissions.map(tx => ({
        ...tx, start_sample: Math.round(tx.start_sec * recording.sample_rate), end_sample: Math.round(tx.end_sec * recording.sample_rate),
        speech_segments: (tx.speech_segments || []).map(s => ({ ...s, start_sample: Math.round(s.start_sec * recording.sample_rate), end_sample: Math.round(s.end_sec * recording.sample_rate) })) })) }], events: [] }),
    [recording, transmissions, duration]);
  const save = () => { const blob = new Blob([JSON.stringify(groundTruth, null, 2)], { type: 'application/json' });
    const anchor = document.createElement('a'); anchor.href = URL.createObjectURL(blob); anchor.download = `${recording.recording_id}.groundtruth.json`; anchor.click(); URL.revokeObjectURL(anchor.href); };
  return <div className="fixed inset-0 z-50 bg-black/85 p-5 overflow-auto font-mono">
    <div className="max-w-5xl mx-auto bg-[#111215] border border-[#2A2B2F] rounded-lg p-5 space-y-5">
      <header className="flex justify-between"><div><h2 className="text-[#00F0FF] font-bold">REVIEW / VALIDATE</h2><p className="text-xs text-[#808080]">Manual ground truth — original recorder metadata is never changed.</p></div><button onClick={onClose}><X /></button></header>
      <AudioPlayer recording={recording} />
      <div className="relative h-16 rounded bg-[#090A0C] border border-[#2A2B2F] overflow-hidden" aria-label="Annotated transmission timeline">
        {transmissions.map((tx, i) => <div key={`${tx.id}-${i}`} className="absolute top-2 h-12 bg-cyan-500/20 border border-cyan-400 text-[10px] px-1" style={{ left: `${tx.start_sec/duration*100}%`, width: `${Math.max(.4,(tx.end_sec-tx.start_sec)/duration*100)}%` }}>
          TX{tx.id} · {tx.speaker}{(tx.speech_segments || []).map((s, j) => <span key={j} className="absolute bottom-1 h-2 bg-emerald-400" style={{ left: `${(s.start_sec-tx.start_sec)/(tx.end_sec-tx.start_sec)*100}%`, width: `${(s.end_sec-s.start_sec)/(tx.end_sec-tx.start_sec)*100}%` }} />)}</div>)}
      </div>
      <div className="space-y-2">{transmissions.map((tx, i) => <div key={`${tx.id}-${i}`} className="grid grid-cols-7 gap-2 items-center text-xs">
        <b>TX {tx.id}</b><input aria-label="Adjust start" type="number" step=".01" value={tx.start_sec} onChange={e => update(i,{start_sec:+e.target.value})} className="bg-black p-2" />
        <input aria-label="Adjust end" type="number" step=".01" value={tx.end_sec} onChange={e => update(i,{end_sec:+e.target.value})} className="bg-black p-2" />
        <input aria-label="Speaker label" list="speaker-labels" value={tx.speaker || 'Unknown'} onChange={e => update(i,{speaker:e.target.value})} className="bg-black p-2" />
        <button onClick={() => split(i)} className="text-cyan-300"><Scissors className="inline w-3"/> Split</button><button disabled={!i} onClick={() => merge(i)}>Merge previous</button>
        <label><input type="checkbox" checked={!!tx.false_detection} onChange={e => update(i,{false_detection:e.target.checked})}/> False detection</label>
      </div>)}</div>
      <datalist id="speaker-labels"><option value="Unknown"/><option value="A"/><option value="B"/><option value="C"/><option value="D"/></datalist>
      <div className="flex justify-end"><button onClick={save} className="px-4 py-2 bg-cyan-500/20 border border-cyan-400 text-cyan-300"><Download className="inline w-4"/> Save ground truth</button></div>
    </div></div>;
};
