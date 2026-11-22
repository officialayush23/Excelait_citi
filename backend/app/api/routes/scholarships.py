from fastapi import APIRouter, Depends

from app.core.auth import CurrentUser, require_role
from app.services import scholarships as svc
from app.services.students import get_facts

router = APIRouter(prefix="/scholarships", tags=["scholarships"])
student = require_role("student")


@router.get("/for-me")
def for_me(user: CurrentUser = Depends(student)) -> dict:
    """Scholarships found on Buddy4Study and official portals, matched to the signed-in student's facts.
    The verified government schemes stay on the Money page (fixed rules); this is the second tier."""
    res = svc.discover(get_facts(user.id))
    return {k: res[k] for k in ("found", "counts", "ask", "checked_on", "sites", "from_store")}
