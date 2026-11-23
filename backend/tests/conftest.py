"""Unit tests never reach the real database through the roadmap: it reports 'not ready' unless a test says so."""

import pytest


@pytest.fixture(autouse=True)
def _roadmap_offline(monkeypatch):
    from app.services import roadmap

    monkeypatch.setattr(roadmap, "ready", lambda: False)
    monkeypatch.setattr(roadmap, "BACKGROUND", False)
