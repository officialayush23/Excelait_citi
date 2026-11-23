from fastapi import APIRouter, Depends

from app.core.auth import CurrentUser, get_current_user
from app.services import insights as svc

router = APIRouter(tags=["insights"])


@router.get("/insights/demand-supply")
def demand_supply(_user: CurrentUser = Depends(get_current_user)) -> dict:
    """Aggregate counts only (no student is identifiable): students per career category vs opportunities we hold."""
    return svc.demand_supply()
