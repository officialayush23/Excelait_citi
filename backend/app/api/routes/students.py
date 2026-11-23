from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.core.auth import CurrentUser, require_role
from app.core.db import get_db
from app.engine.matching import rank
from app.engine.rules import evaluate
from app.services import catalogue as cat
from app.services import profile as profile_svc
from app.services import profile_questions as pq
from app.services.students import delete_fact, get_facts, merge_facts

router = APIRouter(tags=["students"])
student = require_role("student")


class FactsPatch(BaseModel):
    facts: dict
    replace_lists: bool = False  # the app's own editors send the full list
    # Where the answer was given: the onboarding screens and profile page, the interest quiz, or a
    # question card in a Saathi chat. 'teacher' and 'system' are set only by the server.
    source: Literal["onboarding", "quiz", "saathi"] = "onboarding"
    note: str | None = Field(default=None, max_length=200)


@router.get("/students/me/facts")
def read_facts(user: CurrentUser = Depends(student)) -> dict:
    return {"facts": get_facts(user.id)}


@router.patch("/students/me/facts")
def update_facts(body: FactsPatch, user: CurrentUser = Depends(student)) -> dict:
    facts = merge_facts(user.id, body.facts, body.replace_lists, source=body.source, note=body.note)
    try:  # answers move the roadmap too (quiz done, a fact a step was waiting on)
        from app.services.roadmap import record_event
        record_event(user.id, "riasec_done" if "riasec" in body.facts else "fact_answered", ",".join(sorted(body.facts))[:120])
    except Exception:  # noqa: BLE001 - saving facts must never fail because of the roadmap
        pass
    return {"facts": facts}


@router.delete("/students/me/facts/{key}")
def remove_fact(key: str, user: CurrentUser = Depends(student)) -> dict:
    if not key or len(key) > 60:
        raise HTTPException(status_code=400, detail="bad fact key")
    return {"facts": delete_fact(user.id, key)}


@router.get("/students/me/next-questions")
def next_questions(
    context: Literal["onboarding", "saathi"] = "onboarding",
    limit: int = Query(default=1, ge=0, le=10),
    lang: Literal["en", "hi", "mr"] = "en",
    intent: str | None = Query(default=None, max_length=30),
    skip: str = Query(default="", max_length=600, description="comma-separated fields the student skipped"),
    user: CurrentUser = Depends(student),
) -> dict:
    """The next question(s) worth asking this student, with text, options and why-text in their language."""
    skipped = [s for s in skip.split(",") if s][:30]
    return pq.next_questions(get_facts(user.id), context, limit, lang=lang, intent=intent, skip=skipped)


@router.get("/students/me/profile")
def my_profile(lang: Literal["en", "hi", "mr"] = "en", user: CurrentUser = Depends(student)) -> dict:
    return profile_svc.build(user.id, lang)


@router.post("/eligibility/check")
def check_eligibility(user: CurrentUser = Depends(student)) -> dict:
    """Runs every active scheme's rule on the student's facts. The AI is never involved."""
    facts = get_facts(user.id)
    results, rows = [], []
    for s in cat.schemes_with_rules():
        out = evaluate(s["rule"], facts)
        results.append({"slug": s["slug"], "rule_version": s["rule_version"], "benefit_amount": s["benefit_amount"], **out.as_dict()})
        rows.append({
            "user_id": user.id, "scheme_id": s["id"], "rule_version": s["rule_version"], "result": out.result,
            "failed_rule": out.failed[0]["id"] if out.failed else None, "missing_fields": out.missing,
        })
    if rows:
        get_db().table("scheme_checks").upsert(rows, on_conflict="user_id,scheme_id").execute()
    eligible_total = sum(r["benefit_amount"] or 0 for r in results if r["result"] == "eligible")
    return {"results": results, "eligible_rupees": eligible_total}


@router.get("/careers/matches")
def career_matches(
    can_relocate: bool | None = Query(default=None, description="What-if override"),
    needs_income_soon: bool | None = Query(default=None, description="What-if override"),
    user: CurrentUser = Depends(student),
) -> dict:
    facts = get_facts(user.id)
    what_if = {k: v for k, v in {"can_relocate": can_relocate, "needs_income_soon": needs_income_soon}.items() if v is not None}
    careers = cat.careers()
    matches = rank(careers, {**facts, **what_if}, 10)
    if not what_if:  # only the real profile is saved
        ids = {c["slug"]: c for c in get_db().table("careers").select("id, slug").execute().data}
        rows = [{"user_id": user.id, "career_id": ids[m.slug]["id"], "score": m.score, "reasons": m.reasons, "gaps": m.gaps} for m in matches]
        if rows:
            get_db().table("career_matches").upsert(rows, on_conflict="user_id,career_id").execute()
    return {"matches": [m.as_dict() for m in matches], "what_if": what_if}
