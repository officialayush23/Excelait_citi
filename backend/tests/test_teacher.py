"""Teacher side: risk rules, rupee totals, permission checks. No network: the DB is an in-memory fake."""

from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.core.auth import CurrentUser
from app.services import teacher as t

NOW = datetime(2026, 11, 20, 12, 0, tzinfo=timezone.utc)


def ago(days: float) -> datetime:
    return NOW - timedelta(days=days)


# ---------- fake supabase ----------
class Q:
    def __init__(self, db, name):
        self.db, self.name, self.rows = db, name, None
        self.filters, self.op, self.payload, self.lim = [], "select", None, None

    def select(self, *_a, **_k): return self
    def eq(self, c, v): self.filters.append(lambda r: r.get(c) == v); return self
    def in_(self, c, vs): vs = set(vs); self.filters.append(lambda r: r.get(c) in vs); return self
    def is_(self, c, v): self.filters.append(lambda r: r.get(c) is None); return self
    def order(self, *_a, **_k): return self
    def limit(self, n): self.lim = n; return self
    def insert(self, p): self.op, self.payload = "insert", p; return self
    def update(self, p): self.op, self.payload = "update", p; return self
    def upsert(self, p, **_k): self.op, self.payload = "upsert", p; return self

    def execute(self):
        table = self.db.tables.setdefault(self.name, [])
        match = [r for r in table if all(f(r) for f in self.filters)]
        if self.op == "select":
            data = [dict(r) for r in match][: self.lim]
        elif self.op == "insert":
            row = {"id": f"{self.name}-{len(table) + 1}", **self.payload}
            table.append(row)
            data = [dict(row)]
        elif self.op == "update":
            for r in match:
                r.update(self.payload)
            data = [dict(r) for r in match]
        else:  # upsert
            key = {k: v for k, v in self.payload.items() if k in ("cohort_id", "student_id")}
            if not any(all(r.get(k) == v for k, v in key.items()) for r in table):
                table.append(dict(self.payload))
            data = [dict(self.payload)]
        return SimpleNamespace(data=data)


class FakeDB:
    def __init__(self, **tables): self.tables = {k: [dict(r) for r in v] for k, v in tables.items()}
    def table(self, name): return Q(self, name)


RULE_ALWAYS = {"all": []}
RULE_CLASS12 = {"all": [{"field": "class_level", "op": "gte", "value": 12, "label": "Class 12"}]}
SCHEMES = {
    "a": {"id": 1, "slug": "a", "name": "Scheme A", "benefit_amount": 10000, "rule": RULE_ALWAYS},
    "b": {"id": 2, "slug": "b", "name": "Scheme B", "benefit_amount": 5000, "rule": RULE_CLASS12},
    "c": {"id": 3, "slug": "c", "name": "Scheme C", "benefit_amount": None, "rule": RULE_ALWAYS},
}
FULL_FACTS = {"class_level": 12, "state": "MH", "gender": "female", "family_income_annual": 90000, "social_category": "obc", "interests": ["x"]}

TEACHER = CurrentUser(id="t1", email=None, roles={"facilitator"})
OTHER = CurrentUser(id="t2", email=None, roles={"facilitator"})
ADMIN = CurrentUser(id="adm", email=None, roles={"admin"})


@pytest.fixture
def world(monkeypatch):
    db = FakeDB(
        cohorts=[{"id": "c1", "facilitator_id": "t1", "name": "10-A", "join_code": "ABC234"},
                 {"id": "c2", "facilitator_id": "t2", "name": "Other", "join_code": "ZZZ999"}],
        cohort_members=[{"cohort_id": "c1", "student_id": "s1", "added_at": ago(40).isoformat()},
                        {"cohort_id": "c1", "student_id": "s2", "added_at": ago(2).isoformat()},
                        {"cohort_id": "c2", "student_id": "s3", "added_at": ago(2).isoformat()}],
        profiles=[{"id": "s1", "full_name": "Asha"}, {"id": "s2", "full_name": "Ravi"}, {"id": "s3", "full_name": "Neha"},
                  {"id": "t1", "full_name": "Teacher"}],
        student_profiles=[{"user_id": "s1", "facts": FULL_FACTS, "updated_at": ago(1).isoformat()},
                          {"user_id": "s2", "facts": {"class_level": 8}, "updated_at": ago(1).isoformat()},
                          {"user_id": "s3", "facts": FULL_FACTS, "updated_at": ago(1).isoformat()}],
        saved_careers=[{"user_id": "s1", "career_slug": "nurse", "created_at": ago(3).isoformat()}],
        pathways=[{"id": "p1", "user_id": "s1", "title": "Nurse", "status": "active", "career_slug": "nurse", "created_at": ago(3).isoformat()}],
        pathway_steps=[{"id": "st1", "pathway_id": "p1", "position": 1, "kind": "exam", "title": "Exam", "due_date": "2026-11-01", "done_at": None},
                       {"id": "st2", "pathway_id": "p1", "position": 2, "kind": "task", "title": "Docs", "due_date": "2027-01-01", "done_at": None}],
        claims=[{"id": "cl1", "user_id": "s1", "scheme_id": 1, "status": "money_received", "amount_expected": 10000, "amount_received": 9000,
                 "confirmed_by": "t1", "created_at": ago(10).isoformat(), "updated_at": ago(10).isoformat()}],
        applications=[{"id": "ap1", "student_id": "s1", "opportunity_id": "o1", "status": "applied", "created_at": ago(5).isoformat(), "updated_at": ago(5).isoformat()}],
        opportunities=[{"id": "o1", "title": "ITI intern", "kind": "internship"}],
        assistant_threads=[{"user_id": "s1", "updated_at": ago(1).isoformat()}],
        scheme_checks=[], task_submissions=[{"student_id": "s1", "status": "submitted", "created_at": ago(1).isoformat()}],
        recommendations=[], notifications=[],
    )
    monkeypatch.setattr(t, "get_db", lambda: db)
    monkeypatch.setattr(t, "graph", lambda: SimpleNamespace(schemes=SCHEMES, careers={"nurse": {"name": "Nurse"}}))
    return db


# ---------- risk rules ----------
def risks(**over):
    base = dict(now=NOW, joined_at=ago(30), last_active=ago(1), profile_complete=True, unclaimed=[], overdue_steps=[], class_level=9, careers_count=1)
    return {r["code"] for r in t.compute_risks(**{**base, **over})}


def test_no_risks_for_healthy_student():
    assert risks() == set()


def test_inactive_boundary():
    assert "inactive" not in risks(last_active=ago(14))
    assert "inactive" in risks(last_active=ago(15))
    # never active: measured from joining
    assert "inactive" in risks(last_active=None, joined_at=ago(20))
    assert "inactive" not in risks(last_active=None, joined_at=ago(3))


def test_profile_incomplete_only_after_a_week():
    assert "profile_incomplete" not in risks(profile_complete=False, joined_at=ago(6))
    assert "profile_incomplete" in risks(profile_complete=False, joined_at=ago(8))
    assert "profile_incomplete" not in risks(profile_complete=True, joined_at=ago(60))


def test_claim_not_started_after_21_days():
    assert "claim_not_started" not in risks(unclaimed=[{"name": "A", "since": ago(20)}])
    r = t.compute_risks(now=NOW, joined_at=ago(60), last_active=ago(1), profile_complete=True,
                        unclaimed=[{"name": "A", "since": ago(22)}, {"name": "B", "since": ago(1)}], overdue_steps=[], class_level=9, careers_count=1)
    assert r[0]["code"] == "claim_not_started" and r[0]["detail"]["schemes"] == ["A"]


def test_plan_overdue_and_no_career():
    assert "plan_overdue" in risks(overdue_steps=[{"title": "x"}])
    assert "no_career" in risks(class_level=10, careers_count=0)
    assert "no_career" in risks(class_level=12, careers_count=0)
    assert "no_career" not in risks(class_level=9, careers_count=0)
    assert "no_career" not in risks(class_level=12, careers_count=1)


def test_every_risk_carries_an_explanation():
    out = t.compute_risks(now=NOW, joined_at=ago(60), last_active=ago(40), profile_complete=False,
                          unclaimed=[{"name": "A", "since": ago(30)}], overdue_steps=[{"title": "x"}], class_level=10, careers_count=0)
    assert {r["code"] for r in out} == set(t.RISK_EXPLAIN)
    assert all(r["reason"] for r in out)


def test_profile_status():
    assert t.profile_status(FULL_FACTS) == (100, [])
    pct, missing = t.profile_status({"class_level": 10, "interests": []})
    assert pct == 17 and "interests" in missing and "state" in missing


# ---------- rupees ----------
def test_eligible_recomputed_from_current_facts():
    schemes = list(SCHEMES.values())
    assert sum(e["benefit_amount"] for e in t.eligible_schemes({"class_level": 12}, schemes)) == 15000  # a + b + c(None -> 0)
    assert sum(e["benefit_amount"] for e in t.eligible_schemes({"class_level": 10}, schemes)) == 10000
    assert [e["slug"] for e in t.eligible_schemes({}, schemes)] == ["a", "c"]  # b needs info, so not counted


def test_dashboard_totals(world):
    d = t.class_dashboard(world.tables["cohorts"][0], now=NOW)
    tot = d["totals"]
    assert tot["students"] == 2
    # s1 (class 12): a + b = 15000; s2 (class 8): a = 10000
    assert tot["eligible_inr"] == 25000
    assert tot["claimed_inr"] == 9000
    assert tot["plans_made"] == 1 and tot["applications"] == 1 and tot["to_verify"] == 1
    assert tot["profiles_complete_pct"] == 50 and tot["careers_chosen_pct"] == 50
    by = {s["id"]: s for s in d["students"]}
    assert by["s1"]["claim_status"] == "money_received" and by["s1"]["top_career"]["name"] == "Nurse"
    assert by["s1"]["plan"]["overdue"] == 1 and by["s1"]["plan"]["pct"] == 0
    assert {r["code"] for r in by["s1"]["risks"]} == {"plan_overdue", "claim_not_started"}  # B and C unclaimed for 40 days
    assert {r["code"] for r in by["s2"]["risks"]} == set()  # joined 2 days ago, class 8
    assert "social_category" not in str(by["s1"])
    assert d["totals"]["at_risk"] == 1 and d["attention"][0]["student_id"] == "s1"


# ---------- permissions ----------
def test_teacher_only_sees_own_class(world):
    assert t.get_cohort_for("c1", TEACHER)["id"] == "c1"
    with pytest.raises(HTTPException) as e:
        t.get_cohort_for("c2", TEACHER)
    assert e.value.status_code == 404
    assert t.get_cohort_for("c2", ADMIN)["id"] == "c2"


def test_student_access(world):
    assert t.assert_student_access("s1", TEACHER)[0]["id"] == "c1"
    for fn in (lambda: t.assert_student_access("s3", TEACHER), lambda: t.student_detail("s3", TEACHER),
               lambda: t.set_claim("s3", TEACHER, scheme_id=None, scheme_slug="a", status="started", amount_received=None),
               lambda: t.add_recommendation("s3", TEACHER, note="hi", title=None, opportunity_id=None, link=None),
               lambda: t.nudge("s3", TEACHER, "inactive")):
        with pytest.raises(HTTPException) as e:
            fn()
        assert e.value.status_code == 404
    assert t.assert_student_access("s3", ADMIN)
    assert world.tables["notifications"] == [] and world.tables["recommendations"] == []


def test_list_classes_scoped(world):
    assert [c["id"] for c in t.list_classes(TEACHER)] == ["c1"]
    assert {c["id"] for c in t.list_classes(ADMIN)} == {"c1", "c2"}
    assert t.list_classes(TEACHER)[0]["student_count"] == 2
    with pytest.raises(HTTPException):
        t.rename_class("c2", TEACHER, {"name": "hijack"})


def test_routes_require_facilitator_role():
    from app.api.routes import teacher as routes
    from app.core.auth import get_current_user
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    app = FastAPI()
    app.include_router(routes.router, prefix="/api/v1")
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(id="s9", email=None, roles={"student"})
    c = TestClient(app)
    assert c.get("/api/v1/teacher/classes").status_code == 403
    assert c.get("/api/v1/teacher/students/s1").status_code == 403
    assert c.post("/api/v1/teacher/classes", json={"name": "Class"}).status_code == 403


# ---------- classes, join ----------
def test_code_alphabet_and_normalize():
    for _ in range(50):
        c = t.make_code()
        assert len(c) == 6 and set(c) <= set(t.CODE_ALPHABET) and not set(c) & set("ILO01")
    assert t.normalize_code(" abc-234 ") == "ABC234"


def test_join_class(world):
    student = CurrentUser(id="s9", email=None, roles={"student"})
    out = t.join_class(student, "abc 234")
    assert out["id"] == "c1" and out["teacher_name"] == "Teacher"
    t.join_class(student, "ABC234")  # idempotent
    assert sum(1 for m in world.tables["cohort_members"] if m["student_id"] == "s9") == 1
    with pytest.raises(HTTPException) as e:
        t.join_class(student, "NOPE22")
    assert e.value.status_code == 404
    with pytest.raises(HTTPException) as e:
        t.join_class(student, "abc")
    assert e.value.status_code == 422
    with pytest.raises(HTTPException):
        t.join_class(TEACHER, "ABC234")  # own class


def test_create_class_gets_code(world):
    c = t.create_class(TEACHER, " Class 11 ", "ZP School", None)
    assert c["name"] == "Class 11" and len(c["join_code"]) == 6 and c["facilitator_id"] == "t1"


# ---------- claims and recommendations ----------
def test_claim_flow_sets_confirmed_by(world):
    out = t.set_claim("s2", TEACHER, scheme_id=None, scheme_slug="a", status="started", amount_received=None)
    assert out["status"] == "started" and out["amount_expected"] == 10000 and out["confirmed_by"] == "t1"
    out = t.set_claim("s2", TEACHER, scheme_id=None, scheme_slug="a", status="money_received", amount_received=8000)
    assert out["status"] == "money_received" and out["amount_received"] == 8000
    assert len([c for c in world.tables["claims"] if c["user_id"] == "s2"]) == 1
    with pytest.raises(HTTPException) as e:
        t.set_claim("s2", TEACHER, scheme_id=None, scheme_slug="a", status="money_received", amount_received=None)
    assert e.value.status_code == 422
    with pytest.raises(HTTPException) as e:  # s2 is class 8: scheme b needs class 12 -> not eligible
        t.set_claim("s2", TEACHER, scheme_id=None, scheme_slug="b", status="started", amount_received=None)
    assert e.value.status_code == 422


def test_recommendation_notifies_student(world):
    t.add_recommendation("s1", TEACHER, note="Try this", title="ITI intake", opportunity_id="o1", link=None)
    n = world.tables["notifications"][0]
    assert n["user_id"] == "s1" and n["kind"] == "recommendation" and n["title"] == "ITI intake" and n["body"] == "Try this"
    with pytest.raises(HTTPException):
        t.add_recommendation("s1", TEACHER, note=" ", title=None, opportunity_id=None, link=None)
    with pytest.raises(HTTPException):
        t.add_recommendation("s1", TEACHER, note=None, title=None, opportunity_id="missing", link=None)


def test_nudge_language(world):
    world.tables["profiles"][0]["preferred_language"] = "hi"
    t.nudge("s1", TEACHER, "no_career")
    assert "करियर" in world.tables["notifications"][0]["title"]


def test_student_detail_shape(world):
    d = t.student_detail("s1", TEACHER, now=NOW)
    assert d["facts"]["social_category"] == "obc"
    assert [s["slug"] for s in d["schemes"]] == ["a", "b", "c"]
    assert d["schemes"][0]["claim"]["status"] == "money_received"
    assert d["plans"][0]["steps"][0]["overdue"] is True
    assert d["applications"][0]["title"] == "ITI intern"
