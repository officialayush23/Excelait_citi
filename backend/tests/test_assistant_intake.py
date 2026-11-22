"""Saathi's fixed rules: language, intent, intake, one question per turn, minors."""

from types import SimpleNamespace

import pytest

from app.services import assistant as a
from app.services import jobs

HINGLISH = ("Hello, mera naam Ayush hai. Main 10th standard mein hoon, but mujhe mere ghar mein paison ki bahut zaroorat hai, "
            "toh mujhe padhai karte hue paise bhi kamane honge. Kya main kuch kar sakta hoon?")


@pytest.mark.parametrize("text,lang", [
    (HINGLISH, "hinglish"),
    ("नमस्ते, मुझे नर्स बनना है। मैं क्या करूँ?", "hi"),
    ("मी आठवीत शिकते. मला शिष्यवृत्ती मिळेल का?", "mr"),
    ("Mi aathvit shikte, mala scholarship milel ka?", "mr_latn"),
    ("I am 18 and doing ITI electrician. Show me electrician jobs near Pune.", "en"),
    ("15", None),
])
def test_detect_lang(text, lang):
    assert a.detect_lang(text) == lang


def test_short_answers_keep_the_thread_language():
    assert a.pick_lang("15", [HINGLISH], "en") == "hinglish"
    assert a.pick_lang("महाराष्ट्र", ["मी आठवीत शिकते. मला शिष्यवृत्ती मिळेल का?"], "en") == "mr"
    assert a.pick_lang("ok", [], "hi") == "en" or a.pick_lang("ok", [], "hi") == "hi"


def fake_graph():
    careers = {"staff-nurse": {"name": "Staff nurse (GNM / B.Sc Nursing)", "name_i18n": {"hi": "स्टाफ नर्स"}},
               "electrician": {"name": "Electrician", "name_i18n": {"hi": "इलेक्ट्रीशियन"}}}
    return SimpleNamespace(careers=careers, programs={}, exams={}, schemes={})


def test_intents(monkeypatch):
    monkeypatch.setattr(a, "graph", fake_graph)
    assert a.detect_intent(HINGLISH)[0] == "earn"
    assert a.detect_intent("Show me electrician jobs near Pune")[0] == "jobs"
    assert a.detect_intent("मी आठवीत शिकते. मला शिष्यवृत्ती मिळेल का?")[0] == "scholarship"
    assert a.detect_intent("मुझे नर्स बनना है") == ("career_named", "staff-nurse")
    assert a.detect_intent("Help me find careers that suit me")[0] == "careers"
    assert a.detect_intent("15")[0] is None


def test_required_facts_in_order():
    f = {"class_level": 10}
    assert a.missing_for("earn", f)[:2] == ["age", "district"]
    full = {"age": 15, "class_level": 10, "district": "Nashik", "state": "Maharashtra", "skills": ["phone repair"],
            "hours_per_week": 10, "can_travel_km": 5, "has_family_business": False}
    assert a.missing_for("earn", full) == ["gender"]  # scholarships for girls need it
    assert a.missing_for("earn", {**full, "gender": "female"}) == []
    assert a.missing_for("scholarship", {"class_level": 10, "state": "Maharashtra"}) == ["district", "gender"]
    assert a.missing_for("careers", {"class_level": 11}) == ["interests"]
    assert a.missing_for("careers", {"class_level": 11, "skills": ["sewing"]}) == []


def test_parse_plain_answers():
    assert a.parse_answer("age", "15 saal") == 15
    assert a.parse_answer("age", "मैं १५ साल का हूँ") == 15
    assert a.parse_answer("hours_per_week", "2 ghante roz") == 14
    assert a.parse_answer("hours_per_week", "hafte mein 10 ghante") == 10
    assert a.parse_answer("has_family_business", "nahi") is False
    assert a.parse_answer("has_family_business", "होय") is True
    assert a.parse_answer("district", "Nashik, Maharashtra") == {"state": "Maharashtra", "district": "Nashik"}
    assert a.parse_answer("can_travel_km", "5 km tak") == 5


def test_skill_tags_feed_matching():
    assert {"hands_on", "computers"} <= set(a.skill_tags(["phone repair thoda aata hai"]))
    assert a.skill_tags([]) == []


def test_reply_checks():
    assert a.hazard_issue("Tum driver ban sakte ho.") == "driver"
    assert a.hazard_issue("18 saal ke baad electrician ban sakte ho.") is None
    assert a.number_issue("Aapko 5000 rupaye milenge", "nothing") == ["5000"]
    assert a.number_issue("Aapko 5000 rupaye milenge", "benefit 5000") == []
    assert a.script_of("Theek hai") == "latin" and a.script_of("ठीक है") == "devanagari"


class FakeTable:
    def __init__(self, rows=None):
        self.rows = rows or []

    def __getattr__(self, _):
        return lambda *x, **k: self

    def execute(self):
        return SimpleNamespace(data=self.rows)


class FakeDb:
    def __init__(self):
        self.inserted = []

    def table(self, name):
        if name == "assistant_threads":
            return FakeTable([{"id": "t1"}])
        if name == "assistant_messages":
            t = FakeTable([])
            t.insert = lambda rows: (self.inserted.extend(rows), t)[1]
            return t
        return FakeTable([])


def call(name, args, i=0):
    import json
    return {"id": f"c{i}", "type": "function", "function": {"name": name, "arguments": json.dumps(args)}}


def test_one_question_then_stop(monkeypatch):
    """The model asks two questions and tries to list careers in the same turn: only one card, no list."""
    db = FakeDb()
    monkeypatch.setattr(a, "get_db", lambda: db)
    monkeypatch.setattr(a, "graph", fake_graph)
    monkeypatch.setattr(a, "get_facts", lambda uid: {"class_level": 10})
    monkeypatch.setattr(a, "merge_facts", lambda uid, f: {"class_level": 10, **f})
    rounds = []

    def fake_llm(messages, tools, tool_choice=None, max_tokens=600):
        rounds.append([t["function"]["name"] for t in tools or []])
        return {"usage": {"total_tokens": 100}, "choices": [{"message": {"content": "", "tool_calls": [
            call("ask_student", {"field": "age", "question": "Aapki umar kitni hai?"}, 0),
            call("ask_student", {"field": "age", "question": "Aur kitne ghante?"}, 1),
            call("find_careers", {}, 2)]}}]}

    monkeypatch.setattr(a, "_llm", fake_llm)
    res = a.chat("u1", {"student"}, HINGLISH, "en")
    assert len(rounds) == 1                                  # the loop stopped after the question
    assert set(rounds[0]) == {"save_facts", "ask_student"}   # intake offers no list tools at all
    kinds = [c["type"] for c in res["cards"]]
    assert kinds == ["question"]
    assert res["cards"][0]["answered"] == a.ANSWERED["hinglish"]
    assert res["lang"] == "hinglish" and res["intent"] == "earn"


def test_lists_are_refused_while_facts_are_missing(monkeypatch):
    monkeypatch.setattr(a, "get_facts", lambda uid: {})
    monkeypatch.setattr(a, "graph", fake_graph)
    ctx = a.Ctx("u1", {"student"})
    ctx.missing = ["age"]
    assert a.run_tool(ctx, "find_careers", {}).startswith("need: age")
    assert a.run_tool(ctx, "find_jobs", {"role": "electrician"}).startswith("need: age")
    ctx.missing = []
    assert a.run_tool(ctx, "find_careers", {}).startswith("need: interests")
    assert ctx.cards == []


def test_minor_gets_no_job_listings(monkeypatch):
    monkeypatch.setattr(a, "graph", fake_graph)
    monkeypatch.setattr(a, "get_facts", lambda uid: {"age": 12, "district": "Nashik"})
    ctx = a.Ctx("u1", {"student"})
    out = a.run_tool(ctx, "find_jobs", {"role": "mobile repair"})
    assert "under 14" in out and [c["type"] for c in ctx.cards] == ["law"]
    monkeypatch.setattr(a, "get_facts", lambda uid: {"age": 16, "district": "Nashik"})
    monkeypatch.setattr(a, "graph", lambda: SimpleNamespace(careers={"mason": {"name": "Mason", "name_i18n": {}}}, programs={}, exams={}, schemes={}))
    ctx = a.Ctx("u1", {"student"})
    assert "not allowed before 18" in a.run_tool(ctx, "find_jobs", {"role": "mason"})
    called = {}
    monkeypatch.setattr(jobs, "find_jobs", lambda *x, **k: called.update(k) or {"items": [], "pages": [], "role": "x", "place": "y", "searched_place": "y", "sites": [], "nearby": []})
    a.run_tool(ctx, "find_jobs", {"role": "tailor"})
    assert called["apprenticeship_only"] is True


def test_job_url_kinds():
    assert jobs._kind("https://www.workindia.in/jobs/iti_electrician-bhosari-pune-10410515") == "post"
    assert jobs._kind("https://apna.co/job/pune/electrician-180528941") == "post"
    assert jobs._kind("https://www.naukri.com/iti-electrician-jobs-in-pune") == "page"
    assert jobs._kind("https://www.ambitionbox.com/profile/electrician-salary") == "drop"
    assert jobs._kind("https://in.indeed.com/career-advice/x") == "drop"
    assert jobs._workindia_slug("https://www.workindia.in/jobs/iti_electrician-akurdi-pune-8345083") == ("Iti Electrician", "Akurdi, Pune")


def test_apna_listing_parser():
    text = "[## Electrician\n\nSodexo\n\nHinjewadi, Pune\n\n₹22,000 - ₹24,000\n\nFull Time](/job/pune/electrician-386959156)"
    [x] = jobs._parse_apna_list(text)
    assert x["employer"] == "Sodexo" and x["place"] == "Hinjewadi, Pune" and x["url"].startswith("https://apna.co/job/")


def test_place_in_message():
    assert a.place_in("Show me electrician jobs near Pune.") == {"district": "Pune"}
    assert a.place_in("Pune mein naukri chahiye") == {"district": "Pune"}
    assert a.place_in("Ghar mein paise chahiye") is None
    assert a.place_in("I am in Class 11") is None
