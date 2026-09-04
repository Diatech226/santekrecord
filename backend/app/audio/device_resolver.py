"""Fresh PortAudio device identity resolution for USB hot-plug."""
from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Any, Iterable, Optional


@dataclass(frozen=True)
class AudioDeviceIdentity:
    name: str
    hostapi: str = ""
    max_input_channels: Optional[int] = None
    default_samplerate: Optional[int] = None
    alsa_card_id: Optional[str] = None
    alsa_device: Optional[int] = None

    @classmethod
    def from_device(cls, device: dict[str, Any]) -> "AudioDeviceIdentity":
        return cls(
            name=str(device.get("name") or ""),
            hostapi=str(device.get("hostapi") or ""),
            max_input_channels=device.get("max_input_channels"),
            default_samplerate=device.get("default_samplerate"),
            alsa_card_id=device.get("alsa_card_id"),
            alsa_device=device.get("alsa_device"),
        )


def normalize_device_name(name: str) -> str:
    """Remove only known volatile ALSA card-number fragments from a PA name."""
    normalized = re.sub(r"\(\s*(?:plug)?hw:\d+\s*,\s*\d+\s*\)", "", name, flags=re.I)
    normalized = re.sub(r"\bplughw:\d+\s*,\s*\d+\b", "", normalized, flags=re.I)
    normalized = re.sub(r"\bcard\s+\d+\b", "", normalized, flags=re.I)
    return " ".join(normalized.split()).strip(" :-,").casefold()


def _same_identity(device: dict[str, Any], expected: AudioDeviceIdentity) -> bool:
    """Compare stable properties, with ALSA identity dominating the PA name."""
    if expected.alsa_card_id:
        return (
            device.get("alsa_card_id") == expected.alsa_card_id
            and (expected.alsa_device is None or device.get("alsa_device") == expected.alsa_device)
        )
    if normalize_device_name(str(device.get("name") or "")) != normalize_device_name(expected.name):
        return False
    comparisons = (
        ("hostapi", expected.hostapi),
        ("max_input_channels", expected.max_input_channels),
        ("default_samplerate", expected.default_samplerate),
        ("alsa_card_id", expected.alsa_card_id),
        ("alsa_device", expected.alsa_device),
    )
    return all(value in (None, "") or device.get(key) == value for key, value in comparisons)


def resolve_configured_device(
    devices: Iterable[dict[str, Any]], configured_id: Optional[int],
    expected: AudioDeviceIdentity,
) -> tuple[Optional[dict[str, Any]], bool]:
    """Resolve the same physical input; never accept an index whose identity changed."""
    inputs = list(devices)
    if not expected.name:
        legacy = next((d for d in inputs if d.get("id") == configured_id), None)
        return legacy, bool(legacy)
    # ALSA card id/device is the strongest identity and intentionally ignores a
    # PortAudio name whose hw index may have changed after hot-plug.
    matches = [d for d in inputs if _same_identity(d, expected)]
    if len(matches) == 1:
        return matches[0], True
    if len(matches) > 1:
        exact_id = next((d for d in matches if d.get("id") == configured_id), None)
        return (exact_id, True) if exact_id else (None, False)
    # An authoritative ALSA identity must never degrade to a similar name.
    if expected.alsa_card_id:
        return None, False
    normalized_name = normalize_device_name(expected.name)
    normalized_matches = [d for d in inputs
                          if normalize_device_name(str(d.get("name") or "")) == normalized_name]
    if len(normalized_matches) == 1:
        return normalized_matches[0], True
    # Exact name is the final legacy identity supported by older configuration.
    name_matches = [d for d in inputs if expected.name and d.get("name") == expected.name]
    return (name_matches[0], True) if len(name_matches) == 1 else (None, False)
