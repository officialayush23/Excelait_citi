"""Student facts: one JSON object keyed by the names in shared/rules/fields.json, plus where each fact came
from (facts_meta, migration 0017): who saved it (onboarding, Saathi, a teacher, the interest quiz or the
system), when, and for Saathi the words of the message it was read from."""

from __future__ import annotations

import logging
from datetime import date, datetime, timezone

from app.core.db import get_db
from app.services.catalogue import fields
from app.services.profile_questions import clean_riasec

log = logging.getLogger("students")

# Facts the matcher and the question planner use that are not scheme-rule fields.
EXTRA_FACTS = {"interests", "subjects", "needs_income_soon", "can_relocate", "district", "stage", "date_of_birth",
               "skills", "hours_per_week", "has_family_business", "can_travel_km",
               "plan_after_10", "stream", "exam_interest", "course_year", "qualification", "work_experience", "riasec"}
SOURCES = ("onboarding", "saathi", "teacher", "quiz", "system")
NOTE_MAX = 200


def allowed_fact(name: str) -> bool:
    return name in fields() or name in EXTRA_FACTS


def clean_facts(raw: dict) -> dict:
    """Keep known facts only; drop None so 'unknown' stays unknown."""
    out = {k: v for k, v in raw.items() if allowed_fact(k) and v is not None}
    if "riasec" in out:
        r = clean_riasec(out["riasec"])
        if r is None:
            out.pop("riasec")
        else:
            out["riasec"] = r
    return out


def _age(dob: str | None) -> int | None:
    if not dob:
        return None
    d = date.fromisoformat(dob)
    t = date.today()
    return t.year - d.year - ((t.month, t.day) < (d.month, d.day))


def _with_age(facts: dict) -> dict:
    if "age" not in facts and facts.get("date_of_birth"):
        facts["age"] = _age(facts["date_of_birth"])
    return facts


def get_facts(user_id: str) -> dict:
    db = get_db()
    row = db.table("student_profiles").select("facts").eq("user_id", user_id).maybe_single().execute()
    facts = dict((row.data or {}).get("facts") or {}) if row else {}
    return _with_age(facts)


# Until migration 0017 is applied the database has no facts_meta column and the merge function takes
# no p_meta; facts still save, provenance is simply not kept.
_meta_ok: dict[str, bool] = {}


def get_profile_row(user_id: str) -> tuple[dict, dict, str | None]:
    """(facts, facts_meta, updated_at)."""
    db = get_db()
    if _meta_ok.get("column", True):
        try:
            row = db.table("student_profiles").select("facts, facts_meta, updated_at").eq("user_id", user_id).maybe_single().execute()
            data = (row.data if row else None) or {}
            return _with_age(dict(data.get("facts") or {})), dict(data.get("facts_meta") or {}), data.get("updated_at")
        except Exception as e:  # noqa: BLE001 - column missing before 0017
            if "facts_meta" not in str(e):
                raise
            _meta_ok["column"] = False
            log.warning("student_profiles.facts_meta missing; apply migration 0017")
    row = db.table("student_profiles").select("facts, updated_at").eq("user_id", user_id).maybe_single().execute()
    data = (row.data if row else None) or {}
    return _with_age(dict(data.get("facts") or {})), {}, data.get("updated_at")


def make_meta(keys: list[str], source: str, note: str | None = None, at: str | None = None) -> dict:
    src = source if source in SOURCES else "system"
    at = at or datetime.now(timezone.utc).isoformat(timespec="seconds")
    n = (note or "").strip()[:NOTE_MAX] or None
    return {k: {"source": src, "at": at, "note": n} for k in keys}


LIST_FACTS = {"interests", "subjects", "skills"}


def merge_facts(user_id: str, patch: dict, replace_lists: bool = False, source: str = "system", note: str | None = None) -> dict:
    """Merge new facts in atomically. Lists (interests, subjects, skills) grow unless replace_lists is set.
    An explicit null means "forget this fact". Each fact set records its source, time and note."""
    incoming = clean_facts(patch)
    remove = [k for k, v in patch.items() if v is None and allowed_fact(k)]
    args = {"p_user": user_id, "p_set": incoming, "p_remove": remove, "p_append_lists": not replace_lists}
    db = get_db()
    res = None
    if _meta_ok.get("rpc", True):
        try:
            res = db.rpc("merge_student_facts", {**args, "p_meta": make_meta(list(incoming), source, note)}).execute()
        except Exception as e:  # noqa: BLE001 - p_meta unknown before 0017
            if "p_meta" not in str(e) and "PGRST202" not in str(e) and "merge_student_facts" not in str(e):
                raise
            _meta_ok["rpc"] = False
            log.warning("merge_student_facts has no p_meta; apply migration 0017")
    if res is None:
        res = db.rpc("merge_student_facts", args).execute()
    return _with_age(dict(res.data or {}))


def delete_fact(user_id: str, key: str) -> dict:
    """Forget one fact and where it came from. Age goes with the date of birth it may be worked out from."""
    remove = [key, "date_of_birth"] if key == "age" else [key]
    args = {"p_user": user_id, "p_set": {}, "p_remove": remove, "p_append_lists": False}
    res = get_db().rpc("merge_student_facts", args).execute()  # p_meta defaults to null; 0017 drops the key's meta too
    return _with_age(dict(res.data or {}))
