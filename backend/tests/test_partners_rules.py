"""Partner offering criteria <-> rule JSON, and offer_matches against the shared rules engine."""

from app.services.partners import criteria_to_rule, offer_matches, rule_to_criteria

FULL = {
    "class_min": 10, "class_max": 12, "courses": ["pcm", "arts"], "states": ["Maharashtra", "Goa"], "gender": "female",
    "income_max": 250000, "categories": ["sc", "st"], "marks_min": 60.0, "age_min": 15, "age_max": 25,
}


def test_empty_criteria_is_no_rule():
    assert criteria_to_rule({}) is None
    assert criteria_to_rule({"courses": []}) is None
    assert rule_to_criteria(None) == {}


def test_round_trip_all_fields():
    rule = criteria_to_rule(FULL)
    assert {n["id"] for n in rule["all"]} == {"class_min", "class_max", "courses", "states", "gender", "income", "category", "marks", "age"}
    assert all({"id", "field", "op", "value", "label"} <= set(n) for n in rule["all"])
    assert rule_to_criteria(rule) == FULL


def test_round_trip_partial_and_one_sided_age():
    c = {"class_min": 8, "income_max": 100000}
    assert rule_to_criteria(criteria_to_rule(c)) == c
    r = criteria_to_rule({"age_min": 18})
    assert r["all"][0]["value"] == [18, 120]
    assert rule_to_criteria(criteria_to_rule({"age_max": 30})) == {"age_min": 0, "age_max": 30}


def test_rule_fields_and_ops():
    by = {n["id"]: n for n in criteria_to_rule(FULL)["all"]}
    assert (by["class_min"]["field"], by["class_min"]["op"]) == ("class_level", "gte")
    assert (by["income"]["field"], by["income"]["op"]) == ("family_income_annual", "lte")
    assert (by["category"]["field"], by["category"]["op"]) == ("social_category", "in")
    assert by["age"]["op"] == "between"
    assert "girls" in by["gender"]["label"]


def test_no_rule_means_everyone_eligible():
    assert offer_matches({"rule": None}, {}) == "eligible"


def test_state_filter():
    offer = {"state": "Maharashtra", "rule": None}
    assert offer_matches(offer, {"state": "Bihar"}) == "not_eligible"
    assert offer_matches(offer, {"state": "Maharashtra"}) == "eligible"
    assert offer_matches(offer, {}) == "eligible"  # unknown state does not exclude


def test_gender_only_rule():
    offer = {"rule": criteria_to_rule({"gender": "female"})}
    assert offer_matches(offer, {"gender": "female"}) == "eligible"
    assert offer_matches(offer, {"gender": "male"}) == "not_eligible"
    assert offer_matches(offer, {}) == "needs_info"


def test_needs_info_when_fact_missing_but_not_excluded():
    offer = {"rule": criteria_to_rule({"class_min": 10, "income_max": 300000})}
    assert offer_matches(offer, {"class_level": 12}) == "needs_info"
    assert offer_matches(offer, {"class_level": 12, "family_income_annual": 200000}) == "eligible"
    # a definite failure wins over a missing fact
    assert offer_matches(offer, {"class_level": 8}) == "not_eligible"


def test_multi_condition_rule_from_criteria():
    offer = {"state": "Goa", "rule": criteria_to_rule({"class_min": 10, "age_min": 15, "age_max": 20, "categories": ["sc"]})}
    ok = {"state": "Goa", "class_level": 11, "age": 17, "social_category": "sc"}
    assert offer_matches(offer, ok) == "eligible"
    assert offer_matches(offer, {**ok, "age": 30}) == "not_eligible"
    assert offer_matches(offer, {**ok, "social_category": "general"}) == "not_eligible"
    assert offer_matches(offer, {**ok, "state": "Kerala"}) == "not_eligible"
