"""Demand vs supply counts against an in-memory fake database."""

from types import SimpleNamespace

from fastapi.testclient import TestClient

from app.core.auth import CurrentUser, get_current_user
from app.main import create_app
from app.services import insights

CAREERS = [
    {"slug": "electrician", "name": "Electrician", "category": "skilled_trade", "interest_tags": ["hands_on", "electricity"]},
    {"slug": "nurse", "name": "Staff Nurse", "category": "healthcare", "interest_tags": ["health", "helping"]},
]


class Q:
    def __init__(self, rows): self.rows = rows
    def select(self, *_a): return self
    def in_(self, *_a): return self
    def gt(self, *_a): return self
    def eq(self, *_a): return self
    def limit(self, *_a): return self
    def execute(self): return SimpleNamespace(data=self.rows)


class FakeDB:
    def __init__(self, **t): self.t = t
    def table(self, name):
        if name not in self.t:
            raise RuntimeError("relation does not exist")
        return Q(self.t[name])


def test_counts_students_and_opportunities(monkeypatch):
    db = FakeDB(
        student_profiles=[{"user_id": "a", "facts": {"interests": ["hands_on", "electricity"]}},
                          {"user_id": "b", "facts": {"interests": ["health"]}}, {"user_id": "c", "facts": {}}],
        saved_careers=[{"user_id": "a", "career_slug": "electrician"}, {"user_id": "c", "career_slug": "nurse"}],
        knowledge_items=[{"kind": "job", "tags": ["electrician", "x"]}, {"kind": "scholarship", "tags": ["nurse"]}, {"kind": "job", "tags": ["pilot"]}],
        opportunities=[{"career_slugs": ["electrician"]}, {"career_slugs": []}],
    )
    monkeypatch.setattr(insights, "get_db", lambda: db)
    out = insights.demand_supply(CAREERS)
    rows = {r["category"]: r for r in out["categories"]}
    assert rows["skilled_trade"]["students"] == 1          # student a counted once despite interests + saved career
    assert rows["healthcare"]["students"] == 2
    assert (rows["skilled_trade"]["jobs"], rows["skilled_trade"]["offers"], rows["skilled_trade"]["opportunities"]) == (1, 1, 2)
    assert rows["healthcare"]["scholarships"] == 1
    assert out["totals"] == {"students": 3, "unmapped_opportunities": 2}


def test_missing_tables_give_zeros(monkeypatch):
    monkeypatch.setattr(insights, "get_db", lambda: FakeDB())
    out = insights.demand_supply(CAREERS)
    assert all(r["students"] == 0 and r["opportunities"] == 0 for r in out["categories"])
    assert out["totals"]["students"] == 0


def test_endpoint_requires_sign_in_and_returns_json(monkeypatch):
    monkeypatch.setattr(insights, "get_db", lambda: FakeDB())
    monkeypatch.setattr(insights.cat, "careers", lambda: CAREERS)
    app = create_app()
    client = TestClient(app)
    assert client.get("/api/v1/insights/demand-supply").status_code in (401, 403)
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(id="u", email=None, roles={"funder"})
    r = client.get("/api/v1/insights/demand-supply")
    assert r.status_code == 200 and {c["category"] for c in r.json()["categories"]} == {"skilled_trade", "healthcare"}
