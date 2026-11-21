"""Student facts: one JSON object keyed by the names in shared/rules/fields.json."""

from __future__ import annotations

from datetime import date

from app.core.db import get_db
from app.services.catalogue import fields

# Facts the matcher uses that are not scheme-rule fields.
EXTRA_FACTS = {"interests", "subjects", "needs_income_soon", "can_relocate", "district", "stage", "date_of_birth",
               "skills", "hours_per_week", "has_family_business", "can_travel_km"}


def allowed_fact(name: str) -> bool:
    return name in fields() or name in EXTRA_FACTS


def clean_facts(raw: dict) -> dict:
    """Keep known facts only; drop None so 'unknown' stays unknown."""
    return {k: v for k, v in raw.items() if allowed_fact(k) and v is not None}


def _age(dob: str | None) -> int | None:
    if not dob:
        return None
    d = date.fromisoformat(dob)
    t = date.today()
    return t.year - d.year - ((t.month, t.day) < (d.month, d.day))


def get_facts(user_id: str) -> dict:
    db = get_db()
    row = db.table("student_profiles").select("facts").eq("user_id", user_id).maybe_single().execute()
    facts = dict((row.data or {}).get("facts") or {}) if row else {}
    if "age" not in facts and facts.get("date_of_birth"):
        facts["age"] = _age(facts["date_of_birth"])
    return facts


LIST_FACTS = {"interests", "subjects", "skills"}


def merge_facts(user_id: str, patch: dict, replace_lists: bool = False) -> dict:
    """Merge new facts in atomically. Lists (interests, subjects) grow unless replace_lists is set.
    An explicit null means "forget this fact"."""
    incoming = clean_facts(patch)
    remove = [k for k, v in patch.items() if v is None and allowed_fact(k)]
    res = get_db().rpc("merge_student_facts", {
        "p_user": user_id, "p_set": incoming, "p_remove": remove, "p_append_lists": not replace_lists,
    }).execute()
    facts = dict(res.data or {})
    if "age" not in facts and facts.get("date_of_birth"):
        facts["age"] = _age(facts["date_of_birth"])
    return facts
