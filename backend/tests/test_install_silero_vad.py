import importlib.util
from pathlib import Path

import numpy as np


SCRIPT = Path(__file__).parents[2] / "scripts" / "install_silero_vad.py"
SPEC = importlib.util.spec_from_file_location("install_silero_vad", SCRIPT)
installer = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(installer)


class Input:
    def __init__(self, name): self.name = name


class ValidSession:
    def __init__(self, path, **_kwargs):
        if Path(path).read_bytes() != b"valid-model":
            raise ValueError("corrupt protobuf")
        self.calls = 0
    def get_inputs(self):
        return [Input("input"), Input("state"), Input("sr")]
    def run(self, _outputs, feed):
        assert feed["input"].shape == (1, 576)
        self.calls += 1
        probability = .01 + float(np.mean(np.abs(feed["input"])))
        return [np.asarray([[probability]], np.float32),
                np.full((2, 1, 128), self.calls, np.float32)]


class Response:
    def __init__(self, data=b"valid-model"): self.data = data
    def __enter__(self): return self
    def __exit__(self, *_args): pass
    def read(self, _size=-1):
        data, self.data = self.data, b""
        return data


def runtime(monkeypatch):
    import onnxruntime
    monkeypatch.setattr(onnxruntime, "InferenceSession", ValidSession)


def test_valid_download(monkeypatch, tmp_path):
    runtime(monkeypatch)
    monkeypatch.setattr(installer, "urlopen", lambda *_args, **_kwargs: Response())
    destination = tmp_path / "silero_vad.onnx"
    assert installer.install_model(destination)
    assert destination.read_bytes() == b"valid-model"


def test_invalid_url_cleans_partial_file(monkeypatch, tmp_path):
    runtime(monkeypatch)
    monkeypatch.setattr(installer, "urlopen", lambda *_args, **_kwargs: (_ for _ in ()).throw(OSError("offline")))
    destination = tmp_path / "silero_vad.onnx"
    assert not installer.install_model(destination, "invalid://url")
    assert not destination.with_suffix(".onnx.part").exists()


def test_corrupted_model_is_rejected(monkeypatch, tmp_path):
    runtime(monkeypatch)
    model = tmp_path / "bad.onnx"
    model.write_bytes(b"corrupt")
    valid, diagnostic = installer.validate_model(model)
    assert not valid and "validation failed" in diagnostic.lower()


def test_onnxruntime_unavailable(monkeypatch, tmp_path):
    model = tmp_path / "model.onnx"
    model.write_bytes(b"valid-model")
    real_import = __import__
    monkeypatch.setattr("builtins.__import__", lambda name, *args, **kwargs:
                        (_ for _ in ()).throw(ImportError("missing"))
                        if name == "onnxruntime" else real_import(name, *args, **kwargs))
    valid, diagnostic = installer.validate_model(model)
    assert not valid and "onnxruntime unavailable" in diagnostic


def test_existing_valid_model_is_not_downloaded(monkeypatch, tmp_path):
    runtime(monkeypatch)
    destination = tmp_path / "silero_vad.onnx"
    destination.write_bytes(b"valid-model")
    monkeypatch.setattr(installer, "urlopen", lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("downloaded")))
    assert installer.install_model(destination)


def test_existing_invalid_model_is_replaced_after_valid_download(monkeypatch, tmp_path):
    runtime(monkeypatch)
    destination = tmp_path / "silero_vad.onnx"
    destination.write_bytes(b"corrupt")
    monkeypatch.setattr(installer, "urlopen", lambda *_args, **_kwargs: Response())
    assert installer.install_model(destination)
    assert destination.read_bytes() == b"valid-model"
