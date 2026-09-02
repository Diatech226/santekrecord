import json
import wave
import numpy as np
import pytest

from backend.app.config.settings import AppConfig
from backend.app.recording.recorder import AudioRecorderEngine
from backend.app.recording.transmission_manager import TransmissionManager

SR = 1000


def tm():
    return TransmissionManager(SR, 1.2, 3.0)


def test_short_pause_same_transmission():
    m = tm(); m.process(0, 500, True, True, False, 1)
    m.process(500, 900, False, False, True, 1)
    m.process(900, 1400, True, True, False, 1)
    assert m.current.id == 1 and len(m.current.speech_segments) == 2


def test_phrase_pause_same_transmission():
    m = tm(); m.process(0, 1500, True, True, False, 1)
    m.process(1500, 2300, False, False, True, 1)
    m.process(2300, 3300, True, True, False, 1)
    assert m.current.id == 1 and len(m.current.speech_segments) == 2


def test_medium_pause_closes_transmission():
    m = tm(); m.process(0, 500, True, True, False, 1)
    assert m.process(500, 3500, False, False, True, 1).id == 1


def feed(rec, seconds, speech=False, radio=False, value=0):
    for _ in range(int(seconds * 10)):
        rec.process_frame(np.full(100, value, np.float32), -25 if speech else -60,
                          .9 if speech else .01, speech_confirmed=speech,
                          radio_activity=radio, return_to_ambient=not radio)


def config(**kw):
    values = dict(sample_rate=SR, preroll_seconds=.2, minimum_total_speech_ms=100,
                  intra_phrase_pause_seconds=.5, transmission_end_timeout_seconds=1,
                  communication_end_timeout_seconds=3, trim_margin_seconds=.1,
                  max_communication_seconds=30)
    values.update(kw)
    return AppConfig(**values)


def test_new_transmission_same_session_and_long_ambient_closes_session(tmp_path):
    rec = AudioRecorderEngine(config(), str(tmp_path))
    feed(rec, 1, True, True, .2); feed(rec, 1.1); feed(rec, 1, True, True, .3)
    assert rec.is_recording and rec.session_telemetry()["transmission_count"] == 2
    feed(rec, 3.1)
    assert len(list(tmp_path.glob("*.wav"))) == 1


def test_multiple_transmissions_one_wav_and_metadata_and_internal_gaps(tmp_path):
    rec = AudioRecorderEngine(config(), str(tmp_path))
    feed(rec, 1, True, True, .2); feed(rec, 2); feed(rec, 1, True, True, .4); feed(rec, 3.1)
    assert len(list(tmp_path.glob("*.wav"))) == len(list(tmp_path.glob("*.json"))) == 1
    meta = json.loads(next(tmp_path.glob("*.json")).read_text())
    assert meta["transmission_count"] == 2
    assert len(meta["transmissions"]) == 2 and meta["transmissions"][0]["speaker"] is None
    assert meta["inter_transmission_gap_seconds"][0] >= 1.9
    with wave.open(str(next(tmp_path.glob("*.wav")))) as wf:
        assert wf.getnframes() / wf.getframerate() >= 4


def test_manual_stop_saves_active_session(tmp_path):
    rec = AudioRecorderEngine(config(), str(tmp_path)); feed(rec, 1, True, True, .2)
    rec.stop_and_flush()
    meta = json.loads(next(tmp_path.glob("*.json")).read_text())
    assert meta["communication_end_reason"] == "manual_stop"


def test_max_session_duration(tmp_path):
    rec = AudioRecorderEngine(config(max_communication_seconds=2), str(tmp_path))
    feed(rec, 2.1, True, True, .2)
    assert json.loads(next(tmp_path.glob("*.json")).read_text())["communication_end_reason"] == "max_duration"


def test_radio_hiss_without_speech_does_not_create_session(tmp_path):
    rec = AudioRecorderEngine(config(), str(tmp_path)); feed(rec, 3, False, True, .1); feed(rec, 4)
    assert not list(tmp_path.glob("*.wav"))
