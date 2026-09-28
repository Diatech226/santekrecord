import json
import os
import threading
import wave
from unittest.mock import Mock

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


def test_spool_fsync_runs_once_per_five_minute_interval(monkeypatch, tmp_path):
    clock = {"now": 0.0}
    monkeypatch.setattr("backend.app.recording.recorder.time.monotonic", lambda: clock["now"])
    fsync = Mock(wraps=os.fsync)
    monkeypatch.setattr("backend.app.recording.recorder.os.fsync", fsync)
    rec = recorder(tmp_path)

    send(rec)
    initial_calls = fsync.call_count  # The manifest itself is made durable.
    clock["now"] = 299.999
    send(rec)
    assert fsync.call_count == initial_calls

    clock["now"] = 300.0
    send(rec)
    assert fsync.call_count == initial_calls + 1
    send(rec)
    send(rec)
    assert fsync.call_count == initial_calls + 1

    clock["now"] = 600.0
    send(rec)
    assert fsync.call_count == initial_calls + 2


def test_new_recording_resets_periodic_fsync_clock(monkeypatch, tmp_path):
    clock = {"now": 0.0}
    monkeypatch.setattr("backend.app.recording.recorder.time.monotonic", lambda: clock["now"])
    fsync = Mock(wraps=os.fsync)
    monkeypatch.setattr("backend.app.recording.recorder.os.fsync", fsync)
    rec = recorder(tmp_path)
    send(rec)
    clock["now"] = 300.0
    send(rec)
    rec.stop_and_flush()

    rec.resume()
    clock["now"] = 1000.0
    send(rec)
    new_recording_calls = fsync.call_count
    clock["now"] = 1299.999
    send(rec)
    assert fsync.call_count == new_recording_calls
    clock["now"] = 1300.0
    send(rec)
    assert fsync.call_count == new_recording_calls + 1


def test_manual_stop_forces_fsync_after_recent_periodic_sync(monkeypatch, tmp_path):
    clock = {"now": 0.0}
    monkeypatch.setattr("backend.app.recording.recorder.time.monotonic", lambda: clock["now"])
    fsync_targets = []
    real_fsync = os.fsync

    def tracked_fsync(fd):
        fsync_targets.append(os.readlink(f"/proc/self/fd/{fd}"))
        real_fsync(fd)

    fsync = Mock(side_effect=tracked_fsync)
    monkeypatch.setattr("backend.app.recording.recorder.os.fsync", fsync)
    rec = recorder(tmp_path)
    send(rec)
    clock["now"] = 300.0
    send(rec)
    calls_after_periodic_sync = fsync.call_count

    clock["now"] = 301.0
    rec.stop_and_flush()

    # The spool sync is followed by the metadata sync; distinguish them by
    # their targets to prove STOP forced the former.
    assert fsync.call_count == calls_after_periodic_sync + 2
    assert fsync_targets[-2].endswith(".pcm.part")
    assert fsync_targets[-1].endswith(".json.part")
    assert len(list(tmp_path.glob("*.wav"))) == 1
    assert len(list(tmp_path.glob("*.json"))) == 1
    assert not list(tmp_path.glob("*.part"))


def test_automatic_end_forces_final_fsync(monkeypatch, tmp_path):
    monkeypatch.setattr("backend.app.recording.recorder.time.monotonic", lambda: 10.0)
    fsync_targets = []
    real_fsync = os.fsync

    def tracked_fsync(fd):
        fsync_targets.append(os.readlink(f"/proc/self/fd/{fd}"))
        real_fsync(fd)

    fsync = Mock(side_effect=tracked_fsync)
    monkeypatch.setattr("backend.app.recording.recorder.os.fsync", fsync)
    rec = recorder(
        tmp_path,
        intra_phrase_pause_seconds=.1,
        transmission_end_timeout_seconds=.1,
        communication_end_timeout_seconds=.5,
        ambient_confirm_ms=20,
    )
    for _ in range(5):
        send(rec)
    calls_while_active = fsync.call_count

    for _ in range(12):
        send(rec, 0, speech=False)
        if not rec.is_recording:
            break

    assert not rec.is_recording
    assert fsync.call_count == calls_while_active + 2
    assert fsync_targets[-2].endswith(".pcm.part")
    assert fsync_targets[-1].endswith(".json.part")
    assert len(list(tmp_path.glob("*.wav"))) == 1
    metadata = json.loads(next(tmp_path.glob("*.json")).read_text())
    assert metadata["communication_end_reason"] == "ambient_timeout"


def test_periodic_fsync_failure_keeps_recording_and_spool(monkeypatch, tmp_path, capsys):
    clock = {"now": 0.0}
    monkeypatch.setattr("backend.app.recording.recorder.time.monotonic", lambda: clock["now"])
    rec = recorder(tmp_path)
    send(rec)
    monkeypatch.setattr("backend.app.recording.recorder.os.fsync", Mock(side_effect=OSError("disk busy")))

    clock["now"] = 300.0
    send(rec)

    assert rec.is_recording
    assert list(tmp_path.glob("*.pcm.part"))
    assert "Periodic spool fsync failed" in capsys.readouterr().out


def test_final_fsync_failure_does_not_publish_or_delete_spool(monkeypatch, tmp_path, capsys):
    rec = recorder(tmp_path)
    send(rec)
    monkeypatch.setattr("backend.app.recording.recorder.os.fsync", Mock(side_effect=OSError("disk busy")))

    rec.stop_and_flush()

    assert not list(tmp_path.glob("*.wav"))
    assert not list(tmp_path.glob("*.json"))
    assert len(list(tmp_path.glob("*.pcm.part"))) == 1
    assert len(list(tmp_path.glob("*.recording.json.part"))) == 1
    assert "Final spool fsync failed" in capsys.readouterr().out
