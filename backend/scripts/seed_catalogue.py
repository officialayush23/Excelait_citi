"""Load careers, programs, resources, exams, schemes and rules from shared/ into Supabase.

Safe to run again: rows are upserted by slug, and a scheme's rule gets a new version
only when its JSON actually changed (the old version stays for the audit trail).

    cd backend && python -m scripts.seed_catalogue
"""

from __future__ import annotations

import json
from pathlib import Path

from app.core.db import get_db

SHARED = Path(__file__).resolve().parents[2] / "shared"


def load(rel: str) -> dict:
    return json.loads((SHARED / rel).read_text(encoding="utf-8"))


def main() -> None:
    db = get_db()
    rules_doc = load("rules/schemes.json")
    careers_doc = load("catalogue/careers.json")
    exams_doc = load("catalogue/exams.json")

    # Document types
    db.table("document_types").upsert(
        [{"slug": k, "name": v} for k, v in rules_doc["document_types"].items()], on_conflict="slug"
    ).execute()
    doc_ids = {r["slug"]: r["id"] for r in db.table("document_types").select("id, slug").execute().data}

    # Exams
    db.table("exams").upsert(
        [{k: e[k] for k in ("slug", "name", "conducting_body", "eligibility", "typical_months", "official_url")} for e in exams_doc["exams"]],
        on_conflict="slug",
    ).execute()
    exam_ids = {r["slug"]: r["id"] for r in db.table("exams").select("id, slug").execute().data}

    # Careers
    career_rows = []
    for c in careers_doc["careers"]:
        career_rows.append({
            "slug": c["slug"], "name": c["name"], "name_i18n": c["name_i18n"], "category": c["category"],
            "nco_code": c["nco_code"], "nsqf_level": c["nsqf_level"], "pay_min": c["pay_min"], "pay_max": c["pay_max"],
            "pay_note": "Indicative entry-level monthly pay; check locally.",
            "min_education": c["min_education"], "earning_speed": c["earning_speed"], "cost_band": c["cost_band"],
            "interest_tags": c["interest_tags"], "subject_tags": c["subject_tags"], "path": c["path"],
            "rural_demand": c["rural_demand"], "needs_city": c["needs_city"],
            "scheme_slugs": c["scheme_slugs"], "exam_slugs": c["exam_slugs"], "program_slugs": c["program_slugs"],
            # Where the pay and path figures come from (backend/scripts/reference_careers.py); migration 0014.
            "sources": c.get("sources", []), "pay_evidence": c.get("pay_evidence"), "pay_status": c.get("pay_status"),
            "checked_on": c.get("checked_on"), "pay_previous": c.get("pay_previous"),
            "min_age": c.get("min_age"), "hazardous_for_minors": c.get("hazardous_for_minors", False),
        })
    db.table("careers").upsert(career_rows, on_conflict="slug").execute()
    career_ids = {r["slug"]: r["id"] for r in db.table("careers").select("id, slug").execute().data}
    links = [{"career_id": career_ids[c["slug"]], "exam_id": exam_ids[e]} for c in careers_doc["careers"] for e in c["exam_slugs"]]
    if links:
        db.table("career_exams").upsert(links, on_conflict="career_id,exam_id").execute()

    # Programs (education steps) and free resources
    programs = load("catalogue/programs.json")["programs"]
    db.table("programs").upsert([{**p, "updated_at": "now()"} for p in programs], on_conflict="slug").execute()
    resources = load("catalogue/resources.json")["resources"]
    db.table("resources").upsert([{**r, "updated_at": "now()"} for r in resources], on_conflict="slug").execute()

    # Schemes, their documents, sources and rules
    new_versions = 0
    for s in rules_doc["schemes"]:
        row = {
            "slug": s["slug"], "name": s["name"], "kind": s["kind"], "level": s["level"], "state": s["state"],
            "ministry": s["ministry"], "benefit_amount": s["benefit_amount"], "benefit_text": s["benefit_text"],
            "official_url": s["official_url"], "apply_url": s.get("apply_url"), "is_active": s.get("is_active", True),
            "verify": s.get("verify", []), "sources": s["sources"], "documents": s["documents"],
            "last_verified_at": rules_doc["checked_on"],
        }
        scheme_id = db.table("schemes").upsert(row, on_conflict="slug").execute().data[0]["id"]

        db.table("scheme_documents").upsert(
            [{"scheme_id": scheme_id, "document_type_id": doc_ids[d], "required": True} for d in s["documents"]],
            on_conflict="scheme_id,document_type_id",
        ).execute()
        db.table("scheme_sources").upsert(
            [{"scheme_id": scheme_id, "url": u, "status": "new"} for u in dict.fromkeys([s["official_url"], *s["sources"]])],
            on_conflict="url", ignore_duplicates=True,
        ).execute()

        current = db.table("scheme_rules").select("version, rule").eq("scheme_id", scheme_id).eq("is_current", True).execute().data
        if current and current[0]["rule"] == s["rule"]:
            continue
        version = (current[0]["version"] + 1) if current else 1
        if current:
            db.table("scheme_rules").update({"is_current": False}).eq("scheme_id", scheme_id).execute()
        db.table("scheme_rules").insert({
            "scheme_id": scheme_id, "version": version, "rule": s["rule"],
            "source_url": s["official_url"], "is_current": True,
        }).execute()
        new_versions += 1

    print(f"careers={len(career_rows)} programs={len(programs)} resources={len(resources)} exams={len(exam_ids)} schemes={len(rules_doc['schemes'])} new_rule_versions={new_versions}")


if __name__ == "__main__":
    main()
