"""Saathi, the assistant. The model's job is small: choose tools and write one or two short
linking sentences. Everything the student sees in detail comes back as cards built by
deterministic tools, so answers are cheap in tokens and numbers are never made up."""

from __future__ import annotations

import json
import time
from datetime import date

import httpx

from app.core.config import get_settings
from app.core.db import get_db
from app.engine.matching import rank
from app.services import colleges as col
from app.services import community, partners, plans
from app.services.ai import LANG_NAMES, _fact_schema
from app.services.graph import career_card, exam_card, graph, program_card, resources_for, scheme_card, scheme_status
from app.services.students import get_facts, merge_facts
from app.services.web_search import web_search

MAX_ROUNDS = 4
HISTORY = 8

SYSTEM = """You are Saathi, a career and education guide for rural Indian students (Class 8 to graduation).
Reply in {language}. The app shows rich cards from your tool calls, so your own text must be SHORT:
at most 2 short sentences that connect the cards or say the next step. Never repeat what a card shows.
Always use tools for facts: careers, courses, exams, colleges, schemes, learning, plans, community, opportunities.
Use web_search only for fresh facts the other tools cannot give (dates, notices, news), then mention it is from the web.
Never say whether someone qualifies for money yourself; check_money does that with fixed rules.
If a needed fact is missing, call ask_student instead of guessing. Save facts the student states with save_facts.
Today is {today}. Treat web results older than this year as possibly out of date and say so.
Student facts: {facts}. Saved careers: {saved}."""

TOOLS_SPEC = [
    ("find_careers", "Rank careers for this student (optionally what-if).", {"can_relocate": {"type": "boolean"}, "needs_income_soon": {"type": "boolean"}, "query": {"type": "string", "description": "words to filter by, e.g. 'nursing'"}}),
    ("career_details", "Full connected view of one career: courses, exams, colleges kind, money, resources, related.", {"slug": {"type": "string"}}),
    ("course_details", "One education/training program: entry, duration, exams, money, careers.", {"slug": {"type": "string"}}),
    ("exam_details", "One entrance or recruitment exam: when, who can sit, which courses and careers use it.", {"slug": {"type": "string"}}),
    ("check_money", "Check scholarships/schemes for this student with fixed rules. Optionally one scheme.", {"slug": {"type": "string"}}),
    ("find_colleges", "Find colleges/ITIs/institutes from the official directory.", {"kind": {"type": "string", "enum": ["iti", "polytechnic", "engineering", "nursing", "medical", "pharmacy", "paramedical", "agriculture", "veterinary", "teacher_training", "law", "hotel", "general"]}, "district": {"type": "string"}, "state": {"type": "string"}, "name": {"type": "string"}}),
    ("learning_resources", "Free learning resources for a career, course or exam.", {"career": {"type": "string"}, "course": {"type": "string"}, "exam": {"type": "string"}}),
    ("opportunities", "Internships, trainings, courses and jobs from verified partners that fit this student.", {"kind": {"type": "string"}, "career": {"type": "string"}}),
    ("community", "Search community questions, stories and opportunity posts; or list seniors on a path.", {"query": {"type": "string"}, "career": {"type": "string"}, "seniors": {"type": "boolean"}}),
    ("my_plan", "Show the student's saved careers and plans.", {}),
    ("make_plan", "Create a dated step-by-step plan for a career (saves it).", {"career": {"type": "string"}, "course": {"type": "string"}}),
    ("save_career", "Save or unsave a career.", {"career": {"type": "string"}, "save": {"type": "boolean"}}),
    ("web_search", "Live web search for fresh facts (dates, notices). Returns sources.", {"query": {"type": "string"}}),
    ("ask_student", "Show the student a tap-to-answer question for one missing fact.", {"field": {"type": "string"}}),
]


def _tools() -> list[dict]:
    out = [{"type": "function", "function": {"name": n, "description": d, "parameters": {"type": "object", "properties": p}}} for n, d, p in TOOLS_SPEC]
    out.append({"type": "function", "function": {"name": "save_facts", "description": "Save facts the student clearly stated.",
                                                 "parameters": {"type": "object", "properties": {"facts": _fact_schema()}, "required": ["facts"]}}})
    return out


def _slug(kind: str, value: str | None) -> str | None:
    """Accept a slug or a name and return the slug."""
    if not value:
        return None
    g = graph()
    table = {"career": g.careers, "program": g.programs, "exam": g.exams, "scheme": g.schemes}[kind]
    v = value.strip().lower()
    if v in table:
        return v
    for slug, row in table.items():
        if v in row["name"].lower() or v.replace(" ", "-") in slug:
            return slug
    return None


class Ctx:
    def __init__(self, user_id: str, roles: set[str]):
        self.user_id, self.roles = user_id, roles
        self.facts = get_facts(user_id)
        self.cards: list[dict] = []


def run_tool(ctx: Ctx, name: str, a: dict) -> str:
    """Runs one tool, appends a card for the app, returns a compact summary for the model."""
    g = graph()
    if name == "find_careers":
        wi = {k: a[k] for k in ("can_relocate", "needs_income_soon") if k in a}
        pool = list(g.careers.values())
        if a.get("query"):
            q = a["query"].lower()
            pool = [c for c in pool if q in c["name"].lower() or q in c["category"] or any(q in t for t in c["interest_tags"])] or pool
        ms = rank(pool, {**ctx.facts, **wi}, 6)
        items = [{"slug": m.slug, "score": m.score, "reasons": m.reasons, "gaps": m.gaps, **{k: g.careers[m.slug][k] for k in ("name", "name_i18n", "category", "pay_min", "pay_max", "earning_speed")}} for m in ms]
        ctx.cards.append({"type": "careers", "what_if": wi, "items": items})
        return "; ".join(f"{i['slug']} {i['score']}" for i in items)
    if name == "career_details":
        s = _slug("career", a.get("slug"))
        card = career_card(s, ctx.facts) if s else None
        if not card:
            return "not found"
        ctx.cards.append({"type": "career", "saved": s in plans.saved(ctx.user_id), **card})
        return f"{s}: courses {[p['slug'] for p in card['programs']]}; exams {[e['slug'] for e in card['exams']]}; money eligible {[x['slug'] for x in card['schemes'] if x['result'] == 'eligible']}"
    if name == "course_details":
        s = _slug("program", a.get("slug"))
        card = program_card(s, ctx.facts) if s else None
        if not card:
            return "not found"
        ctx.cards.append({"type": "program", **card})
        return f"{s}: {card['duration_months']} months, entry {card['entry']}, college kind {card['college_kind']}"
    if name == "exam_details":
        s = _slug("exam", a.get("slug"))
        card = exam_card(s) if s else None
        if not card:
            return "not found"
        ctx.cards.append({"type": "exam", **card})
        return f"{s}: next around {card['next']}"
    if name == "check_money":
        if a.get("slug"):
            s = _slug("scheme", a["slug"])
            card = scheme_card(s, ctx.facts) if s else None
            if not card:
                return "not found"
            ctx.cards.append({"type": "scheme", **card})
            return f"{s}: {card['result']}, missing {card['missing']}"
        checks = [scheme_status(x, ctx.facts) for x in g.schemes]
        checks = [c for c in checks if c and c["result"] != "not_eligible"]
        checks.sort(key=lambda c: (c["result"] != "eligible", len(c["missing"])))
        rupees = sum(c["benefit_amount"] or 0 for c in checks if c["result"] == "eligible")
        ctx.cards.append({"type": "schemes", "rupees": rupees, "items": checks[:8]})
        return f"eligible {sum(c['result'] == 'eligible' for c in checks)}, rupees {rupees}, need info {sum(c['result'] == 'needs_info' for c in checks)}"
    if name == "find_colleges":
        state = a.get("state") or ctx.facts.get("state")
        items = col.search(a.get("kind"), None if state == "Other" else state, a.get("district") or ctx.facts.get("district"), a.get("name"))
        total = col.count()
        ctx.cards.append({"type": "colleges", "query": {**a, "state": state}, "items": items, "directory_loaded": total > 0})
        return f"{len(items)} found" if total else "college directory not loaded yet; suggest web_search"
    if name == "learning_resources":
        c, p, e = _slug("career", a.get("career")), _slug("program", a.get("course")), _slug("exam", a.get("exam"))
        cats = [g.careers[c]["category"]] if c else []
        items = resources_for([c] if c else [], [p] if p else [], [e] if e else [], cats, limit=6)
        ctx.cards.append({"type": "resources", "items": items})
        return ", ".join(r["slug"] for r in items) or "none"
    if name == "opportunities":
        items = partners.offers_for_student(ctx.facts, a.get("kind"), _slug("career", a.get("career")), 8)
        ctx.cards.append({"type": "offers", "items": items})
        return f"{len(items)} open"
    if name == "community":
        if a.get("seniors"):
            items = community.seniors(_slug("career", a.get("career")), a.get("query"))
            ctx.cards.append({"type": "seniors", "items": items})
            return f"{len(items)} seniors"
        items = community.feed(ctx.facts, career=_slug("career", a.get("career")), q=a.get("query"), limit=6)
        ctx.cards.append({"type": "posts", "items": items})
        return f"{len(items)} posts"
    if name == "my_plan":
        data = {"saved": plans.saved(ctx.user_id), "plans": plans.list_plans(ctx.user_id)}
        ctx.cards.append({"type": "my_plan", **data})
        return f"saved {data['saved']}; plans {[p['career_slug'] for p in data['plans']]}"
    if name == "make_plan":
        s = _slug("career", a.get("career"))
        if not s:
            return "unknown career"
        plan = plans.create_plan(ctx.user_id, s, _slug("program", a.get("course")))
        ctx.cards.append({"type": "plan", **plan})
        return f"plan with {len(plan['steps'])} steps"
    if name == "save_career":
        s = _slug("career", a.get("career"))
        if not s:
            return "unknown career"
        saved = plans.save_career(ctx.user_id, s, a.get("save", True))
        ctx.cards.append({"type": "my_plan", "saved": saved, "plans": plans.list_plans(ctx.user_id)})
        return f"saved {saved}"
    if name == "web_search":
        res = web_search(a.get("query", ""))
        ctx.cards.append({"type": "web", **res})
        return " | ".join(f"{r['title'][:70]}: {r['snippet'][:160]}" for r in res["results"][:4])
    if name == "ask_student":
        f = a.get("field")
        ctx.cards.append({"type": "question", "field": f})
        return "question shown"
    if name == "save_facts":
        ctx.facts = merge_facts(ctx.user_id, a.get("facts") or {})
        return "saved"
    return "unknown tool"


FALLBACK_MODEL = "openai/gpt-oss-20b"


def _llm(messages: list[dict]) -> dict:
    """Main model first; on a rate limit wait briefly once, then use the smaller model."""
    s = get_settings()
    attempts = [(s.llm_model, 0), (s.llm_model, 2.0), (FALLBACK_MODEL, 0)]
    for model, wait in attempts:
        if wait:
            time.sleep(wait)
        r = httpx.post(f"{s.llm_base_url}/chat/completions", timeout=60, headers={"Authorization": f"Bearer {s.groq_api_key}"},
                       json={"model": model, "messages": messages, "tools": _tools(), "temperature": 0.2,
                             "reasoning_effort": "low", "max_completion_tokens": 700})
        if r.status_code != 429:
            r.raise_for_status()
            return r.json()
    r.raise_for_status()
    return r.json()


def _thread(user_id: str, thread_id: str | None, first: str) -> str:
    db = get_db()
    if thread_id:
        ok = db.table("assistant_threads").select("id").eq("id", thread_id).eq("user_id", user_id).execute().data
        if ok:
            return thread_id
    return db.table("assistant_threads").insert({"user_id": user_id, "title": first[:80]}).execute().data[0]["id"]


def chat(user_id: str, roles: set[str], message: str, language: str, thread_id: str | None = None) -> dict:
    db = get_db()
    tid = _thread(user_id, thread_id, message)
    past = db.table("assistant_messages").select("role, content").eq("thread_id", tid).order("id", desc=True).limit(HISTORY).execute().data[::-1]
    ctx = Ctx(user_id, roles)
    facts_short = {k: v for k, v in ctx.facts.items() if k not in ("date_of_birth",)}
    messages = [{"role": "system", "content": SYSTEM.format(today=date.today().isoformat(), language=LANG_NAMES.get(language, "English"),
                                                            facts=json.dumps(facts_short, ensure_ascii=False), saved=plans.saved(user_id))}]
    messages += [{"role": m["role"], "content": m["content"] or "(cards shown)"} for m in past]
    messages.append({"role": "user", "content": message})
    used, tokens, reply = [], 0, ""
    for _ in range(MAX_ROUNDS):
        resp = _llm(messages)
        tokens += (resp.get("usage") or {}).get("total_tokens", 0)
        msg = resp["choices"][0]["message"]
        calls = msg.get("tool_calls") or []
        if not calls:
            reply = msg.get("content") or ""
            break
        messages.append({"role": "assistant", "content": msg.get("content") or "", "tool_calls": calls})
        for call in calls:
            name = call["function"]["name"]
            try:
                args = json.loads(call["function"].get("arguments") or "{}")
            except json.JSONDecodeError:
                args = {}
            try:
                out = run_tool(ctx, name, args)
            except Exception as e:  # a tool failing should not end the conversation
                out = f"error: {type(e).__name__}"
            used.append(name)
            messages.append({"role": "tool", "tool_call_id": call["id"], "content": out[:1200]})
    db.table("assistant_messages").insert([
        {"thread_id": tid, "role": "user", "content": message, "cards": [], "tools": [], "tokens": None},
        {"thread_id": tid, "role": "assistant", "content": reply, "cards": ctx.cards, "tools": used, "tokens": tokens},
    ]).execute()
    db.table("assistant_threads").update({"updated_at": "now()"}).eq("id", tid).execute()
    return {"thread_id": tid, "reply": reply, "cards": ctx.cards, "tools": used, "tokens": tokens}


def threads(user_id: str) -> list[dict]:
    return get_db().table("assistant_threads").select("id, title, updated_at").eq("user_id", user_id).order("updated_at", desc=True).limit(30).execute().data


def thread_messages(user_id: str, thread_id: str) -> list[dict]:
    db = get_db()
    if not db.table("assistant_threads").select("id").eq("id", thread_id).eq("user_id", user_id).execute().data:
        return []
    return db.table("assistant_messages").select("id, role, content, cards, created_at").eq("thread_id", thread_id).order("id").execute().data
