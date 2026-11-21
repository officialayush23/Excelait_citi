"""Demo accounts and data for every role, for the pitch video and judges.

Safe to run again: accounts are found by email and their data is refreshed, not duplicated.

    cd backend && python -m scripts.seed_demo            # create or refresh
    cd backend && python -m scripts.seed_demo --reset-pooja   # empty Pooja's profile again before recording
"""

from __future__ import annotations

import sys
from datetime import date, timedelta

import httpx

from app.core.config import get_settings
from app.core.db import get_db
import io
from datetime import datetime, timezone

from PIL import Image, ImageDraw

from app.services import community, partners, passport, plans
from app.services.students import merge_facts

PASSWORD = "ExcelAIt@Demo2026"
DOMAIN = "demo.excelait.in"

S = get_settings()
ADMIN_H = {"apikey": S.supabase_secret_key, "Authorization": f"Bearer {S.supabase_secret_key}"}

# email local part, full name, roles, language
ACCOUNTS = [
    ("pooja", "Pooja Patil", ["student"], "mr"),             # fresh profile: onboard on camera
    ("sneha", "Sneha Jadhav", ["student"], "mr"),            # ready-made profile, Class 12, nursing
    ("rahul", "Rahul Shinde", ["student"], "hi"),            # ITI electrician route
    ("aarti", "Aarti Pawar", ["student"], "mr"),             # Class 8, NMMSS
    ("vikas", "Vikas More", ["student"], "mr"),              # inactive, at risk
    ("teacher", "Sunita Deshmukh", ["facilitator"], "mr"),   # Career Mitra with a class
    ("mentor", "Dr. Kavita Rao", ["mentor"], "en"),          # verified answers, senior
    ("senior", "Meena Gaikwad", ["student"], "mr"),          # alumna on the nursing path
    ("partner", "Asha Health Trust", ["partner"], "en"),     # NGO with offerings
    ("college", "Nashik Nursing College", ["partner"], "en"),
    ("parent", "Ramesh Patil", ["parent"], "mr"),
    ("funder", "CSR Foundation", ["funder"], "en"),
    ("admin", "ExcelAIt Admin", ["admin"], "en"),
]

FACTS = {
    "sneha": {"class_level": 12, "course": "school", "state": "Maharashtra", "district": "Nashik", "gender": "female",
              "family_income_annual": 200000, "social_category": "SC", "marks_percent": 72, "school_type": "aided",
              "interests": ["helping", "health", "teaching"], "subjects": ["biology", "science"],
              "needs_income_soon": True, "can_relocate": False, "age": 17},
    "rahul": {"class_level": 10, "course": "school", "state": "Maharashtra", "district": "Nashik", "gender": "male",
              "family_income_annual": 100000, "social_category": "OBC", "marks_percent": 58, "school_type": "government",
              "interests": ["hands_on", "electricity", "machines"], "subjects": ["science", "maths"],
              "needs_income_soon": True, "can_relocate": True, "age": 16},
    "aarti": {"class_level": 8, "course": "school", "state": "Maharashtra", "district": "Nashik", "gender": "female",
              "family_income_annual": 250000, "social_category": "ST", "marks_percent": 64, "school_type": "local_body",
              "interests": ["teaching", "creative"], "subjects": ["languages", "art"], "age": 13},
    "vikas": {"class_level": 12, "course": "school", "state": "Maharashtra", "district": "Nashik", "gender": "male",
              "interests": ["computers"], "age": 17},
    "senior": {"class_level": 15, "course": "ug_degree", "state": "Maharashtra", "district": "Nashik", "gender": "female",
               "interests": ["health", "helping"], "subjects": ["biology"]},
}


def user_id(email: str, name: str, role: str) -> str:
    r = httpx.get(f"{S.supabase_url}/auth/v1/admin/users", headers=ADMIN_H, params={"per_page": 1000})
    for u in r.json().get("users", []):
        if u["email"] == email:
            return u["id"]
    r = httpx.post(f"{S.supabase_url}/auth/v1/admin/users", headers=ADMIN_H, json={
        "email": email, "password": PASSWORD, "email_confirm": True, "user_metadata": {"role": role, "full_name": name}})
    r.raise_for_status()
    return r.json()["id"]


def main() -> None:
    db = get_db()
    ids: dict[str, str] = {}
    for key, name, roles, lang in ACCOUNTS:
        uid = user_id(f"{key}@{DOMAIN}", name, roles[0] if roles[0] in ("student", "facilitator", "parent", "mentor", "partner") else "student")
        ids[key] = uid
        db.table("profiles").update({"full_name": name, "preferred_language": lang}).eq("id", uid).execute()
        db.table("user_roles").delete().eq("user_id", uid).execute()
        db.table("user_roles").insert([{"user_id": uid, "role": r} for r in roles]).execute()

    # Student profiles. Pooja starts empty so onboarding can be shown live.
    if "--keep-pooja" not in sys.argv:
        db.table("student_profiles").upsert({"user_id": ids["pooja"], "facts": {}}).execute()
        db.table("saved_careers").delete().eq("user_id", ids["pooja"]).execute()
        db.table("pathways").delete().eq("user_id", ids["pooja"]).execute()
    for key, facts in FACTS.items():
        db.table("student_profiles").upsert({"user_id": ids[key], "facts": {}}).execute()
        merge_facts(ids[key], facts, replace_lists=True)
    for key, career in (("sneha", "staff-nurse"), ("rahul", "electrician"), ("aarti", "primary-teacher"), ("senior", "staff-nurse")):
        db.table("pathways").delete().eq("user_id", ids[key]).execute()
        plans.create_plan(ids[key], career)

    # Seniors and mentor
    db.table("profiles").update({"is_senior": True, "senior_path": "Class 12 (Biology) → B.Sc Nursing, Nashik → staff nurse, district hospital",
                                 "bio": "First in my family to go to college. Ask me about nursing CET and hostels."}).eq("id", ids["senior"]).execute()
    db.table("profiles").update({"is_senior": True, "senior_path": "MBBS → community health officer → mentor for nursing aspirants",
                                 "bio": "I help students choose between ANM, GNM and B.Sc Nursing."}).eq("id", ids["mentor"]).execute()

    # Partners: NGO (verified, one open + one draft offer) and a college that claimed its AISHE listing
    db.table("organizations").delete().in_("name", ["Asha Health Trust", "Nashik Nursing College"]).execute()
    ngo = partners.register_org(ids["partner"], {"name": "Asha Health Trust", "kind": "ngo", "state": "Maharashtra", "district": "Nashik",
                                                  "about": "Free coaching and mentoring for girls entering nursing and allied health.",
                                                  "website": "https://example.org/asha", "contact_email": f"partner@{DOMAIN}"})
    partners.review_org(ids["admin"], ngo["id"], True)
    deadline = (date.today() + timedelta(days=40)).isoformat()
    live = partners.save_offer(ids["partner"], ngo["id"], {
        "kind": "training", "title": "Free nursing entrance coaching for girls", "description": "12 weekend classes in Nashik, with mock tests and hostel guidance.",
        "fee_inr": 0, "deadline": deadline, "location": "Nashik", "state": "Maharashtra", "district": "Nashik",
        "career_slugs": ["staff-nurse", "anm-nurse"], "program_slugs": ["bsc-nursing", "anm"],
        "criteria": {"gender": "female", "class_min": 11, "states": ["Maharashtra"]}})
    partners.publish_offer(ids["partner"], ngo["id"], live["id"])
    partners.save_offer(ids["partner"], ngo["id"], {
        "kind": "internship", "title": "Health camp volunteer internship (stipend)", "description": "4-week rural health camp internship.",
        "fee_inr": 0, "stipend_monthly": 3000, "deadline": deadline, "location": "Nashik district", "state": "Maharashtra",
        "career_slugs": ["anm-nurse", "staff-nurse", "social-worker"],
        "criteria": {"class_min": 12, "states": ["Maharashtra"]}})  # stays a draft: publish it on camera
    col = db.table("colleges").select("aishe_code").ilike("district", "%Nashik%").eq("kind", "nursing").limit(1).execute().data
    if col:
        cname = "Nashik Nursing College"
        org = partners.register_org(ids["college"], {"name": cname, "kind": "college", "state": "Maharashtra", "district": "Nashik",
                                                     "aishe_code": col[0]["aishe_code"], "contact_email": f"college@{DOMAIN}"})
        partners.review_org(ids["admin"], org["id"], True)
        partners.update_college_details(ids["college"], org["id"], {
            "courses": ["B.Sc Nursing (4 years)", "GNM (3 years)"], "fees": "Government quota fees as per state rules", "seats": "60",
            "hostel": True, "contact": f"college@{DOMAIN}", "admission_info": "Admission through the state nursing CET."})
    # One organisation left pending, for the admin verification demo
    db.table("organizations").delete().eq("name", "Gram Skills Training Centre").execute()
    partners.register_org(ids["college"], {"name": "Gram Skills Training Centre", "kind": "training_centre", "state": "Maharashtra",
                                           "district": "Nashik", "about": "Solar and EV technician short courses for rural youth."})

    # Community: a question with a verified accepted answer, a story, an opportunity post
    community.ensure_default_groups()
    db.table("posts").delete().in_("author_id", list(ids.values())).execute()
    roles_mentor = {"mentor"}
    q = community.create_post(ids["sneha"], {"student"}, {"kind": "question", "title": "Is GNM still open in Maharashtra, or only B.Sc Nursing?",
                                                          "body": "My teacher said GNM is closing. Which should I apply for?", "tags": {"careers": ["staff-nurse"]}})
    a = community.comment(ids["mentor"], roles_mentor, q["id"], "GNM seats are being reduced under the Indian Nursing Council's plan. Apply for the B.Sc Nursing CET this year, and keep ANM as a backup.")
    community.accept(ids["sneha"], {"student"}, q["id"], a["id"])
    community.comment(ids["senior"], {"student"}, q["id"], "I did B.Sc Nursing in Nashik on the post-matric scholarship; the fees were covered. Start the income certificate early!")
    community.create_post(ids["senior"], {"student"}, {"kind": "story", "title": "From my village to a nursing degree",
                                                       "body": "No one in my family had gone to college. The scholarship paid my fees and I now work at the district hospital.",
                                                       "tags": {"careers": ["staff-nurse"]}})
    community.create_post(ids["rahul"], {"student"}, {"kind": "question", "title": "Which ITI trade has the most jobs near Nashik?",
                                                      "tags": {"careers": ["electrician"]}})

    # Teacher's class: Pooja, Sneha, Rahul, Aarti, Vikas
    db.table("cohorts").delete().eq("facilitator_id", ids["teacher"]).execute()
    cohort = db.table("cohorts").insert({"facilitator_id": ids["teacher"], "name": "Class 10 & 12 career group",
                                         "school_name": "ZP High School, Dindori (Nashik)"}).execute().data[0]
    members = ["pooja", "sneha", "rahul", "aarti", "vikas"]
    db.table("cohort_members").insert([{"cohort_id": cohort["id"], "student_id": ids[k]} for k in members]).execute()
    long_ago = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    db.table("cohort_members").update({"added_at": long_ago}).eq("cohort_id", cohort["id"]).eq("student_id", ids["vikas"]).execute()
    db.table("student_profiles").update({"updated_at": long_ago}).eq("user_id", ids["vikas"]).execute()

    # Scholarship claims the teacher tracks
    scheme = {r["slug"]: r["id"] for r in db.table("schemes").select("id, slug").execute().data}
    db.table("claims").delete().in_("user_id", [ids[k] for k in members]).execute()
    db.table("claims").insert([
        {"user_id": ids["aarti"], "scheme_id": scheme["nmmss"], "status": "money_received", "amount_expected": 12000,
         "amount_received": 12000, "confirmed_by": ids["teacher"]},
        {"user_id": ids["sneha"], "scheme_id": scheme["pms-sc"], "status": "submitted", "confirmed_by": ids["teacher"]},
    ]).execute()

    # Skill Passport: Sneha has a verified credential; Rahul is waiting for review
    def photo(label: str) -> bytes:
        img = Image.new("RGB", (800, 600), (232, 240, 230))
        d = ImageDraw.Draw(img)
        d.rectangle([40, 40, 760, 560], outline=(40, 90, 60), width=6)
        d.text((80, 280), label, fill=(20, 40, 30))
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=80)
        return buf.getvalue()
    task = {r["slug"]: r["id"] for r in db.table("skill_tasks").select("id, slug").execute().data}
    db.table("credentials").delete().in_("student_id", [ids["sneha"], ids["rahul"]]).execute()
    db.table("task_submissions").delete().in_("student_id", [ids["sneha"], ids["rahul"]]).execute()
    if "blood-pressure-1" in task:
        sub = passport.submit(task["blood-pressure-1"], ids["sneha"], [(photo("BP 118/76 at 10:40, volunteer seated"), "image/jpeg")],
                              "Measured my aunt's BP twice: 118/76 and 120/78.")
        passport.review_submission(ids["teacher"], {"facilitator"}, sub["id"], "approve",
                                   [{"id": c, "ok": True} for c in ("c1", "c2", "c3", "c4")], "Careful and clean work.")
    if "switchboard-wiring-1" in task:
        passport.submit(task["switchboard-wiring-1"], ids["rahul"], [(photo("Switch + bulb practice board"), "image/jpeg")],
                        "Wired one switch and a bulb holder on the ITI practice board. Supply was off.")

    print("Demo accounts (password for all: %s)" % PASSWORD)
    for key, name, roles, _ in ACCOUNTS:
        print(f"  {key + '@' + DOMAIN:<28} {', '.join(roles):<12} {name}")
    print(f"Teacher class join code: {cohort['join_code']}")


if __name__ == "__main__":
    main()
