import json
import re
import os
import subprocess
import sys

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
        "vad_start_threshold": 0.50,
        "vad_stop_threshold": 0.30,
        "minimum_speech_ms": 128,
        "minimum_total_speech_ms": 300,
        "minimum_snr_db": 6.0,
        "input_gain": 1.0,
        "auto_gain_control": False,
        "input_channel": "auto",
    }
    assert all(getattr(config, key) == value for key, value in expected.items())
    repository_config = json.loads(open("config.default.json", encoding="utf-8").read())
    assert all(repository_config[key] == value for key, value in expected.items())


def test_frontend_bootstrap_detection_defaults_match_canonical_config():
    expected = {
        "vad_start_threshold": 0.50,
        "vad_stop_threshold": 0.30,
        "minimum_speech_ms": 128,
        "minimum_snr_db": 6.0,
    }
    for path in ("src/App.tsx", "src/services/api.ts"):
        source = open(path, encoding="utf-8").read()
        for key, value in expected.items():
            match = re.search(rf"{key}:\s*([0-9.]+)", source)
            assert match, f"{key} bootstrap default missing from {path}"
            assert float(match.group(1)) == value


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


def test_legacy_config_is_migrated_to_runtime_config(tmp_path, monkeypatch):
    legacy = tmp_path / "config.json"
    runtime = tmp_path / "data" / "config.json"
    preserved = {
        "device_id": 7, "device_name": "USB Audio CODEC", "device_hostapi": "ALSA",
        "device_alsa_card_id": "CODEC", "device_alsa_device": 1, "input_gain": 2.5,
        "input_channel": "channel_2", "audio_backend": "alsa", "frequency_hz": 123456789,
        "station_id": "KALI", "minimum_speech_ms": 120,
    }
    legacy.write_text(json.dumps(preserved), encoding="utf-8")
    monkeypatch.setattr(settings, "CONFIG_PATH", str(runtime))
    monkeypatch.setattr(settings, "LEGACY_CONFIG_PATH", str(legacy))
    monkeypatch.setattr(settings, "DEFAULT_CONFIG_PATH", str(tmp_path / "config.default.json"))
    loaded = settings.load_config()
    assert runtime.exists()
    assert all(getattr(loaded, key) == value for key, value in preserved.items()
               if key != "minimum_speech_ms")
    assert loaded.minimum_speech_ms == 128
    migrated = json.loads(runtime.read_text(encoding="utf-8"))
    assert all(migrated[key] == value for key, value in preserved.items()
               if key != "minimum_speech_ms")
    assert migrated["minimum_speech_ms"] == 128


def test_existing_runtime_config_is_not_overwritten_by_defaults(tmp_path, monkeypatch):
    runtime = tmp_path / "data" / "config.json"
    runtime.parent.mkdir()
    runtime.write_text(json.dumps({"input_gain": 2.5}), encoding="utf-8")
    default = tmp_path / "config.default.json"
    default.write_text(json.dumps({"input_gain": 1}), encoding="utf-8")
    monkeypatch.setattr(settings, "CONFIG_PATH", str(runtime))
    monkeypatch.setattr(settings, "DEFAULT_CONFIG_PATH", str(default))
    assert settings.load_config().input_gain == 2.5
    assert json.loads(runtime.read_text(encoding="utf-8"))["input_gain"] == 2.5


def test_recorder_config_path_environment_override_is_prioritary(tmp_path):
    override = tmp_path / "custom.json"
    env = {**os.environ, "RECORDER_CONFIG_PATH": str(override), "PYTHONPATH": os.getcwd()}
    result = subprocess.run(
        [sys.executable, "-c", "from backend.app.config.settings import CONFIG_PATH; print(CONFIG_PATH)"],
        check=True, capture_output=True, text=True, env=env,
    )
    assert result.stdout.strip() == str(override)
