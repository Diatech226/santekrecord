from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from backend.app.api import routes


def engine_state(*, requested, reconnecting, running, status):
    return SimpleNamespace(
        _monitor_requested=requested,
        device_reconnecting=reconnecting,
        _is_running=running,
        current_status=status,
        get_telemetry=lambda: {
            "audio_frames_received": False,
            "monitor_requested": requested,
            "device_reconnecting": reconnecting,
            "engine_running": running,
            "status": status,
        },
    )


def forbid_microphone_open(monkeypatch):
    def fail_if_constructed(*_args, **_kwargs):
        pytest.fail("MicrophoneSource must not be opened during a capture conflict")

    monkeypatch.setattr(routes, "MicrophoneSource", fail_if_constructed)


def test_audio_test_input_returns_409_during_reconnect(monkeypatch):
    forbid_microphone_open(monkeypatch)
    engine = engine_state(requested=True, reconnecting=True, running=False,
                          status="device_reconnecting")

    with pytest.raises(HTTPException) as raised:
        routes.test_input_json(routes.InputTestRequest(), engine=engine)

    assert raised.value.status_code == 409
    assert raised.value.detail == "Audio monitor is opening or reconnecting"


def test_audio_test_input_returns_409_while_monitor_opening(monkeypatch):
    forbid_microphone_open(monkeypatch)
    engine = engine_state(requested=True, reconnecting=False, running=False,
                          status="opening")

    with pytest.raises(HTTPException) as raised:
        routes.test_input_json(routes.InputTestRequest(), engine=engine)

    assert raised.value.status_code == 409
    assert raised.value.detail == "Audio monitor is opening or reconnecting"


def test_both_audio_test_routes_share_capture_conflict_rule(monkeypatch):
    forbid_microphone_open(monkeypatch)
    engine = engine_state(requested=True, reconnecting=False, running=False,
                          status="opening")

    response = routes.test_input(engine=engine)

    assert response.status_code == 409
