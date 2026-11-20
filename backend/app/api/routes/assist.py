from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field

from app.core.auth import CurrentUser, get_current_user, require_role
from app.services.ai import onboard_turn
from app.services.scheme_search import search_schemes
from app.services.voice import VoiceError, speech_to_text, text_to_speech

router = APIRouter(tags=["voice and AI"])
MAX_AUDIO_BYTES = 5 * 1024 * 1024


@router.post("/voice/stt")
async def stt(
    file: UploadFile = File(...),
    language: str | None = Form(default=None),
    _: CurrentUser = Depends(get_current_user),
) -> dict:
    audio = await file.read()
    if len(audio) > MAX_AUDIO_BYTES:
        raise HTTPException(413, "Recording is too long.")
    try:
        return speech_to_text(audio, file.filename or "audio.webm", file.content_type or "audio/webm", language)
    except VoiceError as e:
        raise HTTPException(502, str(e)) from e


class TtsIn(BaseModel):
    text: str = Field(min_length=1, max_length=1500)
    language: str = "en"


@router.post("/voice/tts")
def tts(body: TtsIn, _: CurrentUser = Depends(get_current_user)) -> dict:
    try:
        return {"audio_base64": text_to_speech(body.text, body.language), "mime": "audio/wav"}
    except VoiceError as e:
        raise HTTPException(502, str(e)) from e


class Turn(BaseModel):
    message: str = Field(min_length=1, max_length=1000)
    language: str = "en"
    history: list[dict] = []


@router.post("/ai/onboard")
def onboard(body: Turn, user: CurrentUser = Depends(require_role("student"))) -> dict:
    try:
        return onboard_turn(user.id, body.history, body.message, body.language)
    except Exception as e:  # network or provider failure: the app falls back to tap chips
        raise HTTPException(502, "The guide is not reachable right now. You can keep going by tapping.") from e


@router.get("/schemes/search")
def scheme_search(q: str = Query(default="", max_length=200), state: str | None = None, kind: str | None = None) -> dict:
    return {"results": search_schemes(q, state, kind)}
