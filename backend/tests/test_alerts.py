"""Alert rules: deadlines 7/3/1 days before, exam windows, scheme deadlines, new jobs, and minors."""

from datetime import date

from app.services import alerts as al

TODAY = date(2026, 11, 23)


def hard(i, due, **kw):
    return {"id": f"s{i}", "title": f"Step {i}", "hard_deadline": True, "status": "todo", "due_date": due, **kw}


def test_threshold_one_alert_per_mark_even_if_a_day_is_missed():
    assert al.threshold(7, (1, 3, 7)) == 7
    assert al.threshold(5, (1, 3, 7)) == 7
    assert al.threshold(2, (1, 3, 7)) == 3
    assert al.threshold(1, (1, 3, 7)) == 1
    assert al.threshold(8, (1, 3, 7)) is None
    assert al.threshold(-1, (1, 3, 7)) is None


def test_deadline_alerts_only_for_open_hard_dates():
    steps = [hard(0, "2026-11-30"), hard(1, "2026-11-26"), hard(2, "2026-11-23"), hard(3, "2026-12-20"),
             hard(4, "2026-11-24", status="done"), {**hard(5, "2026-11-24"), "hard_deadline": False}]
    out = {a["key"]: a for a in al.deadline_alerts(steps, TODAY)}
    assert set(out) == {"deadline:s0:7", "deadline:s1:3", "deadline:s2:0"}
    assert "7 days left" in out["deadline:s0:7"]["title"]


def test_deadline_alert_in_hindi():
    a = al.deadline_alerts([hard(0, "2026-11-26")], TODAY, "hi")[0]
    assert "दिन बाकी" in a["title"]


def test_exam_window_alerts_at_30_and_7_days():
    exam = {"slug": "neet-ug", "name": "NEET-UG"}
    assert al.exam_alerts(exam, "2026-12", TODAY)[0]["key"] == "exam:neet-ug:2026-12:30"   # 8 days -> the 30-day mark
    assert al.exam_alerts(exam, "2026-12", date(2026, 11, 25))[0]["key"] == "exam:neet-ug:2026-12:7"
    assert al.exam_alerts(exam, "2027-05", TODAY) == []
    assert "May 2027" in al.exam_alerts(exam, "2027-05", date(2027, 4, 10))[0]["title"]


def test_scheme_deadline_and_eligibility():
    s = {"slug": "pm-yasasvi", "name": "PM YASASVI", "deadline": "2026-11-25"}
    keys = [a["key"] for a in al.scheme_alerts(s, "eligible", TODAY)]
    assert keys == ["scheme:pm-yasasvi:2026-11-25:3", "scheme:pm-yasasvi:eligible"]
    assert al.scheme_alerts({**s, "deadline": None}, "needs_info", TODAY) == []


ITEMS = [
    {"id": "j1", "kind": "job", "title": "Electrician needed, Pune", "tags": [], "first_seen_at": "2026-11-23T05:00:00+00:00"},
    {"id": "j2", "kind": "apprenticeship", "title": "Electrician apprentice (NAPS)", "tags": [], "first_seen_at": "2026-11-23T06:00:00+00:00"},
    {"id": "j3", "kind": "job", "title": "Electrician, old post", "tags": [], "first_seen_at": "2026-11-01T06:00:00+00:00"},
    {"id": "j4", "kind": "job", "title": "Data entry operator", "tags": [], "first_seen_at": "2026-11-23T06:00:00+00:00"},
]
WATCH = {"id": "w1", "ref": "electrician|pune", "query": {"role": "electrician", "place": "Pune"}, "last_checked_at": "2026-11-22T00:00:00+00:00"}
ADULT_RULES = {"can_apprentice": True, "can_take_jobs": True}
TEEN_RULES = {"can_apprentice": True, "can_take_jobs": False}


def test_adult_gets_one_grouped_alert_for_new_matching_openings():
    out = al.job_alerts(WATCH, ITEMS, {"age": 19}, TODAY, ADULT_RULES, hazardous=False)
    assert len(out) == 1 and out[0]["items"] == ["j1", "j2"] and out[0]["key"] == "job:w1:2026-11-23"
    assert "Never pay" in out[0]["body"]


def test_minor_never_gets_job_alerts():
    assert al.job_alerts(WATCH, [ITEMS[0]], {"age": 16}, TODAY, TEEN_RULES, hazardous=False) == []
    assert al.job_alerts(WATCH, ITEMS, {"age": 12}, TODAY, {"can_apprentice": False}, hazardous=False) == []
    assert al.job_alerts(WATCH, ITEMS, {}, TODAY, ADULT_RULES, hazardous=False) == []   # age unknown


def test_teen_gets_only_safe_apprenticeships():
    out = al.job_alerts(WATCH, ITEMS, {"age": 16}, TODAY, TEEN_RULES, hazardous=False)
    assert out[0]["items"] == ["j2"] and "apprenticeship" in out[0]["title"]
    assert al.job_alerts(WATCH, ITEMS, {"age": 16}, TODAY, TEEN_RULES, hazardous=True) == []


def test_job_allowed_by_law():
    assert al.job_allowed(18, "job", "x", True, True)
    assert not al.job_allowed(17, "job", "x", True, False)
    assert al.job_allowed(15, "apprenticeship", "x", True, False)
    assert not al.job_allowed(15, "apprenticeship", "x", True, True)
    assert not al.job_allowed(None, "job", "x", True, False)


def test_skill_watch_alerts_new_scholarships():
    sch = [{"id": "k1", "title": "Girls STEM scholarship", "first_seen_at": "2026-11-23T01:00:00+00:00"},
           {"id": "k2", "title": "Old one", "first_seen_at": "2026-10-01T01:00:00+00:00"}]
    out = al.skill_alerts(WATCH, sch, TODAY, "mr")
    assert len(out) == 1 and "1 नवीन" in out[0]["title"]
