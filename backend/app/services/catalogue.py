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


def careers() -> list[dict]:
    return get_db().table("careers").select(
        "slug, name, name_i18n, category, nco_code, nsqf_level, pay_min, pay_max, min_education, earning_speed, "
        "cost_band, interest_tags, subject_tags, rural_demand, needs_city, path, scheme_slugs, exam_slugs"
    ).eq("is_active", True).execute().data


def document_types() -> dict:
    return {r["slug"]: r["name"] for r in get_db().table("document_types").select("slug, name").execute().data}


def exams() -> list[dict]:
    return get_db().table("exams").select("slug, name, conducting_body, eligibility, typical_months, official_url").execute().data
