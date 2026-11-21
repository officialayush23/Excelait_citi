"""Skill Passport API: student tasks and evidence, teacher review, and the public verify endpoints."""

from typing import Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from app.core.auth import CurrentUser, require_role
from app.services import passport as svc

router = APIRouter(tags=["passport"])
student = require_role("student")
reviewer = require_role("facilitator", "admin")


def _run(fn, *a, **kw):
    try:
        return fn(*a, **kw)
    except svc.PassportError as e:
        raise HTTPException(e.status, str(e)) from e


# ---------- public ----------
@router.get("/public/credentials/key")
def public_key() -> dict:
    return svc.public_key_doc()


@router.get("/public/credentials/{public_id}")
def verify(public_id: str) -> dict:
    return _run(svc.verify_credential, public_id)


# ---------- student ----------
@router.get("/passport/skills")
def skills(user: CurrentUser = Depends(student)) -> dict:
    return {"skills": svc.list_skills(user.id)}


@router.get("/passport/me")
def me(user: CurrentUser = Depends(student)) -> dict:
    return svc.my_passport(user.id)


@router.get("/passport/tasks/{task_id}")
def task(task_id: str, user: CurrentUser = Depends(student)) -> dict:
    return _run(svc.get_task, task_id, user.id)


@router.post("/passport/tasks/{task_id}/submit")
async def submit(task_id: str, files: list[UploadFile] = File(default=[]), note: str = Form(default=""), user: CurrentUser = Depends(student)) -> dict:
    if len(files) > svc.MAX_FILES:
        raise HTTPException(400, f"You can upload up to {svc.MAX_FILES} photos.")
    data = []
    for f in files:
        blob = await f.read(svc.MAX_BYTES + 1)
        data.append((blob, f.content_type or ""))
    return _run(svc.submit, task_id, user.id, data, note)


class AttachIn(BaseModel):
    credential_ids: list[str] = Field(max_length=10)


@router.post("/passport/applications/{application_id}/credentials")
def attach(application_id: str, body: AttachIn, user: CurrentUser = Depends(student)) -> dict:
    return _run(svc.attach_credentials, user.id, application_id, body.credential_ids)


# ---------- teacher ----------
@router.get("/passport/review")
def review_queue(status: Literal["submitted", "approved", "resubmit"] = "submitted", user: CurrentUser = Depends(reviewer)) -> dict:
    return {"submissions": svc.review_queue(user.id, user.roles, status)}


class CriterionIn(BaseModel):
    id: str
    ok: bool
    comment: str | None = Field(default=None, max_length=500)


class ReviewIn(BaseModel):
    decision: Literal["approve", "needs_work"]
    criteria: list[CriterionIn] = Field(default_factory=list, max_length=20)
    comment: str = Field(default="", max_length=1000)


@router.post("/passport/review/{submission_id}")
def review(submission_id: str, body: ReviewIn, user: CurrentUser = Depends(reviewer)) -> dict:
    return _run(svc.review_submission, user.id, user.roles, submission_id, body.decision, [c.model_dump() for c in body.criteria], body.comment)
