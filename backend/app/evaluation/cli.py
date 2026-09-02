"""Command-line interface for evaluation, tuning, and dataset statistics."""
from __future__ import annotations

import argparse
import csv
import json
import wave
from collections import Counter
from pathlib import Path

from ..config.settings import load_config
from .annotations import GroundTruth
from .evaluator import aggregate, evaluate
from .offline_replayer import OfflineAudioReplayer
from .tuner import ParameterTuner


def dataset(audio: Path, annotations: Path):
    for annotation_path in sorted(annotations.glob("*.json")):
        truth = GroundTruth.load(annotation_path)
        wav_path = audio / truth.file
        if wav_path.exists(): yield truth, wav_path


def run_evaluation(audio: Path, annotations: Path, config=None):
    replayer = OfflineAudioReplayer(config or load_config())
    return aggregate([evaluate(truth, replayer.replay(wav).as_dict()) for truth, wav in dataset(audio, annotations)])


def export_report(result, output: Path):
    output.mkdir(parents=True, exist_ok=True)
    (output / "report.json").write_text(json.dumps(result.as_dict(), indent=2) + "\n", encoding="utf-8")
    with (output / "report.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle); writer.writerow(["metric", "value"])
        for key, value in result.metrics.items(): writer.writerow([key, json.dumps(value) if isinstance(value, dict) else value])
    with (output / "errors.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=["file", "type", "time_sec"]); writer.writeheader(); writer.writerows(result.errors)


def display(result):
    m = result.metrics
    print("SANTEK RADIO EVALUATION\n")
    print(f"Files                    {m.get('files', 0)}")
    print(f"Ground truth COM         {m.get('ground_truth_communications', 0):.0f}")
    print(f"Detected COM             {m.get('detected_communications', 0):.0f}")
    for label, key in (("Communication recall", "communication_recall"), ("Communication precision", "communication_precision"),
                       ("Transmission recall", "transmission_recall"), ("Transmission precision", "transmission_precision"),
                       ("Speech F1", "speech_f1")):
        print(f"{label:<25}{m.get(key, 0)*100:6.1f} %")
    print(f"Mean boundary error      {m.get('mean_boundary_error_ms', 0):6.0f} ms")
    for kind, count in m.get("false_triggers_by_type", {}).items(): print(f"False {kind} trigger      {count}")


def stats(audio: Path, annotations: Path):
    truths = [GroundTruth.load(x) for x in annotations.glob("*.json")]
    wavs = list(audio.glob("*.wav")); duration = 0.
    for path in wavs:
        with wave.open(str(path), "rb") as w: duration += w.getnframes()/w.getframerate()
    communications = sum(len(t.communications) for t in truths)
    transmissions = [x for t in truths for c in t.communications for x in c.transmissions]
    speakers = Counter(x.speaker or "Unknown" for x in transmissions)
    events = Counter()
    for truth in truths:
        for event in truth.events: events[event.type] += event.end_sec-event.start_sec
    print(f"{len(wavs)} WAV\n{duration/3600:.2f} h audio\n\n{communications} communications\n{len(transmissions)} transmissions")
    for key, value in speakers.items(): print(f"Speaker {key} labels {value}")
    for key, value in events.items(): print(f"{key.replace('_', ' ').title()} {value/3600:.2f} h")


def main(argv=None):
    parser = argparse.ArgumentParser(prog="santek-evaluation"); sub = parser.add_subparsers(dest="command", required=True)
    for name in ("evaluate", "tune", "stats"):
        item = sub.add_parser(name); item.add_argument("--audio", type=Path, default=Path("evaluation_data/audio")); item.add_argument("--annotations", type=Path, default=Path("evaluation_data/annotations"))
        if name == "tune": item.add_argument("--trials", type=int, default=50)
    args = parser.parse_args(argv)
    if args.command == "stats": stats(args.audio, args.annotations); return
    if args.command == "evaluate":
        result = run_evaluation(args.audio, args.annotations); export_report(result, Path("evaluation_results")); display(result); return
    def trial(config): return run_evaluation(args.audio, args.annotations, config).metrics
    recommendation = ParameterTuner(load_config(), trial).run(args.trials)
    print(f"Best score: {recommendation['best']['score']:.4f}\nRecommended parameters:")
    print(json.dumps(recommendation["best"]["parameters"], indent=2))


if __name__ == "__main__": main()
