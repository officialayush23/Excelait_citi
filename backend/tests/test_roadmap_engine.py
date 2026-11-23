"""The roadmap's fixed rules: pace, automatic changes (fresh start, re-spacing, micro-steps, stretch,
money first), evidence from activity, and signals from what the student tells Saathi."""

from datetime import date, datetime, timedelta, timezone

from app.services import roadmap_engine as eng

TODAY = date(2026, 11, 23)  # a Monday


def ts(d: date) -> str:
    return datetime(d.year, d.month, d.day, 10, tzinfo=timezone.utc).isoformat()


def step(i, kind="task", due=None, hard=False, status="todo", progress=0, **kw):
    return {"id": f"s{i}", "goal_id": "g1", "position": i, "kind": kind, "title": f"Step {i}", "status": status,
            "progress": progress, "due_date": due.isoformat() if due else None, "hard_deadline": hard, **kw}


GOAL = {"id": "g1", "kind": "career", "status": "active", "career_slug": "staff-nurse"}


def days(n):
    return TODAY + timedelta(days=n)


# ---------------------------------------------------------------- pace

def test_inactive_after_a_week_without_activity():
    steps = [step(0, due=days(5)), step(1, "exam", due=days(60), hard=True)]
    p = eng.assess(steps, [{"created_at": ts(days(-9))}], TODAY, started=days(-30))
    assert p["pace"] == "inactive" and p["days_inactive"] == 9


def test_new_roadmap_is_not_inactive():
    p = eng.assess([step(0, due=days(5))], [], TODAY, started=TODAY)
    assert p["pace"] == "new"


def test_behind_when_a_soft_step_is_overdue():
    steps = [step(0, due=days(-3)), step(1, due=days(10))]
    p = eng.assess(steps, [{"created_at": ts(days(-1))}], TODAY, started=days(-20))
    assert p["pace"] == "behind" and p["overdue"] == ["s0"]


def test_hard_overdue_dates_do_not_count_as_behind():
    steps = [step(0, "exam", due=days(-3), hard=True), step(1, due=days(10))]
    p = eng.assess(steps, [{"created_at": ts(days(-1))}], TODAY, started=days(-20))
    assert p["pace"] != "behind"


def test_ahead_when_several_steps_done_recently():
    steps = [step(i, status="done", progress=100, done_at=ts(days(-i)), due=days(20 + i)) for i in range(3)] + [step(5, due=days(40))]
    p = eng.assess(steps, [{"created_at": ts(days(-1))}], TODAY, started=days(-20))
    assert p["pace"] == "ahead"


def test_combined_pace_takes_the_one_needing_most_care():
    assert eng.combine_pace(["ahead", "behind", "on_track"]) == "behind"
    assert eng.combine_pace(["ahead", "inactive"]) == "inactive"


# ---------------------------------------------------------------- changes

def kinds(chs):
    return [c["kind"] for c in chs]


def test_fresh_start_respaces_from_next_monday_and_splits_but_never_moves_hard_dates():
    tuesday = TODAY + timedelta(days=1)
    steps = [step(0, due=days(-10), subtasks=[{"id": "a", "key": "task.a", "title": "Open the syllabus", "done": False}]),
             step(1, due=days(-3)), step(2, "exam", due=days(20), hard=True), step(3, due=days(25))]
    p = eng.assess(steps, [{"created_at": ts(days(-12))}], tuesday, started=days(-40))
    chs = eng.plan_changes(GOAL, steps, p, [], [], tuesday, gap=7)
    fresh = next(c for c in chs if c["kind"] == "fresh_start")
    moved = {u["id"]: u["due_date"] for u in fresh["updates"]}
    assert "s2" not in moved                                     # the exam date is fixed
    assert moved["s0"] == "2026-11-30"                           # next Monday after Tuesday 24 Nov
    assert moved["s1"] == "2026-12-07"
    assert all(date.fromisoformat(d) < days(20) for k, d in moved.items() if k in ("s0", "s1"))
    micro = fresh["creates"][0]
    assert micro["kind"] == "micro" and micro["parent_step_id"] == "s0" and micro["title"] == "10 minutes: Open the syllabus"
    assert "lost" in fresh["reason"].lower() and "miss" not in fresh["reason"].lower()   # no shame
    risk = next(c for c in chs if c["kind"] == "at_risk")
    assert risk["step_id"] == "s2" and risk["params"]["days"] == 19


def test_fresh_start_is_not_repeated_within_two_weeks():
    steps = [step(0, due=days(-10)), step(1, due=days(5))]
    p = {"pace": "inactive", "overdue": ["s0"]}
    prior = [{"kind": "fresh_start", "goal_id": "g1", "created_at": ts(days(-3))}]
    assert "fresh_start" not in kinds(eng.plan_changes(GOAL, steps, p, [], prior, TODAY))


def test_behind_respaces_soft_steps_but_keeps_them_before_the_next_hard_date():
    steps = [step(0, due=days(-5)), step(1, due=days(-1)), step(2, due=days(3)), step(3, "scheme", due=days(6), hard=True)]
    p = eng.assess(steps, [{"created_at": ts(days(-1))}], TODAY, started=days(-30))
    chs = eng.plan_changes(GOAL, steps, p, [], [], TODAY, gap=7)
    assert kinds(chs)[:1] == ["at_risk"] and "respace" in kinds(chs) and "split" in kinds(chs)
    moved = {u["id"]: date.fromisoformat(u["due_date"]) for u in next(c for c in chs if c["kind"] == "respace")["updates"]}
    assert all(d < days(6) for d in moved.values())              # squeezed before the fixed scheme date
    assert all(d >= TODAY for d in moved.values())


def test_an_undone_change_is_not_made_again():
    steps = [step(0, due=days(-5)), step(1, due=days(10))]
    p = {"pace": "behind", "overdue": ["s0"]}
    prior = [{"kind": "split", "goal_id": "g1", "step_id": "s0", "created_at": ts(days(-2)), "undone_at": ts(days(-1))},
             {"kind": "respace", "goal_id": "g1", "step_id": None, "created_at": ts(days(-2)), "undone_at": ts(days(-1))}]
    assert kinds(eng.plan_changes(GOAL, steps, p, [], prior, TODAY)) == []


def test_no_second_micro_step_for_the_same_step():
    steps = [step(0, due=days(-5)), {**step(9, "micro", due=days(1)), "parent_step_id": "s0", "position": 0}]
    p = {"pace": "behind", "overdue": ["s0"]}
    assert "split" not in kinds(eng.plan_changes(GOAL, steps, p, [], [], TODAY))


def test_worry_makes_steps_smaller_even_when_on_track():
    steps = [step(0, due=days(5)), step(1, due=days(12))]
    sig = [{"kind": "worry", "value": "exam", "created_at": ts(TODAY)}]
    chs = eng.plan_changes(GOAL, steps, {"pace": "on_track", "overdue": []}, sig, [], TODAY)
    assert kinds(chs) == ["split"] and chs[0]["reason_code"] == "split_worry"


def test_old_worry_signals_fade():
    steps = [step(0, due=days(5))]
    sig = [{"kind": "worry", "value": "exam", "created_at": ts(days(-40))}]
    assert eng.plan_changes(GOAL, steps, {"pace": "on_track", "overdue": []}, sig, [], TODAY) == []


def test_ahead_adds_one_optional_stretch_and_pulls_a_soft_date_in():
    steps = [step(0, status="done"), step(1, "course", due=days(20)), step(2, "exam", due=days(90), hard=True)]
    chs = eng.plan_changes(GOAL, steps, {"pace": "ahead", "overdue": []}, [], [], TODAY)
    st = next(c for c in chs if c["kind"] == "stretch")["creates"][0]
    assert st["optional"] and st["kind"] == "stretch"
    pull = next(c for c in chs if c["kind"] == "pull_in")
    assert pull["updates"] == [{"id": "s1", "due_date": days(13).isoformat()}]
    again = eng.plan_changes(GOAL, steps, {"pace": "ahead", "overdue": []}, [], [{"kind": "stretch", "goal_id": "g1", "created_at": ts(days(-5))}], TODAY)
    assert "stretch" not in kinds(again)


def test_money_pressure_puts_scholarships_first_and_adds_earning_for_adults_only():
    steps = [step(0, "course", due=days(7)), step(1, "document", due=days(14)), step(2, "scheme", due=days(21))]
    sig = [{"kind": "money", "value": "pressure", "created_at": ts(TODAY)}]
    minor = eng.plan_changes(GOAL, steps, {"pace": "on_track", "overdue": []}, sig, [], TODAY, minor=True)
    ch = next(c for c in minor if c["kind"] == "reorder")
    assert ch["creates"] == [] and ch["reason_code"] == "money_first"
    assert {u["id"]: u["position"] for u in ch["updates"]}["s2"] == 0
    adult = next(c for c in eng.plan_changes(GOAL, steps, {"pace": "on_track", "overdue": []}, sig, [], TODAY, minor=False) if c["kind"] == "reorder")
    assert adult["creates"][0]["kind"] == "job" and adult["reason_code"] == "earn_while_learning"


def test_paused_goals_are_left_alone():
    steps = [step(0, due=days(-5))]
    assert eng.plan_changes({**GOAL, "status": "paused"}, steps, {"pace": "behind", "overdue": ["s0"]}, [], [], TODAY) == []


def test_hard_deadline_is_flagged_within_a_week_even_on_track():
    steps = [step(0, "exam", due=days(5), hard=True)]
    chs = eng.plan_changes(GOAL, steps, {"pace": "on_track", "overdue": []}, [], [], TODAY)
    assert kinds(chs) == ["at_risk"] and chs[0]["updates"] == [{"id": "s0", "at_risk": True}]


# ---------------------------------------------------------------- scheduling and grouping

def test_soft_dates_are_spaced_and_kept_before_hard_dates():
    steps = [step(0, "document"), step(1, "scheme"), step(2, "exam", due=days(10), hard=True), step(3, "course")]
    out = {s["id"]: s["due_date"] for s in eng.schedule_soft(steps, TODAY, gap=7)}
    assert out["s0"] == days(7).isoformat()
    assert out["s1"] == days(9).isoformat()          # 14 days would pass the exam: one day before it
    assert out["s2"] == days(10).isoformat()
    assert out["s3"] == days(21).isoformat()


def test_only_sundays_moves_dates_to_sundays():
    assert eng.snap(TODAY, ["sun"]).weekday() == 6
    out = eng.schedule_soft([step(0, "course")], TODAY, gap=7, days=["sun"])
    assert date.fromisoformat(out[0]["due_date"]).weekday() == 6


def test_gap_days_from_time_available():
    assert eng.gap_days({}, []) == 7
    assert eng.gap_days({"hours_per_week": 3}, []) == 14
    assert eng.gap_days({}, [{"kind": "time", "value": "sundays", "detail": {"days": ["sun"], "hours_per_week": 4}}]) == 10


def test_now_next_later():
    steps = [step(0, status="done"), step(1), step(2), step(3), step(4), step(5, "milestone", due=days(400), hard=True)]
    b = eng.buckets(steps, TODAY)
    assert b == {"s0": "done", "s1": "now", "s2": "next", "s3": "next", "s4": "later", "s5": "later"}


def test_micro_step_and_parent_are_both_now():
    steps = [step(1), {**step(9, "micro"), "parent_step_id": "s1", "position": 1}, step(2)]
    b = eng.buckets(steps, TODAY)
    assert b["s9"] == "now" and b["s1"] == "now" and b["s2"] == "next"


def test_progress_ignores_helper_and_optional_steps():
    steps = [step(0, status="done"), step(1, progress=50), step(2, "micro", status="done"), step(3, "stretch", optional=True)]
    assert eng.goal_progress(steps) == 75
    assert eng.overall_progress([{"steps": steps}, {"steps": [step(7)]}]) == 50


def test_old_steps_get_why_and_what_to_do_now():
    s = eng.with_copy({"id": "x", "kind": "milestone", "title": "Eligible from age 18"})
    assert s["copy_key"] == "milestone_gate" and "law" in s["why"]
    e = eng.with_copy({"id": "y", "kind": "exam", "title": "Take NEET"})
    assert e["now_text"] and [t["id"] for t in e["subtasks"]] == ["dates", "syllabus", "paper", "form"]


# ---------------------------------------------------------------- evidence

def test_applying_for_the_scheme_completes_its_step():
    steps = [step(0, "scheme", ref_id="pm-yasasvi"), step(1, "scheme", ref_id="other")]
    ups = eng.match_event(steps, {"kind": "scheme_applied", "ref": "pm-yasasvi"})
    assert ups == [{"id": "s0", "progress": 100, "status": "done"}]


def test_viewing_a_scheme_starts_it_and_ticks_the_check():
    s = eng.with_copy(step(0, "scheme", ref_id="pm-yasasvi"))
    ups = eng.match_event([s], {"kind": "scheme_viewed", "ref": "pm-yasasvi"})
    assert ups[0]["progress"] == 25 and ups[0]["status"] == "doing"
    assert next(t for t in ups[0]["subtasks"] if t["id"] == "check")["done"]


def test_a_lesson_moves_a_course_and_finishes_its_micro_step_but_never_completes_the_course():
    course = step(0, "course", progress=80)
    micro = {**step(9, "micro"), "parent_step_id": "s0", "position": 0}
    ups = {u["id"]: u for u in eng.match_event([course, micro], {"kind": "lesson_completed", "ref": "l1"})}
    assert ups["s9"]["status"] == "done"
    assert ups["s0"]["progress"] == 90 and ups["s0"]["status"] == "doing"


def test_evidence_never_lowers_progress_or_touches_done_steps():
    steps = [step(0, "scheme", ref_id="x", progress=60), step(1, "scheme", ref_id="x", status="done", progress=100)]
    assert eng.match_event(steps, {"kind": "scheme_viewed", "ref": "x"}) == []


def test_unrelated_activity_moves_nothing():
    assert eng.match_event([step(0, "exam", ref_id="neet")], {"kind": "saathi_turn"}) == []


def test_community_post_completes_the_ask_a_senior_step():
    ups = eng.match_event([step(0, "community"), step(1, "community")], {"kind": "community_post"})
    assert [u["id"] for u in ups] == ["s0"]


# ---------------------------------------------------------------- signals

def test_signals_english():
    got = {(s["kind"], s["value"]) for s in eng.extract_signals("I want to be a nurse but the NEET exam scares me and I only have Sundays free")}
    assert ("worry", "exam") in got and ("time", "sundays") in got


def test_signals_hindi_and_hinglish():
    hi = {(s["kind"], s["value"]) for s in eng.extract_signals("मुझे परीक्षा से डर लगता है, घर में पैसों की कमी है")}
    assert ("worry", "exam") in hi and ("money", "pressure") in hi
    hg = {(s["kind"], s["value"]) for s in eng.extract_signals("Mujhe paise ki bahut zaroorat hai, roz 2 ghante free hoon")}
    assert ("money", "pressure") in hg
    t = next(s for s in eng.extract_signals("I have 2 hours a day") if s["kind"] == "time")
    assert t["detail"]["hours_per_week"] == 14


def test_signals_marathi_and_mood():
    mr = {(s["kind"], s["value"]) for s in eng.extract_signals("मला परीक्षेची भीती वाटते, मी थकलो आहे")}
    assert ("worry", "exam") in mr and ("mood", "low") in mr


def test_goal_signal_uses_the_catalogue_lookup():
    got = eng.extract_signals("I want to do nursing", career_lookup=lambda t: "staff-nurse" if "nurs" in t else None)
    assert {"kind": "goal", "value": "staff-nurse", "detail": {"career": "staff-nurse"}} in got
    assert eng.extract_signals("hello there") == []


def test_tone():
    assert eng.tone("behind", [{"kind": "worry", "value": "exam"}]) == "reassure"
    assert eng.tone("inactive", []) == "welcome_back"
    assert eng.tone("ahead", []) == "cheer"
