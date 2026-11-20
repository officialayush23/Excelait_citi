from fastapi import APIRouter, Depends

from app.core.auth import CurrentUser, get_current_user
from app.core.db import get_db

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("")
def mine(user: CurrentUser = Depends(get_current_user)) -> dict:
    rows = get_db().table("notifications").select("id, kind, title, body, link, read_at, created_at") \
        .eq("user_id", user.id).order("created_at", desc=True).limit(50).execute().data
    return {"notifications": rows, "unread": sum(1 for r in rows if not r["read_at"])}


@router.post("/read")
def read_all(user: CurrentUser = Depends(get_current_user)) -> dict:
    get_db().table("notifications").update({"read_at": "now()"}).eq("user_id", user.id).is_("read_at", "null").execute()
    return {"ok": True}
