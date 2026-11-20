"""Colleges and institutes from the AISHE directory, plus anything their owners add after claiming."""

from __future__ import annotations

from app.core.db import get_db

FIELDS = "aishe_code, name, state, district, location, college_type, management, university, kind, org_id, details"


def search(kind: str | None = None, state: str | None = None, district: str | None = None, q: str | None = None, limit: int = 12) -> list[dict]:
    query = get_db().table("colleges").select(FIELDS)
    if kind:
        query = query.eq("kind", kind)
    if state:
        query = query.ilike("state", state)
    if district:
        query = query.ilike("district", f"%{district}%")
    if q:
        query = query.ilike("name", f"%{q.strip()[:80]}%")
    rows = query.limit(limit * 2).execute().data
    # Claimed (verified) listings and government institutes first.
    rows.sort(key=lambda r: (r["org_id"] is None, "government" not in (r["management"] or "").lower(), r["name"]))
    return rows[:limit]


def count() -> int:
    return get_db().table("colleges").select("aishe_code", count="exact").limit(1).execute().count or 0


def get(aishe_code: str) -> dict | None:
    rows = get_db().table("colleges").select(FIELDS).eq("aishe_code", aishe_code).limit(1).execute().data
    return rows[0] if rows else None
