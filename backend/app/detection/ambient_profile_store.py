"""Versioned, device-specific persistence for learned ambient baselines."""
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import time


class AmbientProfileStore:
    SCHEMA_VERSION = 1

    def __init__(self, directory="data/ambient_profiles", max_age_seconds=30 * 86400):
        self.directory = Path(directory)
        self.max_age_seconds = max_age_seconds

    @staticmethod
    def identity(config, device_name=None):
        return {
            "source": config.source,
            "device_name": device_name or config.device_name or "default",
            "input_channel": config.input_channel,
            "sample_rate": config.sample_rate,
            "detection_profile": config.detection_profile,
        }

    def key(self, config, device_name=None):
        identity = self.identity(config, device_name)
        readable = "__".join(str(identity[name]) for name in (
            "source", "device_name", "input_channel", "sample_rate", "detection_profile"))
        safe = "".join(char if char.isalnum() or char in "-_" else "_" for char in readable)
        digest = hashlib.sha256(readable.encode()).hexdigest()[:10]
        return f"{safe[:100]}__{digest}"

    def _path(self, config, device_name=None):
        return self.directory / f"{self.key(config, device_name)}.json"

    def save(self, config, profile, device_name=None):
        self.directory.mkdir(parents=True, exist_ok=True)
        now = datetime.now(timezone.utc).isoformat()
        payload = {
            "profile_schema_version": self.SCHEMA_VERSION,
            "created_at": now,
            "updated_at": now,
            **self.identity(config, device_name),
            "ambient_window_seconds": config.ambient_window_seconds,
            "profile": profile.export_profile(),
        }
        path = self._path(config, device_name)
        if path.exists():
            try:
                payload["created_at"] = json.loads(path.read_text(encoding="utf-8"))["created_at"]
            except (OSError, ValueError, KeyError):
                pass
        temporary = path.with_suffix(".tmp")
        temporary.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
        os.replace(temporary, path)
        return payload

    def load(self, config, device_name=None):
        path = self._path(config, device_name)
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            updated = datetime.fromisoformat(payload["updated_at"]).timestamp()
            if (payload.get("profile_schema_version") != self.SCHEMA_VERSION
                    or payload.get("source") != config.source
                    or payload.get("device_name") != self.identity(config, device_name)["device_name"]
                    or payload.get("input_channel") != config.input_channel
                    or payload.get("sample_rate") != config.sample_rate
                    or payload.get("detection_profile") != config.detection_profile
                    or time.time() - updated > self.max_age_seconds):
                return None
            payload["age_seconds"] = max(0, time.time() - updated)
            return payload
        except (OSError, ValueError, KeyError, TypeError):
            return None

    def delete(self, config, device_name=None):
        try:
            self._path(config, device_name).unlink()
            return True
        except FileNotFoundError:
            return False
