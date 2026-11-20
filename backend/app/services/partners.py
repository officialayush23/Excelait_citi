"""Partner organisations (colleges, ITIs, NGOs, companies) and the offerings they publish.

Who an offering is for is written as simple criteria, turned into the same rule JSON the
scheme checker uses, so matching students is deterministic and explainable."""

from __future__ import annotations

from datetime import date

from app.core.db import get_db
from app.engine.rules import evaluate

ORG_FIELDS = "id, name, kind, about, website, contact_email, phone, state, district, aishe_code, verification_status, rejection_reason, created_at"
OFFER_FIELDS = ("id, org_id, kind, title, description, location, is_remote, stipend_monthly, fee_inr, seats, deadline, starts_at, apply_url, "
                "status, rule, state, district, career_slugs, program_slugs, language, published_at, notified_count, created_at")
NOTIFY_LIMIT = 5000


class PartnerError(ValueError):
    pass


# ---------- criteria -> rule ----------
def criteria_to_rule(c: dict) -> dict | None:
    conds = []
    def add(id_, field, op, value, label):
        conds.append({"id": id_, "field": field, "op": op, "value": value, "label": label})
    if c.get("class_min") is not None:
        add("class_min", "class_level", "gte", int(c["class_min"]), f"Class {c['class_min']} or above")
    if c.get("class_max") is not None:
        add("class_max", "class_level", "lte", int(c["class_max"]), f"Up to Class {c['class_max']}")
    if c.get("courses"):
        add("courses", "course", "in", list(c["courses"]), "Studying: " + ", ".join(c["courses"]))
    if c.get("states"):
        add("states", "state", "in", list(c["states"]), "Lives in: " + ", ".join(c["states"]))
    if c.get("gender"):
        add("gender", "gender", "eq", c["gender"], "Only for " + {"female": "girls and women", "male": "boys and men"}.get(c["gender"], c["gender"]))
    if c.get("income_max") is not None:
        add("income", "family_income_annual", "lte", int(c["income_max"]), f"Family income up to Rs {int(c['income_max']):,} a year")
    if c.get("categories"):
        add("category", "social_category", "in", list(c["categories"]), "Category: " + ", ".join(c["categories"]))
    if c.get("marks_min") is not None:
        add("marks", "marks_percent", "gte", float(c["marks_min"]), f"{c['marks_min']}% or more in the last exam")
    if c.get("age_min") is not None or c.get("age_max") is not None:
        lo, hi = int(c.get("age_min") or 0), int(c.get("age_max") or 120)
        add("age", "age", "between", [lo, hi], f"Age {lo} to {hi}")
    return {"all": conds} if conds else None


def rule_to_criteria(rule: dict | None) -> dict:
    out: dict = {}
    for n in (rule or {}).get("all", []):
        i, v = n.get("id"), n.get("value")
        if i == "age":
            out["age_min"], out["age_max"] = v
        else:
            out[{"income": "income_max", "category": "categories", "marks": "marks_min"}.get(i, i)] = v
    return out


# ---------- organisations ----------
def my_orgs(user_id: str) -> list[dict]:
    rows = get_db().table("org_members").select(f"role, organizations({ORG_FIELDS})").eq("user_id", user_id).execute().data
    return [{**r["organizations"], "my_role": r["role"]} for r in rows]


def _org_for(user_id: str, org_id: str) -> dict:
    for o in my_orgs(user_id):
        if o["id"] == org_id:
            return o
    raise PartnerError("You are not a member of this organisation.")


def register_org(user_id: str, data: dict) -> dict:
    db = get_db()
    code = (data.get("aishe_code") or "").strip().upper() or None
    if code:
        col = db.table("colleges").select("aishe_code, org_id").eq("aishe_code", code).limit(1).execute().data
        if not col:
            raise PartnerError("That AISHE code is not in the directory.")
        if col[0]["org_id"]:
            raise PartnerError("This college listing has already been claimed. Contact support if this is wrong.")
    row = {k: data.get(k) for k in ("name", "kind", "about", "website", "contact_email", "phone", "state", "district")}
    row["aishe_code"] = code
    org = db.table("organizations").insert(row).execute().data[0]
    db.table("org_members").insert({"org_id": org["id"], "user_id": user_id, "role": "owner"}).execute()
    return org


def update_org(user_id: str, org_id: str, data: dict) -> dict:
    _org_for(user_id, org_id)
    patch = {k: data[k] for k in ("name", "about", "website", "contact_email", "phone", "state", "district") if k in data}
    return get_db().table("organizations").update(patch).eq("id", org_id).execute().data[0]


def update_college_details(user_id: str, org_id: str, details: dict) -> dict:
    org = _org_for(user_id, org_id)
    if org["verification_status"] != "verified" or not org["aishe_code"]:
        raise PartnerError("Only a verified owner can edit a college listing.")
    allowed = {k: details[k] for k in ("courses", "fees", "seats", "hostel", "contact", "admission_info", "photos") if k in details}
    return get_db().table("colleges").update({"details": allowed, "updated_at": "now()"}).eq("aishe_code", org["aishe_code"]).execute().data[0]


# ---------- admin ----------
def pending_orgs() -> list[dict]:
    return get_db().table("organizations").select(ORG_FIELDS).eq("verification_status", "pending").order("created_at").execute().data


def review_org(admin_id: str, org_id: str, approve: bool, reason: str | None = None) -> dict:
    db = get_db()
    org = db.table("organizations").update({
        "verification_status": "verified" if approve else "rejected", "verified_by": admin_id,
        "verified_at": "now()", "rejection_reason": None if approve else (reason or "Not approved"),
    }).eq("id", org_id).execute().data[0]
    if approve and org.get("aishe_code"):
        db.table("colleges").update({"org_id": org_id}).eq("aishe_code", org["aishe_code"]).execute()
    for m in db.table("org_members").select("user_id").eq("org_id", org_id).execute().data:
        db.table("notifications").insert({"user_id": m["user_id"], "kind": "org_review",
            "title": "Your organisation is verified" if approve else "Your organisation was not approved",
            "body": None if approve else reason, "link": "/app/organisation"}).execute()
    return org


# ---------- offerings ----------
def _clean_offer(data: dict) -> dict:
    row = {k: data.get(k) for k in ("kind", "title", "description", "location", "is_remote", "stipend_monthly", "fee_inr", "seats",
                                    "deadline", "starts_at", "apply_url", "state", "district", "career_slugs", "program_slugs", "language")
           if k in data}
    if "criteria" in data:
        row["rule"] = criteria_to_rule(data["criteria"] or {})
    row["fee_inr"] = int(row.get("fee_inr") or 0)
    return row


def list_offers(user_id: str, org_id: str) -> list[dict]:
    _org_for(user_id, org_id)
    rows = get_db().table("opportunities").select(OFFER_FIELDS + ", applications(count)").eq("org_id", org_id).order("created_at", desc=True).execute().data
    for r in rows:
        r["applicants"] = (r.pop("applications") or [{"count": 0}])[0]["count"]
        r["criteria"] = rule_to_criteria(r["rule"])
    return rows


def save_offer(user_id: str, org_id: str, data: dict, offer_id: str | None = None) -> dict:
    _org_for(user_id, org_id)
    row = _clean_offer(data)
    t = get_db().table("opportunities")
    if offer_id:
        return t.update(row).eq("id", offer_id).eq("org_id", org_id).execute().data[0]
    return t.insert({**row, "org_id": org_id, "status": "draft", "source": "partner"}).execute().data[0]


def publish_offer(user_id: str, org_id: str, offer_id: str) -> dict:
    org = _org_for(user_id, org_id)
    if org["verification_status"] != "verified":
        raise PartnerError("Your organisation must be verified before you can publish.")
    db = get_db()
    offer = db.table("opportunities").update({"status": "open", "published_at": "now()"}).eq("id", offer_id).eq("org_id", org_id).execute().data[0]
    sent = notify_matches(offer, org["name"])
    db.table("opportunities").update({"notified_count": sent}).eq("id", offer_id).execute()
    return {**offer, "notified_count": sent}


def close_offer(user_id: str, org_id: str, offer_id: str) -> dict:
    _org_for(user_id, org_id)
    return get_db().table("opportunities").update({"status": "closed"}).eq("id", offer_id).eq("org_id", org_id).execute().data[0]


def offer_matches(offer: dict, facts: dict) -> str:
    """eligible / needs_info / not_eligible for one student."""
    if offer.get("state") and facts.get("state") and facts["state"] != offer["state"]:
        return "not_eligible"
    return evaluate(offer["rule"], facts).result if offer.get("rule") else "eligible"


def notify_matches(offer: dict, org_name: str) -> int:
    db = get_db()
    rows = db.table("student_profiles").select("user_id, facts").limit(NOTIFY_LIMIT).execute().data
    notes = [{"user_id": r["user_id"], "kind": "offering", "title": f"New for you: {offer['title']}",
              "body": f"From {org_name}" + (f" · apply by {offer['deadline']}" if offer.get("deadline") else ""),
              "link": f"/app/opportunities?id={offer['id']}"}
             for r in rows if offer_matches(offer, r["facts"] or {}) == "eligible"]
    for i in range(0, len(notes), 500):
        db.table("notifications").insert(notes[i:i + 500]).execute()
    return len(notes)


def offers_for_student(facts: dict, kind: str | None = None, career: str | None = None, limit: int = 30) -> list[dict]:
    q = get_db().table("opportunities").select(OFFER_FIELDS + ", organizations(name, kind, verification_status)").eq("status", "open")
    if kind:
        q = q.eq("kind", kind)
    if career:
        q = q.contains("career_slugs", [career])
    today = date.today().isoformat()
    out = []
    for o in q.order("deadline", nullsfirst=False).limit(200).execute().data:
        if o["deadline"] and o["deadline"] < today:
            continue
        org = o.pop("organizations") or {}
        if org and org.get("verification_status") != "verified":
            continue  # only verified organisations reach students
        m = offer_matches(o, facts)
        if m == "not_eligible":
            continue
        rule_out = evaluate(o["rule"], facts) if o.get("rule") else None
        out.append({**o, "org_name": org.get("name"), "org_kind": org.get("kind"), "verified": org.get("verification_status") == "verified",
                    "match": m, "missing": rule_out.missing if rule_out else [], "criteria_labels": [n["label"] for n in (o.get("rule") or {}).get("all", [])]})
    out.sort(key=lambda o: (o["match"] != "eligible", o["deadline"] or "9999"))
    return out[:limit]


# ---------- applications ----------
def apply(student_id: str, offer_id: str, note: str | None) -> dict:
    db = get_db()
    app = db.table("applications").upsert({"opportunity_id": offer_id, "student_id": student_id, "note": note, "status": "applied"},
                                          on_conflict="opportunity_id,student_id").execute().data[0]
    db.table("application_events").insert({"application_id": app["id"], "status": "applied", "actor_id": student_id}).execute()
    return app


def my_applications(student_id: str) -> list[dict]:
    return get_db().table("applications").select("id, status, created_at, updated_at, opportunities(id, title, kind, deadline, organizations(name))") \
        .eq("student_id", student_id).order("created_at", desc=True).execute().data


def applicants(user_id: str, org_id: str, offer_id: str) -> list[dict]:
    _org_for(user_id, org_id)
    return get_db().table("applications").select("id, status, note, created_at, profiles!applications_student_id_fkey(full_name)") \
        .eq("opportunity_id", offer_id).order("created_at").execute().data


def set_application_status(user_id: str, org_id: str, application_id: str, status: str) -> dict:
    _org_for(user_id, org_id)
    db = get_db()
    app = db.table("applications").select("id, student_id, opportunities!inner(org_id, title)").eq("id", application_id).single().execute().data
    if app["opportunities"]["org_id"] != org_id:
        raise PartnerError("Not your applicant.")
    db.table("applications").update({"status": status}).eq("id", application_id).execute()
    db.table("application_events").insert({"application_id": application_id, "status": status, "actor_id": user_id}).execute()
    db.table("notifications").insert({"user_id": app["student_id"], "kind": "application", "title": f"Update on {app['opportunities']['title']}",
                                      "body": f"Status: {status}", "link": "/app/opportunities?tab=applied"}).execute()
    return {"id": application_id, "status": status}
