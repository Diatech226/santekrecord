import numpy as np
import wave

from backend.app.detection.vad import SileroVADDetector


class Input:
    def __init__(self, name):
        self.name = name


class StreamingSession:
    """Deterministic stand-in exercising the official context/state contract."""

    def __init__(self):
        self.feeds = []

    def get_inputs(self):
        return [Input("input"), Input("state"), Input("sr")]

    def run(self, _outputs, feed):
        copied = {name: np.asarray(value).copy() for name, value in feed.items()}
        self.feeds.append(copied)
        probability = np.asarray([[np.mean(np.abs(feed["input"])) +
                                   np.mean(feed["state"]) / 100]], np.float32)
        state = np.asarray(feed["state"], np.float32) + 1
        return [probability, state]


def detector_with(session, monkeypatch):
    monkeypatch.setattr(SileroVADDetector, "_init_model", lambda self: None)
    detector = SileroVADDetector()
    detector._onnx_session = session
    detector.vad_backend = "silero_onnx"
    detector.vad_model_loaded = True
    return detector


def official_reference(session, frames):
    state = np.zeros((2, 1, 128), np.float32)
    context = np.zeros((1, 64), np.float32)
    probabilities = []
    for frame in frames:
        model_input = np.concatenate((context, frame.reshape(1, 512)), axis=1)
        probability, state = session.run(None, {
            "input": model_input.astype(np.float32), "state": state,
            "sr": np.asarray(16000, np.int64),
        })
        context = model_input[:, -64:].copy()
        probabilities.append(float(probability.reshape(-1)[0]))
    return probabilities


def test_onnx_adapter_matches_official_silero_context_behavior(monkeypatch):
    rng = np.random.default_rng(226)
    frames = [rng.normal(0, .1, 512).astype(np.float32) for _ in range(4)]
    ours_session = StreamingSession()
    detector = detector_with(ours_session, monkeypatch)
    ours = [detector._infer_frame(frame) for frame in frames]
    official = official_reference(StreamingSession(), frames)
    assert np.allclose(ours, official, atol=1e-4, rtol=1e-3)
    assert all(feed["input"].shape == (1, 576) for feed in ours_session.feeds)


def test_onnx_context_is_carried_between_frames(monkeypatch):
    session = StreamingSession()
    detector = detector_with(session, monkeypatch)
    first = np.linspace(-1, 1, 512, dtype=np.float32)
    second = np.zeros(512, np.float32)
    detector._infer_frame(first)
    assert np.array_equal(detector._onnx_context, first[-64:].reshape(1, 64))
    detector._infer_frame(second)
    assert np.array_equal(session.feeds[1]["input"][:, :64], first[-64:].reshape(1, 64))


def test_vad_reset_clears_onnx_context_and_state(monkeypatch):
    detector = detector_with(StreamingSession(), monkeypatch)
    detector.get_speech_probability(np.ones(1024, np.float32) * .2)
    assert np.any(detector._onnx_state) and np.any(detector._onnx_context)
    detector.reset()
    assert not np.any(detector._onnx_state)
    assert not np.any(detector._onnx_context)
    assert detector._pending.size == 0
    assert detector.last_raw_probability == detector.last_smoothed_probability == 0
    assert detector._smoothed_probability == 0


def test_streaming_1024_samples_equals_two_512_inferences(monkeypatch):
    session = StreamingSession()
    detector = detector_with(session, monkeypatch)
    samples = np.arange(1024, dtype=np.float32) / 2048
    detector.get_speech_probability(samples)
    assert len(session.feeds) == 2
    assert np.array_equal(session.feeds[0]["input"][:, -512:], samples[:512].reshape(1, 512))
    assert np.array_equal(session.feeds[1]["input"][:, :64], samples[448:512].reshape(1, 64))
    assert np.array_equal(session.feeds[1]["input"][:, -512:], samples[512:].reshape(1, 512))


def test_onnx_inference_error_reports_shapes_before_fallback(monkeypatch, capsys):
    session = StreamingSession()
    session.run = lambda *_args: (_ for _ in ()).throw(RuntimeError("bad dimensions"))
    detector = detector_with(session, monkeypatch)
    detector._infer_frame(np.zeros(512, np.float32))
    assert "input=(1, 576)" in detector.vad_error
    assert "state=(2, 1, 128)" in detector.vad_error
    assert "[SILERO ERROR]" in capsys.readouterr().out


def test_vad_shape_diagnostics(monkeypatch):
    detector = detector_with(StreamingSession(), monkeypatch)
    diagnostics = detector.diagnostics()
    assert diagnostics["vad_frame_samples"] == 512
    assert diagnostics["vad_context_samples"] == 64
    assert diagnostics["vad_model_input_samples"] == 576


def test_debug_vad_audio_is_opt_in_and_contains_exact_input(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("SANTEK_DEBUG_VAD_AUDIO", "1")
    detector = detector_with(StreamingSession(), monkeypatch)
    samples = np.linspace(-.25, .25, 512, dtype=np.float32)
    detector.get_speech_probability(samples)
    detector.reset()
    path = tmp_path / "data/debug/vad_input.wav"
    with wave.open(str(path), "rb") as debug_wave:
        assert debug_wave.getframerate() == 16000
        assert debug_wave.getnchannels() == 1
        decoded = np.frombuffer(debug_wave.readframes(512), dtype="<i2") / 32767
    assert np.allclose(decoded, samples, atol=1 / 32767)


def test_debug_vad_audio_disabled_creates_no_file(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("SANTEK_DEBUG_VAD_AUDIO", raising=False)
    detector = detector_with(StreamingSession(), monkeypatch)
    detector.get_speech_probability(np.zeros(512, np.float32))
    detector.reset()
    assert not (tmp_path / "data/debug/vad_input.wav").exists()
