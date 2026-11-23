from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.core.auth import CurrentUser, get_current_user, require_role
from app.core.db import get_db
from app.services import community as svc
from app.services.plans import saved
from app.services.roadmap import record_event
from app.services.students import get_facts

router = APIRouter(prefix="/community", tags=["community"])
admin = require_role("admin", "facilitator")


def _run(fn, *a, **k):
    try:
        return fn(*a, **k)
    except svc.CommunityError as e:
        raise HTTPException(403, str(e)) from e


@router.get("/groups")
def groups(user: CurrentUser = Depends(get_current_user)) -> dict:
    return svc.groups_for(user.id, get_facts(user.id), saved(user.id) if "student" in user.roles else [])


@router.post("/groups/{group_id}/join")
def join(group_id: str, on: bool = True, user: CurrentUser = Depends(get_current_user)) -> dict:
    _run(svc.join, user.id, group_id, get_facts(user.id), on)
    return {"ok": True}


@router.get("/posts")
def feed(kind: str | None = None, group: str | None = None, career: str | None = None, exam: str | None = None,
         q: str | None = None, user: CurrentUser = Depends(get_current_user)) -> dict:
    return {"posts": _run(svc.feed, get_facts(user.id), kind, group, career, exam, q)}


class PostIn(BaseModel):
    kind: Literal["post", "question", "opportunity", "story", "resource"] = "question"
    title: str = Field(min_length=3, max_length=200)
    body: str | None = Field(default=None, max_length=5000)
    group_id: str | None = None
    tags: dict = {}
    deadline: str | None = None
    link: str | None = None
    language: str = "en"


@router.post("/posts")
def create(body: PostIn, user: CurrentUser = Depends(get_current_user)) -> dict:
    if body.group_id:
        _run(svc.feed, get_facts(user.id), group_id=body.group_id, limit=1)  # checks access
    out = svc.create_post(user.id, user.roles, body.model_dump())
    record_event(user.id, "community_post", str((out or {}).get("id") or ""), {"kind": body.kind})
    return out


@router.get("/posts/{post_id}")
def read(post_id: str, user: CurrentUser = Depends(get_current_user)) -> dict:
    return _run(svc.get_post, post_id, get_facts(user.id))


class CommentIn(BaseModel):
    body: str = Field(min_length=1, max_length=3000)


@router.post("/posts/{post_id}/comments")
def comment(post_id: str, body: CommentIn, user: CurrentUser = Depends(get_current_user)) -> dict:
    _run(svc.get_post, post_id, get_facts(user.id))
    out = svc.comment(user.id, user.roles, post_id, body.body)
    record_event(user.id, "community_answer", post_id)
    return out


@router.post("/posts/{post_id}/comments/{comment_id}/accept")
def accept(post_id: str, comment_id: str, user: CurrentUser = Depends(get_current_user)) -> dict:
    _run(svc.accept, user.id, user.roles, post_id, comment_id)
    return {"ok": True}


class VoteIn(BaseModel):
    value: Literal[-1, 0, 1]


@router.post("/posts/{post_id}/vote")
def vote(post_id: str, body: VoteIn, user: CurrentUser = Depends(get_current_user)) -> dict:
    return {"score": svc.vote(user.id, post_id, body.value)}


class ReportIn(BaseModel):
    kind: Literal["post", "comment", "opportunity", "user"]
    target_id: str
    reason: str = Field(min_length=2, max_length=500)


@router.post("/reports")
def report(body: ReportIn, user: CurrentUser = Depends(get_current_user)) -> dict:
    svc.report(user.id, body.kind, body.target_id, body.reason)
    return {"ok": True}


@router.get("/seniors")
def seniors(career: str | None = None, q: str | None = None, _: CurrentUser = Depends(get_current_user)) -> dict:
    return {"seniors": svc.seniors(career, q)}


class SeniorIn(BaseModel):
    is_senior: bool
    senior_path: str | None = Field(default=None, max_length=200)
    bio: str | None = Field(default=None, max_length=500)


@router.put("/me/senior")
def become_senior(body: SeniorIn, user: CurrentUser = Depends(get_current_user)) -> dict:
    get_db().table("profiles").update(body.model_dump()).eq("id", user.id).execute()
    return {"ok": True}


@router.get("/moderation")
def queue(_: CurrentUser = Depends(admin)) -> dict:
    return svc.moderation_queue()


class ModIn(BaseModel):
    kind: Literal["post", "comment"]
    target_id: str
    approve: bool


@router.post("/moderation")
def moderate(body: ModIn, user: CurrentUser = Depends(admin)) -> dict:
    svc.moderate(user.id, body.kind, body.target_id, body.approve)
    return {"ok": True}
