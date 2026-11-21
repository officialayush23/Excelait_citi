"""Career Mitra (teacher) API plus the student-side class join. Registered under /api/v1."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.core.auth import CurrentUser, get_current_user, require_role
from app.services import teacher as svc

router = APIRouter(tags=["teacher"])
teacher_only = require_role("facilitator", "admin")


class ClassIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    school_name: str | None = Field(default=None, max_length=120)
    district_id: int | None = None


class ClassPatch(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=80)
    school_name: str | None = Field(default=None, max_length=120)


class JoinIn(BaseModel):
    code: str = Field(min_length=1, max_length=20)


class ClaimIn(BaseModel):
    scheme_slug: str | None = None
    scheme_id: int | None = None
    status: Literal["started", "documents_ready", "submitted", "approved", "money_received", "rejected"]
    amount_received: int | None = Field(default=None, ge=0, le=100_000_000)


class RecommendationIn(BaseModel):
    note: str | None = Field(default=None, max_length=600)
    title: str | None = Field(default=None, max_length=120)
    opportunity_id: str | None = None
    link: str | None = Field(default=None, max_length=300)


class NudgeIn(BaseModel):
    code: str = "general"


# ----- student side -----
@router.post("/classes/join")
def join(body: JoinIn, user: CurrentUser = Depends(get_current_user)) -> dict:
    return {"class": svc.join_class(user, body.code)}


@router.get("/classes/mine")
def mine(user: CurrentUser = Depends(get_current_user)) -> dict:
    return {"classes": svc.my_classes(user)}


# ----- teacher side -----
@router.get("/teacher/classes")
def classes(user: CurrentUser = Depends(teacher_only)) -> dict:
    return {"classes": svc.list_classes(user)}


@router.post("/teacher/classes", status_code=201)
def create_class(body: ClassIn, user: CurrentUser = Depends(teacher_only)) -> dict:
    return {"class": svc.create_class(user, body.name, body.school_name, body.district_id)}


@router.patch("/teacher/classes/{cohort_id}")
def rename_class(cohort_id: str, body: ClassPatch, user: CurrentUser = Depends(teacher_only)) -> dict:
    return {"class": svc.rename_class(cohort_id, user, body.model_dump(exclude_none=True))}


@router.get("/teacher/classes/{cohort_id}/dashboard")
def dashboard(cohort_id: str, user: CurrentUser = Depends(teacher_only)) -> dict:
    return svc.class_dashboard(svc.get_cohort_for(cohort_id, user))


@router.get("/teacher/students/{student_id}")
def student(student_id: str, user: CurrentUser = Depends(teacher_only)) -> dict:
    return svc.student_detail(student_id, user)


@router.put("/teacher/students/{student_id}/claims")
def claim(student_id: str, body: ClaimIn, user: CurrentUser = Depends(teacher_only)) -> dict:
    return {"claim": svc.set_claim(student_id, user, scheme_id=body.scheme_id, scheme_slug=body.scheme_slug,
                                   status=body.status, amount_received=body.amount_received)}


@router.post("/teacher/students/{student_id}/recommendations", status_code=201)
def recommend(student_id: str, body: RecommendationIn, user: CurrentUser = Depends(teacher_only)) -> dict:
    return {"recommendation": svc.add_recommendation(student_id, user, note=body.note, title=body.title,
                                                     opportunity_id=body.opportunity_id, link=body.link)}


@router.post("/teacher/students/{student_id}/nudge")
def nudge(student_id: str, body: NudgeIn, user: CurrentUser = Depends(teacher_only)) -> dict:
    return svc.nudge(student_id, user, body.code)
