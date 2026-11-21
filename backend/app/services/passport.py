"""Skill Passport: tasks, evidence, teacher review, and signed verifiable credentials.

Credentials are W3C-VC-style JSON signed with Ed25519. The signed bytes are the canonical
JSON of the payload (sorted keys, no spaces, UTF-8), so anyone holding the published public
key can check a credential without trusting our database.
"""

from __future__ import annotations

import base64
import json
import os
import secrets
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey

BUCKET = "evidence"
MAX_FILES = 3
MAX_BYTES = 4 * 1024 * 1024
ENV_PATH = Path(__file__).resolve().parents[2] / ".env"
KEY_VAR = "CREDENTIAL_SIGNING_KEY"
ISSUER = {"id": "https://excelait.in", "name": "ExcelAIt"}


class PassportError(Exception):
    """Raised for user-facing failures; `status` is the HTTP code the route should use."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


# ---------- encoding + signing ----------
def b64u(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def b64u_decode(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def canonical_json(payload: dict) -> bytes:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def sign_payload(payload: dict, key: Ed25519PrivateKey) -> str:
    return b64u(key.sign(canonical_json(payload)))


def verify_signature(payload: dict, signature: str, public_key: Ed25519PublicKey) -> bool:
    try:
        public_key.verify(b64u_decode(signature), canonical_json(payload))
        return True
    except (InvalidSignature, ValueError):
        return False


def public_key_b64u(key: Ed25519PrivateKey) -> str:
    return b64u(key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw))


def _raw_private(key: Ed25519PrivateKey) -> bytes:
    return key.private_bytes(serialization.Encoding.Raw, serialization.PrivateFormat.Raw, serialization.NoEncryption())


def _read_env_file(name: str) -> str | None:
    try:
        for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
            if line.startswith(f"{name}="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    except OSError:
        pass
    return None


_key_cache: Ed25519PrivateKey | None = None


def get_signing_key() -> Ed25519PrivateKey:
    """Key from CREDENTIAL_SIGNING_KEY (base64 raw 32 bytes). Generated and saved to .env if absent."""
    global _key_cache
    if _key_cache is not None:
        return _key_cache
    raw = os.environ.get(KEY_VAR) or _read_env_file(KEY_VAR)
    if raw:
        data = base64.b64decode(raw + "=" * (-len(raw) % 4))
        if len(data) != 32:
            raise RuntimeError(f"{KEY_VAR} must be base64 of exactly 32 raw bytes")
        _key_cache = Ed25519PrivateKey.from_private_bytes(data)
        return _key_cache
    key = Ed25519PrivateKey.generate()
    encoded = base64.b64encode(_raw_private(key)).decode()
    os.environ[KEY_VAR] = encoded
    try:
        with ENV_PATH.open("a", encoding="utf-8") as f:
            f.write(f"\n# Ed25519 key that signs Skill Passport credentials. Keep it secret; losing it invalidates trust in new credentials.\n{KEY_VAR}={encoded}\n")
        print(f"[passport] {KEY_VAR} was missing: generated a new signing key and appended it to {ENV_PATH}. Copy it to your host's environment too.")
    except OSError as e:
        print(f"[passport] {KEY_VAR} was missing and could not be saved to {ENV_PATH} ({e}). Using an in-memory key; set {KEY_VAR} in the environment.")
    _key_cache = key
    return key


def verify_base_url() -> str:
    base = os.environ.get("PUBLIC_APP_URL") or _read_env_file("PUBLIC_APP_URL")
    if not base:
        from app.core.config import get_settings

        origins = get_settings().cors_origin_list
        base = origins[0] if origins else "http://localhost:5173"
    return base.rstrip("/")


# ---------- credential payload ----------
def build_payload(*, public_id: str, student_name: str, skill_name: str, level: str, task_title: str, evidence_count: int,
                  reviewer_name: str, school: str | None, issued_at: str, base_url: str) -> dict:
    return {
        "@context": ["https://www.w3.org/2018/credentials/v1"],
        "type": ["VerifiableCredential", "SkillCredential"],
        "id": f"{base_url}/verify/{public_id}",
        "issuer": ISSUER,
        "issuanceDate": issued_at,
        "credentialSubject": {
            "name": student_name, "skill": skill_name, "level": level, "task": task_title,
            "evidenceCount": evidence_count, "reviewer": reviewer_name, "school": school or "",
        },
    }


def new_public_id() -> str:
    return secrets.token_urlsafe(9)


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def public_key_doc() -> dict:
    return {"algorithm": "Ed25519", "encoding": "base64url", "publicKey": public_key_b64u(get_signing_key()),
            "canonicalisation": "JSON, keys sorted, no whitespace, UTF-8"}


def verify_credential(public_id: str, db: Any = None) -> dict:
    db = db or _db()
    rows = db.table("credentials").select("public_id, payload, signature, issued_at, revoked_at").eq("public_id", public_id).execute().data
    if not rows:
        raise PassportError("No credential with this ID.", 404)
    c = rows[0]
    sig_ok = verify_signature(c["payload"], c["signature"], get_signing_key().public_key())
    status = "invalid" if not sig_ok else "revoked" if c.get("revoked_at") else "valid"
    return {"status": status, "valid": status == "valid", "revoked": bool(c.get("revoked_at")), "signature_ok": sig_ok,
            "payload": c["payload"], "signature": c["signature"], "issued_at": c["issued_at"], "revoked_at": c.get("revoked_at")}


def _db():
    from app.core.db import get_db

    return get_db()


# ---------- permissions ----------
def is_admin(roles: set[str]) -> bool:
    return "admin" in roles


def facilitator_student_ids(db: Any, facilitator_id: str) -> set[str]:
    cohorts = db.table("cohorts").select("id").eq("facilitator_id", facilitator_id).execute().data or []
    ids = [c["id"] for c in cohorts]
    if not ids:
        return set()
    members = db.table("cohort_members").select("student_id").in_("cohort_id", ids).execute().data or []
    return {m["student_id"] for m in members}


def can_review(db: Any, user_id: str, roles: set[str], student_id: str) -> bool:
    if user_id == student_id:
        return False  # nobody reviews their own work
    if is_admin(roles):
        return True
    if "facilitator" in roles:
        return student_id in facilitator_student_ids(db, user_id)
    return False


# ---------- evidence images ----------
def sniff_image(data: bytes) -> str | None:
    if data[:3] == b"\xff\xd8\xff":
        return "jpg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return None


MIME = {"jpg": "image/jpeg", "png": "image/png", "webp": "image/webp"}


def signed_urls(db: Any, paths: list[str], expires: int = 3600) -> list[str]:
    out: list[str] = []
    for p in paths:
        try:
            r = db.storage.from_(BUCKET).create_signed_url(p, expires)
            out.append(r.get("signedURL") or r.get("signedUrl") or "")
        except Exception:  # noqa: BLE001 - a missing file should not break the whole page
            out.append("")
    return [u for u in out if u]


# ---------- student side ----------
def _status_rank(s: str) -> int:
    return {"approved": 3, "submitted": 2, "resubmit": 1, "rejected": 0}.get(s, -1)


def list_skills(student_id: str, db: Any = None) -> list[dict]:
    db = db or _db()
    saved = [r["career_slug"] for r in db.table("saved_careers").select("career_slug").eq("user_id", student_id).execute().data or []]
    careers = {c["id"]: c for c in db.table("careers").select("id, slug, name, name_i18n").execute().data or []}
    saved_ids = {cid for cid, c in careers.items() if c["slug"] in saved}
    links = db.table("career_skills").select("career_id, skill_id").execute().data or []
    skill_careers: dict[int, list[dict]] = {}
    for l in links:
        c = careers.get(l["career_id"])
        if c:
            skill_careers.setdefault(l["skill_id"], []).append({"slug": c["slug"], "name": c["name"], "name_i18n": c.get("name_i18n") or {}, "mine": l["career_id"] in saved_ids})
    skills = db.table("skills").select("id, slug, name, name_i18n, nsqf_level").execute().data or []
    tasks = db.table("skill_tasks").select("id, skill_id, title, title_i18n").execute().data or []
    subs = db.table("task_submissions").select("id, task_id, status, created_at").eq("student_id", student_id).execute().data or []
    creds = db.table("credentials").select("public_id, submission_id, skill_id, revoked_at").eq("student_id", student_id).execute().data or []
    best: dict[str, str] = {}
    for s in subs:
        if _status_rank(s["status"]) > _status_rank(best.get(s["task_id"], "")):
            best[s["task_id"]] = s["status"]
    sub_task = {s["id"]: s["task_id"] for s in subs}
    cred_for_task = {sub_task[c["submission_id"]]: c["public_id"] for c in creds if c.get("submission_id") in sub_task and not c.get("revoked_at")}
    out = []
    for sk in skills:
        mine = any(c["mine"] for c in skill_careers.get(sk["id"], []))
        out.append({
            "id": sk["id"], "slug": sk["slug"], "name": sk["name"], "name_i18n": sk.get("name_i18n") or {}, "nsqf_level": sk.get("nsqf_level"),
            "for_my_careers": mine, "careers": skill_careers.get(sk["id"], [])[:4],
            "tasks": [{"id": t["id"], "title": t["title"], "title_i18n": t.get("title_i18n") or {}, "status": best.get(t["id"], "todo"),
                       "credential_public_id": cred_for_task.get(t["id"])} for t in tasks if t["skill_id"] == sk["id"]],
        })
    out = [s for s in out if s["tasks"]]
    out.sort(key=lambda s: (not s["for_my_careers"], s["name"]))
    return out


def get_task(task_id: str, student_id: str, db: Any = None) -> dict:
    db = db or _db()
    task = _one(db, "skill_tasks", "id, skill_id, rubric_id, title, title_i18n, instructions, steps, evidence_hint", "id", task_id)
    if not task:
        raise PassportError("Task not found.", 404)
    skill = _one(db, "skills", "id, slug, name, name_i18n, nsqf_level", "id", task["skill_id"])
    rubric = _one(db, "rubrics", "id, title, criteria", "id", task["rubric_id"]) if task.get("rubric_id") else None
    subs = db.table("task_submissions").select("id, status, note, evidence_paths, review, reviewed_at, created_at") \
        .eq("task_id", task_id).eq("student_id", student_id).order("created_at", desc=True).execute().data or []
    for s in subs:
        s["evidence_urls"] = signed_urls(db, s.get("evidence_paths") or [])
        s.pop("evidence_paths", None)
    creds = db.table("credentials").select("public_id, submission_id, revoked_at").eq("student_id", student_id).execute().data or []
    sub_ids = {s["id"] for s in subs}
    cred = next((c for c in creds if c.get("submission_id") in sub_ids and not c.get("revoked_at")), None)
    return {"task": {k: task[k] for k in ("id", "title", "title_i18n", "instructions", "steps", "evidence_hint")}, "skill": skill,
            "rubric": (rubric or {}).get("criteria", []), "submissions": subs, "credential_public_id": cred["public_id"] if cred else None}


def submit(task_id: str, student_id: str, files: list[tuple[bytes, str]], note: str, db: Any = None) -> dict:
    """files: [(bytes, original content type)] already read by the route."""
    db = db or _db()
    if not files and not note.strip():
        raise PassportError("Add at least one photo or a note.")
    if len(files) > MAX_FILES:
        raise PassportError(f"You can upload up to {MAX_FILES} photos.")
    exts = []
    for data, _ in files:
        if len(data) > MAX_BYTES:
            raise PassportError("Each photo must be 4 MB or smaller.", 413)
        ext = sniff_image(data)
        if not ext:
            raise PassportError("Only JPEG, PNG or WebP photos are allowed.", 415)
        exts.append(ext)
    if not _one(db, "skill_tasks", "id", "id", task_id):
        raise PassportError("Task not found.", 404)
    existing = db.table("task_submissions").select("id, status").eq("task_id", task_id).eq("student_id", student_id).execute().data or []
    if any(s["status"] == "approved" for s in existing):
        raise PassportError("You have already proved this skill.", 409)
    if any(s["status"] == "submitted" for s in existing):
        raise PassportError("Your last submission is still waiting for review.", 409)
    sid = str(uuid.uuid4())
    paths = []
    for i, ((data, _), ext) in enumerate(zip(files, exts), 1):
        path = f"{student_id}/{sid}/{i}.{ext}"
        db.storage.from_(BUCKET).upload(path, data, {"content-type": MIME[ext], "upsert": "true"})
        paths.append(path)
    row = db.table("task_submissions").insert({"id": sid, "task_id": task_id, "student_id": student_id, "evidence_paths": paths,
                                               "note": note.strip()[:2000] or None, "status": "submitted"}).execute().data[0]
    return {"id": row["id"], "status": row["status"], "evidence_count": len(paths)}


def my_passport(student_id: str, db: Any = None) -> dict:
    db = db or _db()
    subs = db.table("task_submissions").select("id, task_id, status, review, reviewed_at, created_at").eq("student_id", student_id) \
        .order("created_at", desc=True).execute().data or []
    tasks = {t["id"]: t for t in db.table("skill_tasks").select("id, title, title_i18n, skill_id").execute().data or []}
    skills = {s["id"]: s for s in db.table("skills").select("id, name, name_i18n").execute().data or []}
    for s in subs:
        t = tasks.get(s["task_id"]) or {}
        sk = skills.get(t.get("skill_id")) or {}
        s["task_title"], s["task_title_i18n"] = t.get("title"), t.get("title_i18n") or {}
        s["skill_name"], s["skill_name_i18n"] = sk.get("name"), sk.get("name_i18n") or {}
    creds = db.table("credentials").select("id, public_id, skill_id, payload, issued_at, revoked_at").eq("student_id", student_id) \
        .order("issued_at", desc=True).execute().data or []
    for c in creds:
        sk = skills.get(c.get("skill_id")) or {}
        c["skill_name_i18n"] = sk.get("name_i18n") or {}
    return {"submissions": subs, "credentials": creds}


def attach_credentials(student_id: str, application_id: str, credential_ids: list[str], db: Any = None) -> dict:
    db = db or _db()
    app = _one(db, "applications", "id, student_id", "id", application_id)
    if not app or app["student_id"] != student_id:
        raise PassportError("Application not found.", 404)
    mine = db.table("credentials").select("id, revoked_at").eq("student_id", student_id).in_("id", credential_ids or ["-"]).execute().data or []
    ok = [c["id"] for c in mine if not c.get("revoked_at")]
    if len(ok) != len(set(credential_ids)):
        raise PassportError("One of the credentials is not yours or has been revoked.", 400)
    db.table("applications").update({"credential_ids": ok}).eq("id", application_id).execute()
    return {"application_id": application_id, "credential_ids": ok}


# ---------- teacher side ----------
def review_queue(user_id: str, roles: set[str], status: str = "submitted", db: Any = None) -> list[dict]:
    db = db or _db()
    q = db.table("task_submissions").select("id, task_id, student_id, evidence_paths, note, status, review, reviewed_at, created_at").eq("status", status)
    if not is_admin(roles):
        ids = facilitator_student_ids(db, user_id)
        if not ids:
            return []
        q = q.in_("student_id", sorted(ids))
    rows = q.order("created_at").limit(100).execute().data or []
    if not rows:
        return []
    tasks = {t["id"]: t for t in db.table("skill_tasks").select("id, title, skill_id, rubric_id").in_("id", list({r["task_id"] for r in rows})).execute().data or []}
    skills = {s["id"]: s["name"] for s in db.table("skills").select("id, name").execute().data or []}
    rubrics = {r["id"]: r["criteria"] for r in db.table("rubrics").select("id, criteria").execute().data or []}
    profiles = {p["id"]: p.get("full_name") for p in db.table("profiles").select("id, full_name").in_("id", list({r["student_id"] for r in rows})).execute().data or []}
    out = []
    for r in rows:
        t = tasks.get(r["task_id"]) or {}
        out.append({"id": r["id"], "status": r["status"], "student_id": r["student_id"], "student_name": profiles.get(r["student_id"]),
                    "task_id": r["task_id"], "task_title": t.get("title"), "skill_name": skills.get(t.get("skill_id")),
                    "rubric": rubrics.get(t.get("rubric_id"), []), "note": r.get("note"), "review": r.get("review"),
                    "reviewed_at": r.get("reviewed_at"), "created_at": r["created_at"],
                    "evidence_urls": signed_urls(db, r.get("evidence_paths") or [])})
    return out


def check_review(decision: str, criteria: list[dict], rubric: list[dict], comment: str) -> list[dict]:
    """Validate a review against the rubric and return the cleaned criteria list."""
    known = {c["id"] for c in rubric}
    seen = {}
    for c in criteria:
        if c["id"] not in known:
            raise PassportError(f"Unknown criterion {c['id']}.")
        seen[c["id"]] = {"id": c["id"], "ok": bool(c["ok"]), "comment": (c.get("comment") or "").strip()}
    if decision == "approve":
        missing = known - seen.keys()
        if missing or not all(c["ok"] for c in seen.values()):
            raise PassportError("To approve, every criterion must be marked as met. Otherwise choose 'needs work'.")
    elif not comment.strip() and all(c["ok"] for c in seen.values()):
        raise PassportError("Tell the student what to improve (a comment or an unmet criterion).")
    return list(seen.values())


def review_submission(reviewer_id: str, roles: set[str], submission_id: str, decision: str, criteria: list[dict], comment: str, db: Any = None) -> dict:
    db = db or _db()
    sub = _one(db, "task_submissions", "id, task_id, student_id, evidence_paths, status", "id", submission_id)
    if not sub:
        raise PassportError("Submission not found.", 404)
    if not can_review(db, reviewer_id, roles, sub["student_id"]):
        raise PassportError("This student is not in your cohorts.", 403)
    if sub["status"] != "submitted":
        raise PassportError("This submission has already been reviewed.", 409)
    task = _one(db, "skill_tasks", "id, skill_id, rubric_id, title", "id", sub["task_id"]) or {}
    rubric = (_one(db, "rubrics", "id, criteria", "id", task["rubric_id"]) or {}).get("criteria", []) if task.get("rubric_id") else []
    cleaned = check_review(decision, criteria, rubric, comment)
    status = "approved" if decision == "approve" else "resubmit"
    now = now_iso()
    db.table("task_submissions").update({"status": status, "reviewer_id": reviewer_id, "reviewed_at": now,
                                         "review": {"decision": decision, "criteria": cleaned, "comment": comment.strip()}}).eq("id", submission_id).execute()
    result: dict[str, Any] = {"id": submission_id, "status": status, "credential_public_id": None}
    skill = _one(db, "skills", "id, name, nsqf_level", "id", task.get("skill_id")) or {}
    if decision == "approve":
        cred = issue_credential(db, sub, task, skill, reviewer_id)
        result["credential_public_id"] = cred["public_id"]
        title, body, link = f"Skill proved: {skill.get('name', task.get('title'))}", "Your teacher approved your work. Your credential is in your Skill Passport.", "/app/passport"
        kind = "credential"
    else:
        title, body, link = f"Try again: {task.get('title')}", comment.strip() or "Your teacher left feedback. Please improve and submit again.", f"/app/passport/tasks/{sub['task_id']}"
        kind = "task_review"
    db.table("notifications").insert({"user_id": sub["student_id"], "kind": kind, "title": title, "body": body, "link": link}).execute()
    return result


def issue_credential(db: Any, sub: dict, task: dict, skill: dict, reviewer_id: str) -> dict:
    student = _one(db, "profiles", "id, full_name", "id", sub["student_id"]) or {}
    reviewer = _one(db, "profiles", "id, full_name", "id", reviewer_id) or {}
    sp = _one(db, "student_profiles", "user_id, school_name", "user_id", sub["student_id"]) or {}
    public_id = new_public_id()
    issued = now_iso()
    lvl = skill.get("nsqf_level")
    payload = build_payload(public_id=public_id, student_name=student.get("full_name") or "Student", skill_name=skill.get("name") or task.get("title", ""),
                            level=f"NSQF level {lvl}" if lvl else "Practical", task_title=task.get("title", ""),
                            evidence_count=len(sub.get("evidence_paths") or []), reviewer_name=reviewer.get("full_name") or "Teacher",
                            school=sp.get("school_name"), issued_at=issued, base_url=verify_base_url())
    row = {"student_id": sub["student_id"], "submission_id": sub["id"], "skill_id": skill.get("id"), "payload": payload,
           "signature": sign_payload(payload, get_signing_key()), "public_id": public_id, "issued_at": issued}
    return db.table("credentials").insert(row).execute().data[0]


def _one(db: Any, table: str, cols: str, col: str, value: Any) -> dict | None:
    if value is None:
        return None
    rows = db.table(table).select(cols).eq(col, value).limit(1).execute().data or []
    return rows[0] if rows else None
