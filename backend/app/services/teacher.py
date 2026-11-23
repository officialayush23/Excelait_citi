"""Career Mitra (teacher) side: classes, class dashboard, risk rules, claim help, recommendations.

Everything here is deterministic. Risk rules are plain functions of the data so a teacher
(and a test) can see exactly why a student is flagged. Eligible rupees are recomputed from the
student's current facts with the rules engine, never read from stale scheme_checks.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

import secrets
from datetime import date, datetime, timedelta, timezone
from typing import Any, Iterable

from fastapi import HTTPException

from app.core.auth import CurrentUser
from app.core.db import get_db
from app.engine.rules import evaluate
from app.services.graph import graph

# ---------- rules (thresholds are part of the explanation shown to the teacher) ----------
INACTIVE_DAYS = 14
PROFILE_DAYS = 7
CLAIM_DAYS = 21

# Facts that make a profile "complete" enough to match careers and schemes.
CORE_FACTS = ["class_level", "state", "gender", "family_income_annual", "social_category", "interests"]

# Readable code alphabet: no I, L, O, 0, 1.
CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
CODE_LEN = 6

CLAIM_STATUSES = ["started", "documents_ready", "submitted", "approved", "money_received", "rejected"]
CLAIM_RANK = {"started": 1, "documents_ready": 2, "submitted": 3, "approved": 4, "money_received": 5}

RISK_EXPLAIN = {
    "inactive": f"No activity for more than {INACTIVE_DAYS} days.",
    "profile_incomplete": f"Profile still incomplete {PROFILE_DAYS} days after joining.",
    "claim_not_started": f"Eligible for a scheme but no claim started after {CLAIM_DAYS} days.",
    "plan_overdue": "A step in the plan is past its due date.",
    "no_career": "Class 10/12 student has not saved any career yet.",
}

NUDGES = {
    "inactive": {
        "en": ("Your teacher misses you", "Open ExcelAIt and take one small step today."),
        "hi": ("आपके शिक्षक आपका इंतज़ार कर रहे हैं", "आज ExcelAIt खोलें और एक छोटा क़दम उठाएँ।"),
        "mr": ("तुमचे शिक्षक तुमची वाट पाहत आहेत", "आज ExcelAIt उघडा आणि एक छोटे पाऊल टाका."),
    },
    "profile_incomplete": {
        "en": ("Finish your profile", "A few more answers will unlock careers and scholarships for you."),
        "hi": ("अपनी प्रोफ़ाइल पूरी करें", "कुछ और जवाब देने से आपके लिए करियर और छात्रवृत्ति खुल जाएँगी।"),
        "mr": ("तुमची प्रोफाइल पूर्ण करा", "आणखी काही उत्तरे दिल्यास तुमच्यासाठी करिअर आणि शिष्यवृत्ती खुल्या होतील."),
    },
    "claim_not_started": {
        "en": ("You may get scholarship money", "You are eligible for a scheme. Start your claim and ask your teacher for help."),
        "hi": ("आपको छात्रवृत्ति मिल सकती है", "आप एक योजना के पात्र हैं। दावा शुरू करें और शिक्षक से मदद लें।"),
        "mr": ("तुम्हाला शिष्यवृत्ती मिळू शकते", "तुम्ही एका योजनेसाठी पात्र आहात. दावा सुरू करा आणि शिक्षकांची मदत घ्या."),
    },
    "plan_overdue": {
        "en": ("A step in your plan is due", "Open your plan and finish the overdue step."),
        "hi": ("आपकी योजना का एक चरण बाकी है", "अपनी योजना खोलें और बाकी चरण पूरा करें।"),
        "mr": ("तुमच्या योजनेतील एक पायरी बाकी आहे", "तुमची योजना उघडा आणि बाकी पायरी पूर्ण करा."),
    },
    "no_career": {
        "en": ("Pick a career to follow", "Save a career you like so we can build your plan."),
        "hi": ("एक करियर चुनें", "अपना पसंदीदा करियर सेव करें ताकि हम आपकी योजना बना सकें।"),
        "mr": ("एक करिअर निवडा", "तुम्हाला आवडणारे करिअर सेव्ह करा म्हणजे आम्ही तुमची योजना बनवू."),
    },
    "general": {
        "en": ("A note from your teacher", "Your teacher is checking in on you."),
        "hi": ("शिक्षक की ओर से संदेश", "आपके शिक्षक आपका हाल पूछ रहे हैं।"),
        "mr": ("शिक्षकांकडून संदेश", "तुमचे शिक्षक तुमची चौकशी करत आहेत."),
    },
}


# ---------- small helpers ----------
def _now() -> datetime:
    return datetime.now(timezone.utc)


def parse_ts(v: Any) -> datetime | None:
    if not v:
        return None
    if isinstance(v, datetime):
        return v if v.tzinfo else v.replace(tzinfo=timezone.utc)
    try:
        d = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    except ValueError:
        return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def parse_date(v: Any) -> date | None:
    if not v:
        return None
    if isinstance(v, date) and not isinstance(v, datetime):
        return v
    try:
        return date.fromisoformat(str(v)[:10])
    except ValueError:
        return None


def make_code() -> str:
    return "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LEN))


def normalize_code(raw: str) -> str:
    """Forgiving input: case, spaces and dashes do not matter."""
    return "".join(ch for ch in (raw or "").upper() if ch.isalnum())


def _chunks(ids: list[str], n: int = 80) -> Iterable[list[str]]:
    for i in range(0, len(ids), n):
        yield ids[i:i + n]


def _fetch_in(table: str, cols: str, col: str, ids: list[str], **eq: Any) -> list[dict]:
    """select <cols> from <table> where <col> in ids (chunked to keep URLs short)."""
    out: list[dict] = []
    for part in _chunks(ids):
        q = get_db().table(table).select(cols).in_(col, part)
        for k, v in eq.items():
            q = q.eq(k, v)
        out.extend(q.execute().data or [])
    return out


def _first(rows: list[dict] | None) -> dict | None:
    return rows[0] if rows else None


# ---------- permissions ----------
def is_admin(user: CurrentUser) -> bool:
    return "admin" in user.roles


def get_cohort_for(cohort_id: str, user: CurrentUser) -> dict:
    """The class, if the user owns it (or is admin). 404 otherwise so ids do not leak."""
    row = _first(get_db().table("cohorts").select("*").eq("id", cohort_id).limit(1).execute().data)
    if not row or not (is_admin(user) or row["facilitator_id"] == user.id):
        raise HTTPException(404, "Class not found.")
    return row


def assert_student_access(student_id: str, user: CurrentUser) -> list[dict]:
    """The classes (of this teacher) the student belongs to. 404 if none; admins see any student."""
    db = get_db()
    memberships = db.table("cohort_members").select("cohort_id, added_at").eq("student_id", student_id).execute().data or []
    if not memberships:
        raise HTTPException(404, "Student not found.")
    cohorts = _fetch_in("cohorts", "*", "id", [m["cohort_id"] for m in memberships])
    mine = [c for c in cohorts if is_admin(user) or c["facilitator_id"] == user.id]
    if not mine:
        raise HTTPException(404, "Student not found.")
    joined = {m["cohort_id"]: m["added_at"] for m in memberships}
    for c in mine:
        c["joined_at"] = joined.get(c["id"])
    return mine


# ---------- classes ----------
def create_class(user: CurrentUser, name: str, school_name: str | None, district_id: int | None) -> dict:
    db = get_db()
    last: Exception | None = None
    for _ in range(6):
        try:
            res = db.table("cohorts").insert({
                "facilitator_id": user.id, "name": name.strip(), "school_name": (school_name or "").strip() or None,
                "district_id": district_id, "join_code": make_code(),
            }).execute()
            return {**res.data[0], "student_count": 0}
        except Exception as exc:  # unique violation on join_code: try another code
            last = exc
            if "join_code" not in str(exc) and "duplicate" not in str(exc).lower():
                raise
    raise HTTPException(500, "Could not create a join code. Please try again.") from last


def list_classes(user: CurrentUser) -> list[dict]:
    db = get_db()
    q = db.table("cohorts").select("id, facilitator_id, name, school_name, district_id, join_code, created_at")
    if not is_admin(user):
        q = q.eq("facilitator_id", user.id)
    rows = q.order("created_at").execute().data or []
    counts: dict[str, int] = {}
    for m in _fetch_in("cohort_members", "cohort_id, student_id", "cohort_id", [r["id"] for r in rows]):
        counts[m["cohort_id"]] = counts.get(m["cohort_id"], 0) + 1
    return [{**r, "student_count": counts.get(r["id"], 0)} for r in rows]


def rename_class(cohort_id: str, user: CurrentUser, patch: dict) -> dict:
    get_cohort_for(cohort_id, user)
    clean = {k: (v.strip() if isinstance(v, str) else v) for k, v in patch.items() if k in ("name", "school_name") and v is not None}
    if "name" in clean and not clean["name"]:
        raise HTTPException(422, "Class name cannot be empty.")
    if not clean:
        raise HTTPException(422, "Nothing to update.")
    res = get_db().table("cohorts").update(clean).eq("id", cohort_id).execute()
    return res.data[0]


def join_class(user: CurrentUser, code: str) -> dict:
    norm = normalize_code(code)
    if len(norm) != CODE_LEN:
        raise HTTPException(422, "A class code has 6 letters or numbers.")
    db = get_db()
    cohort = _first(db.table("cohorts").select("id, name, school_name, facilitator_id, join_code").eq("join_code", norm).limit(1).execute().data)
    if not cohort:
        raise HTTPException(404, "No class has this code. Check it with your teacher.")
    if cohort["facilitator_id"] == user.id:
        raise HTTPException(422, "This is your own class.")
    db.table("cohort_members").upsert({"cohort_id": cohort["id"], "student_id": user.id}, on_conflict="cohort_id,student_id").execute()
    return _class_card(cohort)


def _class_card(cohort: dict) -> dict:
    t = _first(get_db().table("profiles").select("full_name").eq("id", cohort["facilitator_id"]).limit(1).execute().data)
    return {"id": cohort["id"], "name": cohort["name"], "school_name": cohort.get("school_name"),
            "teacher_name": (t or {}).get("full_name")}


def my_classes(user: CurrentUser) -> list[dict]:
    db = get_db()
    ms = db.table("cohort_members").select("cohort_id, added_at").eq("student_id", user.id).execute().data or []
    cohorts = _fetch_in("cohorts", "id, name, school_name, facilitator_id, join_code", "id", [m["cohort_id"] for m in ms])
    added = {m["cohort_id"]: m["added_at"] for m in ms}
    return [{**_class_card(c), "joined_at": added.get(c["id"])} for c in cohorts]


# ---------- bulk data ----------
class Bulk:
    """Everything needed to summarise a set of students, fetched in a handful of queries."""

    def __init__(self, ids: list[str]):
        self.ids = ids
        # The queries are independent, so run them side by side: each one is a round trip to the database.
        jobs = {
            "profiles": ("profiles", "id, full_name, preferred_language", "id"),
            "sprofiles": ("student_profiles", "user_id, facts, updated_at", "user_id"),
            "careers": ("saved_careers", "user_id, career_slug, created_at", "user_id"),
            "pathways": ("pathways", "id, user_id, title, status, career_slug, created_at", "user_id"),
            "claims": ("claims", "id, user_id, scheme_id, status, amount_expected, amount_received, confirmed_by, created_at, updated_at", "user_id"),
            "apps": ("applications", "id, student_id, opportunity_id, status, created_at, updated_at", "student_id"),
            "threads": ("assistant_threads", "user_id, updated_at", "user_id"),
            "checks": ("scheme_checks", "user_id, scheme_id, result, computed_at", "user_id"),
            "subs": ("task_submissions", "student_id, status, created_at", "student_id"),
        }

        def run(spec):
            try:
                return _fetch_in(spec[0], spec[1], spec[2], ids)
            except Exception:  # an optional feature's table should not break the dashboard
                return []

        with ThreadPoolExecutor(max_workers=len(jobs)) as pool:
            got = dict(zip(jobs, pool.map(run, jobs.values())))

        def group(rows: list[dict], key: str) -> dict[str, list[dict]]:
            out: dict[str, list[dict]] = {}
            for r in rows:
                out.setdefault(r[key], []).append(r)
            return out

        self.profiles = {r["id"]: r for r in got["profiles"]}
        self.sprofiles = {r["user_id"]: r for r in got["sprofiles"]}
        self.careers = group(got["careers"], "user_id")
        self.pathways = group(got["pathways"], "user_id")
        self.claims = group(got["claims"], "user_id")
        self.apps = group(got["apps"], "student_id")
        self.threads = group(got["threads"], "user_id")
        self.checks = group(got["checks"], "user_id")
        self.subs = group(got["subs"], "student_id")
        self.steps = group(_fetch_in("pathway_steps", "id, pathway_id, position, kind, title, due_date, done_at", "pathway_id",
                                     [p["id"] for p in got["pathways"]]), "pathway_id")

def with_age(facts: dict) -> dict:
    f = dict(facts or {})
    if "age" not in f and f.get("date_of_birth"):
        d = parse_date(f["date_of_birth"])
        if d:
            t = date.today()
            f["age"] = t.year - d.year - ((t.month, t.day) < (d.month, d.day))
    return f


def _has(facts: dict, name: str) -> bool:
    v = facts.get(name)
    return not (v is None or v == "" or v == [])


def profile_status(facts: dict) -> tuple[int, list[str]]:
    """(percent complete, missing fact names)."""
    missing = [n for n in CORE_FACTS if not _has(facts, n)]
    return round(100 * (len(CORE_FACTS) - len(missing)) / len(CORE_FACTS)), missing


def eligible_schemes(facts: dict, schemes: Iterable[dict]) -> list[dict]:
    """Schemes the student is eligible for right now, recomputed from current facts."""
    out = []
    for s in schemes:
        try:
            if evaluate(s["rule"], facts).result == "eligible":
                out.append({"id": s.get("id"), "slug": s.get("slug"), "name": s.get("name"), "benefit_amount": s.get("benefit_amount") or 0})
        except Exception:
            continue
    return out


# ---------- risk rules ----------
def compute_risks(*, now: datetime, joined_at: datetime | None, last_active: datetime | None, profile_complete: bool,
                  unclaimed: list[dict], overdue_steps: list[dict], class_level: int | None, careers_count: int) -> list[dict]:
    """Deterministic risk flags. Each is {code, reason, detail}; `reason` is a plain-English explanation.

    1. inactive: last activity (or joining, if none) is more than 14 days ago.
    2. profile_incomplete: more than 7 days since joining and a core fact is still missing.
    3. claim_not_started: eligible for a scheme with no claim, known for more than 21 days.
       `unclaimed` items are {name, since} where `since` is when eligibility was first known.
    4. plan_overdue: an unfinished step whose due date has passed.
    5. no_career: class 10 or 12 and no saved career.
    """
    risks: list[dict] = []
    ref = last_active or joined_at
    if ref is not None and (now - ref) > timedelta(days=INACTIVE_DAYS):
        risks.append({"code": "inactive", "reason": RISK_EXPLAIN["inactive"], "detail": {"days": (now - ref).days}})
    if not profile_complete and joined_at is not None and (now - joined_at) > timedelta(days=PROFILE_DAYS):
        risks.append({"code": "profile_incomplete", "reason": RISK_EXPLAIN["profile_incomplete"], "detail": {"days": (now - joined_at).days}})
    stale = [u for u in unclaimed if u.get("since") is not None and (now - u["since"]) > timedelta(days=CLAIM_DAYS)]
    if stale:
        risks.append({"code": "claim_not_started", "reason": RISK_EXPLAIN["claim_not_started"],
                      "detail": {"schemes": [u["name"] for u in stale][:3], "count": len(stale), "days": max((now - u["since"]).days for u in stale)}})
    if overdue_steps:
        risks.append({"code": "plan_overdue", "reason": RISK_EXPLAIN["plan_overdue"],
                      "detail": {"count": len(overdue_steps), "step": overdue_steps[0].get("title")}})
    if class_level in (10, 12) and careers_count == 0:
        risks.append({"code": "no_career", "reason": RISK_EXPLAIN["no_career"], "detail": {"class_level": class_level}})
    return risks


def _top_claim_status(claims: list[dict]) -> str | None:
    if not claims:
        return None
    live = [c["status"] for c in claims if c["status"] in CLAIM_RANK]
    if live:
        return max(live, key=lambda s: CLAIM_RANK[s])
    return "rejected"


def _plan_stats(user_id: str, bulk: Bulk, today: date) -> dict:
    total = done = 0
    overdue: list[dict] = []
    for p in bulk.pathways.get(user_id, []):
        for s in bulk.steps.get(p["id"], []):
            total += 1
            if s.get("done_at"):
                done += 1
            elif p.get("status") == "active" and (d := parse_date(s.get("due_date"))) and d < today:
                overdue.append({"title": s["title"], "due_date": d.isoformat()})
    return {"plans": len(bulk.pathways.get(user_id, [])), "steps_total": total, "steps_done": done, "overdue": overdue,
            "pct": round(100 * done / total) if total else 0}


def _last_active(user_id: str, bulk: Bulk) -> datetime | None:
    stamps: list[datetime | None] = []
    stamps += [parse_ts(t["updated_at"]) for t in bulk.threads.get(user_id, [])]
    stamps.append(parse_ts((bulk.sprofiles.get(user_id) or {}).get("updated_at")))
    stamps += [parse_ts(c["updated_at"]) for c in bulk.claims.get(user_id, [])]
    stamps += [parse_ts(c["created_at"]) for c in bulk.careers.get(user_id, [])]
    stamps += [parse_ts(a["created_at"]) for a in bulk.apps.get(user_id, [])]
    stamps += [parse_ts(s["created_at"]) for s in bulk.subs.get(user_id, [])]
    for p in bulk.pathways.get(user_id, []):
        stamps += [parse_ts(s.get("done_at")) for s in bulk.steps.get(p["id"], [])]
    live = [s for s in stamps if s]
    return max(live) if live else None


def summarize_student(sid: str, joined_at: datetime | None, bulk: Bulk, now: datetime, schemes: list[dict], careers: dict) -> dict:
    """One row of the class list. Deliberately leaves out social category and other sensitive facts."""
    facts = with_age((bulk.sprofiles.get(sid) or {}).get("facts") or {})
    pct, missing = profile_status(facts)
    elig = eligible_schemes(facts, schemes)
    claims = bulk.claims.get(sid, [])
    claimed_ids = {c["scheme_id"] for c in claims}
    checks = {c["scheme_id"]: c for c in bulk.checks.get(sid, [])}
    unclaimed = []
    for e in elig:
        if e["id"] in claimed_ids:
            continue
        chk = checks.get(e["id"])
        since = parse_ts(chk["computed_at"]) if chk and chk.get("result") == "eligible" else joined_at
        unclaimed.append({"name": e["name"], "since": since})
    plan = _plan_stats(sid, bulk, now.date())
    saved = sorted(bulk.careers.get(sid, []), key=lambda c: c["created_at"] or "")
    top = saved[0]["career_slug"] if saved else None
    last_active = _last_active(sid, bulk)
    class_level = facts.get("class_level")
    try:
        class_level = int(class_level) if class_level is not None else None
    except (TypeError, ValueError):
        class_level = None
    risks = compute_risks(now=now, joined_at=joined_at, last_active=last_active, profile_complete=not missing, unclaimed=unclaimed,
                          overdue_steps=plan["overdue"], class_level=class_level, careers_count=len(saved))
    ref = last_active or joined_at
    return {
        "id": sid,
        "name": (bulk.profiles.get(sid) or {}).get("full_name") or "Student",
        "class_level": class_level,
        "joined_at": joined_at.isoformat() if joined_at else None,
        "profile_pct": pct,
        "profile_complete": not missing,
        "top_career": {"slug": top, "name": (careers.get(top) or {}).get("name", top)} if top else None,
        "careers_count": len(saved),
        "eligible_inr": sum(e["benefit_amount"] for e in elig),
        "eligible_count": len(elig),
        "claimed_inr": sum(c["amount_received"] or 0 for c in claims),
        "claim_status": _top_claim_status(claims),
        "claims_count": len(claims),
        "plan": {k: plan[k] for k in ("plans", "steps_total", "steps_done", "pct")} | {"overdue": len(plan["overdue"])},
        "applications": len(bulk.apps.get(sid, [])),
        "to_verify": sum(1 for s in bulk.subs.get(sid, []) if s["status"] == "submitted"),
        "last_active": last_active.isoformat() if last_active else None,
        "days_inactive": (now - ref).days if ref else None,
        "risks": risks,
    }


def class_dashboard(cohort: dict, now: datetime | None = None) -> dict:
    now = now or _now()
    members = get_db().table("cohort_members").select("student_id, added_at").eq("cohort_id", cohort["id"]).execute().data or []
    ids = [m["student_id"] for m in members]
    joined = {m["student_id"]: parse_ts(m["added_at"]) for m in members}
    bulk = Bulk(ids)
    g = graph()
    schemes = list(g.schemes.values())
    students = [summarize_student(i, joined.get(i), bulk, now, schemes, g.careers) for i in ids]
    n = len(students)
    pct = lambda x: round(100 * x / n) if n else 0  # noqa: E731
    at_risk = sorted((s for s in students if s["risks"]), key=lambda s: (-len(s["risks"]), s["name"]))
    totals = {
        "students": n,
        "profiles_complete_pct": pct(sum(1 for s in students if s["profile_complete"])),
        "careers_chosen_pct": pct(sum(1 for s in students if s["careers_count"] > 0)),
        "plans_made": sum(s["plan"]["plans"] for s in students),
        "eligible_inr": sum(s["eligible_inr"] for s in students),
        "claimed_inr": sum(s["claimed_inr"] for s in students),
        "applications": sum(s["applications"] for s in students),
        "at_risk": len(at_risk),
        "to_verify": sum(s["to_verify"] for s in students),
    }
    return {
        "class": {k: cohort.get(k) for k in ("id", "name", "school_name", "join_code", "created_at")},
        "totals": totals,
        "students": sorted(students, key=lambda s: s["name"].lower()),
        "attention": [{"student_id": s["id"], "name": s["name"], "risks": s["risks"]} for s in at_risk],
        "rules": {"inactive_days": INACTIVE_DAYS, "profile_days": PROFILE_DAYS, "claim_days": CLAIM_DAYS},
    }


# ---------- student detail ----------
DETAIL_FACTS = ["class_level", "course", "state", "gender", "marks_percent", "family_income_annual", "school_type", "interests", "social_category"]


def student_detail(sid: str, user: CurrentUser, now: datetime | None = None) -> dict:
    now = now or _now()
    cohorts = assert_student_access(sid, user)
    joined = parse_ts(min(c["joined_at"] for c in cohorts if c.get("joined_at")) if any(c.get("joined_at") for c in cohorts) else None)
    bulk = Bulk([sid])
    g = graph()
    schemes = list(g.schemes.values())
    summary = summarize_student(sid, joined, bulk, now, schemes, g.careers)
    facts = with_age((bulk.sprofiles.get(sid) or {}).get("facts") or {})
    _, missing = profile_status(facts)
    claims = {c["scheme_id"]: c for c in bulk.claims.get(sid, [])}
    by_id = {s["id"]: s for s in schemes}

    elig = eligible_schemes(facts, schemes)
    scheme_rows = []
    for e in elig:
        c = claims.get(e["id"])
        scheme_rows.append({**e, "claim": _claim_out(c) if c else None})
    # Claims on schemes that are no longer eligible still show, so nothing disappears.
    for sid_, c in claims.items():
        if sid_ not in {e["id"] for e in elig}:
            s = by_id.get(sid_, {})
            scheme_rows.append({"id": sid_, "slug": s.get("slug"), "name": s.get("name", "Scheme"), "benefit_amount": s.get("benefit_amount") or 0, "claim": _claim_out(c)})
    need_info = []
    for s in schemes:
        try:
            o = evaluate(s["rule"], facts)
        except Exception:
            continue
        if o.result == "needs_info":
            need_info.append({"slug": s["slug"], "name": s["name"], "missing": o.missing})
    plans = []
    today = now.date()
    for p in bulk.pathways.get(sid, []):
        steps = sorted(bulk.steps.get(p["id"], []), key=lambda s: s["position"])
        plans.append({"id": p["id"], "title": p["title"], "status": p["status"], "steps": [
            {"id": s["id"], "title": s["title"], "kind": s["kind"], "due_date": s.get("due_date"), "done_at": s.get("done_at"),
             "overdue": bool(not s.get("done_at") and p["status"] == "active" and (d := parse_date(s.get("due_date"))) and d < today)}
            for s in steps]})
    opp_ids = [a["opportunity_id"] for a in bulk.apps.get(sid, [])]
    opps = {o["id"]: o for o in _fetch_in("opportunities", "id, title, kind", "id", opp_ids)} if opp_ids else {}
    recs = get_db().table("recommendations").select("id, title, note, link, opportunity_id, created_at") \
        .eq("student_id", sid).eq("facilitator_id", user.id).order("created_at", desc=True).limit(20).execute().data or []
    return {
        "student": summary,
        "classes": [{"id": c["id"], "name": c["name"]} for c in cohorts],
        # Social category appears here (and only here) because teachers need it to help with scheme forms.
        "facts": {k: facts[k] for k in DETAIL_FACTS if _has(facts, k)},
        "missing_facts": missing,
        "careers": [{"slug": c["career_slug"], "name": (g.careers.get(c["career_slug"]) or {}).get("name", c["career_slug"])}
                    for c in sorted(bulk.careers.get(sid, []), key=lambda c: c["created_at"] or "")],
        "plans": plans,
        "schemes": scheme_rows,
        "needs_info": need_info[:10],
        "applications": [{"id": a["id"], "status": a["status"], "created_at": a["created_at"],
                          "title": (opps.get(a["opportunity_id"]) or {}).get("title", "Opportunity"),
                          "kind": (opps.get(a["opportunity_id"]) or {}).get("kind")} for a in bulk.apps.get(sid, [])],
        "recommendations": recs,
    }


def _claim_out(c: dict) -> dict:
    return {k: c.get(k) for k in ("id", "status", "amount_expected", "amount_received", "confirmed_by", "updated_at")}


# ---------- teacher actions ----------
def set_claim(sid: str, user: CurrentUser, *, scheme_id: int | None, scheme_slug: str | None, status: str, amount_received: int | None) -> dict:
    """Create or advance a student's claim on their behalf. The teacher is recorded in confirmed_by."""
    assert_student_access(sid, user)
    if status not in CLAIM_STATUSES:
        raise HTTPException(422, "Unknown claim status.")
    schemes = graph().schemes
    scheme = None
    if scheme_slug:
        scheme = schemes.get(scheme_slug)
    elif scheme_id is not None:
        scheme = next((s for s in schemes.values() if s.get("id") == scheme_id), None)
    if not scheme:
        raise HTTPException(404, "Scheme not found.")
    if status == "money_received" and (amount_received is None or amount_received < 0):
        raise HTTPException(422, "Enter the amount received.")
    db = get_db()
    existing = _first(db.table("claims").select("id, status").eq("user_id", sid).eq("scheme_id", scheme["id"]).limit(1).execute().data)
    row: dict[str, Any] = {"status": status, "confirmed_by": user.id}
    if amount_received is not None:
        row["amount_received"] = amount_received
    if existing:
        res = db.table("claims").update(row).eq("id", existing["id"]).execute()
    else:
        facts = with_age((_first(db.table("student_profiles").select("facts").eq("user_id", sid).limit(1).execute().data) or {}).get("facts") or {})
        if evaluate(scheme["rule"], facts).result == "not_eligible":
            raise HTTPException(422, "This student is not eligible for that scheme.")
        res = db.table("claims").insert({"user_id": sid, "scheme_id": scheme["id"], "amount_expected": scheme.get("benefit_amount"), **row}).execute()
    return _claim_out(res.data[0])


def _lang(sid: str) -> str:
    p = _first(get_db().table("profiles").select("preferred_language").eq("id", sid).limit(1).execute().data)
    lang = (p or {}).get("preferred_language") or "en"
    return lang if lang in ("en", "hi", "mr") else "en"


def add_recommendation(sid: str, user: CurrentUser, *, note: str | None, title: str | None, opportunity_id: str | None, link: str | None) -> dict:
    assert_student_access(sid, user)
    note = (note or "").strip() or None
    if not note and not opportunity_id:
        raise HTTPException(422, "Write a note or pick an opportunity.")
    db = get_db()
    title = (title or "").strip() or None
    if opportunity_id:
        opp = _first(db.table("opportunities").select("id, title").eq("id", opportunity_id).limit(1).execute().data)
        if not opp:
            raise HTTPException(404, "Opportunity not found.")
        title = title or opp["title"]
    row = {"facilitator_id": user.id, "student_id": sid, "opportunity_id": opportunity_id, "note": note, "title": title, "link": link}
    res = db.table("recommendations").insert(row).execute()
    heading = NUDGES["general"][_lang(sid)][0]
    db.table("notifications").insert({
        "user_id": sid, "kind": "recommendation", "title": title or heading, "body": note,
        "link": link or ("/app/opportunities" if opportunity_id else "/app"),
    }).execute()
    return res.data[0]


def nudge(sid: str, user: CurrentUser, code: str) -> dict:
    """One-tap reminder: a notification worded for the reason, in the student's language."""
    assert_student_access(sid, user)
    msgs = NUDGES.get(code) or NUDGES["general"]
    title, body = msgs[_lang(sid)]
    link = {"profile_incomplete": "/app/start", "claim_not_started": "/app/money", "plan_overdue": "/app/plan", "no_career": "/app/careers"}.get(code, "/app")
    get_db().table("notifications").insert({"user_id": sid, "kind": "teacher_nudge", "title": title, "body": body, "link": link}).execute()
    return {"ok": True}


# ---------- facts a teacher can correct ----------
# School facts a Career Mitra knows first-hand. Sensitive facts (category, income, disability) stay the
# student's own to give; every fact a teacher sets is recorded with source 'teacher'.
TEACHER_FACTS = {"stage", "class_level", "course", "school_type", "district", "state", "marks_percent", "stream", "course_year"}


def update_student_facts(sid: str, user: CurrentUser, facts: dict, note: str | None = None) -> dict:
    from app.services.profile_questions import apply_answer
    from app.services.students import get_facts, merge_facts

    assert_student_access(sid, user)
    bad = sorted(set(facts) - TEACHER_FACTS)
    if bad:
        raise HTTPException(400, f"A teacher cannot set: {', '.join(bad)}")
    current = get_facts(sid)
    patch: dict = {}
    for k, v in facts.items():
        patch.update(apply_answer(k, v, current) if v is not None else {k: None})
    saved = merge_facts(sid, patch, replace_lists=True, source="teacher", note=note)
    return {k: saved.get(k) for k in patch}
