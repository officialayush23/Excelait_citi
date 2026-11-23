"""The student's roadmap: goals (rows in pathways), their steps, activity events, the changelog, signals from
Saathi and the watchlist. Dates, eligibility and progress come from fixed rules (roadmap_engine, alerts,
plans.build_steps, work_rules); the model only reads this and proposes changes through tools.

Everything here is safe before migration 0018 is applied: the roadmap is read from the old plan columns,
and events, signals, changes and watches are skipped."""

from __future__ import annotations

import logging
import os
import re
import threading
import time
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone

from app.core.db import get_db
from app.services import alerts as al
from app.services import roadmap_engine as eng
from app.services import work_rules as wr
from app.services.graph import graph, next_window, resources_for, scheme_status
from app.services.students import get_facts

log = logging.getLogger("roadmap")

GOAL_LEGACY = "id, career_slug, title, status, created_at"
GOAL_COLS = GOAL_LEGACY + ", kind, program_slug, exam_slug, scheme_slug, target_date, target_text, priority, source"
STEP_LEGACY = "id, pathway_id, position, kind, ref_id, title, detail, due_date, done_at"
STEP_NEW = ("status, progress, subtasks, hard_deadline, at_risk, refs, why, now_text, copy_key, optional, origin, "
            "parent_step_id, original_due_date, done_by, evidence, updated_at")
STEP_COLS = f"{STEP_LEGACY}, {STEP_NEW}"
NEW_FIELDS = set(STEP_NEW.replace(" ", "").split(","))
EVAL_EVERY = timedelta(hours=6)
QUIET_EVENTS = {"saathi_turn", "roadmap_opened", "career_saved", "plan_step_toggled", "exam_viewed"}
BACKGROUND = os.environ.get("ROADMAP_SYNC", "0") != "1"

_ready = {"at": 0.0, "ok": None}
_locks: dict[str, threading.Lock] = defaultdict(threading.Lock)


class RoadmapError(ValueError):
    pass


def now() -> datetime:
    return datetime.now(timezone.utc)


def ready() -> bool:
    """Is migration 0018 applied? Checked once every few minutes."""
    ttl = 300 if _ready["ok"] else 60
    if _ready["ok"] is not None and time.time() - _ready["at"] < ttl:
        return bool(_ready["ok"])
    try:
        db = get_db()
        db.table("pathway_steps").select("status, refs").limit(1).execute()
        db.table("activity_events").select("id").limit(1).execute()
        db.table("roadmap_changes").select("id").limit(1).execute()
        ok = True
    except Exception as e:  # noqa: BLE001 - the roadmap still works from the old columns
        log.info("roadmap tables not ready (%s); using plan columns only", str(e)[:120])
        ok = False
    _ready.update(at=time.time(), ok=ok)
    return ok


def _today() -> date:
    return date.today()


# ---------------------------------------------------------------- building steps

def prepare_steps(steps: list[dict], facts: dict, goal_kind: str = "career", today: date | None = None,
                  signals: list[dict] | None = None) -> list[dict]:
    """Rows for pathway_steps: the plan's steps plus hard-deadline flags, links, why / what-now, sub-tasks and
    soft dates. Before migration 0018 only the old columns are returned."""
    today = today or _today()
    out = []
    for s in steps:
        s = dict(s)
        hard = bool(s.get("due_date")) and (s["kind"] in ("exam", "program", "milestone") or (s["kind"] == "scheme" and s.get("hard_deadline")))
        s["hard_deadline"] = bool(s.get("hard_deadline")) or hard
        if s.get("ref_id") and not s.get("refs"):
            s["refs"] = [{"kind": s["kind"] if s["kind"] != "course" else "resource", "slug": s["ref_id"]}]
        out.append(eng.with_copy(s))
    out = eng.schedule_soft(out, today, eng.gap_days(facts, signals), eng.free_days(signals))
    for i, s in enumerate(out):
        s["position"] = i
        s.setdefault("status", "todo")
        s.setdefault("progress", 0)
        s.setdefault("origin", "plan")
        s["original_due_date"] = s.get("due_date")
    if not ready():
        return [{k: s.get(k) for k in ("position", "kind", "ref_id", "title", "detail", "due_date") if k in s or k == "detail"} for s in out]
    keep = {"position", "kind", "ref_id", "title", "detail", "due_date"} | NEW_FIELDS
    return [{k: v for k, v in s.items() if k in keep} for s in out]


def community_step(career_slug: str | None = None, exam_slug: str | None = None) -> dict:
    refs = [{"kind": "community", "slug": career_slug or exam_slug or ""}]
    if career_slug:
        refs.append({"kind": "career", "slug": career_slug})
    return {"kind": "community", "title": "Ask a senior on this path one question", "refs": refs}


def exam_steps(slug: str, facts: dict, target_year: int | None = None, today: date | None = None) -> list[dict]:
    g = graph()
    today = today or _today()
    e = g.exams[slug]
    start = date(target_year, 1, 1) if target_year and target_year > today.year else today
    win = next_window(e.get("typical_months") or [], start)
    steps: list[dict] = [
        {"kind": "task", "title": f"Check the official {e['name']} dates and who can sit", "refs": [{"kind": "exam", "slug": slug}],
         "copy_key": "exam", "subtasks": [{"id": "dates", "key": "exam.dates", "title": "Check the official date and who can sit", "done": False}]},
        {"kind": "task", "title": "Get the syllabus and mark your weak topics", "refs": [{"kind": "exam", "slug": slug}]},
    ]
    for r in resources_for(exams=[slug], limit=2):
        steps.append({"kind": "course", "ref_id": r["slug"], "title": f"Start learning: {r['title']}", "detail": r["url"]})
    steps.append({"kind": "task", "title": "Try one previous year paper", "refs": [{"kind": "exam", "slug": slug}]})
    steps.append(community_step(exam_slug=slug))
    age = facts.get("age")
    from app.services.plans import ADULT_AGE, RECRUITMENT_EXAMS, eligible_on  # local: plans imports this module
    if slug in RECRUITMENT_EXAMS and wr.is_minor(age):
        gate = eligible_on(facts, ADULT_AGE, int(age), today)
        steps.append({"kind": "milestone", "title": f"Eligible from age {ADULT_AGE}", "due_date": gate.isoformat(),
                      "detail": f"You can sit {e['name']} from age {ADULT_AGE}. Until then, build the skills."})
        win = next_window(e.get("typical_months") or [], gate)
    steps.append({"kind": "exam", "ref_id": slug, "title": f"Take {e['name']}", "due_date": f"{win}-01" if win else None,
                  "detail": f"Usually around {win}. Check the official site for the exact date." if win else None})
    return steps


def scheme_steps(slug: str, facts: dict) -> list[dict]:
    g = graph()
    st = scheme_status(slug, facts)
    if not st:
        raise RoadmapError("unknown scheme")
    s = g.schemes[slug]
    steps = [{"kind": "scheme", "ref_id": slug, "title": f"Apply: {st['name']}", "due_date": s.get("deadline"),
              "hard_deadline": bool(s.get("deadline")),
              "detail": "You qualify" if st["result"] == "eligible" else "Answer a few questions to confirm"}]
    if st["missing"]:
        steps.insert(0, {"kind": "task", "title": "Answer the questions that check if you qualify",
                         "refs": [{"kind": "activity", "slug": "profile"}, {"kind": "scheme", "slug": slug}]})
    for d in st["documents"]:
        steps.insert(-1, {"kind": "document", "ref_id": d, "title": f"Get ready: {g.docs.get(d, d)}"})
    return steps


def _hazardous(role: str) -> bool:
    from app.services.assistant import HAZARD_WORDS  # local: the assistant imports this module
    low = (role or "").lower()
    if any(w in low for w in HAZARD_WORDS):
        return True
    g = graph()
    for slug, c in g.careers.items():
        if c["name"].lower().split(" (")[0] in low or slug.replace("-", " ") in low:
            return wr.career_age_status(slug, 17) != "now"
    return False


def job_steps(role: str, place: str, facts: dict) -> list[dict]:
    age = facts.get("age")
    if wr.is_minor(age) or age is None:
        # Minors: no job steps. Skills and money that needs no work now; work from 18.
        steps = [{"kind": "scheme", "title": "Check scholarships you can get now", "refs": [{"kind": "activity", "slug": "money"}]},
                 {"kind": "course", "title": f"Free skill training for {role}", "refs": [{"kind": "skill", "slug": role}]},
                 community_step()]
        if age is not None:
            from app.services.plans import ADULT_AGE, eligible_on
            steps.append({"kind": "milestone", "title": f"Eligible from age {ADULT_AGE}",
                          "due_date": eligible_on(facts, ADULT_AGE, int(age), _today()).isoformat(),
                          "detail": "The law allows paid jobs from 18. Until then, safe skill training and studies."})
        return steps
    return [{"kind": "job", "title": "Write a simple CV", "refs": [{"kind": "job", "slug": role}]},
            {"kind": "job", "title": f"Look at 3 {role} openings near {place or 'you'}", "refs": [{"kind": "job", "slug": role}]},
            {"kind": "job", "title": "Apply to one opening", "refs": [{"kind": "job", "slug": role}]},
            community_step()]


MONEY_GOAL = re.compile(r"earn|₹|rs\.?|rupee|money|income|kamana|kamai|पैसे|कमाई|कमाना|कमवा", re.IGNORECASE)


def custom_steps(title: str, target: date | None, facts: dict) -> list[dict]:
    steps = [{"kind": "task", "title": "Write down 3 small steps toward this goal"},
             {"kind": "task", "title": "Do the first small step"}]
    if MONEY_GOAL.search(title or ""):
        steps.insert(0, {"kind": "scheme", "title": "Check money that needs no work: scholarships and schemes",
                         "refs": [{"kind": "activity", "slug": "money"}]})
        if not wr.is_minor(facts.get("age")) and facts.get("age") is not None:
            steps.append({"kind": "job", "title": "Find part-time or apprenticeship work near you", "refs": [{"kind": "job", "slug": "part-time"}]})
        else:
            steps.append({"kind": "course", "title": "Learn one skill you can earn from at 18", "refs": [{"kind": "skill", "slug": "earn"}]})
    steps.append(community_step())
    if target:
        steps.append({"kind": "milestone", "title": f"Reach: {title}"[:200], "due_date": target.isoformat()})
    return steps


# ---------------------------------------------------------------- reading

def _norm_step(r: dict) -> dict:
    s = dict(r)
    if "status" not in s or s["status"] is None:  # before 0018
        s["status"] = "done" if s.get("done_at") else "todo"
        s["progress"] = 100 if s.get("done_at") else 0
        s["hard_deadline"] = bool(s.get("due_date")) and s["kind"] in ("exam", "program", "milestone")
        s["refs"] = [{"kind": s["kind"] if s["kind"] != "course" else "resource", "slug": s["ref_id"]}] if s.get("ref_id") else []
        s.update(at_risk=False, optional=False, origin="plan", parent_step_id=None, done_by="student" if s.get("done_at") else None)
    s["goal_id"] = s.get("pathway_id")
    return eng.with_copy(s)


def _goals(user_id: str, full: bool) -> list[dict]:
    rows = get_db().table("pathways").select(GOAL_COLS if full else GOAL_LEGACY).eq("user_id", user_id) \
        .order("created_at").execute().data or []
    for g in rows:
        g.setdefault("kind", "career")
    return rows


def _steps(goal_ids: list[str], full: bool) -> list[dict]:
    if not goal_ids:
        return []
    rows = get_db().table("pathway_steps").select(STEP_COLS if full else STEP_LEGACY).in_("pathway_id", goal_ids) \
        .order("position").execute().data or []
    return [_norm_step(r) for r in rows]


def _load(user_id: str) -> tuple[list[dict], list[dict], bool]:
    full = ready()
    goals = _goals(user_id, full)
    return goals, _steps([g["id"] for g in goals], full), full


def _rows(table: str, user_id: str, cols: str = "*", since_days: int | None = None, order: str = "created_at", limit: int = 200, **eq) -> list[dict]:
    try:
        q = get_db().table(table).select(cols).eq("user_id", user_id)
        for k, v in eq.items():
            q = q.eq(k, v)
        if since_days:
            q = q.gte("created_at", (now() - timedelta(days=since_days)).isoformat())
        return q.order(order, desc=True).limit(limit).execute().data or []
    except Exception as e:  # noqa: BLE001
        log.warning("%s read skipped: %s", table, str(e)[:160])
        return []


def _state(user_id: str) -> dict:
    try:
        r = get_db().table("roadmap_state").select("*").eq("user_id", user_id).maybe_single().execute()
        return (r.data if r else None) or {}
    except Exception:  # noqa: BLE001
        return {}


def _save_state(user_id: str, **fields) -> None:
    try:
        get_db().table("roadmap_state").upsert({"user_id": user_id, **fields, "updated_at": now().isoformat()}).execute()
    except Exception as e:  # noqa: BLE001
        log.warning("roadmap_state write skipped: %s", str(e)[:160])


def _signals(user_id: str) -> list[dict]:
    rows = _rows("roadmap_signals", user_id, "kind, value, detail, created_at, expires_at", since_days=eng.SIGNAL_DAYS, limit=50)
    t = now().isoformat()
    return [r for r in rows if not r.get("expires_at") or r["expires_at"] > t]


def _names(refs: list[dict]) -> list[dict]:
    g = graph()
    out = []
    for r in refs or []:
        k, slug = r.get("kind"), r.get("slug")
        table = {"career": g.careers, "exam": g.exams, "scheme": g.schemes, "program": g.programs}.get(k)
        name = (table.get(slug) or {}).get("name") if table and slug else (g.docs.get(slug) if k == "document" else None)
        out.append({**r, "name": name})
    return out


def _step_out(s: dict, bucket: str, today: date) -> dict:
    keys = ("id", "goal_id", "position", "kind", "ref_id", "title", "detail", "due_date", "done_at", "status", "progress", "subtasks",
            "hard_deadline", "at_risk", "why", "now_text", "copy_key", "optional", "origin", "parent_step_id", "done_by", "evidence")
    out = {k: s.get(k) for k in keys}
    out["progress"] = eng.step_progress(s)
    out["refs"] = _names(s.get("refs") or [])
    out["days_left"] = eng.days_left(s, today) if not eng.is_done(s) else None
    out["bucket"] = bucket
    return out


def get_roadmap(user_id: str, evaluate_first: bool = True, today: date | None = None) -> dict:
    today = today or _today()
    if evaluate_first and ready():
        st = _state(user_id)
        last = eng.to_dt(st.get("last_evaluated_at"))
        if not last or now() - last > EVAL_EVERY:
            try:
                evaluate(user_id, today)
            except Exception as e:  # noqa: BLE001 - showing the roadmap matters more
                log.warning("evaluate failed: %s", e)
    goals, steps, full = _load(user_id)
    facts = get_facts(user_id)
    by_goal: dict[str, list[dict]] = defaultdict(list)
    for s in steps:
        by_goal[s["goal_id"]].append(s)
    events = _rows("activity_events", user_id, "kind, ref, created_at", since_days=30, limit=300) if full else []
    signals = _signals(user_id) if full else []
    st = _state(user_id) if full else {}
    out_goals, paces, at_risk = [], [], []
    for g in goals:
        gs = by_goal.get(g["id"], [])
        started = eng.to_date(g.get("created_at")) or today
        p = eng.assess(gs, events, today, started, eng.to_dt(st.get("last_active_at")))
        if g["status"] == "active":
            paces.append(p["pace"])
        b = eng.buckets(gs, today)
        steps_out = [_step_out(s, b.get(s["id"], "later"), today) for s in eng.ordered(gs)]
        for s in steps_out:
            if s["hard_deadline"] and s["days_left"] is not None and s["days_left"] >= 0 and (s["at_risk"] or s["days_left"] <= eng.RISK_ALWAYS_DAYS) \
                    and g["status"] == "active":
                at_risk.append({"step_id": s["id"], "goal_id": g["id"], "title": s["title"], "days_left": s["days_left"]})
        out_goals.append({**{k: g.get(k) for k in ("id", "kind", "title", "career_slug", "program_slug", "exam_slug", "scheme_slug",
                                                   "target_date", "target_text", "status", "priority", "created_at", "source")},
                          "progress": eng.goal_progress(gs), "pace": p["pace"], "steps": steps_out})
    active = [g for g in out_goals if g["status"] == "active"]
    pace = eng.combine_pace(paces) if paces else "new"
    nxt = None
    for g in sorted(active, key=lambda g: (-(g.get("priority") or 0), g["created_at"] or "")):
        cand = [s for s in g["steps"] if s["bucket"] == "now"]
        cand.sort(key=lambda s: (s["kind"] != "micro", s["due_date"] or "9999"))
        if cand and (nxt is None or (cand[0]["due_date"] or "9999") < (nxt["due_date"] or "9999")):
            nxt = {**cand[0], "goal_title": g["title"], "goal_kind": g["kind"]}
    changes = _rows("roadmap_changes", user_id, "id, goal_id, step_id, kind, reason_code, reason, params, auto, created_at, undone_at",
                    since_days=45, limit=30) if full else []
    watches = _rows("watches", user_id, "id, kind, ref, query, label, active, last_checked_at, created_at", active=True) if full else []
    alerts = _rows("notifications", user_id, "id, kind, title, body, link, read_at, created_at", limit=40)
    alerts = [a for a in alerts if str(a.get("kind", "")).startswith("roadmap_")][:15]
    fresh = eng.to_dt(st.get("fresh_start_at"))
    return {
        "ready": full, "today": today.isoformat(), "pace": pace, "tone": eng.tone(pace, signals),
        "progress": eng.overall_progress([{"steps": by_goal.get(g["id"], [])} for g in goals if g["status"] == "active"]),
        "days_inactive": eng.assess(steps, events, today, min((eng.to_date(g["created_at"]) or today for g in goals), default=today),
                                    eng.to_dt(st.get("last_active_at")))["days_inactive"] if goals else 0,
        "fresh_start": bool(fresh and (now() - fresh).days < 7),
        "next": nxt, "at_risk": sorted(at_risk, key=lambda x: x["days_left"]), "goals": out_goals,
        "changes": [{**c, "can_undo": not c.get("undone_at") and c["kind"] not in ("watch_added",)} for c in changes],
        "watches": watches, "alerts": alerts,
        "signals": [{"kind": s["kind"], "value": s["value"]} for s in signals],
        "minor": wr.is_minor(facts.get("age")), "age_known": facts.get("age") is not None,
    }


def preview(user_id: str) -> dict:
    r = get_roadmap(user_id)
    return {k: r[k] for k in ("ready", "pace", "tone", "progress", "next", "fresh_start")} | {
        "at_risk": len(r["at_risk"]), "goals": len([g for g in r["goals"] if g["status"] == "active"])}


# ---------------------------------------------------------------- changes

def _snapshot(ids: list[str]) -> list[dict]:
    if not ids:
        return []
    return get_db().table("pathway_steps").select("id, due_date, position, status, progress, subtasks, at_risk, done_at, done_by, evidence") \
        .in_("id", ids).execute().data or []


def _apply(user_id: str, ch: dict) -> dict:
    db = get_db()
    before = _snapshot([u["id"] for u in ch["updates"]])
    for u in ch["updates"]:
        fields = {k: v for k, v in u.items() if k != "id"}
        db.table("pathway_steps").update({**fields, "updated_at": now().isoformat()}).eq("id", u["id"]).eq("pathway_id", ch["goal_id"]).execute()
    created = []
    if ch["creates"]:
        rows = [{k: v for k, v in c.items() if k != "params"} | {"pathway_id": ch["goal_id"]} for c in ch["creates"]]
        created = [r["id"] for r in db.table("pathway_steps").insert(rows).execute().data or []]
    row = db.table("roadmap_changes").insert({
        "user_id": user_id, "goal_id": ch["goal_id"], "step_id": ch.get("step_id"), "kind": ch["kind"], "reason_code": ch["reason_code"],
        "reason": ch["reason"], "params": ch.get("params") or {}, "before": before, "created_ids": created, "auto": ch.get("auto", True),
    }).execute().data[0]
    return row


def evaluate(user_id: str, today: date | None = None) -> list[dict]:
    """Run the fixed rules on the whole roadmap and apply what they decide, each change logged with a reason."""
    if not ready():
        return []
    today = today or _today()
    with _locks[user_id]:
        goals, steps, _ = _load(user_id)
        active = [g for g in goals if g["status"] == "active"]
        if not active:
            return []
        events = _rows("activity_events", user_id, "kind, ref, created_at", since_days=60, limit=400)
        signals = _signals(user_id)
        changes = _rows("roadmap_changes", user_id, "kind, goal_id, step_id, created_at, undone_at", since_days=60, limit=300)
        st = _state(user_id)
        facts = get_facts(user_id)
        gap, days, minor = eng.gap_days(facts, signals), eng.free_days(signals), wr.is_minor(facts.get("age"))
        started = min(eng.to_date(g["created_at"]) or today for g in active)
        last_active = eng.to_dt(st.get("last_active_at"))
        overall = eng.assess([s for s in steps if any(s["goal_id"] == g["id"] for g in active)], events, today, started, last_active)
        applied = []
        for g in active:
            gs = [s for s in steps if s["goal_id"] == g["id"]]
            p = eng.assess(gs, events, today, eng.to_date(g["created_at"]) or today, last_active)
            if overall["pace"] == "inactive" and p["pace"] != "done":
                p["pace"] = "inactive"
            for ch in eng.plan_changes(g, gs, p, signals, changes, today, gap, days, minor):
                try:
                    applied.append(_apply(user_id, ch))
                    changes.append({"kind": ch["kind"], "goal_id": g["id"], "step_id": ch.get("step_id"), "created_at": now().isoformat()})
                except Exception as e:  # noqa: BLE001 - one bad change must not stop the rest
                    log.warning("change %s failed: %s", ch["kind"], e)
        fields = {"pace": overall["pace"], "tone": eng.tone(overall["pace"], signals), "last_evaluated_at": now().isoformat()}
        if any(c["kind"] == "fresh_start" for c in applied):
            fields["fresh_start_at"] = now().isoformat()
            _notify(user_id, [{"key": f"fresh:{today.isoformat()}", "kind": "roadmap_change", "title": "A fresh start for your plan",
                               "body": "We made the next step small and moved soft dates. Nothing is lost.", "link": "/app/plan"}])
        _save_state(user_id, **fields)
        return applied


def undo_change(user_id: str, change_id: str) -> dict:
    if not ready():
        raise RoadmapError("not available yet")
    db = get_db()
    rows = db.table("roadmap_changes").select("*").eq("id", change_id).eq("user_id", user_id).execute().data
    if not rows:
        raise LookupError("change not found")
    c = rows[0]
    if c.get("undone_at"):
        return get_roadmap(user_id, evaluate_first=False)
    goal_ids = {g["id"] for g in _goals(user_id, True)}
    for b in c.get("before") or []:
        fields = {k: v for k, v in b.items() if k != "id"}
        q = db.table("pathway_steps").update({**fields, "updated_at": now().isoformat()}).eq("id", b["id"])
        q.in_("pathway_id", list(goal_ids)).execute()
    if c.get("created_ids"):
        db.table("pathway_steps").delete().in_("id", c["created_ids"]).in_("pathway_id", list(goal_ids)).execute()
    if c["kind"] == "goal_added" and (c.get("params") or {}).get("goal_id") in goal_ids:
        db.table("pathways").delete().eq("id", c["params"]["goal_id"]).eq("user_id", user_id).execute()
    db.table("roadmap_changes").update({"undone_at": now().isoformat()}).eq("id", change_id).execute()
    return get_roadmap(user_id, evaluate_first=False)


# ---------------------------------------------------------------- goals

def _log(user_id: str, goal_id: str | None, kind: str, code: str, reason: str, params: dict | None = None, auto: bool = False) -> None:
    if not ready():
        return
    try:
        get_db().table("roadmap_changes").insert({"user_id": user_id, "goal_id": goal_id, "kind": kind, "reason_code": code,
                                                  "reason": reason, "params": params or {}, "auto": auto}).execute()
    except Exception as e:  # noqa: BLE001
        log.warning("change log skipped: %s", e)


def add_goal(user_id: str, kind: str, career: str | None = None, program: str | None = None, exam: str | None = None,
             scheme: str | None = None, title: str | None = None, target_date: str | None = None, role: str | None = None,
             place: str | None = None, source: str = "student") -> dict:
    """Add one goal to the roadmap (deduped: the same active career / exam / scheme goal is returned as it is)."""
    g, db, facts = graph(), get_db(), get_facts(user_id)
    full = ready()
    target = eng.to_date(target_date)
    if kind == "career":
        from app.services import plans
        plan = plans.create_plan(user_id, career or "", program, source=source)
        if full and target:
            db.table("pathways").update({"target_date": target.isoformat()}).eq("id", plan["id"]).execute()
        return {"goal_id": plan["id"], "roadmap": get_roadmap(user_id, evaluate_first=False)}
    if not full and kind != "career":
        raise RoadmapError("Goals other than careers need the roadmap update (migration 0018).")
    existing = [x for x in _goals(user_id, True) if x["status"] == "active" and x["kind"] == kind and
                ((kind == "exam" and x.get("exam_slug") == exam) or (kind == "scheme" and x.get("scheme_slug") == scheme))]
    if existing:
        return {"goal_id": existing[0]["id"], "roadmap": get_roadmap(user_id, evaluate_first=False)}
    goal: dict = {"user_id": user_id, "kind": kind, "source": source, "target_date": target.isoformat() if target else None}
    if kind == "exam":
        if exam not in g.exams:
            raise RoadmapError("unknown exam")
        steps = exam_steps(exam, facts, target.year if target else None)
        goal.update(exam_slug=exam, title=title or g.exams[exam]["name"] + (f" {target.year}" if target else ""))
    elif kind == "scheme":
        if scheme not in g.schemes:
            raise RoadmapError("unknown scheme")
        steps = scheme_steps(scheme, facts)
        goal.update(scheme_slug=scheme, title=title or g.schemes[scheme]["name"])
    elif kind == "job":
        if not role:
            raise RoadmapError("which work?")
        steps = job_steps(role, place or facts.get("district") or "", facts)
        goal.update(title=title or (f"Work as {role}" if not wr.is_minor(facts.get("age")) else f"Skills for {role}"), target_text=role)
        try:
            add_watch(user_id, "job", query={"role": role, "place": place or facts.get("district")})
        except RoadmapError:
            pass
    elif kind == "custom":
        if not (title or "").strip():
            raise RoadmapError("say the goal in a few words")
        steps = custom_steps(title.strip(), target, facts)
        goal.update(title=title.strip()[:120], target_text=title.strip()[:200])
    elif kind == "program":
        if program not in g.programs:
            raise RoadmapError("unknown course")
        careers = g.program_careers.get(program) or []
        if careers:
            from app.services import plans
            plan = plans.create_plan(user_id, careers[0], program, source=source)
            return {"goal_id": plan["id"], "roadmap": get_roadmap(user_id, evaluate_first=False)}
        raise RoadmapError("this course has no career linked yet")
    else:
        raise RoadmapError("unknown goal kind")
    gid = db.table("pathways").insert(goal).execute().data[0]["id"]
    rows = prepare_steps(steps, facts, kind, signals=_signals(user_id))
    db.table("pathway_steps").insert([{**r, "pathway_id": gid} for r in rows]).execute()
    _log(user_id, gid, "goal_added", "goal_added_saathi" if source == "saathi" else "goal_added",
         f"Added the goal \"{goal['title']}\"" + (" from your chat with Saathi." if source == "saathi" else "."),
         {"goal_id": gid, "title": goal["title"]}, auto=source == "saathi")
    evaluate(user_id)
    return {"goal_id": gid, "roadmap": get_roadmap(user_id, evaluate_first=False)}


def _own_goal(user_id: str, goal_id: str) -> dict:
    rows = get_db().table("pathways").select(GOAL_LEGACY).eq("id", goal_id).eq("user_id", user_id).execute().data
    if not rows:
        raise LookupError("goal not found")
    return rows[0]


def update_goal(user_id: str, goal_id: str, patch: dict) -> dict:
    _own_goal(user_id, goal_id)
    allowed = {"title", "status"} | ({"target_date", "priority", "target_text"} if ready() else set())
    fields = {k: v for k, v in patch.items() if k in allowed and v is not None}
    if fields.get("status") not in (None, "active", "paused", "done"):
        raise RoadmapError("bad status")
    if fields:
        if ready():
            fields["updated_at"] = now().isoformat()
        get_db().table("pathways").update(fields).eq("id", goal_id).eq("user_id", user_id).execute()
    return get_roadmap(user_id, evaluate_first=False)


def delete_goal(user_id: str, goal_id: str) -> None:
    get_db().table("pathways").delete().eq("id", goal_id).eq("user_id", user_id).execute()


def _own_step(user_id: str, step_id: str) -> tuple[dict, dict]:
    full = ready()
    rows = get_db().table("pathway_steps").select(STEP_COLS if full else STEP_LEGACY).eq("id", step_id).execute().data
    if not rows:
        raise LookupError("step not found")
    goal = _own_goal(user_id, rows[0]["pathway_id"])
    return _norm_step(rows[0]), goal


def update_step(user_id: str, step_id: str, status: str | None = None, progress: int | None = None,
                subtask: dict | None = None, due_date: str | None = None) -> dict:
    """The student's own change to a step ("you marked it")."""
    s, goal = _own_step(user_id, step_id)
    db = get_db()
    if not ready():
        if status in ("done", "todo"):
            db.table("pathway_steps").update({"done_at": "now()" if status == "done" else None}).eq("id", step_id).execute()
        return get_roadmap(user_id, evaluate_first=False)
    f: dict = {}
    if subtask and subtask.get("id"):
        subs = [{**t, "done": bool(subtask.get("done"))} if t.get("id") == subtask["id"] else t for t in (s.get("subtasks") or [])]
        f["subtasks"] = subs
        progress = eng.progress_from_subtasks(subs)
        status = status or ("done" if progress == 100 else "doing" if progress else "todo")
    if progress is not None:
        f["progress"] = max(0, min(100, int(progress)))
        if f["progress"] == 100:
            status = status or "done"
        elif status is None:
            status = "doing" if f["progress"] else "todo"
    if status:
        if status not in ("todo", "doing", "done", "skipped", "blocked"):
            raise RoadmapError("bad status")
        f["status"] = status
        if status == "done":
            f.update(progress=100, done_at=now().isoformat(), done_by="student")
        else:
            f.update(done_at=None, done_by=None)
            if status == "todo" and "progress" not in f and s.get("status") == "done":
                f["progress"] = 0
    if due_date is not None:
        if s.get("hard_deadline"):
            raise RoadmapError("This date is fixed (exam, scheme or law), so it cannot be moved.")
        f["due_date"] = eng.to_date(due_date).isoformat() if eng.to_date(due_date) else None
    if f:
        f["updated_at"] = now().isoformat()
        db.table("pathway_steps").update(f).eq("id", step_id).eq("pathway_id", goal["id"]).execute()
        if f.get("status") == "done":  # helpers of a finished step are finished too
            db.table("pathway_steps").update({"status": "done", "progress": 100, "done_at": now().isoformat(), "done_by": "student"}) \
                .eq("parent_step_id", step_id).neq("status", "done").execute()
        record_event(user_id, "plan_step_toggled", step_id, {"status": f.get("status"), "by": "student"})
    return get_roadmap(user_id, evaluate_first=False)


# ---------------------------------------------------------------- events and evidence

EVIDENCE_REASON = {
    "lesson_completed": "Saathi noticed you finished a lesson.",
    "quiz_done": "Saathi noticed you did a quiz.",
    "riasec_done": "Saathi noticed you finished the interest quiz.",
    "fact_answered": "Saathi noticed you answered questions about yourself.",
    "scheme_viewed": "Saathi noticed you opened this scheme.",
    "scheme_applied": "Saathi noticed you applied.",
    "document_uploaded": "Saathi noticed you added this document.",
    "credential_issued": "Saathi noticed your teacher approved your skill.",
    "task_submitted": "Saathi noticed you sent your work for a skill.",
    "community_post": "Saathi noticed you asked in the community.",
    "community_answer": "Saathi noticed you helped someone in the community.",
    "job_viewed": "Saathi noticed you looked at openings.",
    "exam_viewed": "Saathi noticed you checked the exam.",
}


def _evidence(user_id: str, event: dict) -> dict | None:
    goals, steps, _ = _load(user_id)
    active = {g["id"] for g in goals if g["status"] == "active"}
    steps = [s for s in steps if s["goal_id"] in active]
    if event["kind"] == "fact_answered":
        facts = get_facts(user_id)
        slugs = {r["slug"] for s in steps for r in (s.get("refs") or []) if r.get("kind") == "scheme"}
        event = {**event, "meta": {**(event.get("meta") or {}),
                                   "eligible": [x for x in slugs if (scheme_status(x, facts) or {}).get("result") == "eligible"]}}
    ups = eng.match_event(steps, event)
    if not ups:
        return None
    by_goal: dict[str, list[dict]] = defaultdict(list)
    for u in ups:
        s = next(x for x in steps if x["id"] == u["id"])
        extra = {"done_by": "evidence", "evidence": {"kind": event["kind"], "ref": event.get("ref"), "at": now().isoformat()}}
        if u["status"] == "done":
            extra["done_at"] = now().isoformat()
        by_goal[s["goal_id"]].append({**u, **extra})
    last = None
    for gid, us in by_goal.items():
        titles = [next(x for x in steps if x["id"] == u["id"])["title"] for u in us]
        last = _apply(user_id, {"kind": "evidence", "reason_code": f"evidence_{event['kind']}", "goal_id": gid,
                                "step_id": us[0]["id"], "reason": EVIDENCE_REASON.get(event["kind"], "Saathi noticed your progress."),
                                "updates": us, "creates": [], "params": {"steps": titles[:3], "count": len(us)}})
    return last


def record_event(user_id: str, kind: str, ref: str | None = None, meta: dict | None = None, background: bool | None = None) -> None:
    """Called by the routes that did the work. Never raises; runs in the background by default."""
    if kind not in eng.EVENT_KINDS or not user_id:
        return

    def work() -> None:
        try:
            if not ready():
                return
            db = get_db()
            db.table("activity_events").insert({"user_id": user_id, "kind": kind, "ref": (str(ref)[:300] if ref else None),
                                                "meta": meta or {}}).execute()
            st = _state(user_id)
            _save_state(user_id, last_active_at=now().isoformat())
            moved = _evidence(user_id, {"kind": kind, "ref": ref, "meta": meta or {}}) if kind not in QUIET_EVENTS else None
            last = eng.to_dt(st.get("last_evaluated_at"))
            idle = eng.to_dt(st.get("last_active_at"))
            back = idle and now() - idle >= timedelta(days=eng.INACTIVE_DAYS)
            if moved or back or not last or now() - last > timedelta(minutes=30) or kind not in QUIET_EVENTS:
                evaluate(user_id)
        except Exception as e:  # noqa: BLE001 - recording activity must never break the route
            log.warning("record_event %s failed: %s", kind, str(e)[:200])

    if BACKGROUND if background is None else background:
        threading.Thread(target=work, name=f"event-{kind}", daemon=True).start()
    else:
        work()


# ---------------------------------------------------------------- signals from Saathi

def capture_signals(user_id: str, text: str, career_lookup=None) -> list[dict]:
    """Store what this message says about worries, time, money, mood and goals. Returns every active signal."""
    found = eng.extract_signals(text, career_lookup)
    if not ready():
        return found
    have = _signals(user_id)
    recent = {(s["kind"], s["value"]) for s in have if (now() - (eng.to_dt(s["created_at"]) or now())).days < 3}
    new = [s for s in found if (s["kind"], s["value"]) not in recent]
    if new:
        try:
            get_db().table("roadmap_signals").insert([{"user_id": user_id, **s, "source": "saathi"} for s in new]).execute()
        except Exception as e:  # noqa: BLE001
            log.warning("signals skipped: %s", e)
            return found
        if any(s["kind"] in ("worry", "money", "time", "mood") for s in new):
            try:
                evaluate(user_id)
            except Exception as e:  # noqa: BLE001
                log.warning("evaluate after signals failed: %s", e)
    return [*found, *[s for s in have if (s["kind"], s["value"]) not in {(f["kind"], f["value"]) for f in found}]]


def ease(user_id: str) -> list[dict]:
    """The student asked for smaller steps: record a worry signal and re-evaluate."""
    if not ready():
        return []
    get_db().table("roadmap_signals").insert({"user_id": user_id, "kind": "worry", "value": "asked_easier", "source": "student"}).execute()
    return evaluate(user_id)


# ---------------------------------------------------------------- watchlist

def add_watch(user_id: str, kind: str, ref: str | None = None, query: dict | None = None, label: str | None = None) -> dict:
    """Watch a job search, exam or scheme. A minor's job watch becomes a skills-and-scholarships watch
    (or non-hazardous apprenticeships at 14-17), because the law decides what they may be alerted about."""
    if not ready():
        raise RoadmapError("Alerts need the roadmap update (migration 0018).")
    g, facts = graph(), get_facts(user_id)
    query = dict(query or {})
    converted = None
    if kind == "job":
        role = (query.get("role") or ref or "").strip()
        if not role:
            raise RoadmapError("which work?")
        query["role"], query["place"] = role, (query.get("place") or facts.get("district") or "")
        age = facts.get("age")
        if age is None:
            converted = "age_needed"
        elif wr.is_minor(age):
            rules = wr.work_rules(age)
            if rules.get("can_apprentice") and not _hazardous(role):
                query["apprenticeship"], converted = True, "apprenticeship"
            else:
                kind, converted = "skill", "skill"
        ref = f"{role.lower()}|{str(query['place']).lower()}"
        label = label or role
    elif kind == "exam":
        if ref not in g.exams:
            raise RoadmapError("unknown exam")
        label = label or g.exams[ref]["name"]
    elif kind == "scheme":
        if ref not in g.schemes:
            raise RoadmapError("unknown scheme")
        label = label or g.schemes[ref]["name"]
    elif kind != "skill":
        raise RoadmapError("unknown watch")
    row = get_db().table("watches").upsert({"user_id": user_id, "kind": kind, "ref": ref, "query": query, "label": label, "active": True},
                                            on_conflict="user_id,kind,ref").execute().data[0]
    return {"watch": row, "converted": converted}


def list_watches(user_id: str) -> list[dict]:
    return _rows("watches", user_id, "id, kind, ref, query, label, active, last_checked_at, created_at", active=True) if ready() else []


def delete_watch(user_id: str, watch_id: str) -> None:
    if ready():
        get_db().table("watches").update({"active": False}).eq("id", watch_id).eq("user_id", user_id).execute()


def _notify(user_id: str, items: list[dict]) -> int:
    if not items:
        return 0
    rows = [{"user_id": user_id, "kind": i["kind"], "title": i["title"], "body": i.get("body"), "link": i.get("link"), "dedupe_key": i["key"]}
            for i in items]
    try:
        res = get_db().table("notifications").upsert(rows, on_conflict="user_id,dedupe_key", ignore_duplicates=True).execute()
        return len(res.data or [])
    except Exception as e:  # noqa: BLE001
        log.warning("notifications skipped: %s", str(e)[:160])
        return 0


def _lang(user_id: str) -> str:
    try:
        r = get_db().table("profiles").select("preferred_language").eq("id", user_id).maybe_single().execute()
        return ((r.data if r else None) or {}).get("preferred_language") or "en"
    except Exception:  # noqa: BLE001
        return "en"


def check_alerts(user_id: str, today: date | None = None) -> int:
    """Today's alerts for one student: roadmap deadlines and everything they watch."""
    if not ready():
        return 0
    from app.services import knowledge
    today = today or _today()
    g, facts, lang = graph(), get_facts(user_id), _lang(user_id)
    goals, steps, _ = _load(user_id)
    active = {x["id"] for x in goals if x["status"] == "active"}
    items = al.deadline_alerts([s for s in steps if s["goal_id"] in active], today, lang)
    db = get_db()
    for w in list_watches(user_id):
        try:
            if w["kind"] == "exam" and w["ref"] in g.exams:
                e = g.exams[w["ref"]]
                items += al.exam_alerts({"slug": w["ref"], "name": e["name"]}, next_window(e.get("typical_months") or [], today), today, lang)
            elif w["kind"] == "scheme" and w["ref"] in g.schemes:
                st = scheme_status(w["ref"], facts)
                items += al.scheme_alerts(g.schemes[w["ref"]], (st or {}).get("result"), today, lang)
            elif w["kind"] == "job":
                q = w.get("query") or {}
                found = knowledge.find(["job", "apprenticeship"], facts.get("state"), q.get("place") or None, limit=200)
                items += al.job_alerts(w, found, facts, today, wr.work_rules(facts.get("age")), _hazardous(q.get("role") or ""), lang)
                if wr.is_minor(facts.get("age")):
                    items += al.skill_alerts(w, knowledge.find(["scholarship"], facts.get("state"), limit=100), today, lang)
            elif w["kind"] == "skill":
                items += al.skill_alerts(w, knowledge.find(["scholarship"], facts.get("state"), limit=100), today, lang)
            db.table("watches").update({"last_checked_at": now().isoformat()}).eq("id", w["id"]).execute()
        except Exception as e:  # noqa: BLE001
            log.warning("watch %s failed: %s", w.get("id"), str(e)[:160])
    return _notify(user_id, items)


def run_daily(today: date | None = None) -> dict:
    """Re-evaluate every active roadmap and send today's alerts."""
    if not ready():
        return {"users": 0}
    db = get_db()
    users = {r["user_id"] for r in db.table("pathways").select("user_id").eq("status", "active").limit(5000).execute().data or []}
    users |= {r["user_id"] for r in db.table("watches").select("user_id").eq("active", True).limit(5000).execute().data or []}
    sent = changed = 0
    for u in users:
        try:
            changed += len(evaluate(u, today))
            sent += check_alerts(u, today)
        except Exception as e:  # noqa: BLE001
            log.warning("daily roadmap for %s failed: %s", u, str(e)[:160])
    return {"users": len(users), "changes": changed, "alerts": sent}


_daily_started = False


def start_daily() -> None:
    """A background thread: once a day, re-evaluate roadmaps and send alerts."""
    global _daily_started
    if _daily_started:
        return
    _daily_started = True

    def loop() -> None:
        time.sleep(120)
        while True:
            try:
                log.info("daily roadmap run: %s", run_daily())
            except Exception as e:  # noqa: BLE001
                log.warning("daily roadmap run failed: %s", e)
            time.sleep(24 * 3600)

    threading.Thread(target=loop, name="roadmap-daily", daemon=True).start()


# ---------------------------------------------------------------- Saathi

def card(user_id: str) -> tuple[dict, str]:
    """The roadmap card for the chat and a one-line summary for the model."""
    r = get_roadmap(user_id)
    goals = [g for g in r["goals"] if g["status"] == "active"]
    nxt = r["next"]
    c = {"type": "roadmap", "ready": r["ready"], "progress": r["progress"], "pace": r["pace"], "tone": r["tone"],
         "fresh_start": r["fresh_start"], "at_risk": r["at_risk"][:3],
         "next": {k: nxt.get(k) for k in ("id", "goal_id", "title", "kind", "due_date", "days_left", "now_text", "copy_key", "goal_title",
                                           "hard_deadline", "parent_step_id", "progress")} if nxt else None,
         "goals": [{"id": g["id"], "title": g["title"], "kind": g["kind"], "progress": g["progress"], "career_slug": g.get("career_slug")}
                   for g in goals][:5],
         "changes": [{k: x.get(k) for k in ("id", "kind", "reason_code", "reason", "params", "created_at")}
                     for x in r["changes"] if not x.get("undone_at")][:2]}
    line = (f"roadmap {r['progress']}% done, {len(goals)} goals, pace {r['pace']}; next step: {nxt['title']}"
            + (f" (in {nxt['days_left']} days)" if nxt and nxt.get("days_left") is not None else "") if nxt else
            f"roadmap {r['progress']}% done, {len(goals)} goals, no next step")
    if r["at_risk"]:
        line += f"; fixed dates close: {', '.join(a['title'] + ' in ' + str(a['days_left']) + ' days' for a in r['at_risk'][:2])}"
    if c["changes"]:
        line += f"; changed for them: {c['changes'][0]['reason']}"
    return c, line


TONE_HINT = {
    "reassure": "The student feels worried. Be warm and calm; say the steps were made smaller and they can go one small step at a time.",
    "welcome_back": "The student is back after a break. Welcome them warmly; never mention missed days or lost progress.",
    "money": "Money is tight at home. Money that needs no work (scholarships) comes first.",
    "busy": "The student has little free time. Keep steps small and few.",
    "gentle": "Be gentle and encouraging; suggest one small step.",
    "cheer": "The student is ahead of plan. Praise the effort briefly.",
}


def saathi_hint(user_id: str, signals: list[dict] | None = None) -> str:
    """A short line for Saathi's prompt: tone and the next step, so replies fit how the student is doing."""
    if not ready():
        return TONE_HINT.get(eng.tone("new", signals or []), "")
    st = _state(user_id)
    t = eng.tone(st.get("pace") or "new", signals if signals is not None else _signals(user_id))
    return TONE_HINT.get(t, "")
