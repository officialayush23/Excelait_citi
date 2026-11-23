"""Demo student Arjun Kale: 2nd-year engineering, 20, family lost its income, needs a scholarship and work
he can do while studying. Every part of the app agrees about him: facts with sources, interest quiz, skills
(two verified, one waiting for review, one in progress), a roadmap with education first, a scholarship claim,
a part-time job watch, and activity that moves the plan.

    cd backend && python -m scripts.seed_arjun
"""
from __future__ import annotations

import io
from datetime import datetime, timedelta, timezone

from PIL import Image, ImageDraw

from app.core.db import get_db
from app.services import passport, plans
from app.services import roadmap as rm
from app.services.students import merge_facts
from scripts.seed_demo import DOMAIN, PASSWORD, user_id

EMAIL = f"arjun@{DOMAIN}"


def photo(label: str) -> bytes:
    img = Image.new("RGB", (800, 600), (232, 240, 230))
    d = ImageDraw.Draw(img)
    d.rectangle([40, 40, 760, 560], outline=(40, 90, 60), width=6)
    d.text((80, 280), label, fill=(20, 40, 30))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=80)
    return buf.getvalue()


def main() -> None:
    db = get_db()
    uid = user_id(EMAIL, "Arjun Kale", "student")
    teacher = user_id(f"teacher@{DOMAIN}", "Sunita Deshmukh", "facilitator")
    db.table("profiles").update({"full_name": "Arjun Kale", "preferred_language": "en"}).eq("id", uid).execute()
    db.table("user_roles").delete().eq("user_id", uid).execute()
    db.table("user_roles").insert([{"user_id": uid, "role": "student"}]).execute()

    # Start clean
    for t, col in (("pathways", "user_id"), ("saved_careers", "user_id"), ("claims", "user_id"), ("credentials", "student_id"),
                   ("task_submissions", "student_id"), ("activity_events", "user_id"), ("roadmap_changes", "user_id"),
                   ("roadmap_signals", "user_id"), ("watches", "user_id"), ("roadmap_state", "user_id")):
        try:
            db.table(t).delete().eq(col, uid).execute()
        except Exception:  # noqa: BLE001
            pass
    db.table("student_profiles").upsert({"user_id": uid, "facts": {}, "facts_meta": {}}).execute()

    # Facts, each with where it came from (the knowledge graph on his profile)
    merge_facts(uid, {"stage": "ug_technical", "course": "ug_technical", "course_year": 2, "class_level": 14, "age": 20,
                      "gender": "male", "state": "Maharashtra", "district": "Nashik", "interests": ["computers", "machines"],
                      "go_where": "city", "can_relocate": True, "phone_access": "shared", "internet": "patchy"},
                source="onboarding")
    merge_facts(uid, {"needs_income_soon": True, "hours_per_week": 15, "can_travel_km": 10, "has_family_business": False},
                source="saathi",
                note="Papa ki factory job chali gayi. Ghar chalane ke liye kuch kaam chahiye, par engineering nahi chhodni.")
    merge_facts(uid, {"skills": ["Typing (35 words a minute)", "MS Excel basics", "Basic Python"]}, source="saathi",
                note="Typing aur Excel aata hai, college mein thoda Python seekha hai.")
    merge_facts(uid, {"marks_percent": 68, "subjects": ["maths", "physics", "computers"]}, source="teacher",
                note="From his 1st-year marksheet")
    merge_facts(uid, {"riasec": {"R": 62, "I": 81, "A": 28, "S": 44, "E": 36, "C": 70}}, source="quiz")
    merge_facts(uid, {"family_income_annual": 100000, "social_category": "OBC", "is_disabled": False}, source="onboarding")

    # His teacher's class
    cohort = (db.table("cohorts").select("id").eq("facilitator_id", teacher).limit(1).execute().data or [None])[0]
    if cohort:
        db.table("cohort_members").upsert({"cohort_id": cohort["id"], "student_id": uid}).execute()

    # Roadmap: finish the degree first, a career goal, a scholarship goal, earning while learning
    plans.save_career(uid, "software-developer", True)
    plans.save_career(uid, "ai-data-annotator", True)
    plans.create_plan(uid, "software-developer")
    for kind, kw in (("scheme", {"scheme": "mh-shahu-maharaj-shikshan-shulk"}),):
        try:
            rm.add_goal(uid, kind, source="student", **kw)
        except Exception as e:  # noqa: BLE001
            print("goal skipped:", e)
    try:
        rm.add_goal(uid, "custom", title="Earn ₹6,000 a month part-time without missing college", source="saathi")
    except Exception as e:  # noqa: BLE001
        print("custom goal skipped:", e)
    for kind, ref, q, label in (("job", None, {"role": "data entry", "place": "Nashik", "part_time": True}, "Part-time data entry, Nashik"),
                                ("job", None, {"role": "AI data annotation", "place": "remote", "part_time": True}, "Remote data annotation")):
        try:
            rm.add_watch(uid, kind, ref, q, label)
        except Exception as e:  # noqa: BLE001
            print("watch skipped:", e)

    # He is already in 2nd year: entrance exams, admission and old documents are done; orphan-only steps don't apply
    cid = db.table("pathways").select("id").eq("user_id", uid).eq("kind", "career").execute().data[0]["id"]
    past = (datetime.now(timezone.utc) - timedelta(days=400)).isoformat()
    for st in db.table("pathway_steps").select("id, title").eq("pathway_id", cid).execute().data:
        t = st["title"]
        if any(k in t for k in ("JEE Main", "MHT-CET", "Get admission: B.Tech", "Class 12 marksheet", "Aadhaar card", "Bank account linked")):
            db.table("pathway_steps").update({"status": "done", "progress": 100, "done_by": "student", "done_at": past,
                                              "evidence": {"kind": "note", "ref": "Already in 2nd year B.E. (Computer)"}}).eq("id", st["id"]).execute()
        if any(k in t for k in ("Swanath", "Orphan certificate")):
            db.table("pathway_steps").delete().eq("id", st["id"]).execute()
    db.table("pathways").update({"title": "Software developer (B.E. Computer, 2nd year)"}).eq("id", cid).execute()

    # Scholarship claim his teacher is tracking
    scheme = {r["slug"]: r["id"] for r in db.table("schemes").select("id, slug").execute().data}
    if "mh-shahu-maharaj-shikshan-shulk" in scheme:
        db.table("claims").insert({"user_id": uid, "scheme_id": scheme["mh-shahu-maharaj-shikshan-shulk"], "status": "submitted",
                                   "confirmed_by": teacher}).execute()

    # Skill Passport: two verified, one waiting for review, one being prepared
    task = {r["slug"]: r["id"] for r in db.table("skill_tasks").select("id, slug").execute().data}
    for slug, label, note in (("typing-accuracy-1", "Typing test: 36 wpm, 97% accuracy", "Typed the passage in 5 minutes."),
                              ("spreadsheet-basic-1", "Household budget sheet with SUM and charts", "Made our home budget sheet.")):
        if slug in task:
            sub = passport.submit(task[slug], uid, [(photo(label), "image/jpeg")], note)
            try:
                passport.review_submission(teacher, {"facilitator"}, sub["id"], "approve",
                                           [{"id": c, "ok": True} for c in ("c1", "c2", "c3", "c4")], "Accurate and neat work.")
            except Exception as e:  # noqa: BLE001
                print("review skipped:", e)
    if "basic-coding-1" in task:
        passport.submit(task["basic-coding-1"], uid, [(photo("Python: marks average program, output shown"), "image/jpeg")],
                        "Wrote a small program that averages marks and prints the grade.")

    # Activity that moves the plan
    long = datetime.now(timezone.utc)
    for kind, ref, days in (("career_saved", "software-developer", 9), ("scheme_viewed", "mh-shahu-maharaj-shikshan-shulk", 7),
                            ("quiz_done", "riasec", 6), ("lesson_completed", "excel-basics", 4), ("job_viewed", "data entry", 2),
                            ("community_post", None, 1)):
        try:
            db.table("activity_events").insert({"user_id": uid, "kind": kind, "ref": ref,
                                                "created_at": (long - timedelta(days=days)).isoformat()}).execute()
        except Exception as e:  # noqa: BLE001
            print("event skipped:", e)
    try:
        rm.capture_signals(uid, "Ghar mein paise ki dikkat hai, padhai ke saath kaam karna hai. Sirf shaam ko 3 ghante free hoon.", None)
        rm.evaluate(uid)
    except Exception as e:  # noqa: BLE001
        print("roadmap evaluate skipped:", e)

    print(f"{EMAIL} / {PASSWORD}  ready")


if __name__ == "__main__":
    main()
