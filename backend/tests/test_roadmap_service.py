"""The roadmap service end to end against an in-memory database: goals, evidence from events, the daily
re-evaluation (fresh start), undo, watches and alerts for minors."""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from app.services import plans
from app.services import roadmap as rm

USER = "u1"


class Q:
    def __init__(self, db, name):
        self.db, self.name, self.filters, self.op, self.payload = db, name, [], "select", None
        self._order, self._limit, self._one, self.kw = None, None, False, {}

    # building
    def select(self, *_a, **_k):
        self.op = "select"
        return self

    def insert(self, rows):
        self.op, self.payload = "insert", rows
        return self

    def upsert(self, rows, on_conflict="", ignore_duplicates=False, **_k):
        self.op, self.payload, self.kw = "upsert", rows, {"on_conflict": on_conflict, "ignore": ignore_duplicates}
        return self

    def update(self, fields):
        self.op, self.payload = "update", fields
        return self

    def delete(self):
        self.op = "delete"
        return self

    def eq(self, k, v):
        self.filters.append(lambda r: r.get(k) == v)
        return self

    def neq(self, k, v):
        self.filters.append(lambda r: r.get(k) != v)
        return self

    def in_(self, k, vs):
        vs = list(vs)
        self.filters.append(lambda r: r.get(k) in vs)
        return self

    def gte(self, k, v):
        self.filters.append(lambda r: str(r.get(k) or "") >= v)
        return self

    def gt(self, k, v):
        self.filters.append(lambda r: str(r.get(k) or "") > v)
        return self

    def order(self, k, desc=False):
        self._order = (k, desc)
        return self

    def limit(self, n):
        self._limit = n
        return self

    def maybe_single(self):
        self._one = True
        return self

    single = maybe_single

    # running
    def _match(self):
        return [r for r in self.db.t.setdefault(self.name, []) if all(f(r) for f in self.filters)]

    def _new(self, row):
        r = {"id": str(uuid.uuid4()), "created_at": self.db.clock().isoformat(), **row}
        for k, v in self.db.defaults.get(self.name, {}).items():
            r.setdefault(k, v() if callable(v) else v)
        return r

    def execute(self):
        rows = self.db.t.setdefault(self.name, [])
        if self.op == "insert":
            new = [self._new(x) for x in (self.payload if isinstance(self.payload, list) else [self.payload])]
            rows.extend(new)
            return SimpleNamespace(data=new)
        if self.op == "upsert":
            keys = [k for k in (self.kw["on_conflict"] or "user_id").split(",") if k]
            out = []
            for x in self.payload if isinstance(self.payload, list) else [self.payload]:
                hit = next((r for r in rows if all(r.get(k) == x.get(k) for k in keys) and all(x.get(k) is not None for k in keys)), None)
                if hit and self.kw["ignore"]:
                    continue
                if hit:
                    hit.update(x)
                    out.append(hit)
                else:
                    r = self._new(x)
                    rows.append(r)
                    out.append(r)
            return SimpleNamespace(data=out)
        hit = self._match()
        if self.op == "update":
            for r in hit:
                r.update(self.payload)
            return SimpleNamespace(data=hit)
        if self.op == "delete":
            self.db.t[self.name] = [r for r in rows if r not in hit]
            return SimpleNamespace(data=hit)
        if self._order:
            k, desc = self._order
            hit = sorted(hit, key=lambda r: (r.get(k) is None, r.get(k) if not isinstance(r.get(k), (int, float)) else r.get(k)), reverse=desc)
        if self._limit:
            hit = hit[: self._limit]
        if self._one:
            return SimpleNamespace(data=dict(hit[0]) if hit else None)
        return SimpleNamespace(data=[dict(r) for r in hit])


class FakeDB:
    def __init__(self, clock):
        self.t: dict[str, list[dict]] = {}
        self.clock = clock
        self.defaults = {
            "pathways": {"status": "active", "kind": "career", "priority": 0, "source": "student"},
            "pathway_steps": {"status": "todo", "progress": 0, "subtasks": [], "hard_deadline": False, "at_risk": False, "refs": [],
                              "optional": False, "origin": "plan", "parent_step_id": None, "done_at": None, "ref_id": None, "detail": None},
            "roadmap_changes": {"undone_at": None, "before": [], "created_ids": [], "auto": True, "params": {}},
            "notifications": {"read_at": None},
            "watches": {"active": True, "last_checked_at": None, "query": {}},
        }

    def table(self, name):
        return Q(self, name)

    def rpc(self, *_a, **_k):
        return SimpleNamespace(execute=lambda: SimpleNamespace(data=None))


def fake_graph():
    return SimpleNamespace(
        careers={"staff-nurse": {"slug": "staff-nurse", "name": "Staff Nurse", "program_slugs": ["gnm"], "min_education": "class_12",
                                 "category": "health", "path": ["GNM", "Nurse"], "name_i18n": {}, "min_age": 18},
                 "electrician": {"slug": "electrician", "name": "Electrician", "program_slugs": [], "min_education": "class_10",
                                 "category": "trades", "path": ["ITI"], "name_i18n": {}}},
        programs={"gnm": {"slug": "gnm", "name": "GNM Nursing", "entry": "class_12", "exam_slugs": ["neet-ug"], "scheme_slugs": ["pm-scholar"],
                          "where": "Nursing college", "duration_months": 36}},
        exams={"neet-ug": {"slug": "neet-ug", "name": "NEET-UG", "typical_months": [5], "official_url": "https://neet.nta.nic.in"}},
        schemes={"pm-scholar": {"slug": "pm-scholar", "name": "PM Scholar", "deadline": None, "documents": ["aadhaar"]}},
        docs={"aadhaar": "Aadhaar card"},
        program_careers={"gnm": ["staff-nurse"]},
    )


@pytest.fixture
def env(monkeypatch):
    state = {"now": datetime(2026, 11, 23, 9, tzinfo=timezone.utc), "facts": {"class_level": 12, "age": 17, "state": "Maharashtra"}}
    clock = lambda: state["now"]  # noqa: E731
    db = FakeDB(clock)
    g = fake_graph()
    statuses = {"pm-scholar": {"slug": "pm-scholar", "name": "PM Scholar", "result": "eligible", "missing": [], "documents": ["aadhaar"]}}
    for mod in (rm, plans):
        monkeypatch.setattr(mod, "get_db", lambda: db)
        monkeypatch.setattr(mod, "graph", lambda: g)
        monkeypatch.setattr(mod, "get_facts", lambda _u: dict(state["facts"]))
        monkeypatch.setattr(mod, "scheme_status", lambda slug, facts: statuses.get(slug))
        monkeypatch.setattr(mod, "resources_for", lambda **kw: [{"slug": "r1", "title": "Biology basics", "url": "https://swayam.gov.in/b"}])
    monkeypatch.setattr(rm, "ready", lambda: True)
    monkeypatch.setattr(rm, "now", clock)
    monkeypatch.setattr(rm, "_today", lambda: state["now"].date())
    monkeypatch.setattr(rm, "_hazardous", lambda role: role in ("electrician", "welder"))
    return SimpleNamespace(db=db, state=state, g=g)


def steps_of(env, goal_id):
    return sorted([s for s in env.db.t["pathway_steps"] if s["pathway_id"] == goal_id], key=lambda s: s["position"])


def test_career_goal_keeps_the_age_gate_and_gets_why_now_and_soft_dates(env):
    plan = plans.create_plan(USER, "staff-nurse")
    steps = steps_of(env, plan["id"])
    gate = next(s for s in steps if s["title"].startswith("Eligible from age"))
    assert gate["hard_deadline"] and gate["copy_key"] == "milestone_gate"
    exam = next(s for s in steps if s["kind"] == "exam")
    assert exam["hard_deadline"] and exam["subtasks"]
    course = next(s for s in steps if s["kind"] == "course")
    assert not course["hard_deadline"] and course["due_date"] and course["now_text"]
    assert any(s["kind"] == "community" for s in steps)
    assert env.db.t["roadmap_changes"][0]["kind"] == "goal_added"
    road = rm.get_roadmap(USER)
    assert road["ready"] and road["next"] and road["minor"] is True
    assert {s["bucket"] for g in road["goals"] for s in g["steps"]} <= {"now", "next", "later", "done"}


def test_exam_goal_with_target_year_and_evidence_from_events(env):
    out = rm.add_goal(USER, "exam", exam="neet-ug", target_date="2027-05-01")
    gid = out["goal_id"]
    exam = next(s for s in steps_of(env, gid) if s["kind"] == "exam")
    assert exam["due_date"] == "2027-05-01" and exam["hard_deadline"]
    rm.record_event(USER, "lesson_completed", "lesson-1", background=False)
    course = next(s for s in steps_of(env, gid) if s["kind"] == "course")
    assert course["progress"] == 25 and course["done_by"] == "evidence"
    ch = next(c for c in env.db.t["roadmap_changes"] if c["kind"] == "evidence")
    assert ch["reason"].startswith("Saathi noticed")
    rm.undo_change(USER, ch["id"])
    course = next(s for s in steps_of(env, gid) if s["kind"] == "course")
    assert course["progress"] == 0


def test_student_marks_a_step_done_and_cannot_move_a_fixed_date(env):
    gid = rm.add_goal(USER, "exam", exam="neet-ug")["goal_id"]
    exam = next(s for s in steps_of(env, gid) if s["kind"] == "exam")
    with pytest.raises(rm.RoadmapError):
        rm.update_step(USER, exam["id"], due_date="2027-09-01")
    task = steps_of(env, gid)[0]
    road = rm.update_step(USER, task["id"], subtask={"id": "dates", "done": True})
    s = next(x for g in road["goals"] for x in g["steps"] if x["id"] == task["id"])
    assert s["progress"] == 100 and s["status"] == "done" and s["done_by"] == "student"


def test_after_a_break_the_daily_run_gives_a_fresh_start_that_can_be_undone(env):
    gid = rm.add_goal(USER, "custom", title="Earn 8000 a month by June", target_date="2027-06-30")["goal_id"]
    rm.record_event(USER, "saathi_turn", "t1", background=False)
    env.state["now"] += timedelta(days=12)
    res = rm.run_daily()
    assert res["users"] == 1 and res["changes"] >= 1
    fresh = next(c for c in env.db.t["roadmap_changes"] if c["kind"] == "fresh_start")
    micro = [s for s in steps_of(env, gid) if s["kind"] == "micro"]
    assert len(micro) == 1
    target = next(s for s in steps_of(env, gid) if s["kind"] == "milestone")
    assert target["due_date"] == "2027-06-30"                       # the goal date did not move
    assert any(n["kind"] == "roadmap_change" for n in env.db.t["notifications"])
    road = rm.get_roadmap(USER, evaluate_first=False)
    assert road["fresh_start"] and road["tone"] == "welcome_back"
    rm.undo_change(USER, fresh["id"])
    assert not [s for s in steps_of(env, gid) if s["kind"] == "micro"]
    # the student said no: not redone the next day
    env.state["now"] += timedelta(days=1)
    rm.run_daily()
    assert len([c for c in env.db.t["roadmap_changes"] if c["kind"] == "fresh_start"]) == 1


def test_minor_money_goal_has_no_job_step(env):
    gid = rm.add_goal(USER, "custom", title="earn money for fees")["goal_id"]
    assert not any(s["kind"] == "job" for s in steps_of(env, gid))
    env.state["facts"]["age"] = 19
    gid2 = rm.add_goal(USER, "custom", title="earn money by March")["goal_id"]
    assert any(s["kind"] == "job" for s in steps_of(env, gid2))


def test_signals_from_saathi_make_steps_smaller(env):
    gid = rm.add_goal(USER, "exam", exam="neet-ug")["goal_id"]
    sig = rm.capture_signals(USER, "The NEET exam scares me and I only have Sundays")
    assert {(s["kind"], s["value"]) for s in sig} >= {("worry", "exam"), ("time", "sundays")}
    assert any(s["kind"] == "micro" for s in steps_of(env, gid))
    assert rm.saathi_hint(USER).startswith("The student feels worried")
    again = rm.capture_signals(USER, "exam scares me")
    assert len([s for s in env.db.t["roadmap_signals"] if s["kind"] == "worry"]) == 1 and again


def test_minor_job_watch_becomes_skills_and_scholarships(env):
    env.state["facts"]["age"] = 16
    w = rm.add_watch(USER, "job", query={"role": "electrician", "place": "Pune"})
    assert w["converted"] == "skill" and w["watch"]["kind"] == "skill"
    w2 = rm.add_watch(USER, "job", query={"role": "data entry", "place": "Pune"})
    assert w2["converted"] == "apprenticeship" and w2["watch"]["query"]["apprenticeship"] is True
    env.state["facts"]["age"] = 12
    w3 = rm.add_watch(USER, "job", query={"role": "tailor", "place": "Pune"})
    assert w3["converted"] == "skill"


def test_deadline_alerts_are_sent_once(env, monkeypatch):
    gid = rm.add_goal(USER, "exam", exam="neet-ug")["goal_id"]
    exam = next(s for s in steps_of(env, gid) if s["kind"] == "exam")
    exam["due_date"] = (env.state["now"].date() + timedelta(days=5)).isoformat()
    from app.services import knowledge
    monkeypatch.setattr(knowledge, "find", lambda *a, **k: [])
    assert rm.check_alerts(USER) == 1
    assert rm.check_alerts(USER) == 0
    note = next(n for n in env.db.t["notifications"] if n["kind"] == "roadmap_deadline")
    assert "5 days left" in note["title"]
