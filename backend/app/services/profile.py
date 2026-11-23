"""The student's profile page: every fact with where it came from, interests (with the quiz), saved careers,
plans, money they can claim, credentials, and a small knowledge graph linking them. The graph runs
me -> what I do / like / can do -> my top careers -> each career's first course -> money I can get."""

from __future__ import annotations

import logging

from app.core.db import get_db
from app.engine.matching import quiz_scores, rank, riasec_top
from app.engine.rules import evaluate
from app.services import plans
from app.services import profile_questions as pq
from app.services.graph import graph
from app.services.students import get_profile_row

log = logging.getLogger("profile")
MAX_NODES = 25
ME = {"en": "Me", "hi": "मैं", "mr": "मी"}
HIDDEN = {"date_of_birth"}  # shown as age


def _t(d: dict | None, lang: str, fallback: str = "") -> str:
    if not d:
        return fallback
    return d.get(lang) or d.get("en") or fallback


def _name(row: dict, lang: str) -> str:
    return (row.get("name_i18n") or {}).get(lang) or row["name"]


def option_label(field: str, value, lang: str) -> str:
    """The label a student saw for an answer ('c10' -> 'Class 10'); the raw value if there is none."""
    q = pq.by_field().get(field)
    if q:
        for opts in [q.get("options") or [], *[(v.get("options") or []) for v in q.get("variants") or []]]:
            for o in opts:
                if o["value"] == value:
                    return _t(o["label"], lang, str(value))
    return str(value)


def fact_rows(facts: dict, meta: dict, updated_at: str | None) -> list[dict]:
    out = []
    for key, value in facts.items():
        if key in HIDDEN:
            continue
        m = meta.get(key) or {}
        if key == "age" and "age" not in meta and facts.get("date_of_birth"):
            m = {**(meta.get("date_of_birth") or {}), "source": "system"}
        out.append({
            "key": key, "value": value, "label": {"en": key, **pq.label(key)}, "group": pq.group(key),
            # Facts saved before provenance was kept (migration 0017) were entered by the student in the app.
            "source": m.get("source") or "onboarding", "at": m.get("at") or updated_at, "note": m.get("note"),
            "sensitive": pq.sensitive(key),
        })
    order = ["basics", "study", "interests", "skills", "work", "money", "personal"]
    out.sort(key=lambda f: (order.index(f["group"]) if f["group"] in order else 99, f["key"]))
    return out


def money(facts: dict) -> dict:
    g = graph()
    eligible, needs_info, total = [], 0, 0
    for s in g.schemes.values():
        res = evaluate(s["rule"], facts).result
        if res == "eligible":
            eligible.append({"slug": s["slug"], "name": s["name"], "benefit_amount": s.get("benefit_amount")})
            total += s.get("benefit_amount") or 0
        elif res == "needs_info":
            needs_info += 1
    eligible.sort(key=lambda x: -(x["benefit_amount"] or 0))
    return {"eligible_inr": int(total), "eligible": [{"slug": e["slug"], "name": e["name"]} for e in eligible], "needs_info": needs_info}


def credentials(user_id: str, lang: str) -> list[dict]:
    db = get_db()
    try:
        rows = db.table("credentials").select("public_id, skill_id, payload, issued_at, revoked_at").eq("student_id", user_id) \
            .order("issued_at", desc=True).execute().data or []
        ids = list({r["skill_id"] for r in rows if r.get("skill_id")})
        skills = {s["id"]: s for s in (db.table("skills").select("id, name, name_i18n").in_("id", ids).execute().data or [])} if ids else {}
    except Exception as e:  # noqa: BLE001 - the profile still loads without the passport
        log.warning("credentials failed: %s", e)
        return []
    out = []
    for r in rows:
        if r.get("revoked_at"):
            continue
        sk = skills.get(r.get("skill_id")) or {}
        name = (sk.get("name_i18n") or {}).get(lang) or sk.get("name") or (r.get("payload") or {}).get("skill") or ""
        out.append({"public_id": r["public_id"], "skill": name, "issued_at": r["issued_at"]})
    return out


def knowledge_graph(facts: dict, saved: list[str], matches: list[str], lang: str) -> dict:
    g = graph()
    nodes: list[dict] = []
    edges: list[dict] = []
    ids: set[str] = set()

    def node(nid: str, kind: str, label: str, grp: str | None = None) -> bool:
        if nid in ids:
            return True
        if len(nodes) >= MAX_NODES:
            return False
        ids.add(nid)
        nodes.append({"id": nid, "type": kind, "label": label, **({"group": grp} if grp else {})})
        return True

    def edge(a: str, b: str, label: str) -> None:
        if a in ids and b in ids and not any(e["from"] == a and e["to"] == b for e in edges):
            edges.append({"from": a, "to": b, "label": label})

    node("me", "me", ME.get(lang, ME["en"]))
    v = pq.view(facts)
    for key in ("stage", "stream", "plan_after_10", "qualification"):
        if v.get(key):
            if node(f"fact:{key}", "fact", option_label(key, v[key], lang), pq.group(key)):
                edge("me", f"fact:{key}", _t(pq.label(key), lang, key))
    scores = quiz_scores(facts)
    types = pq.type_labels()
    for code in riasec_top(scores):
        if node(f"riasec:{code}", "interest", _t(types.get(code), lang, code), "riasec"):
            edge("me", f"riasec:{code}", {"en": "interest type", "hi": "रुचि का प्रकार", "mr": "आवडीचा प्रकार"}.get(lang, "interest type"))
    for tag in (facts.get("interests") or [])[:5]:
        if node(f"interest:{tag}", "interest", option_label("interests", tag, lang), "interests"):
            edge("me", f"interest:{tag}", {"en": "likes", "hi": "पसंद", "mr": "आवडते"}.get(lang, "likes"))
    for sk in (facts.get("skills") or [])[:4]:
        if node(f"skill:{sk}", "skill", option_label("skills", sk, lang), "skills"):
            edge("me", f"skill:{sk}", {"en": "can do", "hi": "कर सकते हैं", "mr": "येते"}.get(lang, "can do"))

    age = v.get("age")
    minor = isinstance(age, (int, float)) and age < 18
    picks = [s for s in saved if s in g.careers][:3]
    # A minor's map suggests only paths they can start now; saved careers are always shown.
    picks += [s for s in matches if s in g.careers and s not in picks and not (minor and g.careers[s].get("hazardous_for_minors"))][:3 - len(picks)]
    fits = {"en": "fits", "hi": "मेल", "mr": "जुळते"}.get(lang, "fits")
    for slug in picks:
        c = g.careers[slug]
        if not node(f"career:{slug}", "career", _name(c, lang)):
            break
        linked = False
        for tag in c.get("interest_tags") or []:
            if f"interest:{tag}" in ids:
                edge(f"interest:{tag}", f"career:{slug}", fits)
                linked = True
        for code in (c.get("riasec") or [])[:2]:
            if f"riasec:{code}" in ids:
                edge(f"riasec:{code}", f"career:{slug}", fits)
                linked = True
        if slug in saved:
            edge("me", f"career:{slug}", {"en": "saved", "hi": "सेव किया", "mr": "जतन केले"}.get(lang, "saved"))
        elif not linked:
            edge("me", f"career:{slug}", {"en": "suggested", "hi": "सुझाया गया", "mr": "सुचवलेले"}.get(lang, "suggested"))
        prog = next((p for p in c.get("program_slugs") or [] if p in g.programs), None)
        if prog and node(f"course:{prog}", "course", _name(g.programs[prog], lang)):
            edge(f"career:{slug}", f"course:{prog}", {"en": "first step", "hi": "पहला कदम", "mr": "पहिली पायरी"}.get(lang, "first step"))
        prog_schemes = set(g.programs[prog]["scheme_slugs"]) if prog else set()
        shown = 0
        for s in dict.fromkeys([*prog_schemes, *(c.get("scheme_slugs") or [])]):
            sc = g.schemes.get(s)
            if not sc or shown >= 2 or evaluate(sc["rule"], facts).result != "eligible":
                continue
            if node(f"scheme:{s}", "scheme", _name(sc, lang)):
                src = f"course:{prog}" if s in prog_schemes and prog else f"career:{slug}"
                edge(src, f"scheme:{s}", {"en": "money help", "hi": "पैसों की मदद", "mr": "पैशांची मदत"}.get(lang, "money help"))
                shown += 1
    return {"nodes": nodes, "edges": edges}


def build(user_id: str, lang: str = "en") -> dict:
    facts, meta, updated_at = get_profile_row(user_id)
    g = graph()
    scores = quiz_scores(facts)
    saved = plans.saved(user_id)
    try:
        my_plans = plans.list_plans(user_id)
    except Exception as e:  # noqa: BLE001
        log.warning("plans failed: %s", e)
        my_plans = []
    matches = [m.slug for m in rank(list(g.careers.values()), facts, 10)] if (facts.get("interests") or scores) else []
    types = pq.type_labels()
    return {
        "facts": fact_rows(facts, meta, updated_at),
        "interests": {"riasec": scores, "top": riasec_top(scores), "labels": types, "tags": list(facts.get("interests") or []),
                      "quiz_done": pq.quiz_done(facts)},
        "skills": list(facts.get("skills") or []),
        "subjects": list(facts.get("subjects") or []),
        "saved_careers": [{"slug": s, "name": g.careers[s]["name"], "name_i18n": g.careers[s].get("name_i18n") or {}} for s in saved if s in g.careers],
        "plans": [{"id": p["id"], "career_slug": p["career_slug"], "title": p["title"], "done": p["done"], "total": p["total"]} for p in my_plans],
        "money": money(facts),
        "credentials": credentials(user_id, lang),
        "graph": knowledge_graph(facts, saved, matches, lang),
        "completeness": pq.completeness(facts, lang),
    }
