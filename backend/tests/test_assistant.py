from types import SimpleNamespace

from app.services import assistant


def fake_graph():
    careers = {
        "staff-nurse": {"name": "Staff nurse (GNM / B.Sc Nursing)", "name_i18n": {"hi": "स्टाफ नर्स"}},
        "electrician": {"name": "Electrician", "name_i18n": {"hi": "इलेक्ट्रीशियन"}},
    }
    return SimpleNamespace(careers=careers, programs={}, exams={}, schemes={})


def test_slug_matches_slug_name_hindi_and_words(monkeypatch):
    monkeypatch.setattr(assistant, "graph", fake_graph)
    assert assistant._slug("career", "electrician") == "electrician"
    assert assistant._slug("career", "Staff Nurse") == "staff-nurse"
    assert assistant._slug("career", "स्टाफ नर्स") == "staff-nurse"
    assert assistant._slug("career", "nurse staff") == "staff-nurse"
    assert assistant._slug("career", "astronaut") is None
    assert assistant._slug("career", None) is None


def test_every_tool_has_an_object_schema():
    for t in assistant._tools():
        assert t["function"]["parameters"]["type"] == "object"
