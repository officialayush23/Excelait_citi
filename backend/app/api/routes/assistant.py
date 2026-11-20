import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.core.auth import CurrentUser, require_role
from app.services import assistant as svc
from app.services.web_search import web_search

router = APIRouter(prefix="/assistant", tags=["assistant"])
student = require_role("student")


class ChatIn(BaseModel):
    message: str = Field(min_length=1, max_length=1000)
    language: str = "en"
    thread_id: str | None = None


@router.post("/chat")
def chat(body: ChatIn, user: CurrentUser = Depends(student)) -> dict:
    try:
        return svc.chat(user.id, user.roles, body.message, body.language, body.thread_id)
    except Exception as e:
        logging.getLogger("assistant").exception("chat failed")
        raise HTTPException(502, "Saathi is not reachable right now. Your saved plans and pages still work.") from e


@router.get("/threads")
def threads(user: CurrentUser = Depends(student)) -> dict:
    return {"threads": svc.threads(user.id)}


@router.get("/threads/{thread_id}")
def thread(thread_id: str, user: CurrentUser = Depends(student)) -> dict:
    return {"messages": svc.thread_messages(user.id, thread_id)}


@router.get("/search")
def search(q: str, user: CurrentUser = Depends(student)) -> dict:
    return web_search(q)
