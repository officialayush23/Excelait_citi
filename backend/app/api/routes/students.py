from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from app.core.auth import CurrentUser, require_role
from app.core.db import get_db
from app.engine.matching import rank
from app.engine.rules import evaluate
from app.services import catalogue as cat
from app.services.students import get_facts, merge_facts

router = APIRouter(tags=["students"])
student = require_role("student")


class FactsPatch(BaseModel):
    facts: dict
    replace_lists: bool = False  # the app's own editors send the full list


@router.get("/students/me/facts")
def read_facts(user: CurrentUser = Depends(student)) -> dict:
    return {"facts": get_facts(user.id)}


@router.patch("/students/me/facts")
def update_facts(body: FactsPatch, user: CurrentUser = Depends(student)) -> dict:
    return {"facts": merge_facts(user.id, body.facts, body.replace_lists)}


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
