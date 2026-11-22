import json
import re

import pytest

from app.services import work_rules as wr
from app.services import jobs


def test_every_right_is_complete_and_sourced():
    d = wr.rights_doc()
    assert d["checked_on"] == "2026-11-22"
    assert d["law_status"]["in_force_from"] == "2025-11-21"
    ids = [r["id"] for r in d["rights"]]
    assert len(ids) == len(set(ids))
    for r in d["rights"]:
        assert set(r["text"]) == {"en", "hi", "mr"}
        assert r["sources"] and all(s in d["sources"] for s in r["sources"])
    for s in d["sources"].values():
        assert s["url"].startswith("https://")
    # the rights the founder asked for are all there
    assert {"min_wage", "timely_wages", "equal_pay", "hours_overtime", "appointment_letter", "women_night_work", "maternity",
            "social_security_eshram", "epf_esi", "safety_health", "no_fee_for_job", "how_to_complain", "apprentice"} <= set(ids)


def test_numbers_match_the_law():
    r = {x["id"]: x for x in wr.rights_doc()["rights"]}
    assert r["hours_overtime"]["numbers"]["max_hours_day"] == 8 and r["hours_overtime"]["numbers"]["max_hours_week"] == 48
    assert r["maternity"]["numbers"]["weeks"] == 26
    assert r["epf_esi"]["numbers"]["esi_wage_ceiling"] == 21000
    assert r["apprentice"]["numbers"]["stipend_class_10"] == 8200
    assert r["social_security_eshram"]["numbers"]["eshram_helpline"] == "14434"


def test_card_for_adult_in_each_language():
    for lang in ("en", "hi", "mr"):
        c = wr.employment_rights(25, "Uttar Pradesh", lang)
        assert not c["minor"] and c["band"] == "adult" and c["lang"] == lang
        assert len(c["rights"]) >= 10
        assert all(x["text_lang"] == x["text"][lang] for x in c["rights"])
        assert c["sources"] and all(s["url"] for s in c["sources"]) and c["checked_on"]
    assert wr.employment_rights(25, None, "xx")["lang"] == "en"
    assert wr.employment_rights(None, None, "en")["rights"]  # age unknown: general rights


def test_minor_gets_no_rights_list():
    c = wr.employment_rights(15, "maharashtra", "en")
    assert c["minor"] and c["rights"] == [] and c["minimum_wage"] is None and c["helplines"] == []


def test_helplines_only_verified_numbers():
    nums = {h["id"]: h["number"] for h in wr.employment_rights(30, None, "en")["helplines"]}
    assert nums["eshram"] == "14434"
    assert "state_labour_helpline" not in nums and "epfo_esic_ncs" not in nums


def test_minimum_wage_up_is_lowest_zone_and_unverified():
    mw = wr.minimum_wage("Uttar Pradesh", "unskilled")
    assert mw["per_month"] == 12530.25 and mw["zone"] == "other_districts"
    assert mw["per_day"] == round(12530.25 / 26, 2)
    assert mw["verified"] is False and mw["source"].startswith("https://") and mw["effective_from"] == "2026-10-01"
    assert wr.minimum_wage("uttar_pradesh", "skilled")["per_month"] == 15438.42
    assert wr.minimum_wage("uttar pradesh", "semi-skilled")["per_month"] == 13782.3


def test_minimum_wage_maharashtra_not_invented():
    assert wr.minimum_wage("Maharashtra") is None
    assert wr.minimum_wage("Atlantis") is None and wr.minimum_wage(None) is None
    c = wr.employment_rights(22, "Maharashtra", "en")
    assert c["minimum_wage"] is None and c["minimum_wage_note"] == "state_sets_per_employment"
    json.dumps(c)  # serialisable


def test_minimum_wages_file_never_claims_unopened_official_figures():
    d = wr.wages_doc()
    for st in d["states"].values():
        assert st["checked_on"] if "checked_on" in st else d["checked_on"]
        if not st["verified"]:
            assert st["verification_note"]
    assert d["central_floor_wage"]["status"] == "not_found"


def test_minor_rules_rechecked():
    m = wr.doc()
    assert m["checked_on"] == "2026-11-22" and m["law_status"]["result"] == "no_change_to_age_limits"
    for r in m["rules"]:
        assert set(r["text"]) == {"en", "hi", "mr"} and all(s in m["sources"] for s in r["sources"])
    assert "osh_code" in m["sources"] and "apprentice_stipend" in m["sources"]
    assert any("6,800" in r["text"]["en"] for r in m["rules"] if r["id"] == "teen_apprentice")
    assert wr.work_rules(16)["can_apprentice"] and not wr.work_rules(13)["can_apprentice"]


@pytest.mark.parametrize("pay,state,flag", [
    ("Rs 8,000 - Rs 10,000 a month", "uttar pradesh", True),
    ("Rs 9000 - Rs 14000 a month", "uttar pradesh", False),   # top of range above minimum: not clearly below
    ("Rs 8,000 - Rs 10,000 a month", "maharashtra", False),   # no state-wide figure: never flag
    ("Rs 500 a day", "uttar pradesh", False),
    (None, "uttar pradesh", False),
])
def test_job_flag(pay, state, flag):
    posts = [{"title": "Helper", "pay": pay, "site": "apna.co", "url": "https://apna.co/job/x"}]
    jobs._flag_low_pay(posts, state, False)
    assert bool(posts[0].get("below_minimum_wage")) is flag
    if flag:
        assert posts[0]["minimum_wage_ref"]["per_month"] == 12530.25 and posts[0]["minimum_wage_ref"]["verified"] is False


def test_job_flag_skips_part_time_and_unknown_state():
    p = [{"title": "H", "pay": "Rs 3,000 - Rs 4,000 a month", "site": "apna.co", "url": "u"}]
    jobs._flag_low_pay(p, "uttar pradesh", True)
    jobs._flag_low_pay(p, None, False)
    assert "below_minimum_wage" not in p[0]
    p[0]["part_time"] = True
    jobs._flag_low_pay(p, "uttar pradesh", False)
    assert "below_minimum_wage" not in p[0]
