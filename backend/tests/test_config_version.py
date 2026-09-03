import json

import pytest

from backend.app.config import settings


def load_from(tmp_path, monkeypatch, payload):
    path = tmp_path / "config.json"
    original = json.dumps(payload)
    path.write_text(original, encoding="utf-8")
    monkeypatch.setattr(settings, "CONFIG_PATH", str(path))
    return path, original


def test_product_defaults_are_canonical():
    config = settings.AppConfig()
    expected = {
        "config_version": 2,
        "detection_profile": "voice_any_source",
        "sample_rate": 16000,
        "preroll_seconds": 1.5,
        "ambient_learning_seconds": 3.0,
        "ambient_learning_vad_max": 0.15,
        "noise_margin_db": 8.0,
        "vad_start_threshold": 0.65,
        "vad_stop_threshold": 0.35,
        "minimum_speech_ms": 160,
        "minimum_total_speech_ms": 300,
        "minimum_snr_db": 6.0,
        "input_gain": 1.0,
        "auto_gain_control": False,
        "input_channel": "auto",
    }
    assert all(getattr(config, key) == value for key, value in expected.items())
    repository_config = json.loads(settings.CONFIG_PATH and open("config.json", encoding="utf-8").read())
    assert all(repository_config[key] == value for key, value in expected.items())


def test_future_config_version_is_rejected_cleanly(tmp_path, monkeypatch):
    path, original = load_from(tmp_path, monkeypatch, {"config_version": 3})
    with pytest.raises(settings.UnsupportedConfigVersionError, match=(
        r"Configuration version 3 is newer than supported version 2\. "
        r"Please update SantekRecord\."
    )):
        settings.load_config()
    assert path.read_text(encoding="utf-8") == original


def test_current_config_version_loads_normally(tmp_path, monkeypatch):
    path, _ = load_from(tmp_path, monkeypatch, {
        "config_version": 2, "preroll_seconds": 2.25,
    })
    config = settings.load_config()
    assert config.config_version == 2
    assert config.preroll_seconds == 2.25
    assert json.loads(path.read_text(encoding="utf-8"))["config_version"] == 2
