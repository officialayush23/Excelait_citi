"""The connected catalogue: every item with links to the others, personalised when signed in."""

from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.auth import CurrentUser, get_current_user
from app.services import colleges as col
from app.services.graph import career_card, exam_card, graph, program_card, resources_for, scheme_card
from app.services.roadmap import record_event
from app.services.students import get_facts

router = APIRouter(prefix="/explore", tags=["explore"])


def _404(x):
    if not x:
        raise HTTPException(404, "Not found")
    return x


@router.get("/careers/{slug}")
def career(slug: str, user: CurrentUser = Depends(get_current_user)) -> dict:
    return _404(career_card(slug, get_facts(user.id)))


@router.get("/programs/{slug}")
def program(slug: str, user: CurrentUser = Depends(get_current_user)) -> dict:
    return _404(program_card(slug, get_facts(user.id)))


@router.get("/programs")
def programs() -> dict:
    return {"programs": [program_card(p) for p in graph().programs]}


@router.get("/exams/{slug}")
def exam(slug: str) -> dict:
    return _404(exam_card(slug))


@router.get("/schemes/{slug}")
def scheme(slug: str, user: CurrentUser = Depends(get_current_user)) -> dict:
    card = _404(scheme_card(slug, get_facts(user.id)))
    record_event(user.id, "scheme_viewed", slug)
    return card


@router.get("/resources")
def resources(career: str | None = None, program: str | None = None, exam: str | None = None) -> dict:
    if not (career or program or exam):
        return {"resources": graph().resources}
    cats = [graph().careers[career]["category"]] if career in graph().careers else []
    return {"resources": resources_for([career] if career else [], [program] if program else [], [exam] if exam else [], cats, limit=12)}


@router.get("/colleges")
def colleges(kind: str | None = None, state: str | None = None, district: str | None = None,
             q: str | None = Query(default=None, max_length=80), limit: int = Query(default=20, le=50)) -> dict:
    return {"colleges": col.search(kind, state, district, q, limit), "directory_size": col.count()}


@router.get("/colleges/{aishe_code}")
def college(aishe_code: str) -> dict:
    return _404(col.get(aishe_code))
