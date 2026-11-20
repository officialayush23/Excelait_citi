"""Runs every shared fixture through the Python engine. The TypeScript engine runs the same file."""

import json
from pathlib import Path

import pytest

from app.engine.rules import evaluate

SHARED = Path(__file__).resolve().parents[2] / "shared" / "rules"
SCHEMES = {s["slug"]: s for s in json.loads((SHARED / "schemes.json").read_text(encoding="utf-8"))["schemes"]}
CASES = json.loads((SHARED / "fixtures.json").read_text(encoding="utf-8"))["cases"]
FIELDS = json.loads((SHARED / "fields.json").read_text(encoding="utf-8"))["fields"]


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_fixture(case):
    out = evaluate(SCHEMES[case["scheme"]]["rule"], case["facts"])
    exp = case["expect"]
    assert out.result == exp["result"]
    if "missing" in exp:
        assert out.missing == exp["missing"]
    if "failed" in exp:
        assert [f["id"] for f in out.failed] == exp["failed"]


def _leaves(node):
    if "all" in node or "any" in node:
        for child in node.get("all", node.get("any", [])):
            yield from _leaves(child)
    else:
        yield node


@pytest.mark.parametrize("slug", sorted(SCHEMES))
def test_every_scheme_is_well_formed(slug):
    s = SCHEMES[slug]
    assert s["official_url"].startswith("https://")
    assert s["sources"], "every scheme cites at least one source"
    for leaf in _leaves(s["rule"]):
        assert leaf["field"] in FIELDS, f"{slug}: unknown fact {leaf['field']}"
        assert leaf.get("label"), f"{slug}: condition {leaf.get('id')} needs a label"
        opts = FIELDS[leaf["field"]].get("options")
        if opts and leaf["op"] in ("eq", "ne"):
            assert leaf["value"] in opts, f"{slug}: {leaf['value']} not an option of {leaf['field']}"
        if opts and leaf["op"] in ("in", "not_in") and FIELDS[leaf["field"]]["type"] == "enum":
            assert set(leaf["value"]) <= set(opts), f"{slug}: bad options for {leaf['field']}"


def test_empty_facts_never_say_no():
    """With nothing known, every scheme must ask, not refuse."""
    for slug, s in SCHEMES.items():
        assert evaluate(s["rule"], {}).result == "needs_info", slug
