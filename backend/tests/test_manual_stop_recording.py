import json
import threading
import wave

import numpy as np
import pytest

from backend.app.config.settings import AppConfig
from backend.app.recording.recorder import AudioRecorderEngine


SR = 16000
FRAME = 1024


def recorder(tmp_path, **overrides):
    config = AppConfig(
        sample_rate=SR,
        preroll_seconds=0,
        auto_trim_silence=False,
        minimum_total_speech_ms=300,
        **overrides,
    )
    return AudioRecorderEngine(config, str(tmp_path))


def send(rec, value=0.2, *, speech=True):
    samples = np.full(FRAME, value, dtype=np.float32)
    rec.process_frame(samples, -25, .9 if speech else .01,
                      speech_confirmed=speech, return_to_ambient=not speech)
    return samples


def read_wav(path):
    with wave.open(str(path), "rb") as handle:
        return handle.getframerate(), handle.getnframes(), handle.readframes(handle.getnframes())


def test_stop_during_recording_creates_readable_wav_and_metadata(tmp_path):
    rec = recorder(tmp_path)
    send(rec)

    rec.stop_and_flush()

    wavs = list(tmp_path.glob("*.wav"))
    assert len(wavs) == 1
    rate, frames, payload = read_wav(wavs[0])
    assert rate == SR and frames == FRAME and payload
    metadata = json.loads(next(tmp_path.glob("*.json")).read_text())
    assert metadata["communication_end_reason"] == "manual_stop"


def test_manual_stop_preserves_every_sample_received(tmp_path):
    rec = recorder(tmp_path)
    expected = np.concatenate([send(rec, .1), send(rec, .2), send(rec, .3)])

    rec.stop_and_flush()

    _, frames, payload = read_wav(next(tmp_path.glob("*.wav")))
    actual = np.frombuffer(payload, dtype=np.int16)
    assert frames == len(expected)
    assert np.allclose(actual / 32767, expected, atol=1 / 32767)


def test_stop_while_rec_off_creates_no_empty_artifacts(tmp_path):
    rec = recorder(tmp_path)
    send(rec, speech=False)
    rec.stop_and_flush()
    assert not list(tmp_path.glob("*.wav"))
    assert not list(tmp_path.glob("*.json"))
    assert not list(tmp_path.glob("*.part"))


def test_repeated_stop_is_idempotent(tmp_path):
    rec = recorder(tmp_path)
    send(rec)
    rec.stop_and_flush()
    rec.stop_and_flush()
    rec.stop_and_flush()
    assert len(list(tmp_path.glob("*.wav"))) == 1
    assert len(list(tmp_path.glob("*.json"))) == 1


def test_saved_duration_matches_samples(tmp_path):
    rec = recorder(tmp_path)
    for _ in range(5):
        send(rec)
    rec.stop_and_flush()
    rate, frames, _ = read_wav(next(tmp_path.glob("*.wav")))
    metadata = json.loads(next(tmp_path.glob("*.json")).read_text())
    assert frames / rate == pytest.approx(5 * FRAME / SR)
    assert metadata["duration_seconds"] == pytest.approx(frames / rate, abs=.001)


def test_stop_during_silence_hangover_keeps_the_pending_session(tmp_path):
    rec = recorder(tmp_path, intra_phrase_pause_seconds=.1,
                   transmission_end_timeout_seconds=3)
    send(rec)
    send(rec, 0, speech=False)
    send(rec, 0, speech=False)
    assert rec.is_recording
    rec.stop_and_flush()
    metadata = json.loads(next(tmp_path.glob("*.json")).read_text())
    assert metadata["communication_end_reason"] == "manual_stop"
    assert read_wav(next(tmp_path.glob("*.wav")))[1] == 3 * FRAME


def test_restart_after_stop_accepts_a_new_recording(tmp_path):
    rec = recorder(tmp_path)
    send(rec)
    rec.stop_and_flush()
    rec.resume()
    send(rec, .4)
    rec.stop_and_flush()
    assert len(list(tmp_path.glob("*.wav"))) == 2


def test_stop_serializes_with_an_in_flight_frame_and_leaves_no_part_file(tmp_path):
    rec = recorder(tmp_path)
    send(rec)
    barrier = threading.Barrier(2)

    def finalizer():
        barrier.wait()
        rec.stop_and_flush()

    thread = threading.Thread(target=finalizer)
    thread.start()
    barrier.wait()
    # Whichever operation takes the recorder lock first, STOP is a durable
    # boundary: the frame is either wholly included or wholly rejected.
    send(rec, .5)
    thread.join()
    frames = read_wav(next(tmp_path.glob("*.wav")))[1]
    assert frames in (FRAME, 2 * FRAME)
    assert not list(tmp_path.glob("*.part"))


def test_interrupted_spool_is_recovered_atomically_on_restart(tmp_path):
    rec = recorder(tmp_path)
    send(rec, .25)
    rec._spool_file.flush()
    rec._spool_file.close()
    rec._spool_file = None

    AudioRecorderEngine(rec.config, str(tmp_path))

    recovered = next(tmp_path.glob("*-recovered.wav"))
    assert read_wav(recovered)[1] == FRAME
    metadata = json.loads(next(tmp_path.glob("*-recovered.json")).read_text())
    assert metadata["communication_end_reason"] == "interrupted_recovery"
    assert not list(tmp_path.glob("*.part"))
