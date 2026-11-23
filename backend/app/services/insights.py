"""Demand vs supply per career category, from our own tables. Counts only, every table optional.

Students: a student counts once in a category when one of their interests (an interest tag on at
least one career of that category) or one of their saved careers belongs to it.
Opportunities: partner offerings (career_slugs), and jobs / scholarships we hold in knowledge_items
(matched through their tags to career names). Items that match no category are reported separately.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timezone

from app.core.db import get_db
from app.services import catalogue as cat

log = logging.getLogger(__name__)
ROW_LIMIT = 20000


def _rows(table: str, cols: str, build=None) -> list[dict]:
    try:
        q = get_db().table(table).select(cols)
        if build:
            q = build(q)
        return q.limit(ROW_LIMIT).execute().data or []
    except Exception as e:  # a missing table or an offline database means "none", not an error page
        log.warning("insights: %s unavailable (%s)", table, type(e).__name__)
        return []


def _words(text: str) -> set[str]:
    return {w for w in re.split(r"[^a-z]+", text.lower()) if len(w) >= 4}


def demand_supply(careers: list[dict] | None = None) -> dict:
    careers = careers if careers is not None else cat.careers()
    by_slug = {c["slug"]: c["category"] for c in careers}
    tag_cats: dict[str, set[str]] = {}
    word_cats: dict[str, set[str]] = {}
    for c in careers:
        for t in c.get("interest_tags") or []:
            tag_cats.setdefault(t, set()).add(c["category"])
        for w in _words(c["slug"].replace("-", " ") + " " + c.get("name", "")):
            word_cats.setdefault(w, set()).add(c["category"])

    out = {k: {"category": k, "students": 0, "jobs": 0, "scholarships": 0, "offers": 0} for k in sorted(set(by_slug.values()))}
    student_cats: dict[str, set[str]] = {}

    for r in _rows("student_profiles", "user_id, facts"):
        for tag in (r.get("facts") or {}).get("interests") or []:
            student_cats.setdefault(r["user_id"], set()).update(tag_cats.get(tag, ()))
    for r in _rows("saved_careers", "user_id, career_slug"):
        if r.get("career_slug") in by_slug:
            student_cats.setdefault(r["user_id"], set()).add(by_slug[r["career_slug"]])
    for cats in student_cats.values():
        for k in cats:
            out[k]["students"] += 1

    unmapped = 0
    now = datetime.now(timezone.utc).isoformat()
    for r in _rows("knowledge_items", "kind, tags", lambda q: q.in_("kind", ["job", "scholarship"]).gt("valid_until", now)):
        hit: set[str] = set()
        for t in r.get("tags") or []:
            hit.update(word_cats.get(str(t).lower(), ()))
        field = "jobs" if r["kind"] == "job" else "scholarships"
        for k in hit:
            out[k][field] += 1
        unmapped += 0 if hit else 1
    for r in _rows("opportunities", "career_slugs", lambda q: q.eq("status", "open")):
        ks = {by_slug[s] for s in r.get("career_slugs") or [] if s in by_slug}
        for k in ks:
            out[k]["offers"] += 1
        unmapped += 0 if ks else 1

    rows = [{**v, "opportunities": v["jobs"] + v["scholarships"] + v["offers"]} for v in out.values()]
    return {
        "categories": rows,
        "totals": {"students": len(student_cats), "unmapped_opportunities": unmapped},
        "generated_at": now,
    }
