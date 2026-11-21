"""Load practical skills, their tasks and rubrics from shared/catalogue/skills.json.

Idempotent: skills upsert by slug, rubrics and tasks by their own slug.
Run after migration 0012 and after seed_catalogue (careers must exist):

    cd backend && python -m scripts.seed_skills
"""

from __future__ import annotations

import json
from pathlib import Path

from app.core.db import get_db

PATH = Path(__file__).resolve().parents[2] / "shared" / "catalogue" / "skills.json"


def main() -> None:
    db = get_db()
    skills = json.loads(PATH.read_text(encoding="utf-8"))["skills"]

    db.table("skills").upsert(
        [{"slug": s["slug"], "name": s["name"], "name_i18n": s.get("name_i18n", {}), "nsqf_level": s.get("nsqf_level"),
          "summary": s.get("summary")} for s in skills], on_conflict="slug").execute()
    skill_ids = {r["slug"]: r["id"] for r in db.table("skills").select("id, slug").execute().data}
    career_ids = {r["slug"]: r["id"] for r in db.table("careers").select("id, slug").execute().data}

    links, missing = [], set()
    for s in skills:
        for c in s.get("careers", []):
            if c in career_ids:
                links.append({"career_id": career_ids[c], "skill_id": skill_ids[s["slug"]], "importance": 4})
            else:
                missing.add(c)
    if links:
        db.table("career_skills").upsert(links, on_conflict="career_id,skill_id").execute()

    rubric_rows, task_defs = [], []
    for s in skills:
        for t in s["tasks"]:
            rubric_rows.append({"slug": t["slug"], "title": t["rubric"]["title"], "criteria": t["rubric"]["criteria"]})
            task_defs.append((s, t))
    db.table("rubrics").upsert(rubric_rows, on_conflict="slug").execute()
    rubric_ids = {r["slug"]: r["id"] for r in db.table("rubrics").select("id, slug").execute().data}

    db.table("skill_tasks").upsert(
        [{"slug": t["slug"], "skill_id": skill_ids[s["slug"]], "rubric_id": rubric_ids[t["slug"]], "title": t["title"],
          "title_i18n": t.get("title_i18n", {}), "instructions": t["instructions"], "steps": t["steps"],
          "evidence_hint": t["evidence"]} for s, t in task_defs], on_conflict="slug").execute()

    print(f"Seeded {len(skills)} skills, {len(task_defs)} tasks, {len(links)} career links.")
    if missing:
        print("Careers not found (run seed_catalogue first):", ", ".join(sorted(missing)))


if __name__ == "__main__":
    main()
