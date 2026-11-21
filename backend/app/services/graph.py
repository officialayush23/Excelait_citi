"""The connected catalogue: careers, programs, exams, schemes and resources, with links
both ways. Cached in memory for a few minutes; everything here is deterministic."""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from datetime import date

from app.engine.rules import evaluate
from app.services import catalogue as cat

TTL = 300
_cache: dict = {"at": 0.0, "g": None}


@dataclass
class Graph:
    careers: dict[str, dict]
    programs: dict[str, dict]
    exams: dict[str, dict]
    schemes: dict[str, dict]
    resources: list[dict]
    docs: dict[str, str]
    # reverse links
    program_careers: dict[str, list[str]] = field(default_factory=dict)
    exam_programs: dict[str, list[str]] = field(default_factory=dict)
    scheme_programs: dict[str, list[str]] = field(default_factory=dict)
    scheme_careers: dict[str, list[str]] = field(default_factory=dict)


def graph() -> Graph:
    if _cache["g"] and time.time() - _cache["at"] < TTL:
        return _cache["g"]
    g = Graph(
        careers={c["slug"]: c for c in cat.careers()},
        programs={p["slug"]: p for p in cat.programs()},
        exams={e["slug"]: e for e in cat.exams()},
        schemes={s["slug"]: s for s in cat.schemes_with_rules()},
        resources=cat.resources(),
        docs=cat.document_types(),
    )
    for c in g.careers.values():
        for p in c.get("program_slugs") or []:
            g.program_careers.setdefault(p, []).append(c["slug"])
        for s in c.get("scheme_slugs") or []:
            g.scheme_careers.setdefault(s, []).append(c["slug"])
    for p in g.programs.values():
        for e in p["exam_slugs"]:
            g.exam_programs.setdefault(e, []).append(p["slug"])
        for s in p["scheme_slugs"]:
            g.scheme_programs.setdefault(s, []).append(p["slug"])
    _cache.update(at=time.time(), g=g)
    return g


def invalidate() -> None:
    _cache["g"] = None


def next_window(months: list[int], today: date | None = None) -> str | None:
    """The next month an exam usually happens, as YYYY-MM (typical, not an announced date)."""
    if not months:
        return None
    t = today or date.today()
    for m in sorted(months):
        if m >= t.month:
            return f"{t.year}-{m:02d}"
    return f"{t.year + 1}-{min(months):02d}"


def scheme_status(slug: str, facts: dict) -> dict | None:
    s = graph().schemes.get(slug)
    if not s:
        return None
    out = evaluate(s["rule"], facts)
    return {"slug": slug, "name": s["name"], "benefit_amount": s["benefit_amount"], "benefit_text": s["benefit_text"],
            "official_url": s["official_url"], "result": out.result, "missing": out.missing,
            "failed": [f["label"] for f in out.failed], "documents": s["documents"]}


def resources_for(careers: list[str] = (), programs: list[str] = (), exams: list[str] = (), categories: list[str] = (), limit: int = 6) -> list[dict]:
    want = {"careers": set(careers), "programs": set(programs), "exams": set(exams), "categories": set(categories)}
    scored = []
    for r in graph().resources:
        t = r.get("tags") or {}
        score = sum(3 if k != "categories" else 1 for k, v in want.items() for x in t.get(k, []) if x in v)
        if score:
            scored.append((score, r))
    scored.sort(key=lambda x: -x[0])
    return [r for _, r in scored[:limit]]


def program_card(slug: str, facts: dict | None = None) -> dict | None:
    g = graph()
    p = g.programs.get(slug)
    if not p:
        return None
    return {
        **{k: p[k] for k in ("slug", "name", "name_i18n", "level", "duration_months", "entry", "where", "college_kind", "official_url", "verify")},
        "exams": [{"slug": e, "name": g.exams[e]["name"], "next": next_window(g.exams[e]["typical_months"]), "official_url": g.exams[e]["official_url"]}
                  for e in p["exam_slugs"] if e in g.exams],
        "schemes": [s for s in (scheme_status(x, facts or {}) for x in p["scheme_slugs"]) if s],
        "careers": [{"slug": c, "name": g.careers[c]["name"], "name_i18n": g.careers[c]["name_i18n"]} for c in g.program_careers.get(slug, [])],
        "resources": resources_for(programs=[slug], exams=p["exam_slugs"], limit=4),
    }


def career_card(slug: str, facts: dict | None = None) -> dict | None:
    g = graph()
    c = g.careers.get(slug)
    if not c:
        return None
    facts = facts or {}
    related = [x for x in g.careers.values() if x["category"] == c["category"] and x["slug"] != slug][:4]
    exam_slugs = list(dict.fromkeys([*c["exam_slugs"], *(e for p in c["program_slugs"] if p in g.programs for e in g.programs[p]["exam_slugs"])]))
    scheme_slugs = list(dict.fromkeys([*c["scheme_slugs"], *(s for p in c["program_slugs"] if p in g.programs for s in g.programs[p]["scheme_slugs"])]))
    return {
        **{k: c[k] for k in ("slug", "name", "name_i18n", "category", "pay_min", "pay_max", "min_education", "earning_speed", "cost_band", "nsqf_level", "needs_city", "path")},
        **{k: c.get(k) for k in ("sources", "pay_evidence", "pay_status", "checked_on", "min_age", "hazardous_for_minors")},
        "programs": [program_card(p, facts) for p in c["program_slugs"] if p in g.programs],
        "exams": [{"slug": e, "name": g.exams[e]["name"], "next": next_window(g.exams[e]["typical_months"]), "official_url": g.exams[e]["official_url"]} for e in exam_slugs if e in g.exams],
        "schemes": [s for s in (scheme_status(x, facts) for x in scheme_slugs) if s],
        "resources": resources_for(careers=[slug], programs=c["program_slugs"], exams=exam_slugs, categories=[c["category"]]),
        "related": [{"slug": x["slug"], "name": x["name"], "name_i18n": x["name_i18n"]} for x in related],
    }


def exam_card(slug: str) -> dict | None:
    g = graph()
    e = g.exams.get(slug)
    if not e:
        return None
    progs = g.exam_programs.get(slug, [])
    careers = list(dict.fromkeys([c for p in progs for c in g.program_careers.get(p, [])] + [c["slug"] for c in g.careers.values() if slug in c["exam_slugs"]]))
    return {**e, "next": next_window(e["typical_months"]),
            "programs": [{"slug": p, "name": g.programs[p]["name"]} for p in progs],
            "careers": [{"slug": c, "name": g.careers[c]["name"], "name_i18n": g.careers[c]["name_i18n"]} for c in careers],
            "resources": resources_for(exams=[slug], limit=4)}


def scheme_card(slug: str, facts: dict) -> dict | None:
    g = graph()
    st = scheme_status(slug, facts)
    if not st:
        return None
    s = g.schemes[slug]
    progs = g.scheme_programs.get(slug, [])
    careers = list(dict.fromkeys(g.scheme_careers.get(slug, []) + [c for p in progs for c in g.program_careers.get(p, [])]))[:8]
    return {**st, "kind": s["kind"], "state": s["state"], "ministry": s["ministry"], "apply_url": s["apply_url"], "verify": s["verify"],
            "documents": [{"slug": d, "name": g.docs.get(d, d)} for d in s["documents"]],
            "programs": [{"slug": p, "name": g.programs[p]["name"]} for p in progs[:8]],
            "careers": [{"slug": c, "name": g.careers[c]["name"], "name_i18n": g.careers[c]["name_i18n"]} for c in careers]}
