"""Adaptive profile questions, shared by onboarding and Saathi.

The questions live in shared/rules/questions.json; frontend/src/engine/questions.ts runs the same
file on the phone when there is no network, and shared/rules/question_fixtures.json keeps the two
in step. The planner never asks what is already known (whoever saved it) and never asks what does
not fit the student: job skills are asked only of students old enough who need to earn, the
stream only in Class 11-12, the year of course only in college, experience only of job seekers.
"""

from __future__ import annotations

import json
import math
from datetime import date
from functools import lru_cache
from typing import Any, Iterable

from app.services.catalogue import SHARED

SCHOOL = ("c8", "c9", "c10", "c11", "c12")
COLLEGE = ("iti", "diploma", "ug_degree", "ug_technical", "pg")
RIASEC = "RIASEC"
LANGS = ("en", "hi", "mr")


@lru_cache
def doc() -> dict:
    return json.loads((SHARED / "rules" / "questions.json").read_text(encoding="utf-8"))


def questions() -> list[dict]:
    return doc()["questions"]


def by_field() -> dict[str, dict]:
    return {q["field"]: q for q in questions()}


def quiz() -> dict:
    return doc()["interest_quiz"]


def _age_from_dob(dob: str | None) -> int | None:
    try:
        d = date.fromisoformat(str(dob))
    except (TypeError, ValueError):
        return None
    t = date.today()
    return t.year - d.year - ((t.month, t.day) < (d.month, d.day))


def derive_stage(facts: dict) -> str | None:
    if facts.get("stage"):
        return facts["stage"]
    course, level = facts.get("course"), facts.get("class_level")
    if isinstance(level, (int, float)) and level <= 12 and course in (None, "school"):
        return f"c{int(level)}" if 8 <= level <= 12 else None
    if course in COLLEGE:
        return course
    if course == "none":
        return "not_studying"
    return None


def view(facts: dict, intent: str | None = None) -> dict:
    """Facts plus the derived values conditions may read."""
    v = dict(facts or {})
    if v.get("age") is None and v.get("date_of_birth"):
        v["age"] = _age_from_dob(v["date_of_birth"])
    stage = derive_stage(v)
    v["stage"] = stage
    age = v.get("age")
    v["school"] = stage in SCHOOL
    v["college"] = stage in COLLEGE
    v["job_seeker"] = stage == "job_seeker" or (stage == "not_studying" and isinstance(age, (int, float)) and age >= 18)
    v["intent"] = intent
    v["earning"] = v.get("needs_income_soon") is True or v["job_seeker"] or intent in ("earn", "jobs")
    return v


def _round(x: float) -> int:
    """Halves round up, as Math.round does on the phone."""
    return int(math.floor(x + 0.5))


def _has(v: Any) -> bool:
    return v is not None and v != "" and v != []


def cond(c: dict | list, v: dict) -> bool:
    if isinstance(c, list):
        return all(cond(x, v) for x in c)
    if "all" in c:
        return all(cond(x, v) for x in c["all"])
    if "any" in c:
        return any(cond(x, v) for x in c["any"])
    if "not" in c:
        return not cond(c["not"], v)
    val, op, want = v.get(c["fact"]), c["op"], c.get("value")
    if op == "known":
        return _has(val)
    if op == "unknown":
        return not _has(val)
    if op == "is_true":
        return val is True
    if op == "is_false":
        return val is False
    if op == "ne":
        return val != want
    if op == "not_in":
        return val not in want
    if val is None:
        return False
    if op == "eq":
        return val == want
    if op == "in":
        return val in want
    if not isinstance(val, (int, float)) or isinstance(val, bool):
        return False
    return {"lt": val < want, "lte": val <= want, "gt": val > want, "gte": val >= want}[op]


def is_known(field: str, v: dict) -> bool:
    if field == "stage":
        return _has(v.get("stage"))
    return _has(v.get(field))


def applies(q: dict, v: dict) -> bool:
    return cond(q.get("applies_if") or [], v)


def variant(q: dict, v: dict) -> dict:
    """The question with its matching variant's text and options merged in."""
    for var in q.get("variants") or []:
        if cond(var.get("applies_if") or [], v):
            return {**q, **{k: val for k, val in var.items() if k != "applies_if"}, "variant": var.get("id")}
    return q


def tier(q: dict, v: dict) -> str:
    return "core" if q["tier"] == "core" or (q.get("core_if") and cond(q["core_if"], v)) else "more"


def pending(facts: dict, *, intent: str | None = None, skip: Iterable[str] = (), include_sensitive: bool = True) -> list[dict]:
    """Unknown questions that fit this student, core first, then by priority."""
    v = view(facts, intent)
    skip = set(skip)
    out = [q for q in questions() if q["field"] not in skip and not is_known(q["field"], v) and applies(q, v)
           and (include_sensitive or not q.get("sensitive"))]
    out.sort(key=lambda q: (tier(q, v) != "core", -q["priority"], q["field"]))
    return out


def _text(t: dict | None, lang: str) -> str | None:
    if not t:
        return None
    return t.get(lang) or t.get("en")


def payload(q: dict, facts: dict, lang: str = "en", intent: str | None = None) -> dict:
    v = view(facts, intent)
    q = variant(q, v)
    opts = [o for o in q.get("options") or [] if cond(o.get("applies_if") or [], v)]
    out = {
        "id": q["field"] + (f":{q['variant']}" if q.get("variant") else ""), "field": q["field"], "type": q["type"],
        "tier": tier(q, v), "text": _text(q.get("text"), lang), "hint": _text(q.get("hint"), lang), "why": _text(q.get("why"), lang),
        "sensitive": bool(q.get("sensitive")), "skippable": True,
        "options": [{"value": o["value"], "label": _text(o["label"], lang), **({"sets": o["sets"]} if o.get("sets") else {})} for o in opts],
    }
    for k in ("min", "max", "max_select"):
        if k in q:
            out[k] = q[k]
    return out


def quiz_done(facts: dict) -> bool:
    r = facts.get("riasec")
    return isinstance(r, dict) and any(k in r for k in RIASEC)


def completeness(facts: dict, lang: str = "en", intent: str | None = None) -> dict:
    """Share of the questions that fit this student (sensitive ones aside) already answered, plus the quiz."""
    v = view(facts, intent)
    fit = [q for q in questions() if not q.get("sensitive") and applies(q, v)]
    done = sum(1 for q in fit if is_known(q["field"], v)) + (1 if quiz_done(facts) else 0)
    total = len(fit) + 1
    nxt = [{"field": q["field"], "why": _text(variant(q, v).get("why"), lang)} for q in pending(facts, intent=intent, include_sensitive=False)[:3]]
    return {"pct": _round(100 * done / total) if total else 100, "next": nxt}


def next_questions(facts: dict, context: str = "onboarding", limit: int = 1, *, lang: str = "en", intent: str | None = None,
                   skip: Iterable[str] = ()) -> dict:
    """The next best question(s). Saathi never asks sensitive facts on its own; the money cards do, gently."""
    todo = pending(facts, intent=intent, skip=skip, include_sensitive=context != "saathi")
    v = view(facts, intent)
    phase = tier(todo[0], v) if todo else "done"
    return {
        "context": context, "phase": phase,
        "questions": [payload(q, facts, lang, intent) for q in todo[:max(0, limit)]],
        "remaining": {"core": sum(1 for q in todo if tier(q, v) == "core"), "more": sum(1 for q in todo if tier(q, v) == "more")},
        "quiz_done": quiz_done(facts),
        "completeness": completeness(facts, lang, intent),
    }


def fits(field: str, facts: dict, intent: str | None = None) -> bool:
    """Whether a fact is worth asking this student at all. Facts the planner has no question for always fit."""
    q = by_field().get(field)
    return True if q is None else applies(q, view(facts, intent))


def apply_answer(field: str, value: Any, facts: dict | None = None) -> dict:
    """The facts patch for one answer: the value plus whatever the chosen option sets (stage -> class and course)."""
    patch: dict = {field: value}
    q = by_field().get(field)
    if not q:
        return patch
    v = view(facts or {})
    q = variant(q, v)
    picked = value if isinstance(value, list) else [value]
    for o in q.get("options") or []:
        if o["value"] in picked and o.get("sets"):
            for k, sv in o["sets"].items():
                if isinstance(sv, list) and isinstance(patch.get(k), list):
                    patch[k] = list(dict.fromkeys([*patch[k], *sv]))
                else:
                    patch[k] = sv
    return patch


# ---------------------------------------------------------------- interest quiz (RIASEC)

def score_quiz(answers: dict[str, int]) -> dict[str, int]:
    """like=2, not sure=1, dislike=0; each type's total as a percent of its maximum. Unanswered items count as 'not sure'."""
    items = quiz()["items"]
    out = {}
    for code in RIASEC:
        mine = [i for i in items if i["code"] == code]
        got = sum(min(2, max(0, int(answers.get(i["id"], 1)))) for i in mine)
        out[code] = _round(100 * got / (2 * len(mine))) if mine else 0
    return out


def clean_riasec(raw: Any) -> dict[str, int] | None:
    if not isinstance(raw, dict):
        return None
    out = {}
    for k in RIASEC:
        x = raw.get(k)
        if isinstance(x, (int, float)) and not isinstance(x, bool):
            out[k] = int(max(0, min(100, _round(x))))
    return out if len(out) == 6 else None


# ---------------------------------------------------------------- labels for the profile

def label(key: str) -> dict:
    q = by_field().get(key)
    if q and q.get("label"):
        return q["label"]
    fl = doc()["fact_labels"].get(key)
    if fl:
        return fl["label"]
    return {"en": key.replace("_", " ").capitalize()}


def group(key: str) -> str:
    q = by_field().get(key)
    if q and q.get("group"):
        return q["group"]
    fl = doc()["fact_labels"].get(key)
    return fl["group"] if fl else "personal"


def sensitive(key: str) -> bool:
    q = by_field().get(key)
    return bool(q and q.get("sensitive")) or key in doc()["sensitive_facts"]


def type_labels() -> dict:
    return {k: v["label"] for k, v in quiz()["types"].items()}
