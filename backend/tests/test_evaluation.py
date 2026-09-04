import json
import wave

import numpy as np
import pytest

from backend.app.config.settings import AppConfig
from backend.app.evaluation.annotations import GroundTruth
from backend.app.evaluation.evaluator import evaluate, match_intervals
from backend.app.evaluation.offline_replayer import OfflineAudioReplayer
from backend.app.evaluation.tuner import ParameterTuner


def truth(**updates):
    data = {"file": "radio.wav", "sample_rate": 16000, "communications": [{"id": "GT-1",
        "start_sec": 1, "end_sec": 5, "transmissions": [{"id": 1, "start_sec": 1.2,
        "end_sec": 2.8, "speaker": "A", "speech_segments": [{"start_sec": 1.3, "end_sec": 2.5}]}]}],
        "events": [{"start_sec": 6, "end_sec": 7, "type": "radio_hiss"}]}
    data.update(updates)
    return GroundTruth.model_validate(data)


def detection(communications=None, frames=None):
    return {"sample_rate": 16000, "communications": communications if communications is not None else [{"id": "D1", "start_sec": 1.1,
        "end_sec": 5.1, "transmissions": [{"id": 1, "start_sec": 1.3, "end_sec": 2.9,
        "speech_segments": [{"start_sec": 1.4, "end_sec": 2.6}]}]}], "frame_decisions": frames or []}


def test_ground_truth_round_trip_populates_samples(tmp_path):
    item = truth(); path = tmp_path / "truth.json"; item.save(path); loaded = GroundTruth.load(path)
    assert loaded.communications[0].transmissions[0].start_sample == 19200
    assert loaded.communications[0].transmissions[0].speaker == "A"
    assert json.loads(path.read_text())["schema_version"] == 1


def test_invalid_annotation_boundary():
    with pytest.raises(ValueError):
        GroundTruth.model_validate({"file": "x.wav", "sample_rate": 1, "events": [{"start_sec": 2, "end_sec": 1, "type": "ambient"}]})


def test_matching_speech_and_boundary_metrics():
    result = evaluate(truth(), detection()).metrics
    assert result["communication_precision"] == result["transmission_recall"] == 1
    assert result["start_boundary_error_ms"] == pytest.approx(100)
    assert 0 < result["speech_f1"] < 1
    assert result["false_speech_seconds"] == pytest.approx(.1)


def test_false_split_and_merge():
    split = detection([{"start_sec": 1, "end_sec": 2, "transmissions": []}, {"start_sec": 2, "end_sec": 5, "transmissions": []}])
    assert evaluate(truth(), split).metrics["communication_split_count"] == 1
    two_truth = truth(communications=[{"id": "a", "start_sec": 1, "end_sec": 2, "transmissions": []},
                                      {"id": "b", "start_sec": 3, "end_sec": 4, "transmissions": []}])
    assert evaluate(two_truth, detection([{"start_sec": 1, "end_sec": 4, "transmissions": []}])).metrics["communication_merge_count"] == 1


def test_false_noise_trigger():
    frames = [{"start_sample": 6*16000, "end_sample": 7*16000, "speech": True}]
    result = evaluate(truth(), detection([], frames)).metrics
    assert result["false_triggers_by_type"]["radio_hiss"] == 1
    assert result["false_trigger_rate"] == 1


def test_interval_matching_is_one_to_one():
    assert len(match_intervals([{"start_sec": 0, "end_sec": 2}], [{"start_sec": 0, "end_sec": 1}, {"start_sec": 1, "end_sec": 2}])) == 1


def test_parameter_sweep_exports_recommendation_without_live_mutation(tmp_path):
    base = AppConfig(); original = base.model_dump()
    tuner = ParameterTuner(base, lambda config: {"transmission_precision": config.vad_start_threshold,
        "transmission_recall": 1, "communication_precision": 1, "communication_recall": 1,
        "speech_f1": 1, "mean_boundary_error_ms": 0, "false_trigger_rate": 0})
    path = tmp_path / "recommended_config.json"; result = tuner.run(4, path)
    assert result["trials"] == 4 and path.exists()
    assert base.model_dump() == original
    assert "data/config.json was not modified" in path.read_text()


def test_offline_wav_replay_uses_sample_clock(tmp_path, monkeypatch):
    rate = 16000; audio = np.concatenate([np.zeros(rate), .5*np.sin(2*np.pi*440*np.arange(rate*2)/rate), np.zeros(rate*2)])
    path = tmp_path / "radio.wav"
    with wave.open(str(path), "wb") as wav:
        wav.setparams((1, 2, rate, 0, "NONE", "not compressed")); wav.writeframes((audio*32767).astype("<i2").tobytes())
    monkeypatch.setattr("backend.app.evaluation.offline_replayer.SileroVADDetector.get_speech_probability",
                        lambda self, chunk: .99 if np.sqrt(np.mean(chunk**2)) > .1 else 0.)
    config = AppConfig(ambient_learning_seconds=1, minimum_speech_ms=128, minimum_total_speech_ms=50,
                       communication_end_timeout_seconds=.5, transmission_end_timeout_seconds=.2,
                       ambient_confirm_ms=20, auto_trim_silence=False)
    result = OfflineAudioReplayer(config).replay(path)
    assert result.duration_seconds == 5
    assert result.communications and result.communications[0]["transmissions"]
    assert len(result.frame_decisions) == pytest.approx(5*rate/1024, abs=1)
