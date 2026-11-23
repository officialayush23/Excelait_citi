"""Saathi, the assistant. The model's job is small: pick tools and write one or two short
linking sentences in the student's own language. Everything the student sees in detail comes
back as cards built by deterministic tools, so answers are cheap in tokens and numbers are never
made up.

Fixed code, not the model, decides:
- which language and script to reply in (detected from what the student writes);
- what the student wants (intent) and which facts are needed before any advice;
- one question per turn: after ask_student the turn ends and waits for the answer;
- what the law allows a student of this age (work_rules), and that minors never get job lists
  or hazardous work."""

from __future__ import annotations

import json
import logging
import re
import time
from datetime import date

import httpx

from app.core.config import get_settings
from app.core.db import get_db
from app.engine.matching import rank
from app.services import colleges as col
from app.services import profile_questions as pq
from app.services import community, jobs, partners, plans
from app.services import roadmap as rm
from app.services import scholarships as sch
from app.services import work_rules as wr
from app.services.ai import _fact_schema
from app.services.catalogue import fields
from app.services.graph import (
    career_card,
    exam_card,
    graph,
    program_card,
    resources_for,
    scheme_card,
    scheme_status,
)
from app.services.students import get_facts, merge_facts
from app.services.web_search import web_search

log = logging.getLogger("saathi")
MAX_ROUNDS = 4
HISTORY = 6          # messages the model sees
LOOKBACK = 24        # messages read to find intent, language and the open question

# ---------------------------------------------------------------- language

DEVANAGARI = re.compile(r"[ऀ-ॿ]")
LATIN_WORD = re.compile(r"[a-zA-Z]+")
HI_WORDS = {"है", "हैं", "मैं", "मेरा", "मेरी", "मेरे", "नहीं", "क्या", "मुझे", "और", "के", "लिए", "कक्षा", "हूँ", "हूं", "में", "का", "की",
            "को", "से", "चाहिए", "कैसे", "बनना", "करूँ", "करूं", "सकता", "सकती", "था", "थी", "रहा", "रही", "पैसे", "हम", "आप", "बताइए", "बताओ"}
MR_WORDS = {"आहे", "आहेत", "मी", "माझे", "माझा", "माझी", "नाही", "काय", "मला", "आम्ही", "तुम्ही", "पाहिजे", "करू", "शकतो", "शकते", "आणि",
            "साठी", "इयत्ता", "मध्ये", "शिकते", "शिकतो", "मिळेल", "का", "कसे", "कोणती", "आहोत", "होते", "दिले", "सांगा", "हवे", "हवी", "आठवीत", "दहावीत"}
HINGLISH = {"hai", "hain", "hoon", "hun", "hu", "mera", "meri", "mere", "mujhe", "main", "mein", "kya", "nahi", "nahin", "kaise", "karna",
            "karte", "karta", "karti", "kar", "sakta", "sakti", "sakte", "paise", "paisa", "paison", "ghar", "padhai", "chahiye", "toh", "bhi",
            "aur", "ka", "ki", "ke", "ko", "se", "haan", "ji", "kuch", "bahut", "naam", "saal", "kaam", "naukri", "zaroorat", "kamana",
            "kamane", "honge", "hoga", "thoda", "aata", "ghante", "hafte", "maine", "diya", "batao", "bataiye", "kitna", "kahan", "yahan", "wala"}
MR_LATN = {"aahe", "ahe", "mi", "majha", "majhi", "maza", "mazi", "mala", "kay", "pahije", "karu", "shakto", "shakte", "ani", "sathi",
           "kasa", "kashi", "kuthe", "tumhi", "amhi", "aamhi", "shikto", "shikte", "varsh", "hoy", "nahi", "milel", "sanga", "dila"}
EN_WORDS = {"i", "am", "the", "is", "a", "to", "for", "my", "me", "want", "what", "can", "how", "in", "and", "of", "jobs", "job", "help",
            "find", "show", "career", "careers", "which", "please", "near", "study", "years", "old", "like", "do", "you", "are", "it", "be"}

LANG_RULE = {
    "en": "Reply in simple English.",
    "hinglish": "The student writes Hinglish (Hindi in English letters). Reply ONLY in simple Hinglish written in English "
                "letters, like 'Theek hai Ayush, aapki umar kitni hai?'. No Devanagari script and no full English sentences.",
    "hi": "Reply in simple Hindi, in Devanagari script.",
    "mr": "Reply in simple Marathi, in Devanagari script.",
    "mr_latn": "The student writes Marathi in English letters. Reply in simple Marathi written in English letters, no Devanagari.",
}
FALLBACK_REPLY = {"en": "Here is what I found for you. Tap a card to see more.", "hinglish": "Yeh dekho, aapke liye kya mila. Zyada jaanne ke liye card dabao.",
                  "hi": "आपके लिए यह मिला। ज़्यादा जानने के लिए कार्ड दबाइए।", "mr": "तुमच्यासाठी हे मिळाले. अधिक माहितीसाठी कार्ड दाबा.",
                  "mr_latn": "Tumchyasathi he milale. Adhik mahitisathi card daba."}
ANSWERED = {"en": "I answered. Please continue.", "hinglish": "Maine jawab de diya. Aage batao.",
            "hi": "मैंने जवाब दे दिया। आगे बताइए।", "mr": "मी उत्तर दिले. पुढे सांगा.", "mr_latn": "Mi uttar dila. Pudhe sanga."}
UI_DEFAULT = {"en": "en", "hi": "hi", "mr": "mr"}


def detect_lang(text: str) -> str | None:
    """'en', 'hinglish', 'hi', 'mr', 'mr_latn', or None when the text is too short to tell (e.g. '15')."""
    text = text or ""
    dev = len(DEVANAGARI.findall(text))
    lat = sum(len(w) for w in LATIN_WORD.findall(text))
    if dev == 0 and lat == 0:
        return None
    if dev >= lat:
        toks = set(re.findall(r"[ऀ-ॿ]+", text))
        mr, hi = len(toks & MR_WORDS), len(toks & HI_WORDS)
        if mr == hi:
            return None if len(toks) < 4 else "dev"  # e.g. 'महाराष्ट्र': Devanagari, but Hindi or Marathi?
        return "mr" if mr > hi else "hi"
    toks = [w.lower() for w in LATIN_WORD.findall(text)]
    hg, mr, en = (sum(t in s for t in toks) for s in (HINGLISH, MR_LATN, EN_WORDS))
    if mr > hg and mr >= 2 and mr > en:
        return "mr_latn"
    if hg >= 2 and hg >= en * 0.6:
        return "hinglish"
    if en >= 1 or len(toks) >= 3:
        return "en" if en >= hg else "hinglish"
    return None


def pick_lang(message: str, past_user: list[str], ui_language: str) -> str:
    dev_seen = False
    for t in [message, *reversed(past_user)]:
        got = detect_lang(t)
        if got == "dev" or (got is None and DEVANAGARI.search(t or "")):
            dev_seen = True
            continue
        if got and not (dev_seen and got not in ("hi", "mr")):
            return got
    if dev_seen:
        return ui_language if ui_language in ("hi", "mr") else "hi"
    return UI_DEFAULT.get(ui_language, "en")


def script_of(text: str) -> str:
    dev = len(DEVANAGARI.findall(text or ""))
    lat = sum(len(w) for w in LATIN_WORD.findall(text or ""))
    return "none" if not dev and not lat else ("devanagari" if dev >= lat else "latin")


# ---------------------------------------------------------------- intent and intake

KEYWORDS = {
    "jobs": ["job", "jobs", "naukri", "nokri", "vacancy", "vacancies", "hiring", "openings", "नौकरी", "नोकरी", "रोजगार", "जॉब", "वैकेंसी"],
    "scholarship": ["scholarship", "scholarships", "shishyavrutti", "chhatravritti", "scheme", "schemes", "yojana", "छात्रवृत्ति",
                    "शिष्यवृत्ती", "स्कॉलरशिप", "योजना", "fees help", "fee help", "financial help", "financial support",
                    "can't work", "cannot work", "can not work", "not allowed to work"],
    "earn": ["earn", "earning", "income", "kamana", "kamane", "kamai", "kamaun", "kamau", "paise", "paisa", "paison", "part time",
             "part-time", "कमाना", "कमाई", "कमाने", "पैसे", "पैसा", "कमवायचे", "कमावणे", "कमाई", "पैसे कमव"],
    "colleges": ["college", "colleges", "admission", "कॉलेज", "महाविद्यालय", "प्रवेश", "iti near", "polytechnic"],
    "plan": ["my plan", "plan bana", "roadmap", "मेरा प्लान", "माझा प्लॅन", "plan for"],
    "careers": ["career", "careers", "future", "kya banu", "kya ban", "करियर", "करिअर", "suit me", "what should i become", "बनना", "banna"],
}
# Money that needs no work (scholarships) is matched on class, place and gender; category and family income
# are optional and asked gently on the scholarship card itself.
WEAK_MONEY = ["money", "fees", "fee", "paisa chahiye", "paise chahiye", "पैसे चाहिए", "पैसे हवे", "आर्थिक मदद", "financial"]
REQUIRED = {
    "earn": ["age", "class_level", "district", "state", "gender", "skills", "hours_per_week", "can_travel_km", "has_family_business"],
    "jobs": ["age", "district"],
    "scholarship": ["class_level", "state", "district", "gender"],
    "colleges": ["district", "state"],
    "plan": ["class_level"],
    "careers": ["class_level", "interests"],
    "career_named": ["class_level"],
}
FIELD_HINT = {
    "age": "how old they are (years)", "class_level": "which class / standard or college year they study in",
    "district": "which district or town they live in (and state)", "state": "which state they live in",
    "skills": "what work they can already do or like doing (e.g. sewing, phone repair, computer, farming)",
    "interests": "what they enjoy doing or are good at", "hours_per_week": "how many hours a week they are free after school and on weekends",
    "can_travel_km": "how far from home they can travel for work or training (km)",
    "has_family_business": "whether the family has a shop, farm or small business they can help in",
    "gender": "whether they are a girl or a boy (some scholarships are only for girls)",
}
EXTRA_ASK = ["district", "skills", "interests", "hours_per_week", "can_travel_km", "has_family_business", "needs_income_soon", "can_relocate"]
STATES = ["Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat", "Haryana", "Himachal Pradesh",
          "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha",
          "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal", "Delhi",
          "Jammu and Kashmir", "Ladakh", "Puducherry", "Chandigarh"]
STATE_ALIASES = {"महाराष्ट्र": "Maharashtra", "उत्तर प्रदेश": "Uttar Pradesh", "up": "Uttar Pradesh", "mh": "Maharashtra"}


def _career_named(text: str) -> str | None:
    t = text.lower()
    g = graph()
    for slug, c in g.careers.items():
        names = [c["name"].lower().split(" (")[0], *(v for v in (c.get("name_i18n") or {}).values())]
        for n in names:
            n = n.strip().lower()
            if len(n) >= 4 and n in t:
                return slug
    for word, slug in (("nurse", "staff-nurse"), ("nursing", "staff-nurse"), ("नर्स", "staff-nurse"), ("नर्सिंग", "staff-nurse"),
                       ("teacher", "primary-teacher"), ("doctor", "doctor"), ("police", "police-constable")):
        if word in t and slug in g.careers:
            return slug
    return None


DONE_RE = re.compile(r"\b(i (have )?(finished|completed|done|submitted|applied|passed|watched)|ho gaya|ho gayi|kar liya|kar li|bhar diya|"
                     r"pura kiya|poora kiya)\b|पूरा कर|पूर्ण केल|कर लिया|कर ली|भर दिया|भरला|हो गया|झाले|सबमिट", re.I)


def detect_intent(text: str) -> tuple[str | None, str | None]:
    t = f" {text.lower()} "
    for intent in ("jobs", "scholarship", "earn", "colleges", "plan"):
        if any(re.search(rf"(?<![a-z]){re.escape(k)}(?![a-z])", t) for k in KEYWORDS[intent]):
            return intent, None
    named = _career_named(text)
    if named:
        return "career_named", named
    if any(k in t for k in KEYWORDS["careers"]):
        return "careers", None
    if any(re.search(rf"(?<![a-z]){re.escape(k)}(?![a-z])", t) for k in WEAK_MONEY):
        return "scholarship", None
    return None, None


GIRL = {"girl", "ladki", "beti", "female", "daughter", "मुलगी", "लड़की", "लडकी", "बेटी", "मुलगी आहे"}
BOY = {"boy", "ladka", "beta", "male", "son", "मुलगा", "लड़का", "लडका", "बेटा"}


def gender_in(text: str) -> str | None:
    """The student's own words: 'I am a Class 10 girl' -> 'female'. Nothing is inferred from grammar."""
    words = set(re.findall(r"[a-z]+|[\u0900-\u097F]+", (text or "").lower()))
    g, b = bool(words & GIRL), bool(words & BOY)
    return "female" if g and not b else "male" if b and not g else None


def known(facts: dict, f: str) -> bool:
    if f in ("interests", "skills"):
        return bool(facts.get("interests") or facts.get("skills"))
    if f == "age":
        return facts.get("age") is not None or bool(facts.get("date_of_birth"))
    v = facts.get(f)
    return v is not None and v != "" and v != []


def missing_for(intent: str | None, facts: dict) -> list[str]:
    """Facts still needed before advice, in the intent's own order. The shared question planner
    (profile_questions) drops facts that do not fit this student: no travel distance under 14, no
    free hours for a full-time job seeker, nothing already known from onboarding or the chat."""
    need = list(REQUIRED.get(intent or "", []))
    return [f for f in need if not known(facts, f) and pq.fits(f, facts, intent)]


YOUNG_SKILLS_HINT = ("what they are already good at or enjoy (e.g. helping at a home shop, drawing, explaining lessons to friends, "
                     "fixing simple things at home); never ask a young student about job skills")


def field_hint(f: str, facts: dict, intent: str | None) -> str:
    """How to put the question, fitted to the student (a 15-year-old is not asked about job skills)."""
    if f == "skills" and pq.variant(pq.by_field()["skills"], pq.view(facts, intent)).get("variant") == "young":
        return YOUNG_SKILLS_HINT
    return FIELD_HINT.get(f, f)


def why_text(f: str, facts: dict, intent: str | None, lang: str) -> str | None:
    """The planner's 'we ask this to ...' line in the student's language (English for Latin-script chats)."""
    q = pq.by_field().get(f)
    if not q:
        return None
    why = pq.variant(q, pq.view(facts, intent)).get("why") or {}
    return why.get(lang if lang in ("hi", "mr") else "en") or why.get("en")


DEV_DIGITS = str.maketrans("०१२३४५६७८९", "0123456789")
YES = {"yes", "haan", "ha", "han", "hoy", "ho", "ji", "हाँ", "हां", "होय", "हो", "ہاں", "y"}
NO = {"no", "nahi", "nahin", "nai", "nako", "नहीं", "नाही", "नही", "n"}


def parse_answer(field: str, text: str):
    """Plain answers to the open question, read without the model ('15', '15 saal', 'nahi')."""
    t = text.translate(DEV_DIGITS).lower().strip()
    nums = [int(x) for x in re.findall(r"\d+", t)]
    words = set(re.findall(r"[\wऀ-ॿ]+", t))
    if field == "age" and nums and 8 <= nums[0] <= 40:
        return nums[0]
    if field == "class_level" and nums and 5 <= nums[0] <= 16:
        return nums[0]
    if field == "hours_per_week" and nums:
        n = nums[0]
        per_day = words & {"din", "roz", "daily", "day", "दिन", "रोज", "दिवसाला", "रोज़"}
        return min(n * 7, 70) if per_day and n <= 12 else min(n, 80)
    if field == "can_travel_km":
        if nums:
            return min(nums[0], 200)
        if words & NO:
            return 0
    if field in ("has_family_business", "needs_income_soon", "can_relocate"):
        if words & NO and not words & YES:
            return False
        if words & YES and not words & NO:
            return True
    if field == "gender":
        return gender_in(t)
    if field in ("state", "district"):
        out: dict = {}
        rest = t
        for s in STATES:
            if s.lower() in t:
                out["state"], rest = s, rest.replace(s.lower(), " ")
                break
        else:
            for k, s in STATE_ALIASES.items():
                if k in words:
                    out["state"], rest = s, re.sub(rf"(?<!\w){re.escape(k)}(?!\w)", " ", rest)
                    break
        if field == "district":
            left = [w for w in re.findall(r"[a-z\u0900-\u097F]+", rest) if w not in DISTRICT_FILLER]
            if 1 <= len(left) <= 3:
                out["district"] = " ".join(left).title()
        return out or None
    return None


PLACE_RE = re.compile(r"\b(?:near|in|around|at|from)\s+([A-Z][a-z]{2,}(?:\s[A-Z][a-z]{2,})?)|\b([A-Z][a-z]{2,})\s+(?:mein|ke paas|ke pass|ke aaspaas|madhe|javal)\b")
NOT_PLACES = {"Class", "School", "College", "English", "Hindi", "Marathi", "India", "Iti", "The", "Standard", "Show", "Ghar", "Main", "Mujhe"}


def place_in(text: str) -> dict | None:
    """'jobs near Pune' / 'Pune mein naukri' -> {'district': 'Pune'} (plus the state when named)."""
    out: dict = {}
    for s in STATES:
        if re.search(rf"\b{re.escape(s)}\b", text, re.IGNORECASE):
            out["state"] = s
            break
    found = list(PLACE_RE.finditer(text))
    found.sort(key=lambda m: m.group(1) is None)  # 'near Pune' beats 'Pune mein'
    for m in found:
        name = (m.group(1) or m.group(2) or "").strip()
        if name and name.split()[0] not in NOT_PLACES and name != out.get("state"):
            out["district"] = name
            break
    return out if "district" in out else None


DISTRICT_FILLER = {"main", "mein", "me", "se", "hoon", "hun", "hu", "rehta", "rehti", "rahta", "rahti", "district", "jilla", "zilla",
                   "i", "live", "in", "am", "from", "my", "is", "near", "ka", "ki", "ke", "mi", "rahto", "rahte", "aahe", "ahe", "state",
                   "मैं", "में", "से", "हूँ", "हूं", "रहता", "रहती", "जिला", "जिल्हा", "मी", "राहतो", "राहते", "आहे", "का", "की",
                   "the", "village", "gaon", "gav", "गाँव", "गाव", "and", "aur"}


SKILL_TAGS = [
    (("phone", "mobile", "फोन", "मोबाइल", "मोबाईल"), ["hands_on", "computers", "electricity"]),
    (("computer", "laptop", "typing", "कंप्यूटर", "संगणक"), ["computers"]),
    (("sil", "sew", "tailor", "stitch", "सिलाई", "शिलाई"), ["fashion", "hands_on"]),
    (("cook", "khana", "food", "खाना", "स्वयंपाक"), ["food"]),
    (("draw", "paint", "art", "mehndi", "चित्र"), ["art", "creative"]),
    (("teach", "tuition", "padha", "पढ़ा", "शिकव"), ["teaching", "helping"]),
    (("farm", "kheti", "kisan", "खेती", "शेती"), ["nature", "outdoors"]),
    (("cow", "buffalo", "dairy", "गाय", "म्हैस"), ["animals", "nature"]),
    (("repair", "fix", "machine", "मरम्मत", "दुरुस्ती"), ["hands_on", "machines"]),
    (("shop", "dukan", "sell", "दुकान", "business"), ["business", "talking"]),
    (("wire", "bijli", "electric", "बिजली", "वीज"), ["electricity", "hands_on"]),
    (("video", "photo", "youtube", "camera"), ["creative", "computers"]),
    (("sport", "khel", "खेल", "run"), ["sports"]),
]


def skill_tags(skills: list[str] | None) -> list[str]:
    out: list[str] = []
    for s in skills or []:
        s = str(s).lower()
        for keys, tags in SKILL_TAGS:
            if any(k in s for k in keys):
                out += tags
    return list(dict.fromkeys(out))


HAZARD_WORDS = ["driver", "driving", "drive", "mason", "construction", "welder", "welding", "garage", "mechanic", "plumber", "carpenter",
                "electrician", "wiring", "factory", "delivery", "dhaba", "hotel", "kiln", "ड्राइवर", "ड्रायव्हर", "राजमिस्त्री", "गवंडी",
                "वेल्डिंग", "मिस्त्री", "बांधकाम", "निर्माण", "गैराज", "गॅरेज", "इलेक्ट्रीशियन", "प्लंबर", "डिलीवरी", "डिलिव्हरी",
                "ढाबा", "होटल", "हॉटेल", "फ़ैक्टरी", "कारखाना"]
AFTER_18 = re.compile(r"18|१८|athara|atharah|aṭhāra|अठारह|अठरा|adult|baad mein|later", re.IGNORECASE)


def hazard_issue(reply: str) -> str | None:
    for sent in re.split(r"(?<=[.!?।])\s+|\n", reply or ""):
        low = sent.lower()
        hit = next((w for w in HAZARD_WORDS if w in low), None)
        if hit and not AFTER_18.search(sent):
            return hit
    return None


def number_issue(reply: str, evidence: str) -> list[str]:
    nums = re.findall(r"\d[\d,]*", (reply or "").translate(DEV_DIGITS))
    ev = evidence.translate(DEV_DIGITS).replace(",", "")
    allowed = {"1", "2", "3", "14", "15", "18"}
    return [n for n in nums if n.replace(",", "") not in ev and n not in allowed]


# ---------------------------------------------------------------- prompt and tools

SYSTEM = """You are Saathi, a guide for rural Indian students (Class 8 to graduation; many are minors and first in their family to study).
LANGUAGE: {lang_rule}
The app shows cards from your tool calls. Your own text: at most 2 short sentences that connect the cards or say the next step. Never repeat a card.
Use tools for every fact. Never decide eligibility yourself (check_money does). Never invent or describe job openings; only find_jobs lists jobs.
Never write a number, amount, date, company or website that is not in a tool result or the student's own words.
Education comes first: for a student still in school or college, their studies, next class and exams come before career or work talk.
When the student says they finished something on their plan, call update_roadmap with action done. Don't start a new career roadmap unless they ask for one.
{age_rule}
Today is {today}. Student facts: {facts}.{care}
NOW: {step}"""

TOOLS_SPEC = [
    ("find_careers", "Rank careers for this student (needs interests or skills).", {"can_relocate": {"type": "boolean"}, "needs_income_soon": {"type": "boolean"}, "query": {"type": "string", "description": "words to filter by, e.g. 'nursing'"}}),
    ("career_details", "Full view of one career: courses, exams, money, resources.", {"slug": {"type": "string"}}),
    ("course_details", "One course/training: entry, duration, exams, money, careers.", {"slug": {"type": "string"}}),
    ("exam_details", "One entrance or recruitment exam: when, who can sit.", {"slug": {"type": "string"}}),
    ("check_money", "Scholarships/schemes for this student, checked with fixed rules. Optionally one scheme.", {"slug": {"type": "string"}}),
    ("find_scholarships", "More private, CSR and government scholarships found on Buddy4Study and official portals, matched to the student (shows the card).", {}),
    ("find_colleges", "Colleges/ITIs from the official directory.", {"kind": {"type": "string", "enum": ["iti", "polytechnic", "engineering", "nursing", "medical", "pharmacy", "paramedical", "agriculture", "veterinary", "teacher_training", "law", "hotel", "general"]}, "district": {"type": "string"}, "state": {"type": "string"}, "name": {"type": "string"}}),
    ("learning_resources", "Free learning resources for a career, course or exam.", {"career": {"type": "string"}, "course": {"type": "string"}, "exam": {"type": "string"}}),
    ("opportunities", "Internships, trainings and courses from verified partners.", {"kind": {"type": "string"}, "career": {"type": "string"}}),
    ("find_jobs", "Current job (18+) or apprenticeship openings from reputed job sites, with links.", {"role": {"type": "string", "description": "trade or job title in English, e.g. 'electrician'"}, "place": {"type": "string", "description": "city or district"}, "part_time": {"type": "boolean"}, "apprenticeship": {"type": "boolean"}}),
    ("work_rules", "What the law allows for this student's age (shows the law card).", {}),
    ("community", "Community questions and stories, or seniors on a path.", {"query": {"type": "string"}, "career": {"type": "string"}, "seniors": {"type": "boolean"}}),
    ("my_plan", "The student's saved careers and plans.", {}),
    ("my_roadmap", "The student's roadmap: next step, % done, fixed dates close, what changed for them (shows the card).", {}),
    ("update_roadmap", "Change the roadmap from what the student said: mark a step done when they say they finished it, add a goal (career, exam, scheme, own goal with a date), "
                       "watch a job search / exam / scheme for alerts, or make the next steps smaller.",
     {"action": {"type": "string", "enum": ["add_goal", "watch", "easier", "done"]},
      "step": {"type": "string", "description": "for done: what the student says they finished, in their words"},
      "goal": {"type": "string", "enum": ["career", "exam", "scheme", "custom"]},
      "career": {"type": "string"}, "exam": {"type": "string"}, "scheme": {"type": "string"},
      "title": {"type": "string", "description": "own goal in the student's words, e.g. 'earn 8000 a month'"},
      "target_date": {"type": "string", "description": "YYYY-MM-DD, only a date the student said"},
      "watch": {"type": "string", "enum": ["job", "exam", "scheme"]}, "role": {"type": "string"}, "place": {"type": "string"}}),
    ("make_plan", "Create a dated step-by-step plan for a career (saves it).", {"career": {"type": "string"}, "course": {"type": "string"}}),
    ("save_career", "Save or unsave a career.", {"career": {"type": "string"}, "save": {"type": "boolean"}}),
    ("web_search", "Live web search for fresh facts (dates, notices). Returns sources.", {"query": {"type": "string"}}),
]


BASIC_FACTS = ["age", "class_level", "course", "district", "state", "gender", "skills", "interests", "subjects", "needs_income_soon"]


def _save_schema(only: list[str] | None = None) -> dict:
    s = _fact_schema()
    s["properties"].update({
        "district": {"type": "string"}, "age": {"type": "number"},
        "skills": {"type": "array", "items": {"type": "string"}, "description": "what they can already do, short English words"},
        "hours_per_week": {"type": "number"}, "can_travel_km": {"type": "number"}, "has_family_business": {"type": "boolean"},
    })
    if only:  # a small schema keeps intake turns cheap
        keep = set(only) | set(BASIC_FACTS)
        s["properties"] = {k: v for k, v in s["properties"].items() if k in keep}
    return s


def _askable() -> list[str]:
    return [*fields().keys(), *EXTRA_ASK]


def _ask_tool(only: str | None = None) -> dict:
    # The enum always lists every askable field: Groq rejects the whole request (400) when the model picks a
    # field outside the enum, so the preferred field is a hint in the description, not a hard limit.
    hint = f" Ask about '{only}' now." if only else ""
    return {"type": "function", "function": {
        "name": "ask_student", "description": "Ask the student ONE question about one missing fact. Ends your turn." + hint,
        "parameters": {"type": "object", "properties": {
            "field": {"type": "string", "enum": _askable() if not only or only in _askable() else [only, *_askable()]},
            "question": {"type": "string", "description": "the question, short, in the student's language and script"}},
            "required": ["field", "question"]}}}


def _save_tool(only: list[str] | None = None) -> dict:
    return {"type": "function", "function": {"name": "save_facts", "description": "Save facts the student clearly stated.",
                                             "parameters": {"type": "object", "properties": {"facts": _save_schema(only)}, "required": ["facts"]}}}


def _tools(phase: str = "answer", next_field: str | None = None, need: list[str] | None = None) -> list[dict]:
    """Intake: only save_facts and ask_student (for the one next fact). Answer: the fact tools, no new questions
    (cards such as the scholarship card ask for what they still need)."""
    if phase == "intake":
        return [_save_tool(need), _ask_tool(next_field)]
    out = [{"type": "function", "function": {"name": n, "description": d, "parameters": {"type": "object", "properties": p}}} for n, d, p in TOOLS_SPEC]
    # ask_student stays available: models sometimes ask anyway (e.g. after "hi"), and Groq rejects a call to a
    # tool that was not offered. The handler still enforces one question per turn and skips known facts.
    return [*out, _save_tool(), _ask_tool(None)]


def _slug(kind: str, value: str | None) -> str | None:
    """Accept a slug or a name and return the slug."""
    if not value:
        return None
    g = graph()
    table = {"career": g.careers, "program": g.programs, "exam": g.exams, "scheme": g.schemes}[kind]
    v = value.strip().lower()
    if v in table:
        return v
    for slug, row in table.items():
        names = [row["name"].lower(), *(x.lower() for x in (row.get("name_i18n") or {}).values())]
        if any(v in n for n in names) or v.replace(" ", "-") in slug:
            return slug
    words = [w for w in v.replace("-", " ").split() if len(w) > 3]
    for slug, row in table.items():
        if words and all(w in row["name"].lower() or w in slug for w in words):
            return slug
    return None


# ---------------------------------------------------------------- tools

class Ctx:
    def __init__(self, user_id: str, roles: set[str]):
        self.user_id, self.roles = user_id, roles
        self.facts = get_facts(user_id)
        self.cards: list[dict] = []
        self.asked_before: set[str] = set()
        self.lang = "en"
        self.intent: str | None = None
        self.missing: list[str] = []
        self.shown: set[str] = set()   # card types already shown in this thread
        self.asked = False
        self.message = ""              # the student's words this turn: kept as the note on facts saved from it
        self.saved_facts = False
        self.care = ""                 # how to speak this turn, from the roadmap's tone

    @property
    def age(self):
        return self.facts.get("age")

    def seen(self, kind: str) -> bool:
        return kind in self.shown or any(c["type"] == kind for c in self.cards)

    def seen_now(self, kind: str) -> bool:
        return any(c["type"] == kind for c in self.cards)


GATED = {"find_careers", "find_jobs", "opportunities", "make_plan", "update_roadmap"}


def _sources(slug: str) -> dict:
    m = wr.career_meta().get(slug, {})
    return {"sources": [{k: s.get(k) for k in ("title", "url", "site")} for s in (m.get("sources") or [])[:3]], "checked_on": m.get("checked_on")}


def _law_card(ctx: Ctx) -> str:
    if not ctx.seen("law"):
        ctx.cards.append({"type": "law", **wr.work_rules(ctx.age)})
    return wr.summary(ctx.age)


def run_tool(ctx: Ctx, name: str, a: dict) -> str:
    """Runs one tool, appends a card for the app, returns a compact summary for the model."""
    g = graph()
    if name in GATED and ctx.missing:
        return f"need: {ctx.missing[0]} first; call ask_student"
    if name == "work_rules":
        return _law_card(ctx) if ctx.age is not None else "need: age"
    if name == "find_careers":
        interests = list(dict.fromkeys([*(ctx.facts.get("interests") or []), *skill_tags(ctx.facts.get("skills"))]))
        if not interests:  # fall back to what the student said in this chat ("phone repair aata hai")
            said = next((t for t in [getattr(ctx, "message", ""), *reversed(getattr(ctx, "past_user", []))] if skill_tags([t])), None)
            if said:
                _save(ctx, {"skills": [said.strip()[:80]]})  # kept in their own words, shown on the profile
                interests = skill_tags([said])
        if not interests:
            return "need: interests (ask what they enjoy or can do); no ranking without them"
        minor = wr.is_minor(ctx.age)
        if minor and ctx.intent == "earn" and not ctx.seen("schemes"):
            return "first call check_money (money that needs no work), then find_careers"
        wi = {k: a[k] for k in ("can_relocate", "needs_income_soon") if k in a}
        pool = list(g.careers.values())
        if minor and ctx.intent in ("earn", "jobs"):
            pool = [c for c in pool if wr.career_age_status(c["slug"], ctx.age) == "now"]
        if a.get("query"):
            q = a["query"].lower()
            pool = [c for c in pool if q in c["name"].lower() or q in c["category"] or any(q in t for t in c["interest_tags"])] or pool
        ms = rank(pool, {**ctx.facts, "interests": interests, **wi}, 6)
        items = [{"slug": m.slug, "score": m.score, "reasons": m.reasons, "gaps": m.gaps,
                  "age_status": wr.career_age_status(m.slug, ctx.age), **_sources(m.slug),
                  **{k: g.careers[m.slug][k] for k in ("name", "name_i18n", "category", "pay_min", "pay_max", "earning_speed")}} for m in ms]
        if minor:  # paths a minor can start now come first; the rest are 'after 18'
            items.sort(key=lambda i: i["age_status"] != "now")
        ctx.cards.append({"type": "careers", "what_if": wi, "items": items, "minor": minor})
        return "; ".join(f"{i['name']} [{i['slug']}]{'' if i['age_status'] == 'now' else ' (' + i['age_status'].replace('_', ' ') + ')'}" for i in items)
    if name == "career_details":
        s = _slug("career", a.get("slug"))
        card = career_card(s, ctx.facts) if s else None
        if not card:
            return "not found"
        st = wr.career_age_status(s, ctx.age)
        ctx.cards.append({"type": "career", "saved": s in plans.saved(ctx.user_id), "age_status": st, **_sources(s), **card})
        return (f"{s}{'' if st == 'now' else ' (' + st.replace('_', ' ') + ')'}: path {card['path']}; courses {[p['name'] for p in card['programs']]}; "
                f"money eligible {[x['slug'] for x in card['schemes'] if x['result'] == 'eligible']}")
    if name == "course_details":
        s = _slug("program", a.get("slug"))
        card = program_card(s, ctx.facts) if s else None
        if not card:
            return "not found"
        ctx.cards.append({"type": "program", **card})
        return f"{s}: {card['duration_months']} months, entry {card['entry']}"
    if name == "exam_details":
        s = _slug("exam", a.get("slug"))
        card = exam_card(s) if s else None
        if not card:
            return "not found"
        ctx.cards.append({"type": "exam", **card})
        return f"{s}: next around {card['next']}"
    if name == "check_money":
        if a.get("slug"):
            s = _slug("scheme", a["slug"])
            card = scheme_card(s, ctx.facts) if s else None
            if not card:
                return "not found"
            ctx.cards.append({"type": "scheme", **card})
            return f"{s}: {card['result']}, missing {card['missing']}"
        if ctx.seen("schemes"):
            return "already shown"
        checks = [scheme_status(x, ctx.facts) for x in g.schemes]
        checks = [c for c in checks if c and c["result"] != "not_eligible"]
        checks.sort(key=lambda c: (c["result"] != "eligible", len(c["missing"])))
        rupees = sum(c["benefit_amount"] or 0 for c in checks if c["result"] == "eligible")
        ctx.cards.append({"type": "schemes", "rupees": rupees, "items": checks[:8]})
        def kinds(result: str, scholarship: bool) -> list[str]:
            return [f"{c['slug']} ({g.schemes[c['slug']]['kind']})" for c in checks if c["result"] == result and (g.schemes[c["slug"]]["kind"] == "scholarship") == scholarship]
        return (f"scholarships eligible {kinds('eligible', True)}; scholarships needing answers on the card {kinds('needs_info', True)[:4]}; "
                f"training/apprenticeship/other schemes eligible {kinds('eligible', False)} (these are not free money: training or paid work-training)")
    if name == "find_scholarships":
        if ctx.seen("scholarships"):
            return "already shown"
        res = sch.discover(ctx.facts)
        ctx.cards.append({"type": "scholarships", **{k: res[k] for k in ("found", "counts", "ask", "checked_on", "sites", "from_store")}})
        return sch.compact(res)
    if name == "find_colleges":
        state = a.get("state") or ctx.facts.get("state")
        items = col.search(a.get("kind"), None if state == "Other" else state, a.get("district") or ctx.facts.get("district"), a.get("name"))
        total = col.count()
        ctx.cards.append({"type": "colleges", "query": {**a, "state": state}, "items": items, "directory_loaded": total > 0})
        return f"{len(items)} found" if total else "college directory not loaded yet; suggest web_search"
    if name == "learning_resources":
        c, p, e = _slug("career", a.get("career")), _slug("program", a.get("course")), _slug("exam", a.get("exam"))
        cats = [g.careers[c]["category"]] if c else []
        items = resources_for([c] if c else [], [p] if p else [], [e] if e else [], cats, limit=6)
        ctx.cards.append({"type": "resources", "items": items})
        return ", ".join(r["slug"] for r in items) or "none"
    if name == "opportunities":
        items = partners.offers_for_student(ctx.facts, a.get("kind"), _slug("career", a.get("career")), 8)
        if wr.is_minor(ctx.age):
            items = [o for o in items if o.get("kind") != "job"]
        ctx.cards.append({"type": "offers", "items": items})
        return f"{len(items)} open"
    if name == "find_jobs":
        if any(c["type"] == "jobs" for c in ctx.cards):
            return "already shown this turn; write your reply now"
        return _find_jobs(ctx, a)
    if name == "community":
        if a.get("seniors"):
            items = community.seniors(_slug("career", a.get("career")), a.get("query"))
            ctx.cards.append({"type": "seniors", "items": items})
            return f"{len(items)} seniors"
        items = community.feed(ctx.facts, career=_slug("career", a.get("career")), q=a.get("query"), limit=6)
        ctx.cards.append({"type": "posts", "items": items})
        return f"{len(items)} posts"
    if name == "my_plan":
        data = {"saved": plans.saved(ctx.user_id), "plans": plans.list_plans(ctx.user_id)}
        ctx.cards.append({"type": "my_plan", **data})
        return f"saved {data['saved']}; plans {[p['career_slug'] for p in data['plans']]}"
    if name == "make_plan":
        s = _slug("career", a.get("career"))
        if not s:
            return "unknown career"
        if _has_career_goal(ctx, other_than=s) and not _asks_new_plan(ctx.message):
            return "the student already has a career roadmap; show it with my_roadmap instead of starting another"
        plan = plans.create_plan(ctx.user_id, s, _slug("program", a.get("course")), source="saathi")
        ctx.cards.append({"type": "plan", **plan})
        return f"plan with {len(plan['steps'])} steps (added to the roadmap)"
    if name == "my_roadmap":
        if ctx.seen_now("roadmap"):
            return "already shown"
        card, line = rm.card(ctx.user_id)
        ctx.cards.append(card)
        return line
    if name == "update_roadmap":
        return _update_roadmap(ctx, a)
    if name == "save_career":
        s = _slug("career", a.get("career"))
        if not s:
            return "unknown career"
        saved = plans.save_career(ctx.user_id, s, a.get("save", True))
        ctx.cards.append({"type": "my_plan", "saved": saved, "plans": plans.list_plans(ctx.user_id)})
        return f"saved {saved}"
    if name == "web_search":
        res = web_search(a.get("query", ""))
        ctx.cards.append({"type": "web", **res})
        return " | ".join(f"{r['title'][:70]} ({r['url'].split('/')[2] if r['url'].startswith('http') else 'web'}): {r['snippet'][:140]}" for r in res["results"][:4])
    if name == "ask_student":
        if ctx.asked:
            return "only one question per turn"
        f = a.get("field")
        if f not in _askable():
            return "unknown field"
        if ctx.intent in REQUIRED and known(ctx.facts, f):
            return f"already known; ask about {ctx.missing[0]}" if ctx.missing else "all needed facts known; answer with tools now"
        ctx.asked = True
        ctx.cards.append({"type": "question", "field": f, "question": (a.get("question") or "").strip()[:200] or None,
                          "lang": ctx.lang, "answered": ANSWERED.get(ctx.lang, ANSWERED["en"]),
                          "why": why_text(f, ctx.facts, ctx.intent, ctx.lang)})
        return "question shown; stop now"
    if name == "save_facts":
        return _save(ctx, a.get("facts") or {})
    return "unknown tool"


NEW_PLAN_WORDS = ("plan", "roadmap", "another", "new", "instead", "switch", "change", "different", "योजना", "प्लान",
                  "रोडमैप", "बदल", "दूसरा", "दूसरी", "नया", "नवीन", "दुसरा", "बदला")


def _asks_new_plan(message: str) -> bool:
    m = (message or "").lower()
    return any(w in m for w in NEW_PLAN_WORDS)


def _has_career_goal(ctx: Ctx, other_than: str | None = None) -> bool:
    """One career roadmap at a time: Saathi doesn't start more unless the student asks."""
    try:
        r = rm.get_roadmap(ctx.user_id, evaluate_first=False)
    except Exception:  # noqa: BLE001
        return False
    return any(g["status"] == "active" and g["kind"] == "career" and g.get("career_slug") != other_than for g in r["goals"])


def _update_roadmap(ctx: Ctx, a: dict) -> str:
    """Saathi's changes to the roadmap. Fixed rules still decide dates and what a minor may be alerted about."""
    act = a.get("action")
    try:
        if act == "easier":
            rm.ease(ctx.user_id)
        elif act == "watch":
            kind = a.get("watch") or ("job" if a.get("role") else "exam" if a.get("exam") else "scheme")
            ref = _slug(kind, a.get(kind)) if kind in ("exam", "scheme") else None
            if kind in ("exam", "scheme") and not ref:
                return f"unknown {kind}"
            res = rm.add_watch(ctx.user_id, kind, ref, {"role": a.get("role"), "place": a.get("place")} if kind == "job" else None)
            if res["converted"] == "skill":
                return "student is under 18: no job alerts by law; watching scholarships and free skill training instead"
            if res["converted"] == "apprenticeship":
                return "student is under 18: watching safe apprenticeships only"
        elif act == "done":
            st = rm.match_step(ctx.user_id, a.get("step") or ctx.message)
            if not st:
                return "no open step matches; ask which step they finished"
            rm.update_step(ctx.user_id, st["id"], status="done")
        elif act == "add_goal":
            kind = a.get("goal") or ("career" if a.get("career") else "exam" if a.get("exam") else "scheme" if a.get("scheme") else "custom")
            if kind == "career" and _has_career_goal(ctx) and not _asks_new_plan(ctx.message):
                return "the student already has a career roadmap; don't add another unless they ask for a new or different plan"
            if kind == "career":
                s = _slug("career", a.get("career"))
                if not s:
                    return "unknown career"
                rm.add_goal(ctx.user_id, "career", career=s, source="saathi")
            elif kind in ("exam", "scheme"):
                s = _slug(kind, a.get(kind))
                if not s:
                    return f"unknown {kind}"
                rm.add_goal(ctx.user_id, kind, **{kind: s}, target_date=a.get("target_date"), source="saathi")
            else:
                rm.add_goal(ctx.user_id, "custom", title=a.get("title"), target_date=a.get("target_date"), source="saathi")
        else:
            return "unknown action"
    except (ValueError, LookupError) as e:
        return f"not changed: {e}"
    card, line = rm.card(ctx.user_id)
    ctx.cards = [c for c in ctx.cards if c["type"] != "roadmap"] + [card]
    return "done; " + line


NUMERIC = {"age", "class_level", "hours_per_week", "can_travel_km", "marks_percent", "family_income_annual"}


def _save(ctx: Ctx, facts: dict) -> str:
    clean: dict = {}
    for k, v in facts.items():
        if k in NUMERIC and isinstance(v, str):
            m = re.search(r"\d+(\.\d+)?", v.translate(DEV_DIGITS))
            v = float(m.group()) if m else None
            v = int(v) if v is not None and v == int(v) else v
        if k == "state" and isinstance(v, str) and v not in (fields().get("state", {}).get("options") or [v]):
            v = "Other"
        if k == "skills" and isinstance(v, list):
            v = list(dict.fromkeys([*(ctx.facts.get("skills") or []), *[str(x)[:40] for x in v]]))[:10]
        if v is not None and v != "":
            clean[k] = v
    if not clean:
        return "nothing to save"
    ctx.facts = merge_facts(ctx.user_id, clean, source="saathi", note=ctx.message)
    ctx.saved_facts = True
    ctx.missing = [f for f in missing_for(ctx.intent, ctx.facts) if f not in getattr(ctx, "asked_before", set())]
    return "saved " + ", ".join(clean) + (f"; still need {ctx.missing[0]}" if ctx.missing else "; all needed facts known")


def _find_jobs(ctx: Ctx, a: dict) -> str:
    age = ctx.age
    if age is None:
        return "need: age"
    role = (a.get("role") or (ctx.facts.get("skills") or [""])[0] or "").strip()
    place = (a.get("place") or ctx.facts.get("district") or "").strip()
    if not role:
        return "need: which work (skills)"
    if not place:
        return "need: district"
    apprentice = bool(a.get("apprenticeship"))
    if wr.is_minor(age):
        law = _law_card(ctx)
        if age < 14:
            return f"no jobs or apprenticeships under 14 by law; {law}"
        slug = _slug("career", role)
        if slug and wr.career_age_status(slug, age) != "now":
            return f"{role} is hazardous / not allowed before 18; suggest skill training now and this work after 18"
        apprentice = True
    res = jobs.find_jobs(role, place, ctx.facts.get("state"), apprenticeship_only=apprentice, part_time=bool(a.get("part_time")))
    ctx.cards.append({"type": "jobs", **res, "minor": wr.is_minor(age)})
    out = jobs.compact(res)
    if not wr.is_minor(age):
        out += _rights_card(ctx)
    return out


def _rights_card(ctx: Ctx) -> str:
    """An adult looking at jobs also sees their rights at work (wages, hours, no fee for a job, where to complain)."""
    rights = getattr(wr, "employment_rights", None)
    if rights is None or ctx.seen("rights"):
        return ""
    try:
        card = rights(ctx.age, ctx.facts.get("state"), ctx.lang if ctx.lang in ("hi", "mr") else "en")
    except Exception as e:  # noqa: BLE001 - the jobs card still stands without it
        log.warning("employment_rights failed: %s", e)
        return ""
    ctx.cards.append({"type": "rights", **card})
    return "; rights-at-work card shown (wages, hours, never pay a fee for a job)"


# ---------------------------------------------------------------- model calls

FALLBACK_MODEL = "openai/gpt-oss-20b"


def _llm(messages: list[dict], tools: list[dict] | None, tool_choice=None, max_tokens: int = 600) -> dict:
    """Main model first; on a rate limit wait briefly once, then use the smaller model."""
    s = get_settings()
    body = {"messages": messages, "temperature": 0.2, "reasoning_effort": "low", "max_completion_tokens": max_tokens}
    if tools:
        body["tools"] = tools
        if tool_choice:
            body["tool_choice"] = tool_choice
    attempts = [(s.llm_model, 0), (s.llm_model, 2.0), (FALLBACK_MODEL, 0)]
    r = None
    for model, wait in attempts:
        if wait:
            time.sleep(wait)
        r = httpx.post(f"{s.llm_base_url}/chat/completions", timeout=60, headers={"Authorization": f"Bearer {s.groq_api_key}"},
                       json={**body, "model": model})
        if r.status_code == 400 and "tool" in r.text:
            # The model produced an invalid tool call (e.g. a tool it was not given); try again, without forcing.
            log.warning("llm 400: %s", r.text[:300])
            body.pop("tool_choice", None) if body.get("tool_choice") == "required" else None
            continue
        if r.status_code != 429:
            r.raise_for_status()
            return r.json()
        try:
            time.sleep(min(float(r.headers.get("retry-after") or 3), 12))
        except ValueError:
            time.sleep(3)
    if r is not None and r.status_code == 400 and "tool" in r.text and tools:
        # Still an invalid tool call after retries: answer in plain words rather than failing the chat.
        log.warning("llm 400 after retries; answering without tools")
        return _llm(messages, None, None, max_tokens)
    r.raise_for_status()
    return r.json()


def _thread(user_id: str, thread_id: str | None, first: str) -> str:
    db = get_db()
    if thread_id:
        ok = db.table("assistant_threads").select("id").eq("id", thread_id).eq("user_id", user_id).execute().data
        if ok:
            return thread_id
    return db.table("assistant_threads").insert({"user_id": user_id, "title": first[:80]}).execute().data[0]["id"]


def _age_rule(ctx: Ctx) -> str:
    if ctx.age is None:
        return "Age unknown: never suggest any paid job until age is known."
    if wr.is_minor(ctx.age):
        return (f"The student is {ctx.age}, a minor. Law: {wr.summary(ctx.age)}. Never suggest driving, delivery, construction/mason, "
                "welding, garages, electrical or factory work or any job now; such careers are only 'after 18'.")
    return f"The student is {ctx.age} (adult)."


def _step(ctx: Ctx, named: str | None, first: bool = False) -> str:
    if ctx.missing:
        f = ctx.missing[0]
        known_now = [k for k in REQUIRED.get(ctx.intent or "", []) if k not in ctx.missing]
        return (f"Intent: {ctx.intent}. Before any advice you need: {', '.join(ctx.missing)}. First save any fact the student just "
                f"stated with save_facts (known: {', '.join(known_now) or 'none'}). Then call ask_student once, field '{f}' "
                f"({field_hint(f, ctx.facts, ctx.intent)}), with a short friendly question in the student's language"
                + (" that starts with one warm line saying you will help, then the question" if first else "") + ". No advice, lists or other questions yet.")
    minor, age = wr.is_minor(ctx.age), ctx.age
    if ctx.intent == "earn":
        if minor:
            extra = " and opportunities(kind='training')" if age >= 14 else ""
            fam = "they can help the family business after school (unpaid, safe work only), " if ctx.facts.get("has_family_business") else ""
            return ("All facts known. Call check_money first (money that needs no work), then find_careers(needs_income_soon=true)"
                    f"{extra}. Then in 1-2 sentences: scholarships first, then {fam}free skill training now so they can earn safely at 18.")
        return "All facts known. Call check_money, then find_jobs(role from their skills, part_time=true), then find_careers(needs_income_soon=true)."
    if ctx.intent == "jobs":
        if minor:
            return "Student is under 18: no job listings. The law card is shown. Call find_jobs(role, apprenticeship=true) only if age is 14+, and find_careers."
        return "Call find_jobs(role, place) for the work they asked about. Then one sentence: check each listing on the site, never pay to get a job."
    if ctx.intent == "scholarship":
        return "Call check_money, then find_scholarships. Then one sentence on the next step."
    if ctx.intent == "colleges":
        return "Call find_colleges for the course they want near their district."
    if ctx.intent == "careers":
        return "Call find_careers. Then one sentence on how to choose."
    if ctx.intent == "career_named":
        return f"Call career_details(slug='{named}'), and check_money if they need money. Then one sentence on the first step."
    if ctx.intent == "plan":
        return "Call my_roadmap, or make_plan if they named a career; update_roadmap for a new goal, a watch or smaller steps."
    return "Answer with the right tools. If a fact you need is missing, call ask_student once."


def _primary(ctx: Ctx, named: str | None) -> list[tuple[str, dict]] | None:
    """The tools an answer always needs, run by code in a fixed order (money before work for minors).
    None means the model should choose the tools itself."""
    minor, i = wr.is_minor(ctx.age), ctx.intent
    skill = next(iter(ctx.facts.get("skills") or []), None)
    money = [("check_money", {}), ("find_scholarships", {})]   # money that needs no work always comes first
    if i == "earn":
        if minor:
            return [*money, ("find_careers", {"needs_income_soon": True})]
        return [*money, ("find_jobs", {"role": skill, "part_time": True}), ("find_careers", {"needs_income_soon": True})]
    if i == "jobs" and minor:
        out = [*money, ("find_careers", {"needs_income_soon": True})]
        return out + ([("find_jobs", {"role": skill, "apprenticeship": True})] if skill and ctx.age >= 14 else [])
    if i == "scholarship":
        return money
    if i == "careers":
        return [("find_careers", {})]
    if i == "career_named" and named:
        return [("career_details", {"slug": named})]
    if i == "plan":
        return ([("make_plan", {"career": named})] if named else []) + [("my_roadmap", {})]
    return None


WRITE = {
    "earn": "Write 1-2 short sentences: first the scholarship cards (money that needs no work: verified schemes, then more found on "
            "Buddy4Study and official sites, to check on each official page), then the safe paths card{fam}. "
            "If no scholarship is eligible yet, say answering the scholarship card's questions can unlock some. "
            "Say real work starts at 18 and free skill training helps now. Do not name any job or number not in the results.",
    "earn_adult": "Write 1-2 short sentences pointing to the scholarships, the job openings (check on the site, never pay to get a job) and careers.",
    "jobs": "Write 1-2 short sentences: scholarships first (money that needs no work), and by law they cannot take a job before 18; "
            "point to the law card and the safe training paths.",
    "scholarship": "Write 1-2 short sentences: the verified schemes card first, then the other scholarships found (check details and "
                   "the deadline on each official page before applying), and the next step (answer the cards' questions to check more).",
    "careers": "Write 1-2 short sentences on how to pick from the careers card (tap one to see the path).",
    "career_named": "Write 1-2 short sentences on the first step on this path from the career card.",
    "plan": "Write 1-2 short sentences: point to the roadmap card and its one next small step. Say the plan changes by itself "
            "to fit how they are doing, and they can undo any change.",
}


def _history(past: list[dict]) -> list[dict]:
    out = []
    for m in past[-HISTORY:]:
        text = (m.get("content") or "")[:400]
        if m["role"] == "assistant":
            kinds = [c.get("type") for c in (m.get("cards") or [])]
            asked = [c.get("field") for c in (m.get("cards") or []) if c.get("type") == "question"]
            text = (text + f" [cards: {', '.join(kinds)}]" if kinds else text) + (f" [asked: {asked[0]}]" if asked else "")
        out.append({"role": m["role"], "content": text or "(cards shown)"})
    return out


def chat(user_id: str, roles: set[str], message: str, language: str, thread_id: str | None = None) -> dict:
    db = get_db()
    tid = _thread(user_id, thread_id, message)
    past = db.table("assistant_messages").select("role, content, cards").eq("thread_id", tid).order("id", desc=True).limit(LOOKBACK).execute().data[::-1]
    past_user = [m["content"] or "" for m in past if m["role"] == "user"]
    ctx = Ctx(user_id, roles)
    ctx.message = message
    ctx.past_user = past_user
    ctx.lang = pick_lang(message, past_user, language)
    ctx.shown = {c.get("type") for m in past if m["role"] == "assistant" for c in (m.get("cards") or [])}

    # What does the student want? The latest message decides; otherwise the thread's last intent.
    intent, named = detect_intent(message)
    if not intent:
        for t in reversed(past_user):
            intent, named = detect_intent(t)
            if intent:
                break
    ctx.intent = intent
    if intent == "plan" and not named:
        named = next((n for t in [message, *reversed(past_user)] if (n := _career_named(t))), None)
    # "I finished the form" / "form bhar diya" / "फॉर्म भर दिया": tick the matching step on the roadmap now,
    # so the plan moves in step with what the student says, not only with what they click.
    if DONE_RE.search(message):
        try:
            st = rm.match_step(user_id, message)
            if st:
                rm.update_step(user_id, st["id"], status="done")
                card, line = rm.card(user_id)
                ctx.cards.append(card)
                ctx.care = f" The student just finished '{st['title']}'; it is ticked on their roadmap. Say well done in one short line."
                intent = intent or "plan"
                ctx.intent = intent
        except Exception as e:  # noqa: BLE001
            log.warning("done-from-chat skipped: %s", e)
    # What the student says about worries, time and money is kept as roadmap signals: it changes the plan's
    # pace and how Saathi speaks (fixed keyword rules, see roadmap_engine.extract_signals).
    try:
        ctx.care = (getattr(ctx, "care", "") or "") + " " + rm.saathi_hint(user_id, rm.capture_signals(user_id, message, _career_named))
    except Exception as e:  # noqa: BLE001 - the chat works without it
        log.warning("roadmap signals skipped: %s", e)
    ctx.care = ctx.care.rstrip()

    # The open question from the last turn, answered in plain words: save it without the model.
    last = next((m for m in reversed(past) if m["role"] == "assistant"), None)
    pending = next((c.get("field") for c in (last.get("cards") or []) if c.get("type") == "question"), None) if last else None
    pre: dict = {}
    if pending and not known(ctx.facts, pending):
        got = parse_answer(pending, message)
        if isinstance(got, dict):
            pre.update(got)
        elif got is not None:
            pre[pending] = got
    if intent in ("jobs", "colleges", "earn", "scholarship") and not known(ctx.facts, "district") and (place := place_in(message)):
        pre.update(place)
    if intent in ("earn", "scholarship", "jobs") and not known(ctx.facts, "gender") and (g := gender_in(message)):
        pre["gender"] = g
    if intent == "earn" and ctx.facts.get("needs_income_soon") is None:
        pre["needs_income_soon"] = True
    if pre:
        _save(ctx, pre)
    # The student's reply to a skills question is kept in their own words when the model doesn't save it,
    # so careers can still be ranked (skill_tags reads the words) and the question is never asked again.
    last_q = next((c.get("field") for m in reversed(past) if m["role"] == "assistant"
                   for c in (m.get("cards") or []) if c.get("type") == "question"), None) if past else None
    if last_q == "skills" and not ctx.facts.get("skills") and message.strip() and skill_tags([message]):
        _save(ctx, {"skills": [message.strip()[:80]]})
    # Never ask the same fact twice in one chat: if the answer didn't stick, move on rather than loop.
    ctx.asked_before = {c.get("field") for m in past if m["role"] == "assistant" for c in (m.get("cards") or [])
                        if c.get("type") == "question" and c.get("field")}
    ctx.missing = [f for f in missing_for(intent, ctx.facts) if f not in ctx.asked_before]

    used, tokens, reply = [], 0, ""
    # A minor asking about work sees what the law says for their age before anything else.
    if intent in ("earn", "jobs") and wr.is_minor(ctx.age) and not ctx.seen("law"):
        _law_card(ctx)
        used.append("work_rules")

    def system() -> dict:
        facts_short = {k: v for k, v in ctx.facts.items() if k != "date_of_birth"}
        return {"role": "system", "content": SYSTEM.format(
            lang_rule=LANG_RULE[ctx.lang], age_rule=_age_rule(ctx), today=date.today().isoformat(),
            facts=json.dumps(facts_short, ensure_ascii=False), care=ctx.care, step=_step(ctx, named, not past))}

    # Intake turns only need the last exchange; answers get a little more history.
    messages = [system(), *_history(past[-2:] if ctx.missing else past), {"role": "user", "content": message}]
    evidence = [message, *past_user[-4:], json.dumps(ctx.facts, ensure_ascii=False),
                json.dumps([r["text"] for r in wr.doc()["rules"]], ensure_ascii=False), wr.summary(ctx.age)]
    primaries_done = False
    for rnd in range(MAX_ROUNDS):
        before = list(ctx.missing)
        phase = "intake" if ctx.missing else "answer"
        if phase == "answer" and not primaries_done:
            primaries_done = True
            plan = _primary(ctx, named)
            if plan is not None:
                lines = []
                for name, args in plan:
                    try:
                        out = run_tool(ctx, name, args)
                    except Exception as e:
                        out = f"error: {type(e).__name__}"
                    used.append(name)
                    evidence.append(out)
                    lines.append(f"{name}: {out[:600]}")
                key = "earn_adult" if intent == "earn" and not wr.is_minor(ctx.age) else intent
                fam = ", and that helping the family business after school (unpaid, safe work) is allowed" if ctx.facts.get("has_family_business") else ""
                messages[0] = system()
                messages.append({"role": "user", "content": "[app note, not from the student] Cards now shown to the student:\n" + "\n".join(lines) + "\n" + WRITE.get(key, WRITE["careers"]).format(fam=fam) + " Never write tool or card code names (like check_money); say 'the scholarship card'. Never call training or apprenticeship schemes scholarships. Reply in the student's language as the LANGUAGE rule says."})
                for _try in range(2):
                    resp = _llm(messages, None, max_tokens=700)
                    tokens += (resp.get("usage") or {}).get("total_tokens", 0)
                    reply = (resp["choices"][0]["message"].get("content") or "").strip()
                    if reply:
                        break
                reply = reply or FALLBACK_REPLY.get(ctx.lang, FALLBACK_REPLY["en"])
                break
        tools = _tools(phase, ctx.missing[0] if ctx.missing else None, REQUIRED.get(intent or ""))
        # In intake the model must act: round one may save facts and ask; later rounds must ask.
        choice = None
        if phase == "answer" and intent == "jobs" and not wr.is_minor(ctx.age) and rnd == 0 and "find_jobs" not in used:
            choice = {"type": "function", "function": {"name": "find_jobs"}}
        if phase == "intake":
            choice = "required" if rnd == 0 else {"type": "function", "function": {"name": "ask_student"}}
        try:
            resp = _llm(messages, tools, choice)
        except Exception as e:  # noqa: BLE001 - a rejected model call must never end the chat
            log.warning("llm failed in %s: %s", phase, str(e)[:200])
            if phase == "answer" and not reply:
                reply = FALLBACK_REPLY.get(ctx.lang, FALLBACK_REPLY["en"])
            break  # in intake, the planner's own question card is added below
        tokens += (resp.get("usage") or {}).get("total_tokens", 0)
        msg = resp["choices"][0]["message"]
        calls = msg.get("tool_calls") or []
        if not calls:
            reply = msg.get("content") or ""
            break
        reply = msg.get("content") or reply
        messages.append({"role": "assistant", "content": msg.get("content") or "", "tool_calls": calls})
        # save_facts first so the question (or the answer) uses the new facts
        calls = sorted(calls, key=lambda c: c["function"]["name"] != "save_facts")
        for call in calls:
            name = call["function"]["name"]
            try:
                args = json.loads(call["function"].get("arguments") or "{}")
            except json.JSONDecodeError:
                args = {}
            if ctx.asked and name not in ("save_facts",):
                out = "skipped: a question is already shown"
            else:
                try:
                    out = run_tool(ctx, name, args)
                except Exception as e:  # a tool failing should not end the conversation
                    out = f"error: {type(e).__name__}"
                used.append(name)
            evidence.append(out)
            messages.append({"role": "tool", "tool_call_id": call["id"], "content": out[:1200]})
        if ctx.asked:
            break  # one question per turn: wait for the answer
        ctx.missing = [f for f in missing_for(intent, ctx.facts) if f not in ctx.asked_before]
        if intent in ("earn", "jobs") and wr.is_minor(ctx.age) and not ctx.seen("law"):
            _law_card(ctx)
            used.append("work_rules")
        if before != ctx.missing:
            messages[0] = system()

    # Money that needs no work comes before anything about work: verified schemes, then the scholarships found.
    if intent in ("earn", "jobs", "scholarship") and (wr.is_minor(ctx.age) or intent == "scholarship"):
        first = {"schemes": 0, "scholarships": 1}
        ctx.cards.sort(key=lambda c: first.get(c["type"], 2))

    # Intake turn where the model gave text but no question card: show the card for the next fact.
    if ctx.missing and not ctx.asked:
        ctx.asked = True
        ctx.cards.append({"type": "question", "field": ctx.missing[0], "question": None, "lang": ctx.lang,
                          "answered": ANSWERED.get(ctx.lang, ANSWERED["en"]), "why": why_text(ctx.missing[0], ctx.facts, intent, ctx.lang)})
    if ctx.asked and not reply.strip():
        reply = ""
    # Fixed checks on the model's own words: safe for minors, no numbers without a source, right script.
    issues = []
    if wr.is_minor(ctx.age) and (h := hazard_issue(reply)):
        issues.append(f"it suggests '{h}' work to a minor; remove it or say it is only possible after 18")
    if bad := number_issue(reply, " ".join(evidence)):
        issues.append(f"it states numbers {bad} that are in no tool result; remove them")
    want = "devanagari" if ctx.lang in ("hi", "mr") else "latin"
    if reply.strip() and script_of(reply) not in (want, "none"):
        issues.append(f"it is in the wrong script; {LANG_RULE[ctx.lang]}")
    if issues and reply.strip():
        fix = _llm([messages[0], {"role": "user", "content": message}, {"role": "assistant", "content": reply},
                    {"role": "user", "content": "Rewrite your last reply because " + "; ".join(issues) + ". Max 2 short sentences. Reply text only."}],
                   None, max_tokens=300)
        tokens += (fix.get("usage") or {}).get("total_tokens", 0)
        reply = fix["choices"][0]["message"].get("content") or reply
        used.append("rewrite")
    db.table("assistant_messages").insert([
        {"thread_id": tid, "role": "user", "content": message, "cards": [], "tools": [], "tokens": None},
        {"thread_id": tid, "role": "assistant", "content": reply, "cards": ctx.cards, "tools": used, "tokens": tokens},
    ]).execute()
    db.table("assistant_threads").update({"updated_at": "now()"}).eq("id", tid).execute()
    rm.record_event(user_id, "saathi_turn", tid, {"intent": intent or ""})
    if ctx.saved_facts:
        rm.record_event(user_id, "fact_answered", "saathi")
    return {"thread_id": tid, "reply": reply, "cards": ctx.cards, "tools": used, "tokens": tokens,
            "lang": ctx.lang, "intent": intent, "missing": ctx.missing}


def threads(user_id: str) -> list[dict]:
    return get_db().table("assistant_threads").select("id, title, updated_at").eq("user_id", user_id).order("updated_at", desc=True).limit(30).execute().data


def thread_messages(user_id: str, thread_id: str) -> list[dict]:
    db = get_db()
    if not db.table("assistant_threads").select("id").eq("id", thread_id).eq("user_id", user_id).execute().data:
        return []
    return db.table("assistant_messages").select("id, role, content, cards, created_at").eq("thread_id", thread_id).order("id").execute().data
