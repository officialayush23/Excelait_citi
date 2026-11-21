"""Pay extraction and status logic for scripts.reference_careers (no network)."""

from scripts import reference_careers as R


def monthly(text, **kw):
    return [a["monthly"] for a in R.parse_amounts(text, **kw) if not a["after_high"]]


def test_rupee_per_month_and_commas():
    assert monthly("Pay: ₹18,260 per month") == [18260]
    assert monthly("Rs. 15000 per month") == [15000]
    assert monthly("INR 21,500 monthly") == [21500]


def test_k_suffix():
    assert monthly("about ₹23.8k per month") == [23800]


def test_lpa_and_lakh_to_monthly():
    assert monthly("1.8 LPA") == [15000]
    assert monthly("₹2.4 Lakhs per year") == [20000]
    assert monthly("salary 3 lakh per annum") == [25000]


def test_lakh_range_without_first_suffix():
    assert monthly("2-3 Lacs PA") == [16667, 25000]


def test_per_day_times_26():
    assert monthly("₹500 per day") == [13000]


def test_hourly_weekly_and_unitless_ignored():
    assert monthly("₹120 per hour") == []
    assert monthly("₹4,000 per week") == []
    assert monthly("Fee is ₹15,000") == []


def test_implausible_values_dropped():
    assert monthly("₹900 per month") == []
    assert monthly("₹40,00,000 per month") == []


def test_default_unit_for_payscale_style_annual_pay():
    assert monthly("The average salary is ₹305,265 in 2026") == []
    assert monthly("The average salary is ₹305,265 in 2026", default_unit="year") == [25439]


def test_range_unit_is_shared_and_high_end_flagged():
    got = R.parse_amounts("₹12,000 – ₹18,000 per month")
    assert [a["monthly"] for a in got] == [12000, 18000]
    assert [a["range_end"] for a in got] == [False, True]
    hi = R.parse_amounts("The highest salary reaching ₹21 Lakhs per year")
    assert hi[0]["after_high"]


def test_entry_values_use_low_end_of_ranges_and_skip_top_and_senior():
    text = ("The average starting salary for an electrician is ₹2.8 Lakhs to ₹3.1 Lakhs per year, "
            "with the highest salary reaching ₹21 Lakhs per year. Senior Electrician: Average ₹40,000 per month.")
    vals, entry = R.entry_values(text, ["electrician"], True)
    assert vals == [23333] and entry is True


def test_other_roles_on_the_same_page_are_ignored():
    text = "Electrician: Average ₹18,251 per month · Apprentice Electrician: Average ₹13,251 per month · Journeyperson: Average ₹30,000 per month"
    vals, _ = R.entry_values(text, ["electrician"], True)
    assert vals == [18251]


def test_experienced_postings_skipped():
    vals, _ = R.entry_values("Electrician with 7 years experience earns ₹30,000 per month.", ["electrician"], True)
    assert vals == []


def test_role_present_modifiers():
    assert R.role_present("Hiring an Electrician in Pune", ["electrician"])
    assert not R.role_present("Senior Electrician salary", ["electrician"])


def test_median_and_rounding():
    assert R.median_int([10, 20, 40]) == 20
    assert R.median_int([10, 20]) == 15
    assert R.round500(12249) == 12000
    assert R.round500(12251) == 12500


def test_evidence_range():
    assert R.evidence_range({"a": 20000, "b": 26000}) == {"min": 20000, "max": 26000, "n_sources": 2}
    assert R.evidence_range({})["n_sources"] == 0


def test_status_matches_when_ranges_overlap():
    d = R.decide(12000, 30000, {"min": 18000, "max": 24000, "n_sources": 2})
    assert d["status"] == "matches" and not d["changed"] and (d["pay_min"], d["pay_max"]) == (12000, 30000)


def test_status_differs_updates_range_rounded_to_500():
    d = R.decide(12000, 25000, {"min": 27320, "max": 29490, "n_sources": 2})
    assert d["status"] == "differs" and d["changed"]
    assert (d["pay_min"], d["pay_max"]) == (27500, 29500)
    d = R.decide(20000, 40000, {"min": 8200, "max": 9700, "n_sources": 3})
    assert d["status"] == "differs" and (d["pay_min"], d["pay_max"]) == (8000, 9500)


def test_status_unverified_with_fewer_than_two_sources_changes_nothing():
    d = R.decide(12000, 25000, {"min": 40000, "max": 40000, "n_sources": 1})
    assert d["status"] == "unverified" and not d["changed"] and (d["pay_min"], d["pay_max"]) == (12000, 25000)


def test_status_unverified_when_sites_disagree_wildly_or_role_is_not_salaried():
    assert R.decide(10000, 20000, {"min": 7000, "max": 47000, "n_sources": 4})["status"] == "unverified"
    assert R.decide(10000, 20000, {"min": 30000, "max": 32000, "n_sources": 2}, salaried=False)["status"] == "unverified"


def test_apply_result_restores_original_range_on_rerun():
    c = {"slug": "driver", "pay_min": 27500, "pay_max": 29500, "pay_previous": {"pay_min": 12000, "pay_max": 25000}}
    res = {"sources": [], "evidence": {"min": 27300, "max": 29500, "n_sources": 2}}
    out = R.apply_result(c, res)["fields"]
    assert out["pay_status"] == "differs" and out["pay_previous"] == {"pay_min": 12000, "pay_max": 25000}


def test_write_results_changes_only_our_keys(tmp_path, monkeypatch):
    import json
    f = tmp_path / "careers.json"
    f.write_text(json.dumps({"careers": [{"slug": "a", "pay_min": 1, "pay_max": 2, "min_age": 18, "name": "हिंदी"}]}), encoding="utf-8")
    monkeypatch.setattr(R, "CAREERS_PATH", f)
    R.write_results({"a": {"pay_status": "matches", "pay_previous": None, "sources": []}})
    c = json.loads(f.read_text(encoding="utf-8"))["careers"][0]
    assert c["min_age"] == 18 and c["name"] == "हिंदी" and c["pay_status"] == "matches" and "pay_previous" not in c
