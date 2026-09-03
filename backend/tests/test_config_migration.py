import json

from backend.app.config import settings


def test_product_defaults_are_canonical():
    config = settings.AppConfig()
    assert config.config_version == 2
    assert config.detection_profile == "voice_any_source"
    assert config.ambient_learning_seconds == 3.0
    assert config.preroll_seconds == 1.5
    assert config.noise_margin_db == 8.0
    assert config.vad_start_threshold == 0.65
    assert config.vad_stop_threshold == 0.35
    assert config.minimum_speech_ms == 160
    assert config.minimum_total_speech_ms == 300
    assert config.minimum_snr_db == 6.0
    assert config.input_gain == 1.0
    assert config.auto_gain_control is False


def load_from(tmp_path, monkeypatch, payload):
    path = tmp_path / "config.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    monkeypatch.setattr(settings, "CONFIG_PATH", str(path))
    return settings.load_config(), path


def test_old_config_migrates_to_voice_any_source(tmp_path, monkeypatch):
    config, _ = load_from(tmp_path, monkeypatch, {"detection_profile": "general_voice"})
    assert config.detection_profile == "voice_any_source"


def test_old_default_preroll_migrates_to_1_5(tmp_path, monkeypatch):
    config, _ = load_from(tmp_path, monkeypatch, {"preroll_seconds": 1.0})
    assert config.preroll_seconds == 1.5


def test_old_default_ambient_learning_migrates_to_3(tmp_path, monkeypatch):
    config, _ = load_from(tmp_path, monkeypatch, {"ambient_learning_seconds": 5.0})
    assert config.ambient_learning_seconds == 3.0


def test_custom_user_preroll_is_preserved(tmp_path, monkeypatch):
    config, _ = load_from(tmp_path, monkeypatch, {"preroll_seconds": 2.25})
    assert config.preroll_seconds == 2.25


def test_custom_user_profile_is_preserved_when_not_legacy_default(tmp_path, monkeypatch):
    config, _ = load_from(tmp_path, monkeypatch, {"detection_profile": "radio_room"})
    assert config.detection_profile == "radio_room"


def test_migrated_config_is_saved_with_version(tmp_path, monkeypatch):
    config, path = load_from(tmp_path, monkeypatch, {"preroll_seconds": 1.0})
    persisted = json.loads(path.read_text(encoding="utf-8"))
    assert config.config_version == 2
    assert persisted["config_version"] == 2
    assert persisted["preroll_seconds"] == 1.5
