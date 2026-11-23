"""The adaptive question planner, the interest quiz, fact provenance and the profile graph."""

import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.engine.matching import riasec_top, score_career
from app.services import assistant as a
from app.services import profile
from app.services import profile_questions as pq
from app.services import students
from scripts.question_fixtures import simulate

SHARED = Path(__file__).resolve().parents[2] / "shared"
FIXTURES = json.loads((SHARED / "rules" / "question_fixtures.json").read_text(encoding="utf-8"))["personas"]
CAREERS = json.loads((SHARED / "catalogue" / "careers.json").read_text(encoding="utf-8"))["careers"]


def ids(seq):
    return [x["id"] for x in seq]


@pytest.mark.parametrize("p", FIXTURES, ids=[p["name"][:30] for p in FIXTURES])
def test_fixture_sequences_are_current(p):
    assert simulate(p["start"], p["answers"]) == p["expect"]


def test_fifteen_year_old_in_class_10_gets_age_appropriate_questions():
    seq = simulate({}, FIXTURES[0]["answers"])
    got = ids(seq)
    assert got[:8] == ["stage", "age", "state", "plan_after_10", "interests", "needs_income_soon", "hours_per_week", "has_family_business"]
    assert "stream" not in got and "work_experience" not in got and "course_year" not in got and "exam_interest" not in got
    skills = next(x for x in seq if x["id"].startswith("skills"))
    assert skills["id"] == "skills:young"
    assert "phone_repair" not in skills["options"] and "farming" not in skills["options"] and "driving" not in skills["options"]
    assert "helping_home_shop" in skills["options"]


def test_class_12_science_is_asked_stream_exams_and_marks():
    seq = simulate({}, FIXTURES[1]["answers"])
    core = [x["id"] for x in seq if x["tier"] == "core"]
    assert {"stream", "exam_interest", "marks_percent"} <= set(core)
    exams = next(x for x in seq if x["id"] == "exam_interest")["options"]
    assert "neet-ug" in exams and "jee-main" not in exams        # biology stream
    assert "mht-cet" not in exams                                # not in Maharashtra
    assert "subjects" not in ids(seq)                            # the stream already gave them
    assert "hours_per_week" not in ids(seq)                      # no earning intent


def test_iti_job_seeker_is_asked_experience_and_job_skills():
    seq = simulate({}, FIXTURES[2]["answers"])
    got = ids(seq)
    assert "work_experience" in got and "skills:work" in got
    assert "needs_income_soon" not in got and "hours_per_week" not in got and "school_type" not in got
    skills = next(x for x in seq if x["id"] == "skills:work")
    assert next(x for x in seq if x["id"] == "skills:work")["tier"] == "core"
    assert "driving" in skills["options"]                        # 19: adult options shown


def test_known_facts_from_saathi_are_never_asked():
    facts = {"class_level": 10, "age": 15, "interests": ["helping"], "state": "Maharashtra", "needs_income_soon": False}
    asked = [q["field"] for q in pq.pending(facts)]
    assert not {"stage", "age", "interests", "state", "needs_income_soon"} & set(asked)
    assert asked[0] == "plan_after_10"


def test_no_job_skills_for_young_students_who_do_not_need_income():
    v = pq.view({"stage": "c9", "age": 14, "needs_income_soon": False})
    assert pq.variant(pq.by_field()["skills"], v)["variant"] == "young"
    v = pq.view({"stage": "c11", "age": 16, "needs_income_soon": True})
    assert pq.variant(pq.by_field()["skills"], v)["variant"] == "work"
    q = pq.payload(pq.by_field()["skills"], {"stage": "c11", "age": 16, "needs_income_soon": True})
    assert "driving" not in [o["value"] for o in q["options"]]   # 16: no adult-only options


def test_apply_answer_sets_linked_facts():
    assert pq.apply_answer("stage", "c10") == {"stage": "c10", "class_level": 10, "course": "school"}
    assert pq.apply_answer("stage", "job_seeker")["needs_income_soon"] is True
    assert pq.apply_answer("stream", "science_pcb") == {"stream": "science_pcb", "subjects": ["biology", "science"]}
    assert pq.apply_answer("course_year", 2)["class_level"] == 14


def test_payload_is_localised_and_explains_why():
    p = pq.next_questions({}, lang="hi")
    q = p["questions"][0]
    assert q["field"] == "stage" and q["why"] and "पूछते" in q["why"]
    assert p["phase"] == "core" and p["completeness"]["pct"] == 0
    sens = pq.payload(pq.by_field()["social_category"], {}, "en")
    assert sens["sensitive"] and "Optional" in sens["why"] and sens["skippable"]


def test_saathi_context_never_offers_sensitive_questions():
    facts = {k: 1 for k in ("age",)} | {"stage": "c10", "state": "Maharashtra", "interests": ["art"], "plan_after_10": "arts",
                                         "needs_income_soon": False, "skills": ["drawing"], "district": "Pune", "marks_percent": 60,
                                         "subjects": ["art"], "gender": "female", "can_relocate": False, "school_type": "government"}
    facts["age"] = 15
    assert pq.next_questions(facts, "saathi", 5)["questions"] == []
    assert [q["field"] for q in pq.next_questions(facts, "onboarding", 5)["questions"]] == ["family_income_annual", "social_category", "is_disabled"]


def test_assistant_intake_uses_the_planner():
    # a full-time job seeker is not asked free hours; under 14 no travel distance
    adult = {"stage": "job_seeker", "age": 19, "class_level": 13, "district": "Pune", "state": "Maharashtra", "gender": "male", "skills": ["x"],
             "has_family_business": False, "can_travel_km": 10}
    assert a.missing_for("earn", adult) == []
    child = {"age": 12, "class_level": 7, "district": "Nashik", "state": "Maharashtra", "gender": "male", "skills": ["x"], "hours_per_week": 6,
             "has_family_business": True}
    assert a.missing_for("earn", child) == []
    assert "helping at a home shop" in a.field_hint("skills", {"age": 15, "class_level": 10}, "earn")
    assert "phone repair" in a.field_hint("skills", {"age": 19, "stage": "job_seeker"}, "earn")
    assert a.why_text("gender", {}, "scholarship", "mr").endswith("विचारतो.")


def test_quiz_scoring_and_top_codes():
    items = pq.quiz()["items"]
    assert len(items) == 18 and {i["code"] for i in items} == set("RIASEC")
    assert all(i["text"]["hi"] and i["text"]["mr"] for i in items)
    answers = {i["id"]: (2 if i["code"] in "SC" else 0) for i in items}
    scores = pq.score_quiz(answers)
    assert scores == {"R": 0, "I": 0, "A": 0, "S": 100, "E": 0, "C": 100}
    assert riasec_top(scores) == ["S", "C"]
    assert riasec_top({"R": 33, "I": 17, "A": 0, "S": 0, "E": 0, "C": 0}) == ["R", "I"]
    assert pq.score_quiz({}) == {k: 50 for k in "RIASEC"}            # all 'not sure'
    assert pq.clean_riasec({"R": 120, "I": -3, "A": 50, "S": 50, "E": 50, "C": 50.4})["R"] == 100
    assert pq.clean_riasec({"R": 1}) is None


def test_every_career_has_riasec_codes_and_quiz_adds_a_reason():
    assert all(c.get("riasec") and set(c["riasec"]) <= set("RIASEC") for c in CAREERS)
    teacher = next(c for c in CAREERS if c["slug"] == "primary-teacher")
    plain = score_career(teacher, {"interests": ["teaching"]})
    quiz = score_career(teacher, {"interests": ["teaching"], "riasec": {"R": 0, "I": 0, "A": 50, "S": 100, "E": 0, "C": 0}})
    assert not any(r["code"] == "riasec" for r in plain.reasons)
    r = next(r for r in quiz.reasons if r["code"] == "riasec")
    assert r["detail"] == ["S", "A"] and r["points"] > 0


def test_clean_facts_keeps_new_planner_facts():
    got = students.clean_facts({"stage": "c10", "stream": "arts", "riasec": {k: 10 for k in "RIASEC"}, "bogus": 1, "work_experience": "none"})
    assert set(got) == {"stage", "stream", "riasec", "work_experience"}


class Rpc:
    def __init__(self, fail_meta=False):
        self.calls, self.fail_meta = [], fail_meta

    def rpc(self, name, args):
        self.calls.append(args)
        if self.fail_meta and "p_meta" in args:
            raise RuntimeError("PGRST202 Could not find the function public.merge_student_facts(p_meta, ...)")
        return SimpleNamespace(execute=lambda: SimpleNamespace(data={**args["p_set"]}))


def test_merge_facts_records_provenance(monkeypatch):
    db = Rpc()
    monkeypatch.setattr(students, "get_db", lambda: db)
    monkeypatch.setattr(students, "_meta_ok", {})
    students.merge_facts("u", {"age": 15, "gender": None}, source="saathi", note="main 15 saal ka hoon")
    args = db.calls[0]
    assert args["p_remove"] == ["gender"]
    assert args["p_meta"]["age"]["source"] == "saathi" and args["p_meta"]["age"]["note"] == "main 15 saal ka hoon"
    assert "gender" not in args["p_meta"]


def test_merge_facts_works_before_migration_0017(monkeypatch):
    db = Rpc(fail_meta=True)
    monkeypatch.setattr(students, "get_db", lambda: db)
    monkeypatch.setattr(students, "_meta_ok", {})
    assert students.merge_facts("u", {"age": 15}, source="onboarding") == {"age": 15}
    assert "p_meta" not in db.calls[-1]


def fake_graph():
    careers = {c["slug"]: c for c in CAREERS if c["slug"] in ("primary-teacher", "anganwadi-worker", "electrician")}
    programs = {"ded": {"slug": "ded", "name": "D.El.Ed", "name_i18n": {}, "scheme_slugs": ["s1"], "exam_slugs": []}}
    careers = {k: {**v, "program_slugs": ["ded"] if k == "primary-teacher" else []} for k, v in careers.items()}
    yes = {"all": [{"id": "c", "field": "class_level", "op": "in", "value": [10], "label": "Class 10"}]}
    schemes = {"s1": {"slug": "s1", "name": "Scheme one", "name_i18n": {}, "rule": yes, "benefit_amount": 5000}}
    return SimpleNamespace(careers=careers, programs=programs, schemes=schemes)


def test_profile_graph_links_me_to_interests_careers_courses_and_money(monkeypatch):
    monkeypatch.setattr(profile, "graph", fake_graph)
    facts = {"stage": "c10", "class_level": 10, "interests": ["teaching"], "riasec": {"R": 0, "I": 0, "A": 0, "S": 100, "E": 0, "C": 0}}
    g = profile.knowledge_graph(facts, ["primary-teacher"], ["anganwadi-worker"], "en")
    nid = {n["id"] for n in g["nodes"]}
    assert {"me", "fact:stage", "interest:teaching", "riasec:S", "career:primary-teacher", "course:ded", "scheme:s1"} <= nid
    e = {(x["from"], x["to"]) for x in g["edges"]}
    assert ("interest:teaching", "career:primary-teacher") in e and ("career:primary-teacher", "course:ded") in e
    assert ("course:ded", "scheme:s1") in e and ("me", "career:primary-teacher") in e
    assert len(g["nodes"]) <= profile.MAX_NODES
    assert next(n for n in g["nodes"] if n["id"] == "fact:stage")["label"] == "Class 10"
    assert profile.money(facts) == {"eligible_inr": 5000, "eligible": [{"slug": "s1", "name": "Scheme one"}], "needs_info": 0}


def test_fact_rows_carry_source_and_labels():
    rows = profile.fact_rows({"age": 15, "social_category": "OBC", "date_of_birth": "2011-01-01"},
                             {"social_category": {"source": "saathi", "at": "2026-11-23T10:00:00+00:00", "note": "main OBC hoon"}}, "2026-11-01")
    by = {r["key"]: r for r in rows}
    assert "date_of_birth" not in by
    assert by["social_category"]["sensitive"] and by["social_category"]["source"] == "saathi" and by["social_category"]["note"] == "main OBC hoon"
    assert by["age"]["source"] == "system" and by["age"]["label"]["hi"] == "उम्र"
    assert by["age"]["group"] == "basics"
