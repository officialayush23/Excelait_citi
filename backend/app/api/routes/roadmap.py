"""The student's adaptive roadmap: goals, steps, the changelog with undo, the watchlist and activity events."""

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.core.auth import CurrentUser, require_role
from app.services import roadmap as svc
from app.services.roadmap_engine import CLIENT_EVENTS

router = APIRouter(prefix="/roadmap", tags=["roadmap"])
student = require_role("student")


def _run(fn, *a, **kw):
    try:
        return fn(*a, **kw)
    except LookupError as e:
        raise HTTPException(404, str(e)) from e
    except ValueError as e:  # RoadmapError and unknown slugs
        raise HTTPException(422, str(e)) from e


class GoalIn(BaseModel):
    kind: Literal["career", "program", "exam", "scheme", "job", "custom"]
    career: str | None = None
    program: str | None = None
    exam: str | None = None
    scheme: str | None = None
    title: str | None = Field(default=None, max_length=120)
    target_date: str | None = None
    role: str | None = Field(default=None, max_length=60)
    place: str | None = Field(default=None, max_length=60)


class GoalPatch(BaseModel):
    title: str | None = Field(default=None, max_length=120)
    status: Literal["active", "paused", "done"] | None = None
    target_date: str | None = None
    priority: int | None = Field(default=None, ge=0, le=9)


class SubtaskIn(BaseModel):
    id: str
    done: bool


class StepPatch(BaseModel):
    status: Literal["todo", "doing", "done", "skipped", "blocked"] | None = None
    progress: int | None = Field(default=None, ge=0, le=100)
    subtask: SubtaskIn | None = None
    due_date: str | None = None


class WatchIn(BaseModel):
    kind: Literal["job", "exam", "scheme"]
    ref: str | None = Field(default=None, max_length=120)
    role: str | None = Field(default=None, max_length=60)
    place: str | None = Field(default=None, max_length=60)


class EventIn(BaseModel):
    kind: str
    ref: str | None = Field(default=None, max_length=300)
    meta: dict = Field(default_factory=dict)


@router.get("")
def read(user: CurrentUser = Depends(student)) -> dict:
    return svc.get_roadmap(user.id)


@router.get("/preview")
def preview(user: CurrentUser = Depends(student)) -> dict:
    return svc.preview(user.id)


@router.post("/goals", status_code=201)
def add_goal(body: GoalIn, user: CurrentUser = Depends(student)) -> dict:
    return _run(svc.add_goal, user.id, **body.model_dump())


@router.patch("/goals/{goal_id}")
def update_goal(goal_id: str, body: GoalPatch, user: CurrentUser = Depends(student)) -> dict:
    return _run(svc.update_goal, user.id, goal_id, body.model_dump(exclude_none=True))


@router.delete("/goals/{goal_id}", status_code=204)
def delete_goal(goal_id: str, user: CurrentUser = Depends(student)) -> None:
    svc.delete_goal(user.id, goal_id)


@router.patch("/steps/{step_id}")
def update_step(step_id: str, body: StepPatch, user: CurrentUser = Depends(student)) -> dict:
    return _run(svc.update_step, user.id, step_id, body.status, body.progress,
                body.subtask.model_dump() if body.subtask else None, body.due_date)


@router.post("/changes/{change_id}/undo")
def undo(change_id: str, user: CurrentUser = Depends(student)) -> dict:
    return _run(svc.undo_change, user.id, change_id)


@router.post("/easier")
def easier(user: CurrentUser = Depends(student)) -> dict:
    """'This is too much': smaller next steps."""
    _run(svc.ease, user.id)
    return svc.get_roadmap(user.id, evaluate_first=False)


@router.get("/watches")
def watches(user: CurrentUser = Depends(student)) -> dict:
    return {"watches": svc.list_watches(user.id)}


@router.post("/watches", status_code=201)
def add_watch(body: WatchIn, user: CurrentUser = Depends(student)) -> dict:
    query = {"role": body.role or body.ref, "place": body.place} if body.kind == "job" else None
    return _run(svc.add_watch, user.id, body.kind, body.ref, query)


@router.delete("/watches/{watch_id}", status_code=204)
def delete_watch(watch_id: str, user: CurrentUser = Depends(student)) -> None:
    svc.delete_watch(user.id, watch_id)


@router.post("/events", status_code=202)
def event(body: EventIn, user: CurrentUser = Depends(student)) -> dict:
    """Things the app sees on its own (a scheme or job opened). Work done elsewhere is recorded by its own route."""
    if body.kind not in CLIENT_EVENTS:
        raise HTTPException(422, "This event is recorded by the server.")
    svc.record_event(user.id, body.kind, body.ref, {k: v for k, v in body.meta.items() if isinstance(v, (str, int, float, bool))})
    return {"ok": True}
