from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.core.auth import CurrentUser, require_role
from app.services import plans as svc
from app.services.roadmap import record_event

router = APIRouter(tags=["plans"])
student = require_role("student")


class SaveIn(BaseModel):
    career: str
    save: bool = True


class PlanIn(BaseModel):
    career: str
    program: str | None = None


class StepIn(BaseModel):
    done: bool


@router.get("/me/saved")
def saved(user: CurrentUser = Depends(student)) -> dict:
    return {"saved": svc.saved(user.id), "plans": svc.list_plans(user.id)}


@router.post("/me/saved")
def save(body: SaveIn, user: CurrentUser = Depends(student)) -> dict:
    try:
        out = {"saved": svc.save_career(user.id, body.career, body.save)}
    except ValueError as e:
        raise HTTPException(404, str(e)) from e
    if body.save:
        record_event(user.id, "career_saved", body.career)
    return out


@router.post("/me/plans")
def create(body: PlanIn, user: CurrentUser = Depends(student)) -> dict:
    try:
        return svc.create_plan(user.id, body.career, body.program)
    except ValueError as e:
        raise HTTPException(404, str(e)) from e


@router.get("/me/plans/{plan_id}")
def read(plan_id: str, user: CurrentUser = Depends(student)) -> dict:
    return svc.get_plan(user.id, plan_id)


@router.patch("/me/plans/{plan_id}/steps/{step_id}")
def step(plan_id: str, step_id: str, body: StepIn, user: CurrentUser = Depends(student)) -> dict:
    return svc.set_step(user.id, plan_id, step_id, body.done)


@router.delete("/me/plans/{plan_id}", status_code=204)
def delete(plan_id: str, user: CurrentUser = Depends(student)) -> None:
    svc.delete_plan(user.id, plan_id)
