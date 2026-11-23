"""Catalogue reads from Supabase (the source of truth once seeded)."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from app.core.db import get_db

SHARED = Path(__file__).resolve().parents[3] / "shared"


@lru_cache
def fields() -> dict:
    return json.loads((SHARED / "rules" / "fields.json").read_text(encoding="utf-8"))["fields"]


def schemes_with_rules(active_only: bool = True) -> list[dict]:
    q = get_db().table("schemes").select(
        "id, slug, name, name_i18n, kind, level, state, ministry, benefit_amount, benefit_text, "
        "official_url, apply_url, deadline, is_active, verify, sources, documents, last_verified_at, "
        "scheme_rules!inner(version, rule, is_current)"
    ).eq("scheme_rules.is_current", True)
    if active_only:
        q = q.eq("is_active", True)
    out = []
    for s in q.execute().data:
        rule = s.pop("scheme_rules")[0]
        s["rule"], s["rule_version"] = rule["rule"], rule["version"]
        out.append(s)
    return out


@lru_cache
def career_riasec() -> dict[str, list[str]]:
    """Holland codes per career from the bundled catalogue (not a database column), so matching on the
    server and on the phone read the same codes."""
    doc = json.loads((SHARED / "catalogue" / "careers.json").read_text(encoding="utf-8"))
    return {c["slug"]: c.get("riasec") or [] for c in doc["careers"]}


def careers() -> list[dict]:
    rows = _career_rows()
    codes = career_riasec()
    for r in rows:
        r.setdefault("riasec", codes.get(r["slug"], []))
    return rows


def _career_rows() -> list[dict]:
    return get_db().table("careers").select(
        "slug, name, name_i18n, category, nco_code, nsqf_level, pay_min, pay_max, min_education, earning_speed, "
        "cost_band, interest_tags, subject_tags, rural_demand, needs_city, path, scheme_slugs, exam_slugs, program_slugs, "
        "sources, pay_evidence, pay_status, checked_on, min_age, hazardous_for_minors"
    ).eq("is_active", True).execute().data


def document_types() -> dict:
    return {r["slug"]: r["name"] for r in get_db().table("document_types").select("slug, name").execute().data}


def exams() -> list[dict]:
    return get_db().table("exams").select("slug, name, conducting_body, eligibility, typical_months, official_url").execute().data


def programs() -> list[dict]:
    return get_db().table("programs").select("*").execute().data


def resources() -> list[dict]:
    return get_db().table("resources").select("slug, title, provider, url, kind, languages, tags, org_id").execute().data
