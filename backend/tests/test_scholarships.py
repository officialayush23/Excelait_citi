"""Scholarship discovery and the knowledge store: parsing, matching, expiry and the database-first decision.
No network and no database: Tavily and the store are replaced with fakes."""

from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytest

from app.services import knowledge as kb
from app.services import scholarships as s

FIX = Path(__file__).parent / "fixtures" / "buddy4study_scholarship.md"
URL = "https://www.buddy4study.com/scholarship/sample-foundation-scholarship-for-girls"


# ---------------------------------------------------------------- dates


@pytest.mark.parametrize("text,want", [
    ("Deadline Date: 31-Dec-2026", date(2026, 12, 31)),
    ("last date December 31, 2026", date(2026, 12, 31)),
    ("31/12/2026", date(2026, 12, 31)),
    ("30-09-2026", date(2026, 9, 30)),
    ("30th September 2026", date(2026, 9, 30)),
    ("1st of March, 2027", date(2027, 3, 1)),
    ("2026-11-22", date(2026, 11, 22)),
    ("Sept 5, 2026", date(2026, 9, 5)),
    ("no date here", None),
    ("31/02/2026", None),
])
def test_parse_date(text, want):
    assert s.parse_date(text) == want


def test_find_deadline_takes_the_stated_one_and_closed():
    d, words, closed = s.find_deadline("Application start date: September 22, 2026\nThe last date to apply: November 22, 2026")
    assert d == date(2026, 11, 22) and "last date" in words.lower() and not closed
    assert s.find_deadline("| Closing date | November 22, 2026 |")[0] == date(2026, 11, 22)
    assert s.find_deadline("###### Deadline\n\nClosed") == (None, None, True)
    # an extended deadline is the later one
    assert s.find_deadline("Deadline: 15-Nov-2026. Extended deadline: 30-Nov-2026")[0] == date(2026, 11, 30)


# ---------------------------------------------------------------- money


@pytest.mark.parametrize("text,want", [
    ("₹50,000", 50000), ("Rs. 2.5 lakh", 250000), ("INR 6,00,000", 600000), ("Rs 1.5 lakhs per year", 150000),
    ("up to ₹1,200 a month", 1200), ("2 lakh", 200000), ("INR 25,000 for Classes 9-12; up to INR 45,000 for UG", 45000),
    ("no money", None),
])
def test_parse_amount(text, want):
    assert s.parse_amount(text) == want


def test_income_known_unknown_none():
    assert s.parse_income("Annual family income should be below INR 6 lakh from all sources.") == ("known", 600000)
    assert s.parse_income("have an annual income of less than or equal to ₹2,50,000 from all sources") == ("known", 250000)
    assert s.parse_income("The parents/Guardian annual income shall be less than or equal to Rs. 2,50,000.") == ("known", 250000)
    assert s.parse_income("Family income: Rs 2.5 lakh for SC students and Rs 8 lakh for OBC students") == ("unknown", None)
    assert s.parse_income("Students from low income families may apply")[0] == "unknown"
    assert s.parse_income("Open to all girls studying in Class 10") == ("none", None)


def test_marks_never_guessed():
    assert s.parse_marks("Must have obtained at least 70% marks in the previous class") == ("known", 70.0)
    assert s.parse_marks("at least 70% marks (60% for students with disabilities)")[0] == "unknown"
    assert s.parse_marks("Applicants must score 60% to 80% marks in Class 12") == ("known", 60.0)


# ---------------------------------------------------------------- eligibility fields


def test_levels():
    assert s.parse_levels("Students in Class 9 to 12")[1] == ["class_9", "class_10", "class_11", "class_12"]
    assert s.parse_levels("currently enrolled in Classes 11 or 12, or pursuing undergraduate degree, Diploma or ITI")[1] == \
        ["class_11", "class_12", "iti", "diploma", "ug"]
    assert "class_11" in s.parse_levels("Students in Class 11 and above")[1]
    # 'have completed Class 10' is a qualification, not the class studied in
    assert s.parse_levels("have completed Class 10 and Class 12 and be enrolled in the first year of an undergraduate degree")[1] == ["ug"]
    assert s.parse_levels("Student should be passes SSC/equivalent Matric")[0] == "unknown"
    assert s.parse_levels("first-year B.Sc Nursing students")[1] == ["ug", "nursing"]


def test_categories_gender_states():
    assert s.parse_categories("belong to the Scheduled Caste (SC) or Navbouddha community")[1] == ["SC"]
    assert s.parse_categories("SC/ST students get 5% relaxation in marks") == ("none", [])
    assert s.parse_categories("Students from VJNT category can apply")[1] == ["DNT"]
    assert s.parse_minority("Students belonging to minority communities only")
    assert not s.parse_minority("Preference will be given to minority students")
    assert s.parse_gender("Open to meritorious girl students across India") == ("known", "female")
    assert s.parse_gender("Both boys and girls can apply") == ("none", None)
    assert s.parse_gender("Preference to girl students") == ("none", None)
    assert s.parse_states("be a domicile of Maharashtra")[1] == ["Maharashtra"]
    assert s.parse_states("Indian students studying anywhere in India") == ("none", [])
    assert s.parse_states("Applicants must be domicile of the state") == ("unknown", [])


# ---------------------------------------------------------------- section parsing


def test_buddy4study_page_sections():
    r = s.parse_page(URL, FIX.read_text())
    assert r["name"] == "Sample Foundation Scholarship for Girls 2026-27"
    assert r["provider"] == "Sample Foundation" and r["provider_type"] == "ngo"
    assert r["amount"] == 15000 and r["deadline"] == "2026-12-31"
    assert r["apply_url"] == "https://example.org/apply"
    assert r["documents"] == ["Income certificate issued by the Tahsildar", "Caste certificate", "Previous class marksheet"]
    assert "Apply Now" in r["how_to_apply"]
    e = r["eligibility"]
    assert e["levels"] == ["class_9", "class_10", "class_11", "class_12"]
    assert e["max_income"] == 250000 and e["min_marks"] == 60.0 and e["gender"] == "female"
    assert e["categories"] == ["SC", "ST"] and e["states"] == ["Maharashtra"] and e["unknown"] == []
    assert not r["partial"] and r["source_site"] == "buddy4study.com"


def test_list_article_is_not_a_record():
    md = "# Scholarships for Girls 2026\n" + "".join(
        f"### {n} Scholarship 2026-27\n\n**Eligibility:** girls in Class {k}\n\n" for k, n in enumerate(["Azim Premji", "Kotak Kanya", "Santoor", "Vigyan Jyoti"], 9))
    assert s.parse_page("https://www.buddy4study.com/article/scholarships-for-girls", md) is None


def test_snippet_record_is_partial():
    r = s.parse_snippet("The Tata Capital Pankh Scholarship Programme", "EligibilityDeadline Date: 30-Nov-2026 · Open to Class 11 students",
                        "https://www.buddy4study.com/page/the-tata-capital-pankh-scholarship-programme")
    assert r["partial"] and r["deadline"] == "2026-11-30" and "details" in r["eligibility"]["unknown"]
    assert s.match(r, {"class_level": 11, "gender": "male"}, date(2026, 11, 22))["status"] == "check"


# ---------------------------------------------------------------- matching


def rec(**e):
    return {"name": "X", "deadline": "2026-12-31", "eligibility": {"unknown": [], **e}}


TODAY = date(2026, 11, 22)
GIRL = {"class_level": 10, "course": "school", "state": "Maharashtra", "gender": "female", "social_category": "SC",
        "family_income_annual": 150000, "marks_percent": 72}


def test_match_likely_eligible_only_when_everything_known():
    r = rec(levels=["class_9", "class_10"], max_income=250000, min_marks=60, gender="female", categories=["SC", "ST"], states=["Maharashtra"])
    assert s.match(r, GIRL, TODAY)["status"] == "likely_eligible"
    no_income = {k: v for k, v in GIRL.items() if k != "family_income_annual"}
    m = s.match(r, no_income, TODAY)
    assert m["status"] == "check" and m["unknown"] == ["family_income_annual"]
    # unknown on the page side is never 'eligible'
    assert s.match(rec(levels=["class_10"], unknown=["max_income"]), GIRL, TODAY)["status"] == "check"


def test_match_not_eligible_with_reason():
    m = s.match(rec(levels=["class_10"], max_income=100000), GIRL, TODAY)
    assert m["status"] == "not_eligible" and "income" in m["reasons"][0]
    assert s.match(rec(levels=["class_10"], gender="female"), {**GIRL, "gender": "male"}, TODAY)["reasons"] == ["for girls only"]
    assert s.match(rec(levels=["ug", "pg"]), GIRL, TODAY)["status"] == "not_eligible"
    assert s.match(rec(levels=["class_10"], categories=["OBC"]), GIRL, TODAY)["status"] == "not_eligible"
    assert s.match(rec(levels=["class_10"], states=["Uttar Pradesh"]), GIRL, TODAY)["status"] == "not_eligible"


def test_match_expired_and_nursing():
    assert s.match({**rec(levels=["class_10"]), "deadline": "2026-11-21"}, GIRL, TODAY)["status"] == "expired"
    assert s.match({**rec(levels=["class_10"]), "deadline": "2026-11-22"}, GIRL, TODAY)["status"] == "likely_eligible"  # last day
    assert s.match({**rec(), "deadline": None, "closed": True}, GIRL, TODAY)["status"] == "expired"
    nurse = {"class_level": 13, "course": "ug_degree", "gender": "female", "subjects": ["nursing"], "is_minority": True, "state": "Maharashtra"}
    assert s.match(rec(levels=["ug", "nursing"], gender="female"), nurse, TODAY)["status"] == "likely_eligible"
    plain_ug = {**nurse, "subjects": ["history"]}
    assert s.match(rec(levels=["ug", "professional"]), plain_ug, TODAY)["status"] == "check"  # may or may not be professional
    assert s.match(rec(levels=["ug"], minority=True), {**nurse, "is_minority": None}, TODAY)["unknown"] == ["is_minority"]


# ---------------------------------------------------------------- knowledge store


def test_expiry_rules():
    at = datetime(2026, 11, 22, 6, 0, tzinfo=timezone.utc)
    eod = kb.expiry_for("scholarship", deadline=date(2026, 12, 31), at=at)
    assert eod == datetime(2026, 12, 31, 18, 29, 59, tzinfo=timezone.utc)  # 23:59:59 IST
    assert kb.expiry_for("scholarship", at=at) == at + timedelta(days=30)
    assert kb.expiry_for("job", posted=date(2026, 11, 1), at=at).date() == date(2026, 12, 1)
    assert kb.expiry_for("job", deadline=date(2026, 11, 25), posted=date(2026, 11, 1), at=at).date() == date(2026, 11, 25)
    assert kb.expiry_for("job", at=at) == at + timedelta(days=30)
    assert kb.expiry_for("apprenticeship", deadline=date(2027, 1, 15), at=at).date() == date(2027, 1, 15)
    assert kb.expiry_for("web", at=at) == at + timedelta(days=30)
    assert kb.expiry_for("notice", stated=date(2026, 12, 5), at=at).date() == date(2026, 12, 5)


def test_db_first_decision():
    at = datetime(2026, 11, 22, 12, tzinfo=timezone.utc)
    assert kb.need_web_search(None, 0, 8, at) is True                       # nothing known yet
    assert kb.need_web_search(None, 12, 8, at) is False                     # other students' finds are enough
    assert kb.need_web_search(at - timedelta(hours=3), 1, 8, at) is False   # same search today: never repeated
    assert kb.need_web_search(at - timedelta(hours=25), 40, 8, at) is True  # daily refresh of the same query


def test_query_key_is_order_and_case_free():
    assert kb.norm_query("Class 10  Scholarship, Nashik") == kb.norm_query("scholarship nashik class 10")
    assert kb.query_key("job", "a b") != kb.query_key("web", "a b")


def test_discover_reads_store_first_and_shares_records(monkeypatch):
    """A record stored for one student is matched for another from the store; no web call when enough are fresh."""
    base = s.parse_page(URL, FIX.read_text())
    rows = [{"id": f"id{i}", "data": {**base, "source_url": f"{URL}-{i}", "name": f"Sample {i} Scholarship"}} for i in range(9)]
    calls = []
    monkeypatch.setattr(kb, "find", lambda kinds, state=None, district=None, tags_any=None, limit=300: rows)
    monkeypatch.setattr(kb, "last_search", lambda kind, q: None)
    monkeypatch.setattr(kb, "hit", lambda ids: None)
    monkeypatch.setattr(s, "web_round", lambda *a, **k: calls.append(a) or [])
    monkeypatch.setattr(s, "_verified", lambda facts: [])
    res = s.discover({**GIRL, "district": "Nashik"})
    assert calls == [] and res["from_store"] and res["counts"]["likely_eligible"] == 9
    assert all(x["source_url"] and x["deadline"] == "2026-12-31" for x in res["found"])
    boy = s.discover({**GIRL, "gender": "male"})
    assert boy["counts"]["likely_eligible"] == 0 and boy["counts"]["not_eligible"] == 9 and boy["found"] == []


def test_discover_searches_web_when_store_is_thin(monkeypatch):
    stored: list[dict] = []
    monkeypatch.setattr(kb, "find", lambda *a, **k: stored)
    monkeypatch.setattr(kb, "last_search", lambda kind, q: None)
    monkeypatch.setattr(kb, "log_search", lambda *a, **k: None)
    monkeypatch.setattr(kb, "hit", lambda ids: None)
    monkeypatch.setattr(kb, "by_urls", lambda urls: {})
    monkeypatch.setattr(kb, "upsert_items", lambda items: [{"id": "n1", **i} for i in items] if not stored.extend(
        {"id": "n1", "data": i["data"]} for i in items) else [])
    monkeypatch.setattr(s, "_verified", lambda facts: [])
    monkeypatch.setattr(s, "get_settings", lambda: type("S", (), {"tavily_api_key": "k", "scholarship_llm_parse": False})())
    monkeypatch.setattr(s, "search", lambda q, d, usage: usage.update(calls=usage["calls"] + 1) or [{"url": URL, "title": "t", "snippet": ""}])
    monkeypatch.setattr(s, "extract", lambda urls, usage: {URL: FIX.read_text()})
    res = s.discover(GIRL)
    assert res["searched"] and res["tavily"]["calls"] >= 1 and res["counts"]["likely_eligible"] == 1
    assert res["found"][0]["name"].startswith("Sample Foundation")


def test_list_article_entries_are_partial_records():
    md = """# Scholarships for Girls 2026-27

### Kotak Kanya Scholarship 2026-27

**Eligibility:** Applicants must have secured at least 75% marks in Class 12, and their annual family income must not exceed ₹6 lakh. They must be admitted to the first year of a professional degree course.

**Award:** ₹1.5 lakh per year.

**Last date:** September 30, 2099

| Application Mode | Portal | Apply Link |
| --- | --- | --- |
| Online | Buddy4Study | [CLICK HERE](https://www.buddy4study.com/page/kotak-kanya-scholarship) |

### Pudhumai Penn Scheme (Tamil Nadu)

**Eligibility:** This scheme is for girls who studied from Class 6 to Class 12 in Tamil Nadu government schools and are now pursuing their first undergraduate degree, diploma or ITI course. There is no income limit.
"""
    url = "https://www.buddy4study.com/article/scholarships-for-girls"
    assert s.is_list_article(md) and s.parse_page(url, md) is None
    a, b = s.parse_list_entries(md, url)
    assert a["source_url"] == "https://www.buddy4study.com/page/kotak-kanya-scholarship" and a["partial"]
    assert a["deadline"] == "2099-09-30" and a["amount"] == 150000
    assert a["eligibility"]["max_income"] == 600000 and a["eligibility"]["min_marks"] == 75.0 and a["eligibility"]["gender"] == "female"
    assert "class_12" not in a["eligibility"]["levels"] and "ug" in a["eligibility"]["levels"]
    assert b["eligibility"]["states"] == ["Tamil Nadu"] and "max_income" not in b["eligibility"]["unknown"]
    assert b["eligibility"]["levels"] == ["iti", "diploma", "ug"]  # 'studied from Class 6 to 12' is past schooling
    assert b["source_url"].startswith(url + "#")
    assert s.match(a, {"course": "ug_technical", "gender": "female", "marks_percent": 90, "family_income_annual": 100000}, TODAY)["status"] == "check"


def test_jobs_served_from_store_for_another_student(monkeypatch):
    from app.services import jobs
    post = {"title": "ITI Electrician", "employer": "A Ltd", "place": "Bhosari, Pune", "pay": None, "posted": None,
            "site": "workindia.in", "url": "https://www.workindia.in/jobs/iti_electrician-bhosari-pune-10410515"}
    rows = [{"id": f"j{i}", "data": {**post, "url": post["url"] + str(i)}} for i in range(6)]
    web = []
    monkeypatch.setattr(kb, "find", lambda kinds, state=None, district=None, tags_any=None, limit=300: rows)
    monkeypatch.setattr(kb, "last_search", lambda kind, q: None)
    monkeypatch.setattr(kb, "hit", lambda ids: None)
    monkeypatch.setattr(jobs, "_search_place", lambda *a: web.append(a) or ([], []))
    res = jobs.find_jobs("electrician", "Pune", "Maharashtra")
    assert web == [] and res["from_store"] and len(res["items"]) == 6 and "_id" not in res["items"][0]


def test_jobs_found_on_web_are_stored_until_they_expire(monkeypatch):
    from app.services import jobs
    stored, logged = [], []
    post = {"title": "ITI Electrician", "employer": None, "place": "Pune", "pay": None, "posted": "2020-01-01",
            "site": "apna.co", "url": "https://apna.co/job/pune/electrician-1"}
    fresh = {**post, "posted": None, "url": "https://apna.co/job/pune/electrician-2"}
    monkeypatch.setattr(kb, "find", lambda *a, **k: [])
    monkeypatch.setattr(kb, "last_search", lambda kind, q: None)
    monkeypatch.setattr(kb, "upsert_items", lambda items: stored.extend(items) or [{"id": "x"} for _ in items])
    monkeypatch.setattr(kb, "log_search", lambda *a, **k: logged.append((a, k)))
    monkeypatch.setattr(jobs, "_search_place", lambda *a: ([post, fresh], []))
    res = jobs.find_jobs("electrician", "Pune", "Maharashtra")
    assert not res["from_store"] and [x["source_url"] for x in stored] == [fresh["url"]]  # the 2020 post has expired
    assert stored[0]["kind"] == "job" and stored[0]["district"] == "Pune" and logged[0][0][0] == "job"
