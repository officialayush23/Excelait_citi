from fastapi import APIRouter, Response

from app.services import catalogue as cat

router = APIRouter(prefix="/catalogue", tags=["catalogue"])


@router.get("")
def read_catalogue(response: Response) -> dict:
    """Everything the phone needs to work offline: careers, schemes with rules, exams, documents, fact fields."""
    response.headers["Cache-Control"] = "public, max-age=300"
    return {
        "careers": cat.careers(),
        "schemes": cat.schemes_with_rules(active_only=False),
        "exams": cat.exams(),
        "document_types": cat.document_types(),
        "fields": cat.fields(),
    }
