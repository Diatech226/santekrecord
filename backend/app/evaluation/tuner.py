"""Bounded random parameter search; recommendations never mutate live config."""
from __future__ import annotations

import json
import random
from pathlib import Path
from typing import Callable

from ..config.settings import AppConfig

SEARCH_SPACE = {
    "vad_start_threshold": [.55, .65, .75], "vad_stop_threshold": [.25, .35, .45],
    "minimum_snr_db": [3., 6., 9.], "noise_margin_db": [6., 8., 12.],
    "ambient_return_spectral_threshold": [.08, .12, .18], "ambient_confirm_ms": [200, 300, 500],
    "intra_phrase_pause_seconds": [.8, 1.2, 1.8], "transmission_end_timeout_seconds": [2., 3., 4.],
    "communication_end_timeout_seconds": [6., 10., 15.],
}
DEFAULT_WEIGHTS = {"transmission_f1": .40, "communication_f1": .25, "speech_f1": .20,
                   "boundary_accuracy": .10, "false_trigger_score": .05}


def global_score(metrics: dict, weights: dict | None = None) -> float:
    weights = weights or DEFAULT_WEIGHTS
    def f1(prefix):
        p, r = metrics.get(prefix + "_precision", 0), metrics.get(prefix + "_recall", 0)
        return 2*p*r/(p+r) if p+r else 0
    components = {"transmission_f1": f1("transmission"), "communication_f1": f1("communication"),
        "speech_f1": metrics.get("speech_f1", 0),
        "boundary_accuracy": max(0., 1 - metrics.get("mean_boundary_error_ms", 1000) / 1000),
        "false_trigger_score": max(0., 1 - metrics.get("false_trigger_rate", 1))}
    return sum(weights.get(key, 0) * value for key, value in components.items())


class ParameterTuner:
    def __init__(self, base_config: AppConfig, evaluator: Callable[[AppConfig], dict], seed: int = 226):
        self.base_config, self.evaluator, self.random = base_config.model_copy(deep=True), evaluator, random.Random(seed)

    def run(self, trials: int = 50, output: str | Path = "evaluation_results/recommended_config.json") -> dict:
        if trials < 1: raise ValueError("trials must be positive")
        seen, ranked = set(), []
        limit = min(trials, 1000)
        while len(ranked) < limit:
            params = {key: self.random.choice(values) for key, values in SEARCH_SPACE.items()}
            signature = tuple(params.items())
            if signature in seen and len(seen) < 3 ** len(SEARCH_SPACE): continue
            seen.add(signature)
            config = self.base_config.model_copy(update=params)
            metrics = self.evaluator(config)
            ranked.append({"score": global_score(metrics), "parameters": params, "metrics": metrics})
        ranked.sort(key=lambda x: x["score"], reverse=True)
        recommendation = {"notice": "Recommendation only; config.json was not modified.", "best": ranked[0],
                          "trials": len(ranked), "weights": DEFAULT_WEIGHTS}
        output = Path(output); output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(recommendation, indent=2) + "\n", encoding="utf-8")
        return recommendation
