"""Saved careers and dated plans built from the catalogue graph (no AI involved)."""

from __future__ import annotations

from datetime import date

from app.core.db import get_db
from app.services.graph import graph, next_window, resources_for, scheme_status
from app.services.students import get_facts

ENTRY_CLASS = {"none": 0, "class_8": 8, "class_10": 10, "class_12": 12, "diploma": 13, "ug_degree": 15, "ug_technical": 15}


# Recruitment exams (jobs), as opposed to admission tests; a minor cannot sit these before the minimum age.
RECRUITMENT_EXAMS = {"state-police", "agniveer", "rrb-group-d", "ibps-clerk", "ssc-gd"}
ADULT_AGE = 18


def min_age_for(career: dict, prog: dict | None) -> int | None:
    """Youngest age at which the student may take this career's jobs: the career's own min_age if the catalogue has
    one, 18 if it is flagged hazardous for minors, a program's min_age, else 18 for government recruitment routes."""
    if career.get("min_age") is not None:
        return int(career["min_age"])
    if career.get("hazardous_for_minors"):
        return ADULT_AGE
    if prog and prog.get("min_age") is not None:
        return int(prog["min_age"])
    if (prog and prog["slug"].endswith("-recruitment")) or career.get("category") == "government":
        return ADULT_AGE
    return None


def eligible_on(facts: dict, min_age: int, age: int, today: date) -> date:
    """The date the student reaches `min_age`: exact from a date of birth, else counted in whole years from today."""
    dob = facts.get("date_of_birth")
    try:
        if dob:
            d = date.fromisoformat(dob)
            return date(d.year + min_age, d.month, min(d.day, 28))
    except (ValueError, TypeError):
        pass
    return date(today.year + (min_age - age), today.month, min(today.day, 28))


def _admission_date(today: date) -> date:
    """Most courses start admissions around June; use the next June."""
    return date(today.year if today.month < 6 else today.year + 1, 6, 1)


def saved(user_id: str) -> list[str]:
    rows = get_db().table("saved_careers").select("career_slug").eq("user_id", user_id).order("created_at").execute().data
    return [r["career_slug"] for r in rows]


def save_career(user_id: str, slug: str, on: bool = True) -> list[str]:
    if slug not in graph().careers:
        raise ValueError("unknown career")
    t = get_db().table("saved_careers")
    if on:
        t.upsert({"user_id": user_id, "career_slug": slug}).execute()
    else:
        t.delete().eq("user_id", user_id).eq("career_slug", slug).execute()
    return saved(user_id)


def build_steps(career_slug: str, facts: dict, program_slug: str | None = None, today: date | None = None) -> list[dict]:
    g = graph()
    today = today or date.today()
    c = g.careers[career_slug]
    progs = [p for p in c["program_slugs"] if p in g.programs]
    prog = g.programs.get(program_slug) if program_slug in progs else (g.programs[progs[0]] if progs else None)
    steps: list[dict] = []

    # Minors: jobs and recruitment exams wait until the legal / minimum age; say so with a milestone.
    age = facts.get("age")
    min_age = min_age_for(c, prog)
    gate: date | None = None
    if isinstance(age, (int, float)) and not isinstance(age, bool) and min_age is not None and age < min_age:
        gate = eligible_on(facts, min_age, int(age), today)

    need = ENTRY_CLASS.get(prog["entry"] if prog else c["min_education"], 0)
    have = facts.get("class_level") or 0
    if need and have and have < need and need <= 12:
        steps.append({"kind": "milestone", "title": f"Pass Class {need}", "detail": "Keep your marks up; many courses look at them.",
                      "due_date": date(today.year + max(0, need - have - (1 if today.month < 4 else 0)), 3, 31).isoformat()})
    if gate:
        steps.append({"kind": "milestone", "title": f"Eligible from age {min_age}",
                      "detail": f"Jobs and recruitment exams for {c['name']} start at age {min_age}. Until then, finish your studies and build skills.",
                      "due_date": gate.isoformat()})
    if prog:
        for e in prog["exam_slugs"]:
            if e in g.exams:
                held_back = bool(gate) and e in RECRUITMENT_EXAMS
                win = next_window(g.exams[e]["typical_months"], gate if held_back else today)
                steps.append({"kind": "exam", "ref_id": e, "title": f"Prepare for and take {g.exams[e]['name']}",
                              "detail": f"Usually held around {win}. Check the official site for the exact date." + (f" You can sit it from age {min_age}." if held_back else ""),
                              "due_date": f"{win}-01" if win else None})
        steps.append({"kind": "program", "ref_id": prog["slug"], "title": f"Get admission: {prog['name']}",
                      "detail": f"{prog['where']}. About {prog['duration_months']} months." if prog["duration_months"] else prog["where"],
                      "due_date": (max(_admission_date(today), gate) if gate and prog["slug"].endswith("-recruitment") else _admission_date(today)).isoformat()})
        docs: list[str] = []
        for s in prog["scheme_slugs"]:
            st = scheme_status(s, facts)
            if st and st["result"] != "not_eligible":
                label = "You qualify" if st["result"] == "eligible" else "Answer a few questions to confirm"
                steps.append({"kind": "scheme", "ref_id": s, "title": f"Apply: {st['name']}", "detail": label})
                docs += [d for d in st["documents"] if d not in docs]
        for d in docs:
            steps.append({"kind": "document", "ref_id": d, "title": f"Get ready: {g.docs.get(d, d)}"})
    for r in resources_for(careers=[career_slug], programs=[prog["slug"]] if prog else [], categories=[c["category"]], limit=2):
        steps.append({"kind": "course", "ref_id": r["slug"], "title": f"Start learning: {r['title']}", "detail": r["url"]})
    steps.append({"kind": "milestone", "title": f"Start work as {c['name']}",
                  "detail": " → ".join(c["path"]) + (f" (from age {min_age})" if gate else ""),
                  **({"due_date": gate.isoformat()} if gate else {})})
    for i, s in enumerate(steps):
        s["position"] = i
    return steps


def create_plan(user_id: str, career_slug: str, program_slug: str | None = None) -> dict:
    g = graph()
    if career_slug not in g.careers:
        raise ValueError("unknown career")
    db = get_db()
    existing = db.table("pathways").select("id").eq("user_id", user_id).eq("career_slug", career_slug).eq("status", "active").execute().data
    if existing:
        return get_plan(user_id, existing[0]["id"])
    steps = build_steps(career_slug, get_facts(user_id), program_slug)
    pid = db.table("pathways").insert({"user_id": user_id, "career_slug": career_slug, "title": g.careers[career_slug]["name"]}).execute().data[0]["id"]
    db.table("pathway_steps").insert([{**s, "pathway_id": pid} for s in steps]).execute()
    save_career(user_id, career_slug)
    return get_plan(user_id, pid)


def list_plans(user_id: str) -> list[dict]:
    rows = get_db().table("pathways").select("id, career_slug, title, status, created_at, pathway_steps(id, done_at)") \
        .eq("user_id", user_id).order("created_at", desc=True).execute().data
    return [{**{k: r[k] for k in ("id", "career_slug", "title", "status", "created_at")},
             "total": len(r["pathway_steps"]), "done": sum(1 for s in r["pathway_steps"] if s["done_at"])} for r in rows]


def get_plan(user_id: str, plan_id: str) -> dict:
    db = get_db()
    p = db.table("pathways").select("id, career_slug, title, status, created_at").eq("id", plan_id).eq("user_id", user_id).single().execute().data
    steps = db.table("pathway_steps").select("id, position, kind, ref_id, title, detail, due_date, done_at").eq("pathway_id", plan_id).order("position").execute().data
    return {**p, "steps": steps}


def set_step(user_id: str, plan_id: str, step_id: str, done: bool) -> dict:
    get_plan(user_id, plan_id)  # ownership check
    get_db().table("pathway_steps").update({"done_at": "now()" if done else None}).eq("id", step_id).eq("pathway_id", plan_id).execute()
    return get_plan(user_id, plan_id)


def delete_plan(user_id: str, plan_id: str) -> None:
    get_db().table("pathways").delete().eq("id", plan_id).eq("user_id", user_id).execute()
