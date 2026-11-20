import json
from pathlib import Path

import pytest

from app.engine.matching import MAX_PER_CATEGORY, rank, score_career

ROOT = Path(__file__).resolve().parents[2] / "shared" / "catalogue"
CAREERS = json.loads((ROOT / "careers.json").read_text(encoding="utf-8"))["careers"]
PERSONAS = json.loads((ROOT / "matching_fixtures.json").read_text(encoding="utf-8"))["personas"]


@pytest.mark.parametrize("p", PERSONAS, ids=[p["name"][:40] for p in PERSONAS])
def test_persona_ranking_is_stable(p):
    got = [{"slug": m.slug, "score": m.score} for m in rank(CAREERS, p["profile"], 10)]
    assert got == p["expect"]


def test_category_cap_keeps_options_wide():
    by = {c["slug"]: c["category"] for c in CAREERS}
    for p in PERSONAS:
        cats = [by[m.slug] for m in rank(CAREERS, p["profile"], 10)]
        assert max(cats.count(c) for c in set(cats)) <= MAX_PER_CATEGORY


def test_every_point_has_a_reason_or_is_neutral():
    m = score_career(next(c for c in CAREERS if c["slug"] == "electrician"), {"interests": ["electricity"], "subjects": ["science"], "needs_income_soon": True})
    codes = {r["code"] for r in m.reasons}
    assert {"interest", "subjects", "earn_soon", "affordable", "local_demand"} <= codes


def test_cannot_relocate_shows_a_gap():
    c = next(c for c in CAREERS if c["needs_city"])
    assert any(g["code"] == "needs_city" for g in score_career(c, {"can_relocate": False}).gaps)
