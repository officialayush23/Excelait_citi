"""What Indian law allows a working student of a given age. Fixed rules from
shared/rules/minor_work.json (each with its source), never decided by the model."""

from __future__ import annotations

import json
from functools import lru_cache

from app.services.catalogue import SHARED


@lru_cache
def doc() -> dict:
    return json.loads((SHARED / "rules" / "minor_work.json").read_text(encoding="utf-8"))


@lru_cache
def career_meta() -> dict[str, dict]:
    """Per-career fields kept in the catalogue file but not in the database: age limits and sources."""
    data = json.loads((SHARED / "catalogue" / "careers.json").read_text(encoding="utf-8"))
    keys = ("min_age", "hazardous_for_minors", "minor_basis", "sources", "checked_on", "pay_status")
    return {c["slug"]: {k: c[k] for k in keys if k in c} for c in data["careers"]}


def is_minor(age) -> bool:
    return isinstance(age, (int, float)) and age < 18


def band(age) -> str:
    if not isinstance(age, (int, float)):
        return "unknown"
    return "child" if age < 14 else "adolescent" if age < 18 else "adult"


def _source(sid: str) -> dict:
    s = doc()["sources"][sid]
    return {"id": sid, "title": s["title"], "url": s["url"], "publisher": s.get("publisher"), "policy": bool(s.get("policy"))}


def work_rules(age) -> dict:
    """Allowed / not allowed / limits for this age, each with its sources."""
    d = doc()
    if not isinstance(age, (int, float)):
        return {"age": None, "band": "unknown", "rules": [], "sources": [], "checked_on": d["checked_on"]}
    a = int(age)
    rules = [r for r in d["rules"] if r["min_age"] <= a <= r["max_age"]]
    used = list(dict.fromkeys(s for r in rules for s in r["sources"]))
    return {
        "age": a,
        "band": band(a),
        "rules": [{"id": r["id"], "kind": r["kind"], "text": r["text"], "policy": bool(r.get("policy")), "sources": r["sources"]} for r in rules],
        "sources": [_source(s) for s in used],
        "checked_on": d["checked_on"],
        "can_apprentice": a >= d["apprentice_min_age"],
        "can_skill_training": a >= d["skill_training_min_age"],
        "can_take_jobs": a >= d["jobs_min_age"],
    }


def career_age_status(slug: str, age) -> str:
    """'now' if the student may start on this path now; 'after_<n>' if it must wait (minors only)."""
    if not is_minor(age):
        return "now"
    m = career_meta().get(slug, {})
    need = max(m.get("min_age") or 0, 18 if m.get("hazardous_for_minors") else 0)
    return f"after_{need}" if need > age else "now"


def summary(age) -> str:
    """A compact line for the model."""
    w = work_rules(age)
    if w["band"] == "unknown":
        return "age unknown"
    if w["band"] == "adult":
        return f"age {w['age']}: adult, jobs allowed"
    return (f"age {w['age']} ({w['band']}): " + ("no paid job; only unpaid non-hazardous family help after school, max 3 h/day"
            if w["band"] == "child" else "only non-hazardous work, max 6 h spread/day, not 7pm-8am")
            + f"; apprenticeship {'yes (non-hazardous trades)' if w['can_apprentice'] else 'no'}"
            + f"; skill training {'yes' if w['can_skill_training'] else 'from 15'}; jobs from 18; no driving, construction, welding, garages")
