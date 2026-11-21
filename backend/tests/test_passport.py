import copy

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from app.services import passport as svc


# ---------- signing ----------
def payload():
    return svc.build_payload(public_id="abc123", student_name="Asha", skill_name="First aid", level="NSQF level 3", task_title="Dress a wound",
                             evidence_count=2, reviewer_name="Mrs Rao", school="ZP School", issued_at="2026-11-01T10:00:00Z", base_url="https://x.test")


def test_round_trip():
    key = Ed25519PrivateKey.generate()
    p = payload()
    sig = svc.sign_payload(p, key)
    assert svc.verify_signature(p, sig, key.public_key())
    assert p["id"] == "https://x.test/verify/abc123"
    assert p["credentialSubject"]["reviewer"] == "Mrs Rao"


def test_tamper_detection():
    key = Ed25519PrivateKey.generate()
    p = payload()
    sig = svc.sign_payload(p, key)
    t = copy.deepcopy(p)
    t["credentialSubject"]["skill"] = "Doctor"
    assert not svc.verify_signature(t, sig, key.public_key())
    assert not svc.verify_signature(p, sig, Ed25519PrivateKey.generate().public_key())
    assert not svc.verify_signature(p, "not-a-signature!!", key.public_key())


def test_canonical_json_is_stable():
    a = {"b": 1, "a": {"d": "हिंदी", "c": [1, 2]}}
    b = {"a": {"c": [1, 2], "d": "हिंदी"}, "b": 1}
    assert svc.canonical_json(a) == svc.canonical_json(b)
    assert svc.canonical_json(a) == '{"a":{"c":[1,2],"d":"हिंदी"},"b":1}'.encode()


def test_public_key_is_32_bytes_b64url():
    k = Ed25519PrivateKey.generate()
    assert len(svc.b64u_decode(svc.public_key_b64u(k))) == 32


def test_sniff_image():
    assert svc.sniff_image(b"\xff\xd8\xff\xe0abc") == "jpg"
    assert svc.sniff_image(b"\x89PNG\r\n\x1a\nxx") == "png"
    assert svc.sniff_image(b"RIFFxxxxWEBPyy") == "webp"
    assert svc.sniff_image(b"GIF89a") is None


# ---------- fake DB ----------
class Q:
    def __init__(self, db, name):
        self.db, self.name, self.filters, self.op, self.val = db, name, [], "select", None
        self._limit = None

    def select(self, *_a):
        return self

    def eq(self, c, v):
        self.filters.append(lambda r: r.get(c) == v)
        return self

    def in_(self, c, vs):
        self.filters.append(lambda r: r.get(c) in vs)
        return self

    def order(self, *_a, **_k):
        return self

    def limit(self, n):
        return self

    def insert(self, row):
        self.op, self.val = "insert", row
        return self

    def update(self, row):
        self.op, self.val = "update", row
        return self

    def execute(self):
        rows = self.db.data.setdefault(self.name, [])
        if self.op == "insert":
            r = {"id": f"id{len(rows)}", **self.val}
            rows.append(r)
            self.db.inserted.append((self.name, r))
            return type("R", (), {"data": [r]})
        match = [r for r in rows if all(f(r) for f in self.filters)]
        if self.op == "update":
            for r in match:
                r.update(self.val)
            return type("R", (), {"data": match})
        return type("R", (), {"data": copy.deepcopy(match)})


class FakeDB:
    def __init__(self, data):
        self.data, self.inserted = data, []
        self.storage = type("S", (), {"from_": lambda s, b: type("B", (), {"create_signed_url": lambda s2, p, e: {"signedURL": "https://u/" + p}})()})()

    def table(self, name):
        return Q(self, name)


RUBRIC = [{"id": "c1", "name": "Safe"}, {"id": "c2", "name": "Neat"}]


def make_db():
    return FakeDB({
        "cohorts": [{"id": "co1", "facilitator_id": "fac1"}, {"id": "co2", "facilitator_id": "fac2"}],
        "cohort_members": [{"cohort_id": "co1", "student_id": "stu1"}, {"cohort_id": "co2", "student_id": "stu2"}],
        "profiles": [{"id": "stu1", "full_name": "Asha"}, {"id": "stu2", "full_name": "Ravi"}, {"id": "fac1", "full_name": "Mrs Rao"}],
        "student_profiles": [{"user_id": "stu1", "school_name": "ZP School"}],
        "skills": [{"id": 1, "name": "First aid", "nsqf_level": 3}],
        "rubrics": [{"id": "r1", "criteria": RUBRIC}],
        "skill_tasks": [{"id": "t1", "skill_id": 1, "rubric_id": "r1", "title": "Dress a wound"}],
        "task_submissions": [
            {"id": "s1", "task_id": "t1", "student_id": "stu1", "evidence_paths": ["a/1.jpg"], "status": "submitted", "created_at": "1"},
            {"id": "s2", "task_id": "t1", "student_id": "stu2", "evidence_paths": [], "status": "submitted", "created_at": "2"},
        ],
        "credentials": [], "notifications": [],
    })


def test_review_permissions():
    db = make_db()
    assert svc.can_review(db, "fac1", {"facilitator"}, "stu1")
    assert not svc.can_review(db, "fac1", {"facilitator"}, "stu2")  # other cohort
    assert svc.can_review(db, "adm", {"admin"}, "stu2")
    assert not svc.can_review(db, "stu1", {"student"}, "stu1")
    assert not svc.can_review(db, "stu1", {"admin"}, "stu1")  # never self-review
    assert not svc.can_review(db, "x", {"partner"}, "stu1")


def test_queue_scoped_to_cohort():
    db = make_db()
    q = svc.review_queue("fac1", {"facilitator"}, "submitted", db)
    assert [s["id"] for s in q] == ["s1"] and q[0]["student_name"] == "Asha" and q[0]["evidence_urls"] == ["https://u/a/1.jpg"]
    assert {s["id"] for s in svc.review_queue("adm", {"admin"}, "submitted", db)} == {"s1", "s2"}
    assert svc.review_queue("lonely", {"facilitator"}, "submitted", db) == []


def test_facilitator_cannot_review_other_cohort():
    with pytest.raises(svc.PassportError) as e:
        svc.review_submission("fac1", {"facilitator"}, "s2", "approve", [{"id": "c1", "ok": True}, {"id": "c2", "ok": True}], "", make_db())
    assert e.value.status == 403


def test_approve_issues_verifiable_credential(monkeypatch):
    key = Ed25519PrivateKey.generate()
    monkeypatch.setattr(svc, "get_signing_key", lambda: key)
    monkeypatch.setattr(svc, "verify_base_url", lambda: "https://x.test")
    db = make_db()
    r = svc.review_submission("fac1", {"facilitator"}, "s1", "approve", [{"id": "c1", "ok": True}, {"id": "c2", "ok": True}], "Good", db)
    assert r["status"] == "approved" and r["credential_public_id"]
    cred = db.data["credentials"][0]
    assert cred["payload"]["credentialSubject"] == {"name": "Asha", "skill": "First aid", "level": "NSQF level 3", "task": "Dress a wound",
                                                    "evidenceCount": 1, "reviewer": "Mrs Rao", "school": "ZP School"}
    assert svc.verify_signature(cred["payload"], cred["signature"], key.public_key())
    assert db.data["notifications"][0]["user_id"] == "stu1" and db.data["notifications"][0]["kind"] == "credential"
    v = svc.verify_credential(cred["public_id"], db)
    assert v["status"] == "valid" and v["valid"]
    cred["revoked_at"] = "2026-12-01"
    assert svc.verify_credential(cred["public_id"], db)["status"] == "revoked"
    cred["revoked_at"] = None
    cred["payload"]["credentialSubject"]["skill"] = "Surgeon"
    assert svc.verify_credential(cred["public_id"], db)["status"] == "invalid"
    # already reviewed
    with pytest.raises(svc.PassportError) as e:
        svc.review_submission("fac1", {"facilitator"}, "s1", "approve", [], "", db)
    assert e.value.status == 409


def test_approve_requires_all_criteria_met():
    db = make_db()
    with pytest.raises(svc.PassportError):
        svc.review_submission("fac1", {"facilitator"}, "s1", "approve", [{"id": "c1", "ok": True}, {"id": "c2", "ok": False}], "", db)
    with pytest.raises(svc.PassportError):
        svc.review_submission("fac1", {"facilitator"}, "s1", "approve", [{"id": "c1", "ok": True}], "", db)
    assert db.data["credentials"] == []


def test_needs_work_notifies_and_needs_feedback():
    db = make_db()
    with pytest.raises(svc.PassportError):
        svc.review_submission("fac1", {"facilitator"}, "s1", "needs_work", [{"id": "c1", "ok": True}], "", db)
    r = svc.review_submission("fac1", {"facilitator"}, "s1", "needs_work", [{"id": "c1", "ok": True}, {"id": "c2", "ok": False, "comment": "messy"}], "", db)
    assert r["status"] == "resubmit" and r["credential_public_id"] is None
    assert db.data["task_submissions"][0]["status"] == "resubmit"
    assert db.data["notifications"][0]["kind"] == "task_review"


def test_unknown_criterion_rejected():
    with pytest.raises(svc.PassportError):
        svc.check_review("approve", [{"id": "zzz", "ok": True}], RUBRIC, "")


def test_submit_validation():
    db = make_db()
    with pytest.raises(svc.PassportError):
        svc.submit("t1", "stu9", [], "", db)
    with pytest.raises(svc.PassportError) as e:
        svc.submit("t1", "stu9", [(b"GIF89a....", "image/gif")], "", db)
    assert e.value.status == 415
    with pytest.raises(svc.PassportError) as e:
        svc.submit("t1", "stu9", [(b"\xff\xd8\xff" + b"0" * svc.MAX_BYTES, "image/jpeg")], "", db)
    assert e.value.status == 413
    jpg = (b"\xff\xd8\xff\xe0", "image/jpeg")
    with pytest.raises(svc.PassportError):
        svc.submit("t1", "stu9", [jpg] * 4, "", db)
    with pytest.raises(svc.PassportError) as e:
        svc.submit("t1", "stu1", [jpg], "", db)  # already has a pending submission
    assert e.value.status == 409
