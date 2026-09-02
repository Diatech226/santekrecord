"""Interval matching and objective validation metrics."""
from __future__ import annotations

from dataclasses import dataclass, field
from statistics import mean
from typing import Iterable

import numpy as np

from .annotations import GroundTruth


def _pair(value) -> tuple[float, float]:
    if isinstance(value, dict):
        return float(value["start_sec"]), float(value["end_sec"])
    return float(value.start_sec), float(value.end_sec)


def overlap(a, b) -> float:
    x, y = _pair(a), _pair(b)
    return max(0.0, min(x[1], y[1]) - max(x[0], y[0]))


def _duration(items: Iterable) -> float:
    points = sorted((_pair(x) for x in items), key=lambda x: x[0])
    total, end = 0.0, -1.0
    for start, stop in points:
        total += max(0.0, stop - max(start, end))
        end = max(end, stop)
    return total


def _intersection_duration(left: Iterable, right: Iterable) -> float:
    return sum(overlap(a, b) for a in left for b in right)


def match_intervals(truth: list, detected: list, minimum_iou: float = .1):
    candidates = []
    for i, expected in enumerate(truth):
        for j, actual in enumerate(detected):
            common = overlap(expected, actual)
            union = (_pair(expected)[1] - _pair(expected)[0]) + (_pair(actual)[1] - _pair(actual)[0]) - common
            if union and common / union >= minimum_iou:
                candidates.append((common / union, i, j))
    pairs, used_truth, used_detected = [], set(), set()
    for score, i, j in sorted(candidates, reverse=True):
        if i not in used_truth and j not in used_detected:
            pairs.append((i, j, score)); used_truth.add(i); used_detected.add(j)
    return pairs


@dataclass
class EvaluationResult:
    metrics: dict[str, float | int | dict] = field(default_factory=dict)
    errors: list[dict] = field(default_factory=list)

    def as_dict(self):
        return {"metrics": self.metrics, "errors": self.errors}


def _level_metrics(truth, detected, prefix: str):
    pairs = match_intervals(truth, detected)
    truth_links = [[j for j, d in enumerate(detected) if overlap(t, d)] for t in truth]
    detected_links = [[i for i, t in enumerate(truth) if overlap(t, d)] for d in detected]
    tp = len(pairs)
    return pairs, {
        f"ground_truth_{prefix}s": len(truth),
        f"detected_{prefix}s": len(detected),
        f"{prefix}_precision": tp / len(detected) if detected else (1.0 if not truth else 0.0),
        f"{prefix}_recall": tp / len(truth) if truth else 1.0,
        f"missed_{prefix}s": len(truth) - tp,
        f"false_{prefix}s": len(detected) - tp,
        f"{prefix}_split_count" if prefix == "communication" else "false_split": sum(max(0, len(x) - 1) for x in truth_links),
        f"{prefix}_merge_count" if prefix == "communication" else "false_merge": sum(max(0, len(x) - 1) for x in detected_links),
    }


def evaluate(truth: GroundTruth, detection: dict) -> EvaluationResult:
    detected_com = detection.get("communications", [])
    com_pairs, metrics = _level_metrics(truth.communications, detected_com, "communication")
    truth_tx = [x for c in truth.communications for x in c.transmissions if not x.false_detection]
    detected_tx = [x for c in detected_com for x in c.get("transmissions", [])]
    tx_pairs, tx_metrics = _level_metrics(truth_tx, detected_tx, "transmission")
    metrics.update(tx_metrics)
    start_errors = [abs(_pair(truth_tx[i])[0] - _pair(detected_tx[j])[0]) * 1000 for i, j, _ in tx_pairs]
    end_errors = [abs(_pair(truth_tx[i])[1] - _pair(detected_tx[j])[1]) * 1000 for i, j, _ in tx_pairs]
    all_errors = start_errors + end_errors
    metrics.update({
        "start_boundary_error_ms": mean(start_errors) if start_errors else 0.0,
        "end_boundary_error_ms": mean(end_errors) if end_errors else 0.0,
        "mean_boundary_error_ms": mean(all_errors) if all_errors else 0.0,
        "p95_boundary_error_ms": float(np.percentile(all_errors, 95)) if all_errors else 0.0,
        "leading_trim_error_ms": mean([(_pair(detected_tx[j])[0] - _pair(truth_tx[i])[0]) * 1000 for i, j, _ in tx_pairs]) if tx_pairs else 0.0,
        "trailing_trim_error_ms": mean([(_pair(detected_tx[j])[1] - _pair(truth_tx[i])[1]) * 1000 for i, j, _ in tx_pairs]) if tx_pairs else 0.0,
    })
    truth_speech = [s for t in truth_tx for s in t.speech_segments]
    detected_speech = [s for t in detected_tx for s in t.get("speech_segments", [])]
    common = _intersection_duration(truth_speech, detected_speech)
    truth_seconds, detected_seconds = _duration(truth_speech), _duration(detected_speech)
    precision = common / detected_seconds if detected_seconds else (1.0 if not truth_seconds else 0.0)
    recall = common / truth_seconds if truth_seconds else 1.0
    metrics.update({"speech_precision": precision, "speech_recall": recall,
                    "speech_f1": 2 * precision * recall / (precision + recall) if precision + recall else 0.0,
                    "false_speech_seconds": max(0.0, detected_seconds - common),
                    "missed_speech_seconds": max(0.0, truth_seconds - common)})
    noise_events = [e for e in truth.events if e.type != "speech"]
    decisions = detection.get("frame_decisions", [])
    sr = detection.get("sample_rate", truth.sample_rate)
    detected_voice = [{"start_sec": f["start_sample"] / sr, "end_sec": f["end_sample"] / sr}
                      for f in decisions if f.get("speech")]
    counts = {kind: 0 for kind in ("ambient", "radio_hiss", "beep", "door_noise", "other_noise")}
    for event in noise_events:
        if any(overlap(event, x) for x in [*detected_voice, *detected_tx, *detected_com]):
            counts[event.type] += 1
    metrics["false_triggers_by_type"] = counts
    metrics["false_trigger_rate"] = sum(counts.values()) / len(noise_events) if noise_events else 0.0
    errors = []
    for i, item in enumerate(truth.communications):
        if not any(pair[0] == i for pair in com_pairs): errors.append({"file": truth.file, "type": "MISSED_COMMUNICATION", "time_sec": item.start_sec})
    if metrics["communication_split_count"]: errors.append({"file": truth.file, "type": "FALSE_SPLIT", "time_sec": 0.0})
    if metrics["communication_merge_count"]: errors.append({"file": truth.file, "type": "FALSE_MERGE", "time_sec": 0.0})
    return EvaluationResult(metrics, errors)


def aggregate(results: list[EvaluationResult]) -> EvaluationResult:
    if not results: return EvaluationResult({"files": 0}, [])
    keys = {k for r in results for k, v in r.metrics.items() if isinstance(v, (int, float))}
    totals = {"files": len(results)}
    for key in keys:
        values = [float(r.metrics[key]) for r in results if key in r.metrics]
        totals[key] = mean(values)
    trigger_counts = {}
    for result in results:
        for key, value in result.metrics.get("false_triggers_by_type", {}).items():
            trigger_counts[key] = trigger_counts.get(key, 0) + value
    totals["false_triggers_by_type"] = trigger_counts
    return EvaluationResult(totals, [error for result in results for error in result.errors])
