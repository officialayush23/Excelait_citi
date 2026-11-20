"""Sarvam AI speech: Saaras speech-to-text and Bulbul text-to-speech."""

from __future__ import annotations

import httpx

from app.core.config import get_settings

BASE = "https://api.sarvam.ai"
# App language code -> Sarvam BCP-47 code
LANG = {
    "en": "en-IN", "hi": "hi-IN", "mr": "mr-IN", "bn": "bn-IN", "ta": "ta-IN", "te": "te-IN",
    "kn": "kn-IN", "ml": "ml-IN", "gu": "gu-IN", "pa": "pa-IN", "od": "od-IN",
}
MAX_TTS_CHARS = 1500


class VoiceError(RuntimeError):
    pass


def _headers() -> dict:
    key = get_settings().sarvam_api_key
    if not key:
        raise VoiceError("SARVAM_API_KEY is not set")
    return {"api-subscription-key": key}


def speech_to_text(audio: bytes, filename: str, content_type: str, language: str | None) -> dict:
    data = {"language_code": LANG.get(language or "", "unknown")}
    r = httpx.post(f"{BASE}/speech-to-text", headers=_headers(), timeout=60,
                   files={"file": (filename, audio, content_type)}, data=data)
    if r.status_code != 200:
        raise VoiceError(f"Sarvam speech-to-text failed ({r.status_code})")
    body = r.json()
    return {"transcript": body.get("transcript", ""), "language": body.get("language_code")}


def text_to_speech(text: str, language: str) -> str:
    """Returns base64 WAV audio."""
    r = httpx.post(f"{BASE}/text-to-speech", headers=_headers(), timeout=60, json={
        "text": text[:MAX_TTS_CHARS], "target_language_code": LANG.get(language, "en-IN"), "model": "bulbul:v3",
    })
    if r.status_code != 200:
        raise VoiceError(f"Sarvam text-to-speech failed ({r.status_code})")
    return r.json()["audios"][0]
