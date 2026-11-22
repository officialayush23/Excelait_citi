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


# ---------------- rights of an adult worker (18+) and minimum wage ----------------

LANGS = ("en", "hi", "mr")


@lru_cache
def rights_doc() -> dict:
    return json.loads((SHARED / "rules" / "employment_rights.json").read_text(encoding="utf-8"))


@lru_cache
def wages_doc() -> dict:
    return json.loads((SHARED / "rules" / "minimum_wages.json").read_text(encoding="utf-8"))


def _state_key(state) -> str:
    return " ".join(str(state or "").lower().replace("_", " ").split())


def minimum_wage(state, skill: str = "unskilled") -> dict | None:
    """The lowest state minimum wage for this skill level, or None when we hold no usable figure.
    UP has several area rates; the lowest is returned so a warning never wrongly accuses an employer.
    Maharashtra sets wages per scheduled employment, so there is no single figure (None)."""
    st = wages_doc()["states"].get(_state_key(state))
    if not st or not st.get("zones"):
        return None
    skill = (skill or "unskilled").lower().replace("-", "_").replace(" ", "_")
    zones = st["zones"]
    pick = zones.get(st.get("lowest_zone")) or {}
    monthly = pick.get(skill)
    if monthly is None:
        return None
    return {
        "per_day": round(monthly / wages_doc()["monthly_divisor"], 2),
        "per_month": monthly,
        "effective_from": st["effective_from"],
        "valid_until": st.get("valid_until"),
        "source": st["sources"][0]["url"],
        "verified": bool(st.get("verified")),
        "zone": st.get("lowest_zone"),
        "state": st["name"],
        "skill": skill,
    }


def employment_rights(age: int | None, state: str | None, lang: str = "en") -> dict:
    """Card payload for 'your rights at work' (18+). Under 18 gets no rights list: the age rules apply."""
    d = rights_doc()
    lang = lang if lang in LANGS else "en"
    band_ = band(age)
    minor = band_ in ("child", "adolescent")
    rights = [] if minor else [r for r in d["rights"] if not isinstance(age, (int, float)) or age >= r["min_age"]]
    used = list(dict.fromkeys(s for r in rights for s in r["sources"]))
    mw = None if minor else minimum_wage(state, "unskilled")
    st = wages_doc()["states"].get(_state_key(state))
    return {
        "age": int(age) if isinstance(age, (int, float)) else None,
        "band": band_,
        "minor": minor,
        "state": st["name"] if st else (state or None),
        "lang": lang,
        "rights": [{"id": r["id"], "topic": r["topic"], "text": r["text"], "text_lang": r["text"].get(lang) or r["text"]["en"],
                    "numbers": r.get("numbers") or {}, "verified": bool(r.get("verified")), "policy": bool(r.get("policy")),
                    "sources": r["sources"]} for r in rights],
        "minimum_wage": mw,
        "minimum_wage_note": None if mw or minor else ("state_sets_per_employment" if st and not st.get("zones") else "not_available"),
        "helplines": [] if minor else [h for h in d["helplines"] if h.get("number") or h.get("url")],
        "law_status": {"in_force_from": d["law_status"]["in_force_from"], "summary": d["law_status"]["summary"]},
        "sources": [{"id": s, "title": d["sources"][s]["title"], "url": d["sources"][s]["url"],
                     "publisher": d["sources"][s].get("publisher"), "policy": bool(d["sources"][s].get("policy"))} for s in used],
        "checked_on": d["checked_on"],
    }
