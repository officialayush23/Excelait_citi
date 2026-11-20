from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.core.auth import CurrentUser, get_current_user
from app.core.db import get_db

router = APIRouter(prefix="/me", tags=["me"])

SUPPORTED_LANGUAGES = {"en", "hi", "mr", "bn", "ta", "te", "kn", "ml", "gu", "pa", "od"}


class Me(BaseModel):
    id: str
    email: str | None
    full_name: str | None
    preferred_language: str
    roles: list[str]
    onboarded: bool


class MeUpdate(BaseModel):
    full_name: str | None = Field(default=None, max_length=120)
    preferred_language: str | None = None


def _load(user: CurrentUser) -> Me:
    row = (
        get_db()
        .table("profiles")
        .select("full_name, email, preferred_language, onboarded_at")
        .eq("id", user.id)
        .single()
        .execute()
        .data
    )
    return Me(
        id=user.id,
        email=row.get("email") or user.email,
        full_name=row.get("full_name"),
        preferred_language=row.get("preferred_language") or "en",
        roles=sorted(user.roles),
        onboarded=row.get("onboarded_at") is not None,
    )


@router.get("", response_model=Me)
def read_me(user: CurrentUser = Depends(get_current_user)) -> Me:
    return _load(user)


@router.patch("", response_model=Me)
def update_me(body: MeUpdate, user: CurrentUser = Depends(get_current_user)) -> Me:
    patch: dict = {}
    if body.full_name is not None:
        patch["full_name"] = body.full_name.strip()
    if body.preferred_language is not None and body.preferred_language in SUPPORTED_LANGUAGES:
        patch["preferred_language"] = body.preferred_language
    if patch:
        get_db().table("profiles").update(patch).eq("id", user.id).execute()
    return _load(user)
