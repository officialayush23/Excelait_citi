from app.services import work_rules as wr


def ids(age):
    return {r["id"]: r["kind"] for r in wr.work_rules(age)["rules"]}


def test_every_rule_and_source_is_complete():
    d = wr.doc()
    for r in d["rules"]:
        assert set(r["text"]) == {"en", "hi", "mr"}
        assert r["sources"] and all(s in d["sources"] for s in r["sources"])
    for s in d["sources"].values():
        assert s["url"].startswith("https://")
    assert d["checked_on"]


def test_under_14_no_job_only_family_help():
    r = ids(12)
    assert r["child_no_job"] == "not_allowed"
    assert r["child_family_help"] == "allowed"
    assert "child_no_apprentice" in r
    w = wr.work_rules(12)
    assert w["band"] == "child" and not w["can_apprentice"] and not w["can_take_jobs"]


def test_adolescent_limits_and_apprenticeship():
    w = wr.work_rules(15)
    r = ids(15)
    assert w["band"] == "adolescent" and w["can_apprentice"] and w["can_skill_training"] and not w["can_take_jobs"]
    assert {"teen_light_work", "teen_no_hazardous", "under18_no_driving", "teen_apprentice"} <= set(r)
    assert not wr.work_rules(14)["can_skill_training"]  # PMKVY is from 15
    assert all(s["url"] for s in w["sources"])


def test_adult():
    w = wr.work_rules(18)
    assert w["band"] == "adult" and w["can_take_jobs"]
    assert wr.work_rules(None)["band"] == "unknown"


def test_hazardous_careers_wait_until_18():
    for slug in ("mason", "welder", "driver", "motor-mechanic", "electrician"):
        assert wr.career_age_status(slug, 15) == "after_18", slug
        assert wr.career_age_status(slug, 19) == "now"
    assert wr.career_age_status("mobile-repair", 15) == "now"
    assert wr.career_age_status("bank-clerk", 17) == "after_20"
    assert wr.career_age_status("mason", None) == "now"  # unknown age: no claim either way
