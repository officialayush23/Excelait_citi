"""Partner dashboard, admin verification, and the student side of offerings."""

from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.core.auth import CurrentUser, require_role
from app.services import partners as svc
from app.services.students import get_facts

router = APIRouter(tags=["partners"])
partner = require_role("partner", "admin")
admin = require_role("admin")
student = require_role("student")


def _run(fn, *a):
    try:
        return fn(*a)
    except svc.PartnerError as e:
        raise HTTPException(400, str(e)) from e


class OrgIn(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    kind: Literal["college", "iti", "ngo", "company", "msme", "csr", "government", "training_centre", "school"]
    about: str | None = Field(default=None, max_length=2000)
    website: str | None = None
    contact_email: str | None = None
    phone: str | None = None
    state: str | None = None
    district: str | None = None
    aishe_code: str | None = None


class Criteria(BaseModel):
    class_min: int | None = None
    class_max: int | None = None
    courses: list[str] = []
    states: list[str] = []
    gender: Literal["female", "male"] | None = None
    income_max: int | None = None
    categories: list[str] = []
    marks_min: float | None = None
    age_min: int | None = None
    age_max: int | None = None


class OfferIn(BaseModel):
    kind: Literal["internship", "apprenticeship", "workshop", "bootcamp", "admission", "job", "mentorship", "course", "training", "scholarship", "resource", "event"]
    title: str = Field(min_length=3, max_length=200)
    description: str | None = Field(default=None, max_length=5000)
    location: str | None = None
    is_remote: bool = False
    stipend_monthly: int | None = None
    fee_inr: int = 0
    seats: int | None = None
    deadline: date | None = None
    starts_at: date | None = None
    apply_url: str | None = None
    state: str | None = None
    district: str | None = None
    career_slugs: list[str] = []
    program_slugs: list[str] = []
    language: str | None = None
    criteria: Criteria = Criteria()


def _offer(body: OfferIn) -> dict:
    d = body.model_dump(mode="json")
    return d


# ---------- partner ----------
@router.get("/partner/orgs")
def my_orgs(user: CurrentUser = Depends(partner)) -> dict:
    return {"orgs": svc.my_orgs(user.id)}


@router.post("/partner/orgs")
def register(body: OrgIn, user: CurrentUser = Depends(partner)) -> dict:
    return _run(svc.register_org, user.id, body.model_dump())


@router.patch("/partner/orgs/{org_id}")
def update(org_id: str, body: dict, user: CurrentUser = Depends(partner)) -> dict:
    return _run(svc.update_org, user.id, org_id, body)


@router.put("/partner/orgs/{org_id}/college")
def college_details(org_id: str, body: dict, user: CurrentUser = Depends(partner)) -> dict:
    return _run(svc.update_college_details, user.id, org_id, body)


@router.get("/partner/orgs/{org_id}/offers")
def offers(org_id: str, user: CurrentUser = Depends(partner)) -> dict:
    return {"offers": _run(svc.list_offers, user.id, org_id)}


@router.post("/partner/orgs/{org_id}/offers")
def create_offer(org_id: str, body: OfferIn, user: CurrentUser = Depends(partner)) -> dict:
    return _run(svc.save_offer, user.id, org_id, _offer(body))


@router.put("/partner/orgs/{org_id}/offers/{offer_id}")
def edit_offer(org_id: str, offer_id: str, body: OfferIn, user: CurrentUser = Depends(partner)) -> dict:
    return _run(svc.save_offer, user.id, org_id, _offer(body), offer_id)


@router.post("/partner/orgs/{org_id}/offers/{offer_id}/publish")
def publish(org_id: str, offer_id: str, user: CurrentUser = Depends(partner)) -> dict:
    return _run(svc.publish_offer, user.id, org_id, offer_id)


@router.post("/partner/orgs/{org_id}/offers/{offer_id}/close")
def close(org_id: str, offer_id: str, user: CurrentUser = Depends(partner)) -> dict:
    return _run(svc.close_offer, user.id, org_id, offer_id)


@router.get("/partner/orgs/{org_id}/offers/{offer_id}/applicants")
def applicants(org_id: str, offer_id: str, user: CurrentUser = Depends(partner)) -> dict:
    return {"applicants": _run(svc.applicants, user.id, org_id, offer_id)}


class StatusIn(BaseModel):
    status: Literal["applied", "shortlisted", "interview", "offered", "joined", "rejected"]


@router.patch("/partner/orgs/{org_id}/applications/{application_id}")
def application_status(org_id: str, application_id: str, body: StatusIn, user: CurrentUser = Depends(partner)) -> dict:
    return _run(svc.set_application_status, user.id, org_id, application_id, body.status)


# ---------- admin ----------
@router.get("/admin/orgs/pending")
def pending(_: CurrentUser = Depends(admin)) -> dict:
    return {"orgs": svc.pending_orgs()}


class ReviewIn(BaseModel):
    approve: bool
    reason: str | None = None


@router.post("/admin/orgs/{org_id}/review")
def review(org_id: str, body: ReviewIn, user: CurrentUser = Depends(admin)) -> dict:
    return svc.review_org(user.id, org_id, body.approve, body.reason)


# ---------- students ----------
@router.get("/opportunities")
def for_me(kind: str | None = None, career: str | None = None, user: CurrentUser = Depends(student)) -> dict:
    return {"offers": svc.offers_for_student(get_facts(user.id), kind, career), "applications": svc.my_applications(user.id)}


class ApplyIn(BaseModel):
    note: str | None = Field(default=None, max_length=1000)


@router.post("/opportunities/{offer_id}/apply")
def apply(offer_id: str, body: ApplyIn, user: CurrentUser = Depends(student)) -> dict:
    facts = get_facts(user.id)
    if not any(o["id"] == offer_id and o["match"] == "eligible" for o in svc.offers_for_student(facts, limit=200)):
        raise HTTPException(400, "This is not open to you, or more answers are needed first.")
    return svc.apply(user.id, offer_id, body.note)
