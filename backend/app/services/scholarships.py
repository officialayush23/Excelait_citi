"""Scholarship discovery: private, CSR, NGO and government scholarships a student may be eligible for,
found on legitimate public pages and read with plain code.

Sources (checked 2026-11-22 with Tavily; robots.txt of buddy4study.com allows these paths):
- buddy4study.com/scholarship/<slug>: full pages with Eligibility / Benefits / Documents / How can you
  apply / Important Dates sections. Read with Tavily extract.
- buddy4study.com/article/<slug>: one-scholarship articles (overview table, eligibility, dates). List
  articles ("Scholarships for girls ...") are not records; their /scholarship/ links are followed.
- buddy4study.com/page/<slug>: the big CSR programmes (HDFC Badhte Kadam, Kotak Kanya, Tata Capital
  Pankh, Aditya Birla Capital ...). These render in the browser and cannot be extracted, so only the
  search snippet is kept, marked partial: it is never shown as "likely eligible".
- mahadbt.maharashtra.gov.in/SchemeData/...: Maharashtra government scheme pages (eligibility,
  benefits, documents; no deadline on the page).
- kotakeducationfoundation.org, reliancefoundation.org and other official foundation pages when search
  returns them: read with the same section reader.
Not readable through Tavily: scholarships.gov.in (scheme list is loaded by script), myscheme.gov.in
(script-rendered), vidyasaarathi.co.in (script-rendered), scholarship.up.gov.in (fetch fails). The 17
verified schemes in shared/rules/schemes.json already cover the main NSP / state schemes.

Nothing here guesses: a criterion the page mentions but the reader cannot parse is listed as unknown,
and a record with any unknown is shown as "check", never as "likely eligible". An optional single LLM
call per new page (SCHOLARSHIP_LLM_PARSE=1, default off) may fill only those unknown fields."""

from __future__ import annotations

import json
import logging
import re
from datetime import date, datetime, timedelta, timezone

import httpx

from app.core.config import get_settings
from app.services import knowledge as kb

log = logging.getLogger("scholarships")
TAVILY = "https://api.tavily.com"
MIN_ITEMS = 8              # fewer fresh matching items than this in the store -> search the web
RECHECK_DAYS = 7           # a stored page is read again at most once a week
MAX_EXTRACT = 20           # Tavily extract limit per call
SITE_NAMES = {"buddy4study.com": "Buddy4Study", "mahadbt.maharashtra.gov.in": "MahaDBT (Govt of Maharashtra)",
              "kotakeducationfoundation.org": "Kotak Education Foundation", "reliancefoundation.org": "Reliance Foundation",
              "scholarships.gov.in": "National Scholarship Portal", "vidyasaarathi.co.in": "Vidyasaarathi",
              "hdfcbank.com": "HDFC Bank", "tatacapital.com": "Tata Capital", "adityabirlacapital.com": "Aditya Birla Capital"}
OFFICIAL_SITES = ["kotakeducationfoundation.org", "reliancefoundation.org", "hdfcbank.com", "tatacapital.com", "adityabirlacapital.com"]

STATES = ["Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat", "Haryana", "Himachal Pradesh",
          "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha",
          "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal", "Delhi",
          "Jammu and Kashmir", "Ladakh", "Puducherry", "Chandigarh", "Andaman and Nicobar", "Lakshadweep", "Dadra and Nagar Haveli"]
MONTHS = {m: i + 1 for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"])}


def site_of(url: str) -> str | None:
    host = re.sub(r"^https?://(www\.)?", "", url or "").split("/")[0].lower()
    for s in [*SITE_NAMES, *OFFICIAL_SITES]:
        if host == s or host.endswith("." + s):
            return s
    return None


# ================================================================ dates and money

_MON = r"(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)"
DATE_PATTERNS = [
    (re.compile(rf"\b(\d{{1,2}})(?:st|nd|rd|th)?[\s\-/.]+(?:of\s+)?{_MON}\.?[\s\-/.,]+(\d{{4}})\b", re.I), "dmy_name"),
    (re.compile(rf"\b{_MON}\.?\s+(\d{{1,2}})(?:st|nd|rd|th)?,?\s+(\d{{4}})\b", re.I), "mdy_name"),
    (re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b"), "iso"),
    (re.compile(r"\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})\b"), "dmy"),
]


def _mk(y: int, m: int, d: int) -> date | None:
    try:
        return date(y, m, d)
    except ValueError:
        return None


def parse_dates(text: str) -> list[tuple[int, date]]:
    """Every date in the text with its position. Numeric dates are read the Indian way (day first)."""
    out = []
    for rx, kind in DATE_PATTERNS:
        for m in rx.finditer(text or ""):
            g = m.groups()
            if kind == "dmy_name":
                d = _mk(int(g[2]), MONTHS[g[1][:3].lower()], int(g[0]))
            elif kind == "mdy_name":
                d = _mk(int(g[2]), MONTHS[g[0][:3].lower()], int(g[1]))
            elif kind == "iso":
                d = _mk(int(g[0]), int(g[1]), int(g[2]))
            else:
                d = _mk(int(g[2]), int(g[1]), int(g[0]))
            if d and 2000 <= d.year <= 2100:
                out.append((m.start(), d))
    out.sort(key=lambda t: t[0])
    seen, uniq = set(), []
    for p, d in out:  # one date per position
        if not any(abs(p - q) < 4 for q in seen):
            seen.add(p)
            uniq.append((p, d))
    return uniq


def parse_date(text: str) -> date | None:
    got = parse_dates(text)
    return got[0][1] if got else None


DEADLINE_RX = re.compile(r"(deadline(?: date)?|last date(?: to apply| of application| for (?:submission|application))?|closing date|"
                         r"apply by|applications? close[sd]?(?: on)?|end date|last date to apply for the scholarship)", re.I)


def find_deadline(text: str) -> tuple[date | None, str | None, bool]:
    """(deadline, the words around it, closed?) from 'Deadline Date: 30-Nov-2026', 'Last Date to Apply | November 15, 2026',
    'Application Deadline: 30th September 2026'. 'Deadline: Closed' with no date gives closed=True."""
    text = text or ""
    best: tuple[date, str] | None = None
    closed = False
    for m in DEADLINE_RX.finditer(text):
        window = text[m.end(): m.end() + 90]
        window = re.split(r"\n\s*\n|#", window)[0] if not re.match(r"[\s:*|]*\n", window) else window[:90]
        ds = parse_dates(window)
        if ds:
            d = ds[0][1]
            snippet = re.sub(r"[*|#]+", " ", text[m.start(): m.end() + 40]).strip()
            snippet = re.sub(r"\s+", " ", snippet)[:90]
            if best is None or d > best[0]:  # extended deadlines are later; take the latest stated
                best = (d, snippet)
        elif re.match(r"[\s:*|]*closed", window, re.I):
            closed = True
    if best:
        return best[0], best[1], False
    return None, None, closed


AMOUNT_RX = re.compile(r"(?:₹|rs\.?|inr|rupees)\s*([\d][\d,]*(?:\.\d+)?)\s*(lakhs?|lacs?|lakh|crores?|k\b)?|"
                       r"\b([\d][\d,]*(?:\.\d+)?)\s*(lakhs?|lacs?)\b", re.I)


def _to_rupees(num: str, unit: str | None) -> int | None:
    try:
        v = float(num.replace(",", ""))
    except ValueError:
        return None
    u = (unit or "").lower()
    if u.startswith("lak") or u.startswith("lac"):
        v *= 100000
    elif u.startswith("crore"):
        v *= 10000000
    elif u == "k":
        v *= 1000
    return int(round(v))


def parse_amounts(text: str) -> list[int]:
    out = []
    for m in AMOUNT_RX.finditer(text or ""):
        num, unit = (m.group(1), m.group(2)) if m.group(1) else (m.group(3), m.group(4))
        v = _to_rupees(num, unit)
        if v and v >= 100:
            out.append(v)
    return out


def parse_amount(text: str) -> int | None:
    """'₹50,000' -> 50000, 'Rs. 2.5 lakh' -> 250000, 'INR 6,00,000' -> 600000. The largest figure when several."""
    got = parse_amounts(text)
    return max(got) if got else None


# ================================================================ eligibility fields

def sentences(text: str) -> list[str]:
    parts = re.split(r"(?<=[;!?])\s+|(?<=[.])(?<!Rs\.)(?<!rs\.)(?<!RS\.)(?<!No\.)(?<!\bB\.)(?<!\bM\.)\s+(?=[A-Z0-9(])|\n+|\s+·\s+|•",
                     text or "")
    return [re.sub(r"\s+", " ", re.sub(r"[*#|>]+", " ", p)).strip() for p in parts if p and p.strip()]


def parse_income(text: str) -> tuple[str, int | None]:
    """('known', 250000) / ('unknown', None) when income is mentioned without one clear figure / ('none', None)."""
    vals, mentioned = set(), False
    for s in sentences(text):
        if re.search(r"\bno (?:family |annual )?income (?:limit|ceiling|bar|criteria)", s, re.I):
            continue
        if re.search(r"\bincome\b", s, re.I):
            mentioned = True
            vals.update(v for v in parse_amounts(s) if v >= 10000)
    if not mentioned:
        return "none", None
    if len(vals) == 1:
        return "known", vals.pop()
    return "unknown", None


def parse_marks(text: str) -> tuple[str, float | None]:
    vals, mentioned = [], False
    for s in sentences(text):
        if re.search(r"marks|score|percent|aggregate|cgpa|%", s, re.I) and re.search(r"marks|score|percent|aggregate|cgpa|grade|board|class|exam", s, re.I):
            if re.search(r"will receive|award|tuition|fees|relaxation", s, re.I) and not re.search(r"must|should|at least|minimum|min\.", s, re.I):
                continue
            pcts = [float(x) for x in re.findall(r"(\d{2}(?:\.\d+)?)\s*%", s)]
            if not pcts and not re.search(r"marks|percent|cgpa", s, re.I):
                continue
            mentioned = True
            rng = re.search(r"(\d{2}(?:\.\d+)?)\s*%?\s*(?:to|-|–)\s*(\d{2}(?:\.\d+)?)\s*%", s)
            vals += [float(rng.group(1))] if rng else pcts
    if not mentioned:
        return "none", None
    vals = sorted(set(vals))
    return ("known", vals[0]) if len(vals) == 1 else ("unknown", None)


ROMAN = {"i": 1, "ii": 2, "iii": 3, "iv": 4, "v": 5, "vi": 6, "vii": 7, "viii": 8, "ix": 9, "x": 10, "xi": 11, "xii": 12}
COURSE_WORDS = [
    ("phd", r"\bph\.?\s?d\b|doctoral"),
    ("pg", r"post[\s-]?graduat|\bpg\b|master'?s?\b|\bm\.?\s?sc\b|\bm\.?\s?com\b|\bmba\b|\bm\.?\s?tech\b|\bm\.a\.?(?=\s)"),
    ("ug", r"under[\s-]?graduat|\bgraduation\b|bachelor|\bug\b|\bb\.a\.?(?=[\s,)/])|\bb\.?\s?com\b|\bb\.?\s?sc\b|\bbca\b|\bbba\b|"
           r"\bb\.?\s?tech\b|\bb\.e\.?(?=[\s,)/])|\bmbbs\b|\bb\.?\s?pharm|\bllb\b|\bb\.?\s?arch|first[- ]year (?:of )?(?:college|engineering|medicine|mbbs|nursing|b\.?\s?tech)|engineering (?:students?|course|degree|college)|"
           r"(?<!post)(?<!post-)(?<!post )(?<!pg )\b(?:technical |professional )?degree (?:or|course|programme|program|students?)\b"),
    ("diploma", r"\bdiploma\b|polytechnic"),
    ("iti", r"\biti\b|industrial training"),
]


def _num(tok: str) -> int | None:
    tok = tok.lower().strip(".")
    if tok.isdigit():
        return int(tok)
    return ROMAN.get(tok)


CLS = r"(\d{1,2}|xii|xi|ix|x|viii|vii|vi|v|iv|iii|ii|i)(?:st|nd|rd|th)?"


def parse_levels(text: str) -> tuple[str, list[str]]:
    """Study levels a scholarship is for, as tokens: class_9 ... class_12, iti, diploma, ug, pg, phd, and the
    qualifiers 'professional' / 'nursing' when only those courses qualify."""
    toks: set[str] = set()
    for s in sentences(text):
        low = s.lower()
        done = bool(re.search(r"\b(passed|completed|cleared|have passed|after|scored|secured|obtained|studied)\b", low))
        for m in re.finditer(rf"class(?:es)?\s*{CLS}\s*(?:and|or|&)\s*above", low):
            n = _num(m.group(1))
            if n:
                toks.update(f"class_{k}" for k in range(n, 13))
                toks.update(["iti", "diploma", "ug", "pg"])
        for m in re.finditer(rf"class(?:es)?\s*{CLS}((?:\s*(?:,|to|-|–|and|or|&)\s*(?:class\s*)?{CLS})*)", low):
            first = _num(m.group(1))
            rest = [_num(x) for x in re.findall(rf"(?:,|to|-|–|and|or|&)\s*(?:class\s*)?{CLS}", m.group(2) or "")]
            nums = [x for x in [first, *rest] if x and 1 <= x <= 12]
            if not nums:
                continue
            before = low[max(0, m.start() - 30): m.start()]
            if re.search(r"passed|completed|cleared|after|scored|secured|obtained|studied|marks|%|score|cgpa|percent", before):
                continue  # 'have completed Class 10' is a qualification, not the class studied in
            is_range = re.search(r"\bto\b|-|–", m.group(0)) and len(nums) == 2
            toks.update(f"class_{k}" for k in (range(min(nums), max(nums) + 1) if is_range else nums))
        if re.search(r"\b(?:ssc|10th|matric)\b", low) and done and re.search(r"studying|pursuing|above|beyond", low):
            pass  # covered by 'Class 11 and above' style text when present
        for tok, rx in COURSE_WORDS:
            if re.search(rx, low):
                if tok == "ug" and re.search(r"post[\s-]?graduat", low) and not re.search(r"under[\s-]?graduat|bachelor|\bug\b|graduation(?!.*post)", low.replace("post graduation", "")):
                    continue
                toks.add(tok)
    full = (text or "").lower()
    if "ug" in toks and re.search(r"professional (?:graduation|degree)", full) and not re.search(r"general (?:graduation|degree)", full):
        toks.add("professional")
    if re.search(r"\bnursing\b", full) and not re.search(r"engineering|mbbs|medical|b\.?\s?tech", full):
        toks.add("nursing")
    order = [*(f"class_{k}" for k in range(1, 13)), "iti", "diploma", "ug", "pg", "phd", "professional", "nursing"]
    out = [t for t in order if t in toks]
    return ("known", out) if any(not t in ("professional", "nursing") for t in out) else ("unknown", [])


CATEGORY_RX = [
    ("SC", r"\bSCs?\b|(?i:scheduled castes?|navbouddha|neo[\s-]?buddhist|nav[\s-]?bauddha)"),
    ("ST", r"\bSTs?\b|(?i:scheduled tribes?|tribal)"),
    ("OBC", r"\bOBCs?\b|(?i:other backward class)"),
    ("SEBC", r"\bSEBC\b"),
    ("EBC", r"\bEBC\b|(?i:economically backward class)"),
    ("DNT", r"\bVJNT\b|\bVJ\b|\bNT\b|\bDNTs?\b|(?i:denotified|nomadic)"),
    ("SBC", r"\bSBC\b|(?i:special backward)"),
    ("EWS", r"\bEWS\b"),
]
REQUIRE_CTX = re.compile(r"belong|community|categor|caste|tribe|must be|should be|only|exclusively|students? from", re.I)
SOFT_CTX = re.compile(r"relax|preference|preferred|priority|reserved|reservation|%|also eligible|can also apply|irrespective|all categories", re.I)


def parse_categories(text: str, title: str = "") -> tuple[str, list[str]]:
    cats: set[str] = set()
    for s in [*sentences(text), title]:
        if not s:
            continue
        hits = [c for c, rx in CATEGORY_RX if re.search(rx, s)]
        if not hits:
            continue
        if s is not title and (SOFT_CTX.search(s) or not REQUIRE_CTX.search(s)):
            continue
        cats.update(hits)
    return ("known", [c for c, _ in CATEGORY_RX if c in cats]) if cats else ("none", [])


def parse_minority(text: str, title: str = "") -> bool:
    for s in [*sentences(text), title]:
        if re.search(r"minorit", s or "", re.I) and (s is title or (REQUIRE_CTX.search(s) and not SOFT_CTX.search(s))):
            return True
    return False


def parse_gender(text: str, title: str = "") -> tuple[str, str | None]:
    if re.search(r"\b(girls?|women|woman|female|kanya|daughters?|she|her)\b", title or "", re.I) and not re.search(r"boys? and girls|girls? and boys", title or "", re.I):
        return "known", "female"
    for s in sentences(text):
        low = s.lower()
        if re.search(r"boys? and girls|girls? and boys|male and female|both", low):
            continue
        if re.search(r"\b(girl students?|female students?|girls|women|female candidates|female applicants|girl child|meritorious girl)\b", low) \
                and not re.search(r"preference|priority|preferred|reserved|encouraged|at least \d+%|\d+% of", low):
            return "known", "female"
    return "none", None


def parse_states(text: str, region: str | None = None, title: str = "") -> tuple[str, list[str]]:
    found: list[str] = []
    mentioned = False
    for s in sentences(text):
        if re.search(r"domicile|resident|belong to|state of|states? or union|located in|studying in|from the state|native", s, re.I):
            names = [st for st in STATES if re.search(rf"\b{re.escape(st)}\b", s, re.I)]
            if re.search(r"domicile|resident|native", s, re.I):
                mentioned = True
            if names and not re.search(r"across india|all over india|anywhere in india|pan[- ]india", s, re.I):
                found += names
    if not found and title:  # 'Pudhumai Penn Scheme (Tamil Nadu)': the scheme's own name says the state
        found += [st for st in STATES if re.search(rf"\(\s*{re.escape(st)}\s*\)|\b{re.escape(st)} (?:government|state|govt)", title, re.I)]
    if region and region.strip().lower() not in ("india", "all india", "pan india", "international", ""):
        found += [st for st in STATES if st.lower() == region.strip().lower()]
    found = list(dict.fromkeys(found))
    if found:
        return "known", found
    return ("unknown", []) if mentioned and not re.search(r"\bindia(n)?\b", text or "", re.I) else ("none", [])


def parse_disability(text: str, title: str = "") -> bool:
    if re.search(r"disab|divyang|\bpwd\b|handicap|specially[- ]abled", title or "", re.I):
        return True
    return bool(re.search(r"(must|should) (be|have) (a )?(person|student|candidate)s? with (a )?(benchmark )?disabilit|"
                          r"only (for )?(students|persons) with disabilit|open (only )?to (students|persons) with disabilit", text or "", re.I))


def parse_eligibility(text: str, title: str = "", region: str | None = None) -> dict:
    """Every field is known (with its value), or listed under 'unknown' when the page mentions it but the
    reader could not parse it. Fields the page does not mention are simply absent (no criterion)."""
    e: dict = {"unknown": []}
    st, v = parse_levels(f"{title}\n{text}")
    if st != "known" and re.search(r"post[\s-]?matric", title, re.I):
        st, v = "known", ["class_11", "class_12", "iti", "diploma", "ug", "pg"]   # the scheme's name says after Class 10
    elif st != "known" and re.search(r"pre[\s-]?matric", title, re.I):
        st, v = "known", [f"class_{k}" for k in range(1, 11)]                    # up to Class 10
    if st == "known":
        e["levels"] = v
    else:
        e["unknown"].append("levels")
    st, v = parse_income(text)
    if st == "known":
        e["max_income"] = v
    elif st == "unknown":
        e["unknown"].append("max_income")
    st, v = parse_marks(text)
    if st == "known":
        e["min_marks"] = v
    elif st == "unknown":
        e["unknown"].append("min_marks")
    st, v = parse_gender(text, title)
    if st == "known":
        e["gender"] = v
    st, v = parse_categories(text, title)
    if st == "known":
        e["categories"] = v
    if parse_minority(text, title):
        e["minority"] = True
    st, v = parse_states(text, region, title)
    if st == "known":
        e["states"] = v
    elif st == "unknown":
        e["unknown"].append("states")
    if parse_disability(text, title):
        e["disability"] = True
    return e


# ================================================================ page readers

def _clean(s: str) -> str:
    s = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", s or "")          # images
    s = re.sub(r"\[([^\]]+)\]\((?!http)[^)]*\)", r"\1", s)     # relative links -> text
    return s


def split_sections(md: str) -> list[tuple[str, str]]:
    """Markdown into (heading, body) pairs. Short plain lines such as 'Eligibility Criteria' count as headings too."""
    out, head, buf = [], "", []
    for line in (md or "").split("\n"):
        h = re.match(r"^\s*#{1,6}\s*(.+?)\s*$", line)
        plain = re.match(r"^\s*\**\s*(eligibility(?: criteria)?|benefits|documents(?: required)?|how (?:can you|to) apply\??|"
                         r"important dates|deadlines?(?: & contact info)?|selection criteria|award)\s*\**\s*:?\s*$", line, re.I)
        if h or plain:
            out.append((head, "\n".join(buf).strip()))
            head = re.sub(r"[*_]+", "", (h.group(1) if h else plain.group(1))).strip()
            buf = []
        else:
            buf.append(line)
    out.append((head, "\n".join(buf).strip()))
    return [(h, b) for h, b in out if h or b]


SECTION_KEYS = [("eligibility", r"eligib|who can apply"), ("benefits", r"benefit|award|reward|amount|prize"),
                ("documents", r"document"), ("how_to_apply", r"how (?:can you|to) apply|application process|steps to apply"),
                ("dates", r"important dates|key dates|deadline|timeline"), ("selection", r"selection")]


def pick_sections(secs: list[tuple[str, str]]) -> dict[str, str]:
    """Bodies of the sections by kind; several sections of one kind are joined. Stops at the FAQ."""
    got: dict[str, str] = {}
    for h, b in secs:
        low = h.lower()
        if "faq" in low or "frequently asked" in low:
            break
        if low.startswith(("question", "what ", "which ", "can ", "is ", "who ", "how much", "disclaimer")):
            continue
        for key, rx in SECTION_KEYS:
            if re.search(rx, low) and b:
                if key == "benefits" and "eligib" in low:
                    continue
                got[key] = f"{got[key]}\n{b}" if key in got else b
                break
    return got


def table_pairs(md: str) -> dict[str, str]:
    out = {}
    for line in (md or "").split("\n"):
        cells = [re.sub(r"[*_]+", "", c).strip() for c in line.strip().strip("|").split("|")]
        if len(cells) == 2 and cells[0] and cells[1] and not set(cells[0]) <= set("-: "):
            out.setdefault(cells[0].lower(), cells[1])
    return out


def bullets(body: str, limit: int = 15) -> list[str]:
    items = [re.sub(r"\s+", " ", re.sub(r"[*_]+", "", m)).strip() for m in re.findall(r"^\s*(?:[*\-•]|\d+[.)])\s+(.+)$", body or "", re.M)]
    return [x[:200] for x in items if len(x) > 2][:limit]


def _short(text: str, n: int) -> str:
    t = re.sub(r"\s+", " ", re.sub(r"[*_#|]+", " ", _clean(text or ""))).strip()
    return t[:n]


def provider_type(name: str, provider: str | None, url: str) -> str:
    s = f"{name} {provider or ''}".lower()
    if re.search(r"\.gov\.in|\.nic\.in", url) or re.search(r"government|govt|ministry|department|directorate|national |state |"
                                                           r"aicte|ugc|cbse|commission|council of|pm[- ]|pradhan mantri|"
                                                           r"post[- ]matric|pre[- ]matric|mahadbt|nsp\b", s):
        return "government"
    if re.search(r"hdfc|kotak|reliance|tata|aditya birla|mahindra|infosys|wipro|santoor|l.or[eé]al|vivo|schaeffler|legrand|"
                 r"dr\.? reddy|ongc|sbi|lic\b|colgate|bajaj|axis|icici|idfc|hcl|tcs|adani|jsw|siemens|bosch|cognizant|accenture|"
                 r"\bltd\b|limited|bank|capital|industries|corporation|motors|steel|finance|pvt", s):
        return "csr"
    if re.search(r"foundation|trust|society|ngo|sewa|seva|charitable|mission", s):
        return "ngo"
    return "private"


def _record(name: str, url: str, provider: str | None, elig_text: str, benefits: str, dates_text: str, docs: list[str],
            how: str, apply_url: str | None, region: str | None = None, partial: bool = False, parser: str = "",
            amount_hint: str | None = None, extra_text: str = "") -> dict:
    name = re.sub(r"\s+", " ", name).strip(" .-–|")[:200]
    deadline, dl_text, closed = find_deadline(f"{dates_text}\n{extra_text}")
    amount_text = _short(amount_hint or benefits, 240) or None
    amount = parse_amount(amount_hint or benefits[:600]) if (amount_hint or benefits) else None
    elig = parse_eligibility(elig_text, name, region)
    if partial and "details" not in elig["unknown"]:
        elig["unknown"].append("details")
    site = site_of(url)
    money_words = re.search(r"₹|rs\.?\s?\d|inr|rupee|lakh|stipend|fee|tuition|allowance|cash|amount|scholarship of", f"{amount_hint or ''} {benefits}", re.I)
    non_monetary = bool(re.search(r"certificate|medal|rank|trophy|recognition", amount_hint or "", re.I)) and not money_words
    return {"non_monetary": non_monetary, 
        "name": name, "provider": provider, "provider_type": provider_type(name, provider, url),
        "amount_text": amount_text, "amount": amount, "deadline": deadline.isoformat() if deadline else None,
        "deadline_text": dl_text, "closed": closed and not deadline,
        "eligibility_text": _short(elig_text, 1500), "eligibility": elig, "documents": docs[:15],
        "how_to_apply": _short(how, 900) or None, "apply_url": apply_url, "source_url": url, "source_site": site,
        "site_name": SITE_NAMES.get(site or "", site), "last_seen": date.today().isoformat(), "partial": partial, "parser": parser,
    }


def _header_block(md: str, label: str) -> str | None:
    m = re.search(rf"#{{4,6}}\s*{label}\s*\n+(.+?)\n", md)
    return m.group(1).strip() if m else None


def parse_buddy4study_scholarship(md: str, url: str) -> dict | None:
    """buddy4study.com/scholarship/<slug>: header blocks (Eligibility / Region / Award / Deadline) and sections."""
    md = _clean(md)
    t = re.search(r"^#\s+(.+)$", md, re.M)
    if not t:
        return None
    secs = pick_sections(split_sections(md))
    region = _header_block(md, "Region")
    award = _header_block(md, "Award")
    head_deadline = _header_block(md, "Deadline") or ""
    about = next((b for h, b in split_sections(md) if "about" in h.lower()), "")
    prov = None
    m = re.search(r"Who is offering this (?:opportunity|scholarship)\?\s*\**\s*Answer:\**\s*(.+?)\s+(?:is|are) offering", md, re.S | re.I)
    if m:
        prov = re.sub(r"\s+", " ", m.group(1)).strip()[:150]
    elif (m := re.search(r"initiative of (?:the )?([^,.]+)", about)):
        prov = m.group(1).strip()[:150]
    apply = re.search(r"\[(?:Apply online link|Apply Now|Apply here|Official website)\]\((https?://[^)\s]+)\)", md, re.I)
    source = re.search(r"\*\*Source:\*\*\s*<?(https?://[^>\s]+)", md)
    elig = secs.get("eligibility", "")
    elig_full = f"{_header_block(md, 'Eligibility') or ''}\n{elig}"
    rec = _record(t.group(1), url, prov, elig_full, secs.get("benefits", ""), f"Deadline: {head_deadline}\n{secs.get('dates', '')}",
                   bullets(secs.get("documents", "")), secs.get("how_to_apply", ""),
                   (apply.group(1) if apply else None) or (source.group(1) if source else None) or url,
                   region=region, parser="buddy4study_scholarship", amount_hint=award, extra_text=elig[:200])
    if not bullets(elig) and len(re.sub(r"[^a-z]", "", elig.lower())) < 120:
        rec["eligibility"]["unknown"].append("details")  # the page's own rule list did not come through: never 'likely'
    return rec


def is_list_article(md: str) -> bool:
    """'Scholarships for girls' style pages list many scholarships; a one-scholarship article repeats one name."""
    h1 = re.search(r"^#\s+(.+)$", md, re.M)
    if h1 and re.search(r"\bscholarships\b|\blist of\b|\btop \d+", h1.group(1), re.I):
        return True
    heads = re.findall(r"^#{2,3}\s+\**(.+?scholarship)", md, re.M | re.I)
    prefixes = {" ".join(re.findall(r"[a-z]+", h.lower())[:2]) for h in heads}
    labels = len(re.findall(r"\*\*Eligibility:?\*\*", md))
    return labels >= 3 or len(prefixes) >= 6


def parse_article(md: str, url: str) -> dict | None:
    """A one-scholarship article (Buddy4Study /article/ or a foundation's own page): title, overview table, sections."""
    md = _clean(md)
    if is_list_article(md):
        return None
    t = re.search(r"^#\s+(.+)$", md, re.M)
    pairs = table_pairs(md)
    name = (pairs.get("name of the scholarship") or pairs.get("scholarship name") or pairs.get("scholarship")
            or (t.group(1) if t else None))
    if not name:
        return None
    name = re.split(r"\s+[–—-]\s+|:\s", re.sub(r"[*_]+", "", name))[0]
    if not re.search(r"scholar|fellowship|yojana|scheme|programme|program|shishyavrutti|chhatravritti", name, re.I):
        return None
    secs = pick_sections(split_sections(md))
    prov = pairs.get("provider") or pairs.get("provider name") or pairs.get("offered by") or pairs.get("conducted by")
    if not prov and site_of(url) in OFFICIAL_SITES:
        prov = SITE_NAMES.get(site_of(url) or "")
    amount = pairs.get("scholarship amount") or pairs.get("award") or pairs.get("amount") or pairs.get("benefits")
    dl_pairs = "\n".join(f"{k}: {v}" for k, v in pairs.items() if re.search(r"date|deadline", k))
    elig = secs.get("eligibility") or pairs.get("eligibility") or ""
    links = re.findall(r"\[[^\]]*(?:apply|scholarship page|official)[^\]]*\]\((https?://[^)\s]+)\)", md, re.I)
    return _record(name, url, prov, elig, secs.get("benefits", "") or (amount or ""),
                   f"{dl_pairs}\n{secs.get('dates', '')}\n{_header_block(md, 'Deadline') or ''}", bullets(secs.get("documents", "")),
                   secs.get("how_to_apply", ""), links[0] if links else url, parser="article", amount_hint=amount,
                   extra_text=md[:0] if dl_pairs or secs.get("dates") else md)


def parse_mahadbt(md: str, url: str) -> dict | None:
    """mahadbt.maharashtra.gov.in/SchemeData: '# Name', then About / Department / Overview / Benefits / Eligibility / Documents."""
    md = _clean(md)
    start = md.find("## About Scheme")
    if start < 0:
        return None
    body = md[start:]
    t = re.findall(r"^#\s+(.+)$", md[:start + 1], re.M)
    if not t:
        return None
    secs = split_sections(body)
    get = {h.lower(): b.replace("---", "").strip() for h, b in secs}
    dept = get.get("department name", "").split("\n")[0].strip()
    elig = get.get("eligibility", "")
    docs = [re.sub(r"^[•*\-\d.)\s]+", "", x).strip() for x in get.get("documents required", "").split("\n") if x.strip().strip("•").strip()]
    rec = _record(t[-1], url, f"Government of Maharashtra, {dept} Department" if dept else "Government of Maharashtra",
                  elig, get.get("benefits", ""), "", [d for d in docs if len(d) > 3], "Apply on MahaDBT after registering with Aadhaar.",
                  "https://mahadbt.maharashtra.gov.in", region="Maharashtra", parser="mahadbt")
    rec["amount"] = None  # benefit tables list many group-wise figures; the text is shown instead
    if "states" not in rec["eligibility"]:
        rec["eligibility"]["states"] = ["Maharashtra"]
        rec["eligibility"]["unknown"] = [u for u in rec["eligibility"]["unknown"] if u != "states"]
    return rec


def parse_snippet(title: str, snippet: str, url: str) -> dict | None:
    """Search snippet of a page that cannot be read (Buddy4Study /page/ programmes). Always partial."""
    name = re.split(r"\s+[|–—]\s+|\s+-\s+(?:Buddy4Study|Apply|Eligibility|Last)", title or "")[0]
    if not name or not re.search(r"scholar|programme|program|fellowship|yojana|scheme", name, re.I):
        return None
    text = re.sub(r"\s+", " ", snippet or "")
    return _record(name, url, None, text, text, text, [], "", url, partial=True, parser="snippet", extra_text=text)


def parse_list_entries(md: str, url: str, limit: int = 40) -> list[dict]:
    """A list article ('Scholarships for Girls 2026-27') holds short entries: '### Name', '**Eligibility:** ...',
    '**Award:** ...', '**Last date:** ...' and an apply link. Each becomes a partial record (a summary only, so
    never 'likely eligible'). The article's own title says who the whole list is for (e.g. girls)."""
    md = _clean(md)
    h1 = re.search(r"^#\s+(.+)$", md, re.M)
    context = h1.group(1) if h1 else ""
    region = next((st for st in STATES if re.search(rf"\b{re.escape(st)}\b", context)), None)
    out = []
    for m in re.finditer(r"^#{3,4}\s+\**(.+?)\**\s*$\n(.*?)(?=^#{2,4}\s|\Z)", md, re.M | re.S):
        name, body = m.group(1).strip(), m.group(2)
        el = re.search(r"\*\*Eligibility:?\*\*:?\s*(.+?)(?=\n\s*\*\*[A-Z][^*]{2,30}:?\*\*|\n\s*\||\Z)", body, re.S)
        if not el or not re.search(r"scholar|fellowship|yojana|scheme|programme|program|penn", name, re.I):
            continue
        award = re.search(r"\*\*(?:Award|Benefits?|Amount):?\*\*:?\s*(.+)", body)
        last = re.search(r"\*\*(?:Last date|Deadline|Application deadline)[^*]*\*\*:?\s*(.+)", body, re.I)
        link = re.search(r"\[(?:CLICK HERE|Apply[^\]]*|Official[^\]]*)\]\((https?://[^)\s]+)\)", body, re.I)
        slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:80]
        own = link.group(1) if link and url_kind(link.group(1)) != "drop" else None
        rec = _record(name, own or f"{url}#{slug}", None, f"{el.group(1)}", award.group(1) if award else "",
                      f"Last date: {last.group(1)}" if last else "", [], "", own or url, region=region, partial=True,
                      parser="list_entry", amount_hint=award.group(1) if award else None)
        if parse_gender("", context)[0] == "known" and "gender" not in rec["eligibility"]:
            rec["eligibility"]["gender"] = "female"
        rec["found_in"] = url
        out.append(rec)
        if len(out) >= limit:
            break
    return out


def parse_page(url: str, md: str) -> dict | None:
    if "buddy4study.com/scholarship/" in url:
        return parse_buddy4study_scholarship(md, url)
    if "mahadbt.maharashtra.gov.in/SchemeData" in url:
        return parse_mahadbt(md, url)
    return parse_article(md, url)


def scholarship_links(md: str, limit: int = 8) -> list[str]:
    urls = re.findall(r"https://www\.buddy4study\.com/scholarship/[a-z0-9-]+", md or "")
    return list(dict.fromkeys(urls))[:limit]


# ================================================================ matching

FIELD_LABEL = {"levels": "class / course", "max_income": "family income limit", "min_marks": "minimum marks",
               "states": "which states", "details": "full details (only a summary could be read)", "gender": "gender",
               "categories": "category", "minority": "minority community", "disability": "disability"}


def student_levels(facts: dict) -> set[str]:
    course, cl = facts.get("course"), facts.get("class_level")
    out: set[str] = set()
    if course in (None, "school") and isinstance(cl, (int, float)) and cl <= 12:
        out.add(f"class_{int(cl)}")
    elif course == "iti":
        out.add("iti")
    elif course == "diploma":
        out.add("diploma")
    elif course in ("ug_degree", "ug_technical") or (course is None and isinstance(cl, (int, float)) and cl > 12):
        out.add("ug")
        if course == "ug_technical":
            out.add("professional")
    elif course == "pg":
        out.add("pg")
    words = " ".join(str(x) for x in [*(facts.get("subjects") or []), *(facts.get("interests") or [])]).lower()
    if "nursing" in words and "ug" in out:
        out.update(["nursing", "professional"])
    return out


def match(rec: dict, facts: dict, today: date | None = None) -> dict:
    """'likely_eligible' when every criterion is known and passes, 'check' when any is unknown (for the page
    or for the student), 'not_eligible' with the reason when a known criterion fails, 'expired' after the deadline."""
    today = today or date.today()
    e = rec.get("eligibility") or {}
    if rec.get("deadline") and date.fromisoformat(rec["deadline"]) < today:
        return {"status": "expired", "reasons": ["deadline passed"], "unknown": [], "passed": []}
    if rec.get("closed"):
        return {"status": "expired", "reasons": ["applications closed"], "unknown": [], "passed": []}
    fails, unknown, passed = [], list(e.get("unknown") or []), []

    lv = e.get("levels")
    if lv:
        need = [x for x in lv if x not in ("professional", "nursing")]
        mine = student_levels(facts)
        if not mine:
            unknown.append("levels")
        elif not mine & set(need):
            fails.append("for " + ", ".join(x.replace("class_", "Class ") if x.startswith("class_") else x.upper() for x in need[:6]))
        else:
            q = [x for x in ("nursing", "professional") if x in lv]
            if q and "ug" in mine and not (set(q) & mine):
                unknown.append("levels")  # the student's degree may or may not be a professional / nursing course
            else:
                passed.append("levels")
    if (mx := e.get("max_income")) is not None:
        inc = facts.get("family_income_annual")
        if inc is None:
            unknown.append("family_income_annual")
        elif inc > mx:
            fails.append(f"family income must be at most Rs {mx:,}")
        else:
            passed.append("max_income")
    if (mn := e.get("min_marks")) is not None:
        mk = facts.get("marks_percent")
        if mk is None:
            unknown.append("marks_percent")
        elif mk < mn:
            fails.append(f"needs at least {mn:g}% marks")
        else:
            passed.append("min_marks")
    if e.get("gender") == "female":
        g = facts.get("gender")
        if g is None:
            unknown.append("gender")
        elif g != "female":
            fails.append("for girls only")
        else:
            passed.append("gender")
    if cats := e.get("categories"):
        c = facts.get("social_category")
        if c is None:
            unknown.append("social_category")
        elif c not in cats:
            fails.append("for " + "/".join(cats) + " students")
        else:
            passed.append("categories")
    if e.get("minority"):
        m = facts.get("is_minority")
        if m is None:
            unknown.append("is_minority")
        elif not m:
            fails.append("for minority community students")
        else:
            passed.append("minority")
    if sts := e.get("states"):
        s = facts.get("state")
        if not s or s == "Other":
            unknown.append("state")
        elif s not in sts:
            fails.append("for students of " + ", ".join(sts[:4]) + ("..." if len(sts) > 4 else ""))
        else:
            passed.append("states")
    if e.get("disability"):
        d = facts.get("is_disabled")
        if d is None:
            unknown.append("is_disabled")
        elif not d:
            fails.append("for students with a disability")
        else:
            passed.append("disability")
    unknown = list(dict.fromkeys(unknown))
    status = "not_eligible" if fails else ("check" if unknown else "likely_eligible")
    return {"status": status, "reasons": fails, "unknown": unknown, "passed": passed}


def days_left(rec: dict, today: date | None = None) -> int | None:
    if not rec.get("deadline"):
        return None
    return (date.fromisoformat(rec["deadline"]) - (today or date.today())).days


# ================================================================ optional LLM normaliser

LLM_USAGE = {"calls": 0, "tokens": 0}
LLM_FIELDS = {"levels", "max_income", "min_marks", "states"}


def llm_fill(rec: dict) -> dict:
    """SCHOLARSHIP_LLM_PARSE=1 only: one small call to fill the fields the regexes left unknown. The raw text stays."""
    s = get_settings()
    e = rec["eligibility"]
    todo = [f for f in e.get("unknown", []) if f in LLM_FIELDS]
    if not (s.scholarship_llm_parse and todo and rec.get("eligibility_text") and s.groq_api_key):
        return rec
    prompt = ("Read these scholarship eligibility rules and return JSON with only these keys when the text states them clearly, "
              "else null: levels (list from class_1..class_12, iti, diploma, ug, pg, phd), max_income (rupees integer), "
              "min_marks (number), states (list of Indian state names). Never guess.\n\n" + rec["eligibility_text"][:1500])
    try:
        r = httpx.post(f"{s.llm_base_url}/chat/completions", timeout=40, headers={"Authorization": f"Bearer {s.groq_api_key}"},
                       json={"model": "openai/gpt-oss-20b", "messages": [{"role": "user", "content": prompt}], "temperature": 0,
                             "response_format": {"type": "json_object"}, "max_completion_tokens": 400, "reasoning_effort": "low"})
        r.raise_for_status()
        body = r.json()
        LLM_USAGE["calls"] += 1
        LLM_USAGE["tokens"] += (body.get("usage") or {}).get("total_tokens", 0)
        got = json.loads(body["choices"][0]["message"]["content"] or "{}")
    except (httpx.HTTPError, ValueError, KeyError) as ex:
        log.info("llm parse skipped: %s", ex)
        return rec
    filled = []
    ok_levels = {f"class_{k}" for k in range(1, 13)} | {"iti", "diploma", "ug", "pg", "phd"}
    if "levels" in todo and isinstance(got.get("levels"), list) and got["levels"] and set(got["levels"]) <= ok_levels:
        e["levels"] = got["levels"]; filled.append("levels")
    if "max_income" in todo and isinstance(got.get("max_income"), (int, float)) and got["max_income"] >= 10000:
        e["max_income"] = int(got["max_income"]); filled.append("max_income")
    if "min_marks" in todo and isinstance(got.get("min_marks"), (int, float)) and 0 < got["min_marks"] <= 100:
        e["min_marks"] = float(got["min_marks"]); filled.append("min_marks")
    if "states" in todo and isinstance(got.get("states"), list) and got["states"] and all(x in STATES for x in got["states"]):
        e["states"] = got["states"]; filled.append("states")
    e["unknown"] = [u for u in e["unknown"] if u not in filled]
    rec["llm_filled"] = filled
    return rec


# ================================================================ web (Tavily)

def _tavily(path: str, body: dict, usage: dict) -> dict:
    s = get_settings()
    r = httpx.post(f"{TAVILY}/{path}", timeout=90, headers={"Authorization": f"Bearer {s.tavily_api_key}"},
                   json={**body, "include_usage": True})
    r.raise_for_status()
    d = r.json()
    usage["calls"] += 1
    usage["credits"] += (d.get("usage") or {}).get("credits", 0) or 0
    usage[path] = usage.get(path, 0) + 1
    return d


def search(query: str, domains: list[str], usage: dict) -> list[dict]:
    try:
        d = _tavily("search", {"query": query, "max_results": 10, "search_depth": "basic", "include_domains": domains}, usage)
    except httpx.HTTPError as e:
        log.warning("tavily search failed: %s", e)
        return []
    return [{"url": x["url"], "title": x.get("title") or "", "snippet": x.get("content") or ""} for x in d.get("results", [])]


def extract(urls: list[str], usage: dict) -> dict[str, str]:
    out: dict[str, str] = {}
    for i in range(0, len(urls), MAX_EXTRACT):
        chunk = urls[i:i + MAX_EXTRACT]
        try:
            d = _tavily("extract", {"urls": chunk, "extract_depth": "basic", "format": "markdown"}, usage)
        except httpx.HTTPError as e:
            log.warning("tavily extract failed: %s", e)
            continue
        out.update({x["url"]: x.get("raw_content") or "" for x in d.get("results", [])})
    return out


def url_kind(url: str) -> str:
    if "buddy4study.com/scholarship/" in url:
        return "page"
    if "buddy4study.com/article/" in url:
        return "article"
    if "buddy4study.com/page/" in url:
        return "snippet"
    if "mahadbt.maharashtra.gov.in/SchemeData" in url:
        return "page"
    if site_of(url) in OFFICIAL_SITES:
        return "page"
    return "drop"


# ================================================================ discovery

def level_words(facts: dict) -> str:
    course, cl = facts.get("course"), facts.get("class_level")
    subj = " ".join(str(x) for x in (facts.get("subjects") or []))
    if course == "iti":
        return "ITI"
    if course == "diploma":
        return "diploma polytechnic"
    if course in ("ug_degree", "ug_technical") or (isinstance(cl, (int, float)) and cl > 12):
        return ("B.Sc nursing" if "nursing" in subj.lower() else "graduation") + " first year"
    if course == "pg":
        return "post graduation"
    return f"class {int(cl)}" if isinstance(cl, (int, float)) else ""


def plan_queries(facts: dict) -> list[tuple[str, list[str]]]:
    """At most three targeted searches: state + community, private / CSR, and the state's government portal."""
    lvl = level_words(facts)
    state = facts.get("state") if facts.get("state") not in (None, "Other") else ""
    cat = facts.get("social_category") if facts.get("social_category") not in (None, "General") else ""
    minority = "minority" if facts.get("is_minority") else ""
    girls = "girls" if facts.get("gender") == "female" else ""
    disabled = "disability" if facts.get("is_disabled") else ""
    j = lambda *xs: re.sub(r"\s+", " ", " ".join(x for x in xs if x)).strip()  # noqa: E731
    q = [(j(lvl, "scholarship", state, cat, minority, girls, disabled), ["buddy4study.com"]),
         (j(lvl, girls or "students", "scholarship 2026-27 private foundation CSR low income"), ["buddy4study.com"])]
    if state == "Maharashtra":
        q.append((j(cat or minority or "", "scholarship", "post matric" if "class_" not in " ".join(student_levels(facts)) or (facts.get("class_level") or 0) >= 11 else "pre matric"), ["mahadbt.maharashtra.gov.in"]))
    elif state:
        q.append((j(state, "government scholarship", lvl, cat or minority), ["buddy4study.com"]))
    return q


def _to_item(rec: dict) -> dict:
    e = rec["eligibility"]
    dl = date.fromisoformat(rec["deadline"]) if rec.get("deadline") else None
    states = e.get("states") or []
    return {"kind": "scholarship", "source_url": rec["source_url"], "source_site": rec.get("source_site"), "title": rec["name"],
            "provider": rec.get("provider"), "data": rec, "eligibility": e, "state": states[0] if len(states) == 1 else None,
            "district": None, "tags": [*(e.get("levels") or []), *(e.get("categories") or []), *([e["gender"]] if e.get("gender") else []),
                                         rec.get("provider_type") or "", rec.get("source_site") or ""],
            "valid_until": kb.expiry_for("scholarship", deadline=dl)}


def web_round(query: str, domains: list[str], usage: dict, stats: dict) -> list[str]:
    """One search on the web, reading every new page found. Returns the stored item ids."""
    results = search(query, domains, usage)
    by_kind: dict[str, list[dict]] = {"page": [], "article": [], "snippet": []}
    for r in results:
        k = url_kind(r["url"])
        if k != "drop":
            by_kind[k].append(r)
    stored = kb.by_urls([r["url"] for r in results])
    recent = {u for u, row in stored.items() if row.get("last_checked_at") and
              datetime.fromisoformat(row["last_checked_at"].replace("Z", "+00:00")) > kb.now() - timedelta(days=RECHECK_DAYS)}
    ids = [stored[u]["id"] for u in recent if datetime.fromisoformat(stored[u]["valid_until"].replace("Z", "+00:00")) > kb.now()]
    recs: list[dict] = []
    for r in by_kind["snippet"]:
        if r["url"] in recent:
            continue
        rec = parse_snippet(r["title"], r["snippet"], r["url"])
        if rec:
            recs.append(rec)
    to_read = [r["url"] for r in by_kind["page"] + by_kind["article"] if r["url"] not in recent]
    texts = extract(to_read, usage) if to_read else {}
    follow: list[str] = []
    for url in to_read:
        md = texts.get(url) or ""
        if len(md) < 300:
            stats["unreadable"] += 1
            continue
        rec = parse_page(url, md)
        if rec is None and "/article/" in url:
            follow += scholarship_links(md, 4)
            entries = parse_list_entries(md, url)
            recs += entries
            stats["list_pages"] += 1
            stats["list_entries"] += len(entries)
            continue
        if rec:
            recs.append(rec)
        else:
            stats["unparsed"] += 1
    follow = [u for u in dict.fromkeys(follow) if u not in recent and u not in texts][:8]
    if follow:
        stored2 = kb.by_urls(follow)
        follow = [u for u in follow if u not in stored2]
        texts2 = extract(follow, usage) if follow else {}
        for url in follow:
            md = texts2.get(url) or ""
            rec = parse_page(url, md) if len(md) >= 300 else None
            if rec:
                recs.append(rec)
            else:
                stats["unreadable"] += 1
    keep = []
    for rec in recs:
        if match(rec, {})["status"] == "expired":
            stats["expired"] += 1
            continue
        keep.append(llm_fill(rec))
    stats["parsed"] += len(keep)
    rows = kb.upsert_items([_to_item(r) for r in keep])
    ids += [r["id"] for r in rows]
    if not rows and keep:  # store not available yet: keep this run's records in memory
        stats["_memory"] += keep
    return list(dict.fromkeys(ids))


def _verified(facts: dict) -> list[dict]:
    from app.services.graph import graph, scheme_status
    g = graph()
    checks = [scheme_status(x, facts) for x in g.schemes]
    checks = [c for c in checks if c and c["result"] != "not_eligible" and g.schemes[c["slug"]]["kind"] == "scholarship"]
    checks.sort(key=lambda c: (c["result"] != "eligible", len(c["missing"])))
    return checks


def _same(a: str, b: str) -> bool:
    w = lambda s: {x for x in re.findall(r"[a-z]+", s.lower()) if len(x) > 3 and x not in {"scholarship", "scheme", "government", "india", "students"}}  # noqa: E731
    x, y = w(a), w(b)
    return bool(x and y) and len(x & y) / len(x | y) >= 0.7


def discover(facts: dict, allow_web: bool = True, limit: int = 30) -> dict:
    """Verified government schemes (fixed rules) first, then scholarships found on the web, matched for this student.
    The store is read first; the web is searched only when plan says so (see knowledge.need_web_search)."""
    usage = {"calls": 0, "credits": 0}
    stats = {"parsed": 0, "expired": 0, "unreadable": 0, "unparsed": 0, "list_pages": 0, "list_entries": 0, "_memory": []}
    state = facts.get("state") if facts.get("state") not in (None, "Other") else None

    def matched_from_store() -> list[tuple[dict, dict, str | None]]:
        rows = kb.find(["scholarship"], state=state, limit=500)
        recs = [(r["data"], r["id"]) for r in rows] + [(r, None) for r in stats["_memory"]]
        out, seen = [], set()
        for rec, rid in recs:
            if rec["source_url"] in seen:
                continue
            seen.add(rec["source_url"])
            out.append((rec, match(rec, facts), rid))
        return out

    pool = matched_from_store()
    searched, skipped = [], []
    for q, domains in plan_queries(facts):
        relevant = sum(1 for _, m, _i in pool if m["status"] in ("likely_eligible", "check"))
        last = kb.last_search("scholarship", q)
        if not allow_web or not get_settings().tavily_api_key or not kb.need_web_search(kb.searched_at(last), relevant, MIN_ITEMS):
            skipped.append(q)
            continue
        ids = web_round(q, domains, usage, stats)
        kb.log_search("scholarship", q, ids, "tavily", filters={"domains": domains, **{k: facts.get(k) for k in
                      ("class_level", "course", "state", "district", "social_category", "gender", "family_income_annual", "is_minority")}})
        searched.append(q)
        pool = matched_from_store()

    verified = _verified(facts)
    found = []
    for rec, m, rid in pool:
        if m["status"] == "expired" or rec.get("non_monetary") or any(_same(rec["name"], v["name"]) for v in verified):
            continue
        found.append({"id": rid, **{k: rec.get(k) for k in ("name", "provider", "provider_type", "amount_text", "amount", "deadline",
                                                 "deadline_text", "documents", "how_to_apply", "apply_url", "source_url", "source_site",
                                                 "site_name", "last_seen", "partial", "eligibility_text")},
                      "days_left": days_left(rec), "match": m["status"], "reasons": m["reasons"], "unknown": m["unknown"]})
    rank = {"likely_eligible": 0, "check": 1, "not_eligible": 2}
    found.sort(key=lambda x: (rank[x["match"]], x["partial"], x["days_left"] if x["days_left"] is not None else 9999, -(x["amount"] or 0)))
    counts = {"verified": len(verified), "verified_eligible": sum(1 for v in verified if v["result"] == "eligible"),
              **{k: sum(1 for x in found if x["match"] == k) for k in rank}}
    shown = [x for x in found if x["match"] != "not_eligible"][:limit]
    kb.hit([x["id"] for x in shown if x.get("id")])
    optional = [f for f in ("social_category", "family_income_annual", "marks_percent", "is_minority", "is_disabled") if facts.get(f) is None]
    asked = list(dict.fromkeys(u for x in shown for u in x["unknown"] if u in optional))
    return {"verified": verified, "found": shown, "not_eligible": [x for x in found if x["match"] == "not_eligible"][:10],
            "counts": counts, "from_store": not searched, "searched": searched, "skipped": skipped,
            "tavily": {k: v for k, v in usage.items()}, "stats": {k: v for k, v in stats.items() if k != "_memory"},
            "ask": asked[:3], "checked_on": date.today().isoformat(),
            "sites": sorted({x["site_name"] for x in shown if x.get("site_name")})}


def compact(res: dict) -> str:
    """What the model sees: counts and names only."""
    c = res["counts"]
    names = "; ".join(f"{x['name'][:60]} ({x['match']}{', ' + str(x['days_left']) + ' days left' if x['days_left'] is not None else ''})" for x in res["found"][:6])
    return (f"found on {', '.join(res['sites']) or 'the web'}: {c['likely_eligible']} likely eligible, {c['check']} to check on the card; "
            f"{names or 'none open now'}. Student should check details on each official page.")
