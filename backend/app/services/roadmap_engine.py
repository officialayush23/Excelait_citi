"""The roadmap's fixed rules. Pure functions, no database, no model: given steps, activity events,
signals from conversation and today's date, decide the pace and the automatic changes.

Rules (see docs/roadmap-design.md):
- Hard deadlines (exam windows, scheme deadlines, the legal age gate, board exams, admissions) never move.
  They are flagged "at risk" with the days left.
- inactive (no activity for INACTIVE_DAYS) -> a fresh start from next Monday: soft dates re-spaced and the
  next step split into a 10-minute micro-step. Nothing is "lost"; no streak, no guilt.
- behind (soft steps overdue, or progress well under the dates) -> re-space soft dates and split the next step.
- ahead -> one optional stretch step and the next soft date pulled in by up to a week.
- worry -> smaller steps; money pressure -> money that needs no work (and, for adults, earning) first;
  time available -> spacing between steps.
- A change the student undid is not made again for UNDO_QUIET_DAYS (their choice wins)."""

from __future__ import annotations

import re
from datetime import date, datetime, timedelta, timezone
from typing import Callable, Iterable

INACTIVE_DAYS = 7
DEFAULT_GAP = 7
UNDO_QUIET_DAYS = 14
FRESH_START_QUIET_DAYS = 14
STRETCH_QUIET_DAYS = 30
SIGNAL_DAYS = 21
RISK_ALWAYS_DAYS = 7
RISK_WHEN_BEHIND_DAYS = 30

DONE = {"done", "skipped"}
# Kinds whose date is a real-world date (or the end goal) and must never be moved by pacing.
FIXED_KINDS = {"exam", "program", "milestone"}
# Steps counted for progress (micro and stretch steps are helpers).
HELPER_KINDS = {"micro", "stretch"}
WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]


# ---------------------------------------------------------------- small helpers

def to_date(x) -> date | None:
    if x is None or x == "":
        return None
    if isinstance(x, datetime):
        return x.date()
    if isinstance(x, date):
        return x
    s = str(x)
    try:
        if len(s) == 7:  # YYYY-MM
            return date.fromisoformat(f"{s}-01")
        return date.fromisoformat(s[:10])
    except ValueError:
        return None


def to_dt(x) -> datetime | None:
    if x is None:
        return None
    if isinstance(x, datetime):
        return x if x.tzinfo else x.replace(tzinfo=timezone.utc)
    try:
        d = datetime.fromisoformat(str(x).replace("Z", "+00:00"))
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    except ValueError:
        d2 = to_date(x)
        return datetime(d2.year, d2.month, d2.day, tzinfo=timezone.utc) if d2 else None


def is_done(s: dict) -> bool:
    return s.get("status") in DONE


def counted(s: dict) -> bool:
    return s.get("kind") not in HELPER_KINDS and not s.get("optional") and s.get("status") != "skipped"


def is_hard(s: dict) -> bool:
    return bool(s.get("hard_deadline"))


def movable(s: dict) -> bool:
    """A soft date that pacing may move."""
    return bool(s.get("due_date")) and not is_hard(s) and s.get("kind") not in FIXED_KINDS and not is_done(s)


def ordered(steps: Iterable[dict]) -> list[dict]:
    return sorted(steps, key=lambda s: (s.get("position") or 0, s.get("kind") != "micro"))


def next_monday(today: date) -> date:
    return today + timedelta(days=(7 - today.weekday()) % 7)


def snap(d: date, days: list[str] | None) -> date:
    """Move a date forward to the next weekday the student said they are free (e.g. only Sundays)."""
    allowed = [WEEKDAYS.index(x) for x in (days or []) if x in WEEKDAYS]
    if not allowed:
        return d
    for k in range(7):
        if (d + timedelta(days=k)).weekday() in allowed:
            return d + timedelta(days=k)
    return d


def gap_days(facts: dict | None, signals: list[dict] | None) -> int:
    """Days between soft steps: from what the student said about their time, else a week."""
    hours = None
    for s in signals or []:
        if s.get("kind") == "time":
            det = s.get("detail") or {}
            if det.get("hours_per_week"):
                hours = det["hours_per_week"]
            elif s.get("value") in ("sundays", "weekends", "one_day"):
                hours = hours or 4
            elif s.get("value") == "busy":
                hours = hours or 3
    if hours is None and facts and isinstance(facts.get("hours_per_week"), (int, float)):
        hours = facts["hours_per_week"]
    if hours is None:
        return DEFAULT_GAP
    return 14 if hours <= 3 else 10 if hours <= 6 else 7 if hours <= 14 else 5


def free_days(signals: list[dict] | None) -> list[str]:
    for s in signals or []:
        if s.get("kind") == "time" and (s.get("detail") or {}).get("days"):
            return list(s["detail"]["days"])
    return []


def active_signals(signals: list[dict] | None, today: date) -> list[dict]:
    out = []
    for s in signals or []:
        at = to_dt(s.get("created_at"))
        if at is None or (today - at.date()).days <= SIGNAL_DAYS:
            out.append(s)
    return out


def has_signal(signals: list[dict], kind: str, value: str | None = None) -> bool:
    return any(s.get("kind") == kind and (value is None or s.get("value") == value) for s in signals)


# ---------------------------------------------------------------- progress and grouping

def step_progress(s: dict) -> int:
    if s.get("status") == "done":
        return 100
    return max(0, min(100, int(s.get("progress") or 0)))


def goal_progress(steps: list[dict]) -> int:
    cs = [s for s in steps if counted(s)]
    if not cs:
        return 0
    return round(sum(step_progress(s) for s in cs) / len(cs))


def overall_progress(goals: list[dict]) -> int:
    """Weighted by the number of counted steps in each goal."""
    total = sum(len([s for s in g["steps"] if counted(s)]) for g in goals)
    if not total:
        return 0
    return round(sum(goal_progress(g["steps"]) * len([s for s in g["steps"] if counted(s)]) for g in goals) / total)


def waiting(s: dict, today: date) -> bool:
    """A step the student cannot act on yet: blocked, or a dated milestone still in the future."""
    if s.get("status") == "blocked":
        return True
    d = to_date(s.get("due_date"))
    return s.get("kind") == "milestone" and d is not None and d > today


def buckets(steps: list[dict], today: date) -> dict[str, str]:
    """Now / Next / Later for one goal. Now = the first thing to act on (and anything already started)."""
    out: dict[str, str] = {}
    todo = [s for s in ordered(steps) if not is_done(s)]
    for s in steps:
        if is_done(s):
            out[s["id"]] = "done"
    actionable = [s for s in todo if not waiting(s, today)]
    now_ids = {s["id"] for s in actionable if s.get("status") == "doing"}
    if actionable:
        first = actionable[0]
        now_ids.add(first["id"])
        # a micro-step and its parent are both "now"
        if first.get("parent_step_id"):
            now_ids.add(first["parent_step_id"])
    nxt = [s for s in actionable if s["id"] not in now_ids][:2]
    for s in todo:
        out[s["id"]] = "now" if s["id"] in now_ids else "next" if s in nxt else "later"
    return out


def next_step(steps: list[dict], today: date) -> dict | None:
    b = buckets(steps, today)
    for s in ordered(steps):
        if b.get(s["id"]) == "now":
            return s
    return None


def days_left(s: dict, today: date) -> int | None:
    d = to_date(s.get("due_date"))
    return (d - today).days if d else None


# ---------------------------------------------------------------- pace

def assess(steps: list[dict], events: list[dict], today: date, started: date | None = None,
           last_active: datetime | None = None) -> dict:
    """on_track / ahead / behind / inactive / new / done for a set of steps, from dates and activity."""
    cs = [s for s in steps if counted(s)]
    started = started or today
    times = [t for t in (to_dt(e.get("created_at")) for e in events) if t]
    if last_active:
        times.append(last_active)
    last = max(times) if times else None
    idle = (today - (last.date() if last else started)).days
    age = (today - started).days
    overdue = [s["id"] for s in cs if movable(s) and to_date(s["due_date"]) < today]
    # a fixed date already gone (an exam taken but not ticked) is not "behind": nothing can be done about it
    dated = [s for s in cs if (d := to_date(s.get("due_date"))) and not (is_hard(s) and d < today)]
    expected = (sum(1 for s in dated if to_date(s["due_date"]) <= today) / len(dated)) if dated else 0.0
    actual = (sum(step_progress(s) for s in dated) / (100 * len(dated))) if dated else 0.0
    recent_done = sum(1 for s in cs if s.get("status") == "done" and (d := to_dt(s.get("done_at") or s.get("updated_at")))
                      and (today - d.date()).days <= 14)
    risk = []
    for s in cs:
        if is_hard(s) and not is_done(s):
            dl = days_left(s, today)
            if dl is not None and dl >= 0:
                risk.append({"id": s["id"], "days_left": dl, "title": s.get("title")})
    if cs and all(is_done(s) for s in cs):
        pace = "done"
    elif idle >= INACTIVE_DAYS and age >= INACTIVE_DAYS:
        pace = "inactive"
    elif overdue or (dated and actual + 0.2 < expected):
        pace = "behind"
    elif idle <= 3 and (recent_done >= 3 or (dated and actual - expected >= 0.25 and recent_done >= 1)):
        pace = "ahead"
    elif age < 2 and not any(step_progress(s) for s in cs):
        pace = "new"
    else:
        pace = "on_track"
    return {"pace": pace, "days_inactive": idle, "overdue": overdue, "expected": round(expected, 2),
            "actual": round(actual, 2), "recent_done": recent_done, "hard": risk}


PACE_ORDER = ["inactive", "behind", "on_track", "new", "ahead", "done"]


def combine_pace(paces: list[str]) -> str:
    for p in PACE_ORDER:
        if p in paces:
            return p
    return "new"


def tone(pace: str, signals: list[dict]) -> str:
    """How the app and Saathi speak this week."""
    if has_signal(signals, "worry"):
        return "reassure"
    if pace == "inactive":
        return "welcome_back"
    if has_signal(signals, "money"):
        return "money"
    if has_signal(signals, "mood", "low"):
        return "gentle"
    if has_signal(signals, "time"):
        return "busy"
    if pace == "ahead":
        return "cheer"
    if pace == "behind":
        return "gentle"
    return "neutral"


# ---------------------------------------------------------------- step copy (what to do now)

COPY = {
    "exam": ("This exam is a door on your path. Its date is fixed, so we plan around it.",
             "Open last year's paper and try 10 questions.",
             [("dates", "Check the official date and who can sit"), ("syllabus", "Get the syllabus"),
              ("paper", "Try one old paper"), ("form", "Fill the form when it opens")]),
    "program": ("This course is the main route to the work you want.", "List 3 colleges near you that offer it.",
                [("entry", "Check who can join"), ("colleges", "Find 3 colleges near you"),
                 ("dates", "Note the admission dates"), ("apply", "Apply")]),
    "scheme": ("Money that needs no work. It helps pay for your studies.", "Open the scheme and see what it asks for.",
               [("check", "Check if you qualify"), ("docs", "Get the documents ready"),
                ("apply", "Apply on the official site"), ("save", "Save the application number")]),
    "document": ("A scheme or admission will ask for this.", "Ask at home if you already have it.",
                 [("have", "Find out if you have it"), ("get", "Get a copy"), ("keep", "Keep a photo safe")]),
    "course": ("Free learning that builds the skill step by step.", "Open it and finish the first lesson.",
               [("open", "Open the course"), ("first", "Finish lesson 1"), ("half", "Reach half way"), ("finish", "Finish it")]),
    "lesson": ("Practice makes the next step easier.", "Do one lesson today.", []),
    "milestone": ("A point on your path. Its date is set by school, law or your goal.", "Keep going with the step before it.", []),
    "milestone_gate": ("The law sets this age. We keep this date as it is and use the time to build skills.",
                       "Use this time for studies and free skill training.", []),
    "task": ("A small step that moves you forward.", "Spend 10 minutes on it today.", []),
    "community": ("People who walked this path can save you months.", "Ask one question in the community.",
                  [("ask", "Ask one question"), ("read", "Read two answers")]),
    "job": ("Earning while you learn, safely and fairly paid.", "Look at 3 openings near you.",
            [("cv", "Write a simple CV"), ("look", "Look at 3 openings"), ("apply", "Apply to one")]),
    "micro": ("A small start is still a start.", "Set a 10-minute timer and begin.", []),
    "stretch": ("You are moving fast. This is extra, only if you want.", "Try it when you have energy.", []),
    "custom": ("Your own goal.", "Write the very first small step.", []),
    "skill": ("Skills you can show open doors.", "Practise for 10 minutes.", []),
}


def copy_key(s: dict) -> str:
    if s.get("kind") == "milestone" and str(s.get("title", "")).startswith("Eligible from age"):
        return "milestone_gate"
    return s.get("kind") if s.get("kind") in COPY else "task"


def with_copy(s: dict) -> dict:
    """Fill why / what-to-do-now / sub-tasks when a step has none (old plans, or before migration 0018)."""
    k = copy_key(s)
    why, now, subs = COPY[k]
    out = dict(s)
    out.setdefault("copy_key", k)
    if not out.get("copy_key"):
        out["copy_key"] = k
    if not out.get("why"):
        out["why"] = why
    if not out.get("now_text"):
        out["now_text"] = now
    if not out.get("subtasks"):
        out["subtasks"] = [{"id": sid, "key": f"{k}.{sid}", "title": t, "done": False} for sid, t in subs]
    return out


def schedule_soft(steps: list[dict], today: date, gap: int = DEFAULT_GAP, days: list[str] | None = None) -> list[dict]:
    """Give undated actionable steps soft target dates, a gap apart, kept before the next hard date after them."""
    out = [dict(s) for s in ordered(steps)]
    k = 0
    for i, s in enumerate(out):
        if s.get("due_date") or is_done(s) or s.get("kind") in FIXED_KINDS or s.get("optional"):
            continue
        k += 1
        d = snap(today + timedelta(days=gap * k), days)
        limit = next((to_date(x["due_date"]) for x in out[i + 1:] if is_hard(x) and to_date(x.get("due_date"))), None)
        if limit and d >= limit:
            d = max(today + timedelta(days=1), limit - timedelta(days=1))
        s["due_date"] = d.isoformat()
    return out


# ---------------------------------------------------------------- automatic changes

def _recent(changes: list[dict], kind: str, today: date, days: int, goal_id=None, step_id=None, undone_only=False) -> bool:
    for c in changes:
        if c.get("kind") != kind:
            continue
        if goal_id is not None and c.get("goal_id") != goal_id:
            continue
        if step_id is not None and c.get("step_id") != step_id:
            continue
        if undone_only and not c.get("undone_at"):
            continue
        at = to_dt(c.get("undone_at") if undone_only else c.get("created_at"))
        if at and (today - at.date()).days <= days:
            return True
    return False


def _declined(changes: list[dict], kind: str, today: date, goal_id=None, step_id=None) -> bool:
    return _recent(changes, kind, today, UNDO_QUIET_DAYS, goal_id, step_id, undone_only=True)


def _live(changes: list[dict], kind: str, goal_id=None, step_id=None) -> bool:
    return any(c.get("kind") == kind and not c.get("undone_at") and (goal_id is None or c.get("goal_id") == goal_id)
               and (step_id is None or c.get("step_id") == step_id) for c in changes)


def respace(steps: list[dict], start: date, gap: int, days: list[str] | None = None, only: set | None = None) -> list[dict]:
    """New soft dates from `start`, a gap apart, in order; never past the next hard date after a step.
    Returns [{id, due_date}] for steps whose date changes."""
    out, k = [], 0
    seq = ordered(steps)
    for i, s in enumerate(seq):
        if not movable(s) or (only is not None and s["id"] not in only) or s.get("kind") in HELPER_KINDS:
            continue
        d = snap(start + timedelta(days=gap * k), days)
        k += 1
        limit = next((to_date(x["due_date"]) for x in seq[i + 1:] if is_hard(x) and not is_done(x) and to_date(x.get("due_date"))), None)
        if limit and d >= limit:
            d = max(start, limit - timedelta(days=1))
        if d.isoformat() != str(s.get("due_date"))[:10]:
            out.append({"id": s["id"], "due_date": d.isoformat()})
    return out


def micro_for(parent: dict, today: date, days: list[str] | None = None, reason: str = "behind") -> dict:
    first = next((t for t in (parent.get("subtasks") or []) if not t.get("done")), None)
    title = f"10 minutes: {first['title'] if first else parent['title']}"
    return {"kind": "micro", "title": title[:200], "origin": "adapt", "parent_step_id": parent["id"],
            "position": parent.get("position") or 0, "due_date": snap(today + timedelta(days=1), days).isoformat(),
            "copy_key": "micro", "why": COPY["micro"][0], "now_text": COPY["micro"][1], "status": "todo", "progress": 0,
            "subtasks": [], "refs": parent.get("refs") or [], "hard_deadline": False, "optional": False,
            "params": {"step": parent["title"], "sub": first["key"] if first else None, "reason": reason}}


STRETCH = {
    "exam": "Stretch: take one full mock test",
    "course": "Stretch: teach one thing you learnt to a friend",
    "scheme": "Stretch: help a friend check a scholarship",
    "program": "Stretch: visit or call one college",
    "default": "Stretch: ask a senior one question in the community",
}


def _change(kind: str, code: str, reason: str, goal_id, step_id=None, updates=None, creates=None, params=None) -> dict:
    return {"kind": kind, "reason_code": code, "reason": reason, "goal_id": goal_id, "step_id": step_id,
            "updates": updates or [], "creates": creates or [], "params": params or {}}


def plan_changes(goal: dict, steps: list[dict], pace: dict, signals: list[dict], changes: list[dict], today: date,
                 gap: int = DEFAULT_GAP, days: list[str] | None = None, minor: bool = False) -> list[dict]:
    """The automatic changes for one goal, in the order they should be applied. Each has a plain reason."""
    gid = goal["id"]
    out: list[dict] = []
    p = pace["pace"]
    if goal.get("status") not in (None, "active") or p == "done":
        return out
    sig = active_signals(signals, today)
    todo = [s for s in ordered(steps) if not is_done(s)]
    nxt = next_step(steps, today)
    has_micro = lambda s: any(x.get("parent_step_id") == s["id"] and not is_done(x) for x in steps)  # noqa: E731

    # 1. Hard deadlines: never moved, flagged with the days left.
    for s in todo:
        if not is_hard(s) or s.get("at_risk"):
            continue
        dl = days_left(s, today)
        if dl is None or dl < 0:
            continue
        if dl <= RISK_ALWAYS_DAYS or (p in ("behind", "inactive") and dl <= RISK_WHEN_BEHIND_DAYS):
            if _declined(changes, "at_risk", today, gid, s["id"]):
                continue
            out.append(_change("at_risk", "at_risk", f"{s['title']} has a fixed date in {dl} days. We kept it and moved other steps around it.",
                               gid, s["id"], [{"id": s["id"], "at_risk": True}], params={"days": dl, "step": s["title"]}))

    split_done = False
    # 2. Back after a break: a fresh start from next Monday.
    if p == "inactive" and not _recent(changes, "fresh_start", today, FRESH_START_QUIET_DAYS) and not _declined(changes, "fresh_start", today, gid):
        start = next_monday(today)
        if start == today:
            start = today
        ups = respace(steps, start, gap, days)
        creates = []
        if nxt and nxt.get("kind") != "micro" and not has_micro(nxt):
            creates.append(micro_for(nxt, today, days, "fresh_start"))
            split_done = True
        if ups or creates:
            out.append(_change("fresh_start", "fresh_start", "Welcome back. We gave your plan a fresh start from Monday and made the next step small. Nothing is lost.",
                               gid, nxt["id"] if nxt else None, ups, creates, {"start": start.isoformat(), "moved": len(ups)}))
    # 3. Behind: re-space overdue soft dates, then split the next step.
    elif p == "behind":
        late = {s for s in pace.get("overdue", []) if any(x["id"] == s for x in steps)}
        if late and not _declined(changes, "respace", today, gid):
            ups = respace(steps, today + timedelta(days=2), gap, days, only={s["id"] for s in todo if movable(s)})
            if ups:
                out.append(_change("respace", "respace_busy", "You've been busy, so we spaced out the next steps. Fixed dates did not move.",
                                   gid, None, ups, params={"moved": len(ups)}))
        if nxt and nxt.get("kind") != "micro" and not has_micro(nxt) and not _declined(changes, "split", today, gid, nxt["id"]):
            out.append(_change("split", "split_busy", f"We split \"{nxt['title']}\" into a smaller first step because you've been busy.",
                               gid, nxt["id"], creates=[micro_for(nxt, today, days, "behind")], params={"step": nxt["title"]}))
            split_done = True

    # 4. Worry (from what they told Saathi): smaller steps, no extra pressure.
    if (has_signal(sig, "worry") or has_signal(sig, "mood", "low")) and not split_done and nxt and nxt.get("kind") != "micro" \
            and not has_micro(nxt) and not _declined(changes, "split", today, gid, nxt["id"]):
        out.append(_change("split", "split_worry", f"You said this feels like a lot, so we made \"{nxt['title']}\" smaller. One small step at a time.",
                           gid, nxt["id"], creates=[micro_for(nxt, today, days, "worry")], params={"step": nxt["title"]}))

    # 5. Ahead: an optional stretch and the next soft date a little sooner.
    if p == "ahead" and not has_signal(sig, "worry"):
        if not _recent(changes, "stretch", today, STRETCH_QUIET_DAYS, gid) and not _declined(changes, "stretch", today, gid):
            base = nxt or (todo[0] if todo else None)
            kind = (base or {}).get("kind")
            title = STRETCH.get(kind, STRETCH["default"])
            out.append(_change("stretch", "stretch", "You are ahead of your plan. We added an optional extra step. Skip it if you like.",
                               gid, base["id"] if base else None,
                               creates=[{"kind": "stretch", "title": title, "origin": "adapt", "optional": True, "status": "todo", "progress": 0,
                                         "position": (base or {}).get("position", 0), "copy_key": "stretch", "why": COPY["stretch"][0],
                                         "now_text": COPY["stretch"][1], "subtasks": [], "refs": (base or {}).get("refs") or [],
                                         "hard_deadline": False, "parent_step_id": None,
                                         "due_date": snap(today + timedelta(days=7), days).isoformat(),
                                         "params": {"key": kind if kind in STRETCH else "default"}}],
                               params={"step": (base or {}).get("title")}))
        soft = next((s for s in todo if movable(s) and to_date(s["due_date"]) > today + timedelta(days=10)), None)
        if soft and not _declined(changes, "pull_in", today, gid, soft["id"]) and not _live(changes, "pull_in", gid, soft["id"]):
            new = max(today + timedelta(days=3), to_date(soft["due_date"]) - timedelta(days=7))
            out.append(_change("pull_in", "pull_in", f"You're moving fast, so \"{soft['title']}\" is now a week sooner.",
                               gid, soft["id"], [{"id": soft["id"], "due_date": new.isoformat()}], params={"step": soft["title"]}))

    # 6. Money pressure: money that needs no work first; earning alongside study for adults only.
    if has_signal(sig, "money") and not _live(changes, "reorder", gid) and not _declined(changes, "reorder", today, gid):
        money = [s for s in todo if s.get("kind") in ("scheme", "job") and not s.get("parent_step_id")]
        others = [s for s in todo if s not in money and s.get("kind") not in FIXED_KINDS and not s.get("parent_step_id")]
        creates = []
        if not minor and not any(s.get("kind") == "job" for s in steps) and goal.get("kind") in ("career", "program", "custom"):
            creates.append({"kind": "job", "title": "Find part-time or apprenticeship work near you", "origin": "adapt", "status": "todo",
                            "progress": 0, "position": (todo[0].get("position", 0) if todo else 0), "copy_key": "job",
                            "why": COPY["job"][0], "now_text": COPY["job"][1],
                            "subtasks": [{"id": a, "key": f"job.{a}", "title": b, "done": False} for a, b in COPY["job"][2]],
                            "refs": [{"kind": "career", "slug": goal.get("career_slug")}] if goal.get("career_slug") else [],
                            "hard_deadline": False, "optional": False, "parent_step_id": None,
                            "due_date": snap(today + timedelta(days=3), days).isoformat(), "params": {}})
        ups = []
        if money and others and min(o.get("position", 0) for o in others) < max(m.get("position", 0) for m in money):
            first = min(s.get("position", 0) for s in money + others)
            for k, s in enumerate(money + others):
                if s.get("position") != first + k:
                    ups.append({"id": s["id"], "position": first + k})
        if ups or creates:
            out.append(_change("reorder", "money_first" if minor or not creates else "earn_while_learning",
                               "Money is tight right now, so scholarships come first." if minor or not creates
                               else "Money is tight right now, so money that needs no work and earning while you learn come first.",
                               gid, None, ups, creates, {"minor": minor}))
    return out


# ---------------------------------------------------------------- evidence from activity

EVENT_KINDS = {"lesson_completed", "quiz_done", "riasec_done", "fact_answered", "scheme_viewed", "scheme_applied",
               "document_uploaded", "career_saved", "plan_step_toggled", "credential_issued", "task_submitted",
               "community_post", "community_answer", "saathi_turn", "job_viewed", "exam_viewed", "roadmap_opened"}
# Events the app may send by itself (views); the rest come from the server routes that did the work.
CLIENT_EVENTS = {"scheme_viewed", "job_viewed", "exam_viewed", "roadmap_opened", "document_uploaded", "scheme_applied"}


def _refs(s: dict, kind: str) -> set[str]:
    out = {r.get("slug") for r in (s.get("refs") or []) if r.get("kind") == kind and r.get("slug")}
    if s.get("kind") == kind and s.get("ref_id"):
        out.add(s["ref_id"])
    return out


def _tick(s: dict, key: str) -> list[dict] | None:
    subs = s.get("subtasks") or []
    if not any(t.get("id") == key and not t.get("done") for t in subs):
        return None
    return [{**t, "done": True} if t.get("id") == key else t for t in subs]


def match_event(steps: list[dict], event: dict) -> list[dict]:
    """Which steps this activity moves forward. Progress only goes up; a step is completed by evidence only
    when the activity is the step itself (applied to that scheme, uploaded that document, ...)."""
    kind, ref, meta = event.get("kind"), event.get("ref"), event.get("meta") or {}
    todo = [s for s in ordered(steps) if not is_done(s)]
    ups: dict[str, dict] = {}

    def bump(s: dict, progress: int, done: bool = False, sub: str | None = None, cap: int = 100) -> None:
        cur = ups.get(s["id"], {})
        p = max(step_progress(s), cur.get("progress", 0), min(cap, progress))
        u = {"id": s["id"], "progress": 100 if done else p, "status": "done" if done or p >= 100 else "doing"}
        subs = _tick(s, sub) if sub else None
        if subs:
            u["subtasks"] = subs
        if u["progress"] <= step_progress(s) and not subs and not done:
            return
        ups[s["id"]] = {**cur, **u}

    def helpers_of(kinds: set[str]) -> list[dict]:
        parents = {s["id"]: s for s in steps}
        return [s for s in todo if s.get("kind") == "micro" and parents.get(s.get("parent_step_id"), {}).get("kind") in kinds]

    if kind == "scheme_viewed":
        for s in todo:
            if ref in _refs(s, "scheme"):
                bump(s, 25, sub="check")
    elif kind == "scheme_applied":
        for s in todo:
            if ref in _refs(s, "scheme"):
                bump(s, 100, done=True)
    elif kind == "document_uploaded":
        for s in todo:
            if ref in _refs(s, "document"):
                bump(s, 100, done=True)
    elif kind == "fact_answered":
        for s in todo:
            if _refs(s, "scheme") & set(meta.get("eligible") or []):
                bump(s, 40, sub="check")
            if "profile" in _refs(s, "activity"):
                bump(s, 100, done=True)
    elif kind == "riasec_done":
        for s in todo:
            if "riasec" in _refs(s, "activity"):
                bump(s, 100, done=True)
    elif kind in ("lesson_completed", "quiz_done", "credential_issued", "task_submitted"):
        if kind == "credential_issued" and ref:
            for s in todo:
                if ref in _refs(s, "skill"):
                    bump(s, 100, done=True)
        for s in helpers_of({"course", "lesson", "exam", "skill", "task"}):
            bump(s, 100, done=True)
        course = next((s for s in todo if s.get("kind") in ("course", "lesson", "skill")), None)
        step = {"lesson_completed": 25, "quiz_done": 15, "credential_issued": 50, "task_submitted": 25}[kind]
        if course and course["id"] not in ups:
            bump(course, step_progress(course) + step, cap=90)
        if kind in ("quiz_done", "lesson_completed"):
            exam = next((s for s in todo if s.get("kind") == "exam"), None)
            if exam:
                bump(exam, step_progress(exam) + 10, cap=80)
    elif kind in ("community_post", "community_answer"):
        s = next((s for s in todo if s.get("kind") == "community"), None)
        if s:
            bump(s, 100, done=True)
        for h in helpers_of({"community"}):
            bump(h, 100, done=True)
    elif kind == "job_viewed":
        for s in todo:
            if s.get("kind") == "job":
                bump(s, 40, sub="look")
        for h in helpers_of({"job"}):
            bump(h, 100, done=True)
    elif kind == "exam_viewed":
        for s in todo:
            if ref in _refs(s, "exam"):
                bump(s, 10, sub="dates", cap=80)
    # micro-step done -> its parent has started
    for u in list(ups.values()):
        s = next(x for x in steps if x["id"] == u["id"])
        if s.get("kind") == "micro" and u["status"] == "done" and s.get("parent_step_id"):
            parent = next((x for x in todo if x["id"] == s["parent_step_id"]), None)
            if parent and parent["id"] not in ups and step_progress(parent) < 10:
                ups[parent["id"]] = {"id": parent["id"], "progress": 10, "status": "doing"}
    return list(ups.values())


def progress_from_subtasks(subtasks: list[dict]) -> int:
    if not subtasks:
        return 0
    return round(100 * sum(1 for t in subtasks if t.get("done")) / len(subtasks))


# ---------------------------------------------------------------- signals from conversation

WORRY = {"scared", "scare", "scares", "scary", "frightened", "afraid", "fear", "worried", "worry", "anxious", "anxiety", "nervous", "stress", "stressed", "panic", "tension",
         "dar", "darr", "darta", "darti", "lagta", "ghabrahat", "ghabra", "chinta",
         "डर", "डरता", "डरती", "घबराहट", "घबरा", "चिंता", "तनाव", "टेंशन", "भीती", "भिती", "घाबरते", "घाबरतो", "काळजी", "टेन्शन"}
WORRY_PHRASES = ["can't do it", "cannot do it", "i will fail", "not good enough", "dar lagta", "dar lag", "डर लगता", "भीती वाटते"]
EXAM_WORDS = {"exam", "exams", "test", "neet", "jee", "cet", "pariksha", "paper", "परीक्षा", "एग्जाम", "पेपर"}
MONEY_PHRASES = ["need money", "no money", "money problem", "can't afford", "cannot afford", "fees", "earn money", "family needs money",
                 "paise ki", "paison ki", "paise nahi", "paisa nahi", "ghar mein paise", "kamana hai", "kamane",
                 "पैसे की", "पैसों की", "पैसे नहीं", "कमाना", "कमाने", "पैसे नाहीत", "पैसे कमव", "आर्थिक"]
LOW_MOOD = {"sad", "tired", "bored", "hopeless", "alone", "lonely", "udaas", "udas", "thak", "thaka", "thaki",
            "उदास", "थका", "थकी", "अकेला", "अकेली", "कंटाळा", "थकलो", "थकले", "एकटा", "एकटी"}
GOOD_MOOD = {"happy", "excited", "confident", "khush", "खुश", "उत्साहित", "आनंदी", "आनंद"}
SUNDAY = {"sunday", "sundays", "ravivar", "itwar", "रविवार", "इतवार"}
WEEKEND = {"weekend", "weekends", "saturday", "shaniwar", "शनिवार", "वीकेंड"}
BUSY = ["no time", "busy", "time nahi", "samay nahi", "समय नहीं", "वक्त नहीं", "वेळ नाही", "farm work", "khet", "घर का काम"]
TRAVEL = ["can't travel", "cannot travel", "bahar nahi ja", "door nahi", "दूर नहीं", "बाहेर जाऊ शकत नाही"]
PERMISSION = ["parents won't", "parents dont", "parents don't", "ghar wale nahi", "papa nahi", "घरवाले नहीं", "आई-बाबा"]
DEVICE = ["no phone", "no smartphone", "phone nahi", "फोन नहीं", "फोन नाही"]
DEV_DIGITS = str.maketrans("०१२३४५६७८९", "0123456789")


def _has(text: str, phrases: Iterable[str]) -> bool:
    return any(p in text for p in phrases)


def extract_signals(text: str, career_lookup: Callable[[str], str | None] | None = None) -> list[dict]:
    """What a message says about the student's goal, worries, time, money and mood. Keywords, not a model."""
    t = f" {(text or '').lower().translate(DEV_DIGITS)} "
    words = set(re.findall(r"[a-z]+|[ऀ-ॿ]+", t))
    out: list[dict] = []
    if words & WORRY or _has(t, WORRY_PHRASES):
        exam = words & EXAM_WORDS or any(w.startswith(("exam", "परीक्ष", "पेपर")) for w in words)
        out.append({"kind": "worry", "value": "exam" if exam else "general", "detail": {}})
    if _has(t, MONEY_PHRASES):
        out.append({"kind": "money", "value": "pressure", "detail": {}})
    if words & LOW_MOOD:
        out.append({"kind": "mood", "value": "low", "detail": {}})
    elif words & GOOD_MOOD:
        out.append({"kind": "mood", "value": "positive", "detail": {}})
    only = bool(re.search(r"only|sirf|bas|keval|फक्त|सिर्फ|केवल|बस", t))
    hours = re.search(r"(\d{1,2})\s*(?:hours?|hrs?|ghante|ghanta|घंटे|घंटा|तास)\s*(?:a|per|ek|every|har|प्रति|रोज|daily)?\s*(day|din|दिन|दिवस|week|hafte|hafta|हफ्ते|हफ़्ते|आठवड)?", t)
    if words & SUNDAY and (only or not words & WEEKEND):
        out.append({"kind": "time", "value": "sundays", "detail": {"days": ["sun"], "hours_per_week": 4}})
    elif words & WEEKEND:
        out.append({"kind": "time", "value": "weekends", "detail": {"days": ["sat", "sun"], "hours_per_week": 6}})
    elif hours:
        n = int(hours.group(1))
        per = hours.group(2) or ""
        weekly = n if per[:1] in ("w", "h") or per.startswith(("हफ", "आठ")) else min(n * 7, 70)
        out.append({"kind": "time", "value": "hours", "detail": {"hours_per_week": weekly}})
    elif _has(t, BUSY):
        out.append({"kind": "time", "value": "busy", "detail": {"hours_per_week": 3}})
    for name, phrases in (("travel", TRAVEL), ("permission", PERMISSION), ("device", DEVICE)):
        if _has(t, phrases):
            out.append({"kind": "constraint", "value": name, "detail": {}})
    if career_lookup and re.search(r"want to|wanna|become|banna|ban(?:u|oon)|banana|बनना|बनायचे|व्हायचे|करना है|करायचे|i'?ll do|do nursing|study", t):
        slug = career_lookup(text)
        if slug:
            out.append({"kind": "goal", "value": slug, "detail": {"career": slug}})
    return out
