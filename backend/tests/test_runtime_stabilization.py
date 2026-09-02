import json
import numpy as np

from backend.app.audio.engine import MainAudioEngine
from backend.app.config.settings import AppConfig
from backend.app.detection.ambient_profile_store import AmbientProfileStore
from backend.app.detection.noise_profile import AdaptiveNoiseProfile
from backend.app.detection.vad import SileroVADDetector


def config(**changes):
    return AppConfig(**{"device_name": "USB AUDIO CODEC", "adaptive_noise": True, **changes})


def learned_profile(sample_rate=16000):
    profile = AdaptiveNoiseProfile(sample_rate)
    quiet = np.zeros(1024, np.float32)
    profile.update(-56.0, profile.spectrum(quiet))
    return profile


def test_update_config_rebuilds_speech_detector(tmp_path):
    engine = MainAudioEngine(config(), ambient_profiles_dir=tmp_path)
    original = engine.speech_detector
    engine.update_config(config(minimum_snr_db=4))
    assert engine.speech_detector is not original


def test_profile_change_is_effective_after_save(tmp_path):
    engine = MainAudioEngine(config(detection_profile="radio_room"), ambient_profiles_dir=tmp_path)
    engine.update_config(config(detection_profile="general_voice"))
    assert engine.get_effective_detection_config()["detection_profile"] == "general_voice"
    assert engine.speech_detector.profile.name == "general_voice"


def test_snr_change_is_effective_after_save(tmp_path):
    engine = MainAudioEngine(config(minimum_snr_db=6), ambient_profiles_dir=tmp_path)
    engine.update_config(config(minimum_snr_db=2))
    assert engine.get_effective_detection_config()["effective_minimum_snr_db"] == 2


def test_vad_threshold_change_is_effective_after_save(tmp_path):
    engine = MainAudioEngine(config(), ambient_profiles_dir=tmp_path)
    engine.update_config(config(vad_start_threshold=.42, vad_stop_threshold=.21,
                                minimum_speech_ms=90))
    effective = engine.get_effective_detection_config()
    assert effective["effective_vad_start_threshold"] == .42
    assert effective["effective_vad_stop_threshold"] == .21


def test_vad_reset_clears_pending():
    vad = SileroVADDetector()
    vad._pending = np.ones(12, np.float32)
    vad.reset()
    assert vad._pending.size == 0


def test_vad_reset_clears_recent_probabilities():
    vad = SileroVADDetector()
    vad._recent.extend([.2, .8])
    vad.reset()
    assert not vad._recent


def test_vad_reset_clears_onnx_state():
    vad = SileroVADDetector()
    vad._onnx_state.fill(1)
    vad.reset()
    assert not np.any(vad._onnx_state)


def test_monitor_restart_resets_vad(monkeypatch, tmp_path):
    engine = MainAudioEngine(config(adaptive_noise=False), ambient_profiles_dir=tmp_path)
    class Source:
        device_name = "USB AUDIO CODEC"
        is_active = True
        def start(self): pass
        def stop(self): self.is_active = False
        def read_chunk(self, chunk_size=1024): return None
    monkeypatch.setattr(engine, "_create_source", Source)
    engine.vad_detector._recent.append(.9)
    assert engine.start()
    engine.stop()
    engine.vad_detector._recent.append(.9)
    assert engine.start()
    assert not engine.vad_detector._recent
    engine.stop()


def test_second_run_loads_cached_profile(tmp_path):
    cfg = config()
    store = AmbientProfileStore(tmp_path)
    store.save(cfg, learned_profile(), cfg.device_name)
    engine = MainAudioEngine(cfg, ambient_profiles_dir=tmp_path)
    cached = store.load(cfg, cfg.device_name)
    assert cached and engine.noise_profile.load_profile(cached["profile"])


def test_cached_ambient_profile_allows_immediate_voice(tmp_path):
    cfg = config()
    store = AmbientProfileStore(tmp_path)
    store.save(cfg, learned_profile(), cfg.device_name)
    engine = MainAudioEngine(cfg, ambient_profiles_dir=tmp_path)
    cached = store.load(cfg, cfg.device_name)
    engine.ambient_profile_loaded = bool(cached and engine.noise_profile.load_profile(cached["profile"]))
    engine.ambient_learning = not engine.ambient_profile_loaded
    assert engine.ambient_profile_loaded and not engine.ambient_learning


def test_first_run_voice_does_not_contaminate_profile(tmp_path):
    engine = MainAudioEngine(config(), ambient_profiles_dir=tmp_path)
    assert not engine.should_learn_ambient(.9)
    assert engine.noise_profile.frames_learned == 0


def test_first_run_profile_saved_after_learning(tmp_path):
    cfg = config()
    engine = MainAudioEngine(cfg, ambient_profiles_dir=tmp_path)
    engine.noise_profile = learned_profile()
    engine.ambient_learning = False
    engine._ambient_profile_dirty = True
    engine._ambient_device_name = cfg.device_name
    engine._save_ambient_profile_if_valid()
    assert AmbientProfileStore(tmp_path).load(cfg, cfg.device_name)


def test_different_device_does_not_reuse_profile(tmp_path):
    store = AmbientProfileStore(tmp_path)
    cfg = config()
    store.save(cfg, learned_profile(), "USB A")
    assert store.load(cfg, "USB B") is None


def test_different_channel_does_not_reuse_profile(tmp_path):
    store = AmbientProfileStore(tmp_path)
    cfg = config(input_channel="channel_1")
    store.save(cfg, learned_profile(), cfg.device_name)
    assert store.load(config(input_channel="channel_2"), cfg.device_name) is None


def test_different_detection_profile_does_not_reuse_profile(tmp_path):
    store = AmbientProfileStore(tmp_path)
    cfg = config(detection_profile="general_voice")
    store.save(cfg, learned_profile(), cfg.device_name)
    assert store.load(config(detection_profile="radio_room"), cfg.device_name) is None


def test_profile_change_does_not_load_other_profiles_cache(tmp_path):
    store = AmbientProfileStore(tmp_path)
    general = config(detection_profile="general_voice")
    store.save(general, learned_profile(), general.device_name)
    engine = MainAudioEngine(general, ambient_profiles_dir=tmp_path)
    engine.update_config(config(detection_profile="radio_room"))
    assert store.load(engine.config, engine.config.device_name) is None


def test_stale_or_wrong_schema_profile_is_ignored(tmp_path):
    cfg = config()
    store = AmbientProfileStore(tmp_path)
    store.save(cfg, learned_profile(), cfg.device_name)
    path = next(tmp_path.glob("*.json"))
    payload = json.loads(path.read_text())
    payload["profile_schema_version"] = 0
    path.write_text(json.dumps(payload))
    assert store.load(cfg, cfg.device_name) is None
