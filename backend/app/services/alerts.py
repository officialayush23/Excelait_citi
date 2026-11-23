"""Alert rules for the roadmap's watchlist. Pure functions: what to tell the student today, each with a
dedupe key so the same alert is never sent twice. The daily job in roadmap.py stores them as notifications.

- A hard deadline on the roadmap: 7, 3 and 1 days before (one alert per threshold, even if a day is missed).
- A watched exam: its usual window is 30 and 7 days away (typical months; the official notice decides).
- A watched scheme: its deadline is 7 / 3 / 1 days away; the student now qualifies.
- A watched job search: openings first seen since the last check, grouped into one alert.
- Minors are never alerted about jobs they cannot legally take (work_rules). A minor's job watch becomes a
  skills-and-scholarships watch; 14-17 year olds may get non-hazardous apprenticeships only."""

from __future__ import annotations

import re
from datetime import date

from app.services.roadmap_engine import is_done, to_date, to_dt

DEADLINE_DAYS = (1, 3, 7)
EXAM_DAYS = (7, 30)
LANGS = ("en", "hi", "mr")

T = {
    "deadline": {
        "en": ("{title}: {days} days left", "This date is fixed. Open your roadmap to see the one step to do now."),
        "hi": ("{title}: {days} दिन बाकी", "यह तारीख तय है। अभी का एक कदम देखने के लिए अपना रोडमैप खोलिए।"),
        "mr": ("{title}: {days} दिवस बाकी", "ही तारीख ठरलेली आहे. आत्ताची एक पायरी पाहण्यासाठी तुमचा रोडमॅप उघडा."),
    },
    "deadline_today": {
        "en": ("{title} is today", "This date is fixed. You can still do it today."),
        "hi": ("{title} आज है", "यह तारीख तय है। आप आज भी कर सकते हैं।"),
        "mr": ("{title} आज आहे", "ही तारीख ठरलेली आहे. तुम्ही आजही करू शकता."),
    },
    "exam": {
        "en": ("{exam} usually happens in {month}", "Check the official site for the form dates. Forms often open earlier."),
        "hi": ("{exam} आमतौर पर {month} में होती है", "फॉर्म की तारीख आधिकारिक साइट पर देखिए। फॉर्म अक्सर पहले खुलते हैं।"),
        "mr": ("{exam} साधारण {month} मध्ये होते", "फॉर्मच्या तारखा अधिकृत साइटवर पहा. फॉर्म अनेकदा आधी उघडतात."),
    },
    "scheme_deadline": {
        "en": ("{scheme}: last date in {days} days", "Keep your documents ready and apply on the official site."),
        "hi": ("{scheme}: आखिरी तारीख {days} दिन में", "दस्तावेज़ तैयार रखिए और आधिकारिक साइट पर आवेदन कीजिए।"),
        "mr": ("{scheme}: शेवटची तारीख {days} दिवसांत", "कागदपत्रे तयार ठेवा आणि अधिकृत साइटवर अर्ज करा."),
    },
    "scheme_eligible": {
        "en": ("You now qualify for {scheme}", "Your answers match its rules. Open it to see how to apply."),
        "hi": ("अब आप {scheme} के लिए योग्य हैं", "आपके जवाब इसके नियमों से मेल खाते हैं। आवेदन कैसे करें, देखिए।"),
        "mr": ("आता तुम्ही {scheme} साठी पात्र आहात", "तुमची उत्तरे नियमांशी जुळतात. अर्ज कसा करायचा ते पहा."),
    },
    "jobs": {
        "en": ("{count} new {role} openings near {place}", "Check each one on its site. Never pay money to get a job."),
        "hi": ("{place} के पास {role} की {count} नई नौकरियाँ", "हर एक को उसकी साइट पर जाँचिए। नौकरी के लिए कभी पैसे मत दीजिए।"),
        "mr": ("{place} जवळ {role} च्या {count} नवीन नोकऱ्या", "प्रत्येक त्याच्या साइटवर तपासा. नोकरीसाठी कधीही पैसे देऊ नका."),
    },
    "apprentice": {
        "en": ("{count} new {role} apprenticeships near {place}", "Safe, paid training you can join at your age. Check each one on its site."),
        "hi": ("{place} के पास {role} की {count} नई अप्रेंटिसशिप", "आपकी उम्र में सुरक्षित, पैसे वाली ट्रेनिंग। हर एक को उसकी साइट पर जाँचिए।"),
        "mr": ("{place} जवळ {role} च्या {count} नवीन अप्रेंटिसशिप", "तुमच्या वयात सुरक्षित, मानधन असलेले प्रशिक्षण. प्रत्येक साइटवर तपासा."),
    },
    "skill": {
        "en": ("{count} new scholarships you may get", "Money that needs no work. Check the rules and last date on each official page."),
        "hi": ("{count} नई छात्रवृत्तियाँ जो आपको मिल सकती हैं", "बिना काम के पैसे। हर आधिकारिक पेज पर नियम और आखिरी तारीख देखिए।"),
        "mr": ("{count} नवीन शिष्यवृत्ती ज्या तुम्हाला मिळू शकतात", "काम न करता मिळणारे पैसे. प्रत्येक अधिकृत पानावर नियम आणि शेवटची तारीख पहा."),
    },
}
MONTHS = {
    "en": ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
    "hi": ["जनवरी", "फ़रवरी", "मार्च", "अप्रैल", "मई", "जून", "जुलाई", "अगस्त", "सितंबर", "अक्टूबर", "नवंबर", "दिसंबर"],
    "mr": ["जानेवारी", "फेब्रुवारी", "मार्च", "एप्रिल", "मे", "जून", "जुलै", "ऑगस्ट", "सप्टेंबर", "ऑक्टोबर", "नोव्हेंबर", "डिसेंबर"],
}


def _text(key: str, lang: str, **kw) -> tuple[str, str]:
    title, body = T[key].get(lang if lang in LANGS else "en") or T[key]["en"]
    return title.format(**kw)[:200], body.format(**kw)


def threshold(days: int, marks: tuple[int, ...]) -> int | None:
    """The alert mark this many days falls under (5 days left -> the 7-day alert); None when none applies."""
    if days < 0:
        return None
    for m in sorted(marks):
        if days <= m:
            return m
    return None


def deadline_alerts(steps: list[dict], today: date, lang: str = "en") -> list[dict]:
    out = []
    for s in steps:
        if not s.get("hard_deadline") or is_done(s):
            continue
        d = to_date(s.get("due_date"))
        if not d:
            continue
        left = (d - today).days
        if left == 0:
            title, body = _text("deadline_today", lang, title=s["title"])
            out.append({"key": f"deadline:{s['id']}:0", "kind": "roadmap_deadline", "title": title, "body": body, "link": "/app/plan"})
            continue
        m = threshold(left, DEADLINE_DAYS)
        if m is None:
            continue
        title, body = _text("deadline", lang, title=s["title"], days=left)
        out.append({"key": f"deadline:{s['id']}:{m}", "kind": "roadmap_deadline", "title": title, "body": body, "link": "/app/plan"})
    return out


def exam_alerts(exam: dict, window: str | None, today: date, lang: str = "en") -> list[dict]:
    """`window` is next_window() for the exam: 'YYYY-MM', a typical month, not an announced date."""
    start = to_date(window)
    if not start:
        return []
    left = (start - today).days
    m = threshold(left, EXAM_DAYS)
    if m is None:
        return []
    month = f"{MONTHS.get(lang, MONTHS['en'])[start.month - 1]} {start.year}"
    title, body = _text("exam", lang, exam=exam["name"], month=month)
    return [{"key": f"exam:{exam['slug']}:{window}:{m}", "kind": "roadmap_exam", "title": title, "body": body, "link": f"/app/exams/{exam['slug']}"}]


def scheme_alerts(scheme: dict, result: str | None, today: date, lang: str = "en") -> list[dict]:
    out = []
    d = to_date(scheme.get("deadline"))
    if d:
        left = (d - today).days
        m = threshold(left, DEADLINE_DAYS)
        if m is not None:
            title, body = _text("scheme_deadline", lang, scheme=scheme["name"], days=left)
            out.append({"key": f"scheme:{scheme['slug']}:{d.isoformat()}:{m}", "kind": "roadmap_scheme", "title": title, "body": body,
                        "link": f"/app/money?scheme={scheme['slug']}"})
    if result == "eligible":
        title, body = _text("scheme_eligible", lang, scheme=scheme["name"])
        out.append({"key": f"scheme:{scheme['slug']}:eligible", "kind": "roadmap_scheme", "title": title, "body": body,
                    "link": f"/app/money?scheme={scheme['slug']}"})
    return out


def _words(s: str) -> set[str]:
    return {w for w in re.findall(r"[a-z]+", (s or "").lower()) if len(w) > 2}


def job_matches(items: list[dict], role: str, since=None) -> list[dict]:
    """Stored openings (knowledge_items rows) that name the role and are new since the last check."""
    want = _words(role)
    since_dt = to_dt(since)
    out = []
    for it in items:
        hay = _words(f"{it.get('title', '')} {' '.join(it.get('tags') or [])} {(it.get('data') or {}).get('role', '')}")
        if want and not want & hay:
            continue
        first = to_dt(it.get("first_seen_at"))
        if since_dt and first and first <= since_dt:
            continue
        out.append(it)
    return out


def job_allowed(age, item_kind: str, role: str, can_apprentice: bool, hazardous: bool) -> bool:
    """Law first: adults get jobs and apprenticeships; 14-17 only non-hazardous apprenticeships; under 14 nothing."""
    if not isinstance(age, (int, float)):
        return False  # age unknown: no job alerts until we know
    if age >= 18:
        return True
    return item_kind == "apprenticeship" and can_apprentice and not hazardous


def job_alerts(watch: dict, items: list[dict], facts: dict, today: date, rules: dict, hazardous: bool, lang: str = "en") -> list[dict]:
    """One grouped alert for a watched job search. `rules` is work_rules(age)."""
    q = watch.get("query") or {}
    role, place = q.get("role") or watch.get("ref"), q.get("place") or facts.get("district") or ""
    age = facts.get("age")
    fresh = job_matches(items, role, watch.get("last_checked_at"))
    ok = [it for it in fresh if job_allowed(age, it.get("kind", "job"), role, bool(rules.get("can_apprentice")), hazardous)]
    if not ok:
        return []
    minor = isinstance(age, (int, float)) and age < 18
    title, body = _text("apprentice" if minor else "jobs", lang, count=len(ok), role=role, place=place or "you")
    return [{"key": f"job:{watch['id']}:{today.isoformat()}", "kind": "roadmap_job", "title": title,
             "body": body + " " + " · ".join(it["title"][:60] for it in ok[:2]), "link": "/app/plan?tab=alerts",
             "items": [it.get("id") for it in ok]}]


def skill_alerts(watch: dict, scholarships: list[dict], today: date, lang: str = "en") -> list[dict]:
    since = to_dt(watch.get("last_checked_at"))
    fresh = [it for it in scholarships if not since or ((f := to_dt(it.get("first_seen_at"))) and f > since)]
    if not fresh:
        return []
    title, body = _text("skill", lang, count=len(fresh))
    return [{"key": f"skill:{watch['id']}:{today.isoformat()}", "kind": "roadmap_scholarship", "title": title,
             "body": body + " " + " · ".join(it["title"][:60] for it in fresh[:2]), "link": "/app/money"}]
