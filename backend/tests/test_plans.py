"""plans.build_steps against a fake catalogue graph (no DB)."""

from datetime import date
from types import SimpleNamespace

import pytest

from app.services import plans

TODAY = date(2026, 11, 20)


def _fake_graph():
    return SimpleNamespace(
        careers={"electrician": {"slug": "electrician", "name": "Electrician", "program_slugs": ["iti-electrician"], "min_education": "class_10",
                                 "category": "trades", "path": ["ITI", "Apprentice", "Electrician"]},
                 "clerk": {"slug": "clerk", "name": "Clerk", "program_slugs": [], "min_education": "class_12", "category": "govt", "path": ["Exam", "Job"]}},
        programs={"iti-electrician": {"slug": "iti-electrician", "name": "ITI Electrician", "entry": "class_10", "exam_slugs": ["ncvt", "cuet"],
                                      "scheme_slugs": ["pm-scholar", "closed-scheme"], "where": "Govt ITI", "duration_months": 24}},
        exams={"ncvt": {"name": "NCVT Admission", "typical_months": [5, 7]}, "cuet": {"name": "Mock Exam", "typical_months": [3]}},
        docs={"aadhaar": "Aadhaar card", "income_cert": "Income certificate"},
    )


@pytest.fixture
def fake(monkeypatch):
    g = _fake_graph()
    monkeypatch.setattr(plans, "graph", lambda: g)
    schemes = {
        "pm-scholar": {"slug": "pm-scholar", "name": "PM Scholar", "result": "eligible", "documents": ["aadhaar", "income_cert"]},
        "closed-scheme": {"slug": "closed-scheme", "name": "Closed", "result": "not_eligible", "documents": ["aadhaar"]},
    }
    monkeypatch.setattr(plans, "scheme_status", lambda slug, facts: schemes.get(slug))
    calls = []
    def fake_resources(**kw):
        calls.append(kw)
        return [{"slug": "r1", "title": "Basics of wiring", "url": "https://swayam.gov.in/x"}]
    monkeypatch.setattr(plans, "resources_for", fake_resources)
    return SimpleNamespace(calls=calls)


def kinds(steps):
    return [s["kind"] for s in steps]


def test_exam_due_dates_use_next_typical_month(fake):
    steps = plans.build_steps("electrician", {"class_level": 10}, today=TODAY)
    exams = {s["ref_id"]: s for s in steps if s["kind"] == "exam"}
    assert exams["ncvt"]["due_date"] == "2027-05-01"   # May/July already passed this year -> next year's first
    assert exams["cuet"]["due_date"] == "2027-03-01"
    assert "NCVT Admission" in exams["ncvt"]["title"]
    mid = plans.build_steps("electrician", {"class_level": 10}, today=date(2026, 6, 10))
    assert {s["ref_id"]: s["due_date"] for s in mid if s["kind"] == "exam"}["ncvt"] == "2026-07-01"


def test_class_milestone_when_below_entry_class(fake):
    steps = plans.build_steps("electrician", {"class_level": 8}, today=TODAY)
    first = steps[0]
    assert first["kind"] == "milestone" and first["title"] == "Pass Class 10"
    assert first["due_date"] == "2028-03-31"
    # in the Jan-Mar window the current school year still ends this March
    early = plans.build_steps("electrician", {"class_level": 9}, today=date(2027, 2, 1))
    assert early[0]["title"] == "Pass Class 10" and early[0]["due_date"] == "2027-03-31"


def test_no_class_milestone_when_already_at_or_above_entry(fake):
    for lvl in (10, 12):
        steps = plans.build_steps("electrician", {"class_level": lvl}, today=TODAY)
        assert not any(s["title"].startswith("Pass Class") for s in steps)
    assert not any(s["title"].startswith("Pass Class") for s in plans.build_steps("electrician", {}, today=TODAY))


def test_program_scheme_documents_and_course_steps(fake):
    steps = plans.build_steps("electrician", {"class_level": 10}, today=TODAY)
    prog = next(s for s in steps if s["kind"] == "program")
    assert prog["ref_id"] == "iti-electrician" and prog["due_date"] == "2027-06-01"
    assert "24 months" in prog["detail"]
    schemes = [s for s in steps if s["kind"] == "scheme"]
    assert [s["ref_id"] for s in schemes] == ["pm-scholar"]       # not_eligible scheme is skipped
    assert schemes[0]["detail"] == "You qualify"
    docs = [s["ref_id"] for s in steps if s["kind"] == "document"]
    assert docs == ["aadhaar", "income_cert"]                      # de-duplicated
    assert any(s["kind"] == "course" and s["detail"].startswith("https://") for s in steps)
    assert fake.calls[0]["careers"] == ["electrician"] and fake.calls[0]["programs"] == ["iti-electrician"]


def test_final_milestone_and_positions(fake):
    steps = plans.build_steps("electrician", {"class_level": 8}, today=TODAY)
    assert steps[-1]["kind"] == "milestone" and steps[-1]["title"] == "Start work as Electrician"
    assert steps[-1]["detail"] == "ITI → Apprentice → Electrician"
    assert [s["position"] for s in steps] == list(range(len(steps)))


def test_career_without_programs_still_gets_a_plan(fake):
    steps = plans.build_steps("clerk", {"class_level": 12}, today=TODAY)
    assert kinds(steps) == ["course", "milestone"]


def test_needs_info_scheme_wording(fake, monkeypatch):
    monkeypatch.setattr(plans, "scheme_status", lambda s, f: {"slug": s, "name": "X", "result": "needs_info", "documents": []})
    steps = plans.build_steps("electrician", {"class_level": 10}, today=TODAY)
    assert next(s for s in steps if s["kind"] == "scheme")["detail"] == "Answer a few questions to confirm"
