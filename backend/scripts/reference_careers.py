"""Reference every career in shared/catalogue/careers.json against reputable web sources.

For each career this makes at most two Tavily searches:
  1. pay: entry-level monthly pay in India, restricted to salary sites and NCS;
  2. path: education / licence route, restricted to NCS, NSDC, Skill India and the regulator for that path.

Pay figures are pulled out of the returned text by plain code (no AI): rupee amounts, "15k", "1.8 LPA"
(divided by 12) and "per day" (times 26). Only sentences that name the role are used. Each site gives one
value (the median of its entry-level figures); the evidence range is the lowest and highest site value.

    pay_status = "matches"     our range overlaps the evidence
                 "differs"     it does not: pay_min / pay_max are replaced by the evidence range (rounded
                               to Rs 500) and the old values are kept in pay_previous for review
                 "unverified"  fewer than 2 sites gave numbers (or they disagree wildly): nothing is changed

Nothing is invented: a source is listed only if Tavily returned that page and it mentions the role.

    cd backend && python -m scripts.reference_careers            # real run, rewrites careers.json
    cd backend && python -m scripts.reference_careers --dry-run  # print the table, change nothing
    cd backend && python -m scripts.reference_careers --only electrician,plumber
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import statistics
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urlparse

CHECKED_ON = "2026-11-21"
SHARED = Path(__file__).resolve().parents[2] / "shared"
CAREERS_PATH = SHARED / "catalogue" / "careers.json"
CACHE_PATH = Path(__file__).resolve().parent / ".reference_cache.json"

PAY_DOMAINS = ["ncs.gov.in", "ambitionbox.com", "naukri.com", "in.indeed.com", "indeed.com", "glassdoor.co.in",
               "payscale.com", "workindia.in", "apna.co"]
PATH_DOMAINS = ["ncs.gov.in", "nsdcindia.org", "skillindiadigital.gov.in"]
# Regulators / official bodies for the path, added to PATH_DOMAINS for these careers.
REGULATORS = {
    "iti": ["dgt.gov.in", "ncvtmis.gov.in"],
    "nursing": ["indiannursingcouncil.org", "nmc.org.in"],
    "teacher": ["ncte.gov.in"],
    "doctor": ["nmc.org.in", "nta.ac.in"],
    "pharma": ["pci.nic.in"],
    "law": ["barcouncilofindia.org"],
    "forces": ["joinindianarmy.nic.in", "indianrailways.gov.in", "rrbcdg.gov.in"],
    "bank": ["ibps.in", "iibf.org.in"],
    "drone": ["dgca.gov.in"],
    "vet": ["vci.gov.in"],
    "engineer": ["aicte-india.org", "dgt.gov.in"],
}
CAREER_REG = {
    "electrician": "iti", "plumber": "iti", "welder": "iti", "motor-mechanic": "iti", "ev-technician": "iti",
    "cnc-operator": "iti", "carpenter": "iti", "draughtsman": "iti", "railway-technician": "forces",
    "anm-nurse": "nursing", "staff-nurse": "nursing", "primary-teacher": "teacher", "doctor": "doctor",
    "pharmacist": "pharma", "lawyer": "law", "police-constable": "forces", "army-soldier": "forces",
    "bank-clerk": "bank", "bank-mitra": "bank", "agri-drone-pilot": "drone", "vet-assistant": "vet",
    "civil-engineer": "engineer", "electrical-engineer": "engineer", "lab-technician": "nursing",
}
# Self-employed or stipend roles: salary sites do not describe them, so pay stays unverified.
NOT_SALARIED = {"dairy-entrepreneur", "organic-farmer", "small-business", "handicraft-artisan", "content-creator",
                "anganwadi-worker"}

# Phrases that name the role in source text; the first one is used in the search query.
ROLES = {
    "electrician": ["electrician"], "solar-technician": ["solar technician", "solar pv technician", "solar installer"],
    "plumber": ["plumber"], "welder": ["welder"],
    "motor-mechanic": ["motor mechanic", "auto mechanic", "automobile mechanic", "two wheeler mechanic", "bike mechanic", "car mechanic"],
    "ev-technician": ["ev technician", "electric vehicle technician"],
    "mobile-repair": ["mobile repair", "mobile technician", "mobile phone repair"],
    "cnc-operator": ["cnc operator", "cnc machine operator"], "carpenter": ["carpenter"],
    "mason": ["mason", "construction supervisor"], "tailor": ["tailor"],
    "beautician": ["beautician", "beauty therapist"], "cook-chef": ["cook", "chef"],
    "hotel-front-office": ["front office executive", "front office associate", "front desk executive", "front office"],
    "tour-guide": ["tour guide", "tourist guide"], "driver": ["driver"],
    "delivery-logistics": ["warehouse associate", "logistics associate", "warehouse executive"],
    "data-entry": ["data entry operator", "data entry"], "csc-operator": ["csc operator", "common service centre operator"],
    "software-developer": ["software developer"], "web-designer": ["web designer", "ui designer"],
    "graphic-designer": ["graphic designer"], "photographer": ["photographer", "videographer"],
    "content-creator": ["content creator"], "primary-teacher": ["primary teacher", "primary school teacher", "prt"],
    "anm-nurse": ["anm", "auxiliary nurse midwife"], "staff-nurse": ["staff nurse", "gnm nurse"],
    "lab-technician": ["lab technician", "medical lab technician", "dmlt"], "pharmacist": ["pharmacist"],
    "physio-assistant": ["physiotherapist", "physiotherapy assistant"], "doctor": ["mbbs doctor", "medical officer", "doctor"],
    "vet-assistant": ["veterinary assistant", "livestock inspector", "veterinary field assistant"],
    "dairy-entrepreneur": ["dairy farmer", "dairy farm"], "organic-farmer": ["organic farmer", "farmer"],
    "agri-drone-pilot": ["drone pilot", "remote pilot"], "food-processing": ["food processing technician", "food processing"],
    "agri-graduate": ["agriculture officer", "agronomist"], "accountant": ["accountant", "tax assistant"],
    "bank-clerk": ["bank clerk", "probationary officer"], "bank-mitra": ["bank mitra", "business correspondent"],
    "police-constable": ["police constable", "constable"], "army-soldier": ["agniveer", "soldier"],
    "railway-technician": ["railway technician", "technician grade"], "anganwadi-worker": ["anganwadi worker", "anganwadi", "asha worker"],
    "social-worker": ["social worker"], "journalist": ["journalist", "reporter"], "lawyer": ["lawyer", "advocate"],
    "civil-engineer": ["civil engineer"], "electrical-engineer": ["electrical engineer"],
    "draughtsman": ["draughtsman", "draftsman", "cad operator"], "ai-data-annotator": ["data annotator", "data annotation"],
    "digital-marketer": ["digital marketing executive", "digital marketing"],
    "retail-sales": ["retail sales associate", "sales associate", "store associate"],
    "small-business": ["shop owner", "small business owner"], "handicraft-artisan": ["handicraft artisan", "handloom weaver", "artisan"],
    "fitness-trainer": ["fitness trainer", "gym trainer"],
}
# A role word right after one of these is a different (senior or adjacent) job.
MODIFIERS = {"senior", "sr", "chief", "head", "lead", "principal", "manager", "supervisor", "assistant", "apprentice",
             "panel", "master", "associate", "junior"}
ENTRY_RE = re.compile(r"fresher|entry|starting|beginner|junior|0\s?[-–]\s?[12]\b|less than (1|one) year|\b1 year\b", re.I)
# Segments about the top of the distribution, or only its floor, say nothing about typical entry pay.
TOP_RE = re.compile(r"\b(top|highest|lowest|maximum|max|minimum|90th|10th|percentile|senior|chief|manager|head of)\b|low of", re.I)
HIGH_RE = re.compile(r"\b(highest|high of|top \d+%|top earners|maximum|up to|upto)\b", re.I)

MIN_MONTHLY, MAX_MONTHLY = 3000, 500000


# --- parsing money -------------------------------------------------------------------------------

_FIG = re.compile(
    r"(?P<cur>₹|rs\.?|inr)?\s?(?P<num>\d{1,3}(?:,\d{2,3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s?(?P<suf>k\b|l\b|lakhs?|lacs?|lpa|lac\b)?",
    re.I,
)
_RANGE_AFTER = re.compile(r"\s*(?:[-–]|to)\s*\d+(?:\.\d+)?\s?(lakhs?|lacs?|lpa)", re.I)
_HOUR = re.compile(r"(per|an?|/)\s?(hour|hr)\b|hourly|per week|weekly", re.I)
_MONTH = re.compile(r"(per|a|each|/)\s?month|monthly|/\s?mo\b|\bp\.?m\.?\b|\bpm\b", re.I)
_YEAR = re.compile(r"(per|a|/)\s?(year|annum|anum|yr)|annual|yearly|\bp\.?a\.?\b|\blpa\b", re.I)
_DAY = re.compile(r"(per|a|/)\s?day|daily|per shift", re.I)


def _unit_in(window: str) -> str | None:
    w = window[:45]
    if _HOUR.search(w):
        return "skip"
    best = None
    for name, rx in (("month", _MONTH), ("year", _YEAR), ("day", _DAY)):
        m = rx.search(w)
        if m and (best is None or m.start() < best[0]):
            best = (m.start(), name)
    return best[1] if best else None


def to_monthly(value: float, unit: str) -> int | None:
    m = value / 12 if unit == "year" else value * 26 if unit == "day" else value
    m = round(m)
    return m if MIN_MONTHLY <= m <= MAX_MONTHLY else None


def parse_amounts(text: str, default_unit: str | None = None) -> list[dict]:
    """Rupee amounts in `text` as monthly rupees: [{"monthly": 18260, "raw": "₹18,260 per month", "after_high": False}].
    `range_end` marks the second number of "X - Y". `default_unit` ("year" for PayScale, which
    quotes annual pay without saying so) is used when a figure has no period of its own. Amounts with no clear period (per month / year / day) are ignored, as are hourly and weekly ones."""
    text = re.sub(r"\bRs\.\s?", "₹", text)
    hm = HIGH_RE.search(text)
    found = []
    for m in _FIG.finditer(text):
        cur, suf = m.group("cur"), (m.group("suf") or "").lower()
        num = float(m.group("num").replace(",", ""))
        rng = False
        if not cur and not suf:
            r = _RANGE_AFTER.match(text, m.end())
            if not r:
                continue
            suf, rng = r.group(1).lower(), True
        if suf == "k" and not cur:
            nxt = _unit_in(text[m.end(): m.end() + 45])
            if nxt not in ("month", "year", "day"):
                continue
        # a bare number glued to a date or phone-like digit run is not money
        if not cur and suf in ("", "l") and not rng:
            continue
        mult = 1000 if suf == "k" else 100000 if suf in ("l", "lac", "lacs", "lakh", "lakhs", "lpa") else 1
        found.append({"start": m.start(), "end": m.end(), "value": num * mult, "lakh": mult == 100000,
                      "after_high": bool(hm and m.start() > hm.start())})
    out = []
    # units: look right of each figure up to the next figure; a short gap inherits the next figure's unit
    for i, f in enumerate(found):
        nxt = found[i + 1]["start"] if i + 1 < len(found) else len(text)
        f["unit"] = _unit_in(text[f["end"]: min(nxt, f["end"] + 45)])
    for i in range(len(found) - 1, -1, -1):
        f = found[i]
        if f["unit"] is None and i + 1 < len(found):
            gap = text[f["end"]: found[i + 1]["start"]]
            if len(gap) <= 24 and not re.search(r"\d", gap):
                f["unit"] = found[i + 1]["unit"]
        if f["unit"] is None and f["lakh"]:
            f["unit"] = "year"
        if f["unit"] is None and default_unit:
            f["unit"] = default_unit
    for i, f in enumerate(found):
        f["range_end"] = bool(i and re.fullmatch(r"\s*(?:[-–]|to|and)\s*(?:an?\s+)?", text[found[i - 1]["end"]: f["start"]], re.I)
                              and (text[found[i - 1]["end"]: f["start"]].strip()))
    for f in found:
        if f["unit"] in (None, "skip"):
            continue
        monthly = to_monthly(f["value"], f["unit"])
        if monthly is None:
            continue
        out.append({"monthly": monthly, "raw": text[f["start"]: f["end"] + 14].strip(),
                    "after_high": f["after_high"], "range_end": f["range_end"]})
    return out


# --- role matching and entry-level selection -----------------------------------------------------

def role_present(text: str, phrases: list[str]) -> bool:
    """True if one of the role phrases appears without a senior/adjacent modifier right before it."""
    low = text.lower()
    for p in phrases:
        for m in re.finditer(r"(?<![a-z])" + re.escape(p) + r"s?(?![a-z])", low):
            prev = re.findall(r"[a-z]+", low[max(0, m.start() - 20): m.start()])
            if not prev or prev[-1] not in MODIFIERS:
                return True
    return False


def _segments(text: str) -> list[str]:
    text = re.sub(r"\bRs\.\s?", "₹", text)
    return [s.strip() for s in re.split(r"(?<=[.!?])\s+(?=[A-Z])|\s·\s|\n+|\s\|\s", text) if s.strip()]


def _too_senior(seg: str) -> bool:
    for m in re.finditer(r"(\d+)\s?(?:[-–]\s?\d+)?\s?\+?\s?(?:years|yrs|yr)\b", seg, re.I):
        if int(m.group(1)) >= 3:
            return True
    return False


def entry_values(text: str, phrases: list[str], page_is_role: bool, default_unit: str | None = None) -> tuple[list[int], bool]:
    """Monthly figures from sentences about this role. Returns (figures, any_entry_level).
    `page_is_role` means the page title or URL is about the role, so a sentence may leave the role unnamed
    unless it is labelled as another job ("Senior Electrician: ...")."""
    entry: list[int] = []
    other: list[int] = []
    for seg in _segments(text):
        if TOP_RE.search(seg) and not ENTRY_RE.search(seg) or _too_senior(seg):
            continue
        named = role_present(seg, phrases)
        is_entry = bool(ENTRY_RE.search(seg))
        label = re.match(r"^([A-Z][\w &/-]{2,40}):\s", seg)
        labelled_other = bool(label) and not named and not re.search(r"salary|pay|average|stipend|ctc|range", label.group(1), re.I)
        if not (named or (page_is_role and not labelled_other)):
            continue
        for a in parse_amounts(seg, default_unit):
            if a["after_high"] or a["range_end"]:  # for "X to Y" only X, the entry end, counts
                continue
            (entry if is_entry else other).append(a["monthly"])
    return (entry, True) if entry else (other, False)


def median_int(xs: list[int | float]) -> int:
    return int(round(statistics.median(xs)))


def round500(x: float) -> int:
    return int(round(x / 500.0) * 500)


def evidence_range(site_values: dict[str, int]) -> dict:
    vals = list(site_values.values())
    return {"min": min(vals), "max": max(vals), "n_sources": len(vals)} if vals else {"min": None, "max": None, "n_sources": 0}


def decide(pay_min: int, pay_max: int, ev: dict, salaried: bool = True) -> dict:
    """Status logic. Returns {"status", "pay_min", "pay_max", "changed", "reason"}."""
    keep = {"pay_min": pay_min, "pay_max": pay_max, "changed": False}
    if not salaried:
        return {**keep, "status": "unverified", "reason": "self-employed or stipend role: no salary data"}
    if ev["n_sources"] < 2:
        return {**keep, "status": "unverified", "reason": f"only {ev['n_sources']} site(s) with pay numbers"}
    lo, hi = ev["min"], ev["max"]
    if hi > 3.5 * lo:
        return {**keep, "status": "unverified", "reason": "sites disagree too much to use"}
    if lo <= pay_max and hi >= pay_min:
        return {**keep, "status": "matches", "reason": "ranges overlap"}
    new_lo, new_hi = (round500(lo), round500(hi)) if hi > lo else (round500(lo * 0.85), round500(lo * 1.15))
    if new_hi <= new_lo:
        new_hi = new_lo + 500
    return {"status": "differs", "pay_min": new_lo, "pay_max": new_hi, "changed": True,
            "reason": "evidence is " + ("above" if lo > pay_max else "below") + " our range"}


# --- Tavily ----------------------------------------------------------------------------------------

def _site(url: str) -> str:
    host = urlparse(url).netloc.lower()
    return host[4:] if host.startswith("www.") else host


def _load_cache() -> dict:
    try:
        return json.loads(CACHE_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def pay_site(url: str) -> str:
    """One name per publisher, so in.indeed.com and indeed.com count once."""
    host = _site(url)
    return "indeed.com" if host.endswith("indeed.com") else host


def search(query: str, domains: list[str], cache: dict, key: str, max_results: int = 8) -> list[dict]:
    ck = hashlib.sha256((query + "|" + ",".join(domains) + f"|{max_results}").encode()).hexdigest()[:32]
    if ck in cache:
        return cache[ck]
    import httpx
    r = httpx.post("https://api.tavily.com/search", timeout=40, headers={"Authorization": f"Bearer {key}"},
                   json={"query": query, "max_results": max_results, "search_depth": "basic", "include_domains": domains})
    r.raise_for_status()
    res = [{"title": x.get("title") or "", "url": x["url"], "content": x.get("content") or ""} for x in r.json().get("results", [])]
    cache[ck] = res
    return res


def _company_page(url: str) -> bool:
    """Pages for one employer, one city, or a combined job title say little about the national entry-level pay."""
    return bool(re.search(r"/cmp/|-salaries/|/companies/|/company/|-location|/salaries/[A-Z][\w%-]*--|_or_", url))


def reference_career(c: dict, cache: dict, key: str) -> dict:
    slug = c["slug"]
    phrases = ROLES.get(slug) or [c["name"].lower()]
    main = phrases[0]
    pay_results = search(f"{main} fresher entry level salary per month India", PAY_DOMAINS, cache, key, 15)
    reg = REGULATORS.get(CAREER_REG.get(slug, ""), [])
    path_results = search(f"how to become {main} India eligibility qualification training", PATH_DOMAINS + reg, cache, key, 10)

    site_figs: dict[str, list[int]] = {}
    pay_sources: list[dict] = []
    for r in pay_results:
        url, title, content = r["url"], r["title"], r["content"]
        if _company_page(url) or "Ray ID" in content or "Cloudflare" in content:
            continue
        if not role_present(title + " " + content, phrases):
            continue
        page_is_role = role_present(title + " " + url.replace("-", " ").replace("_", " ").replace("/", " "), phrases)
        site = pay_site(url)
        vals, _ = entry_values(content, phrases, page_is_role, "year" if site == "payscale.com" else None)
        note = "Mentions this role; no pay figure in the returned text."
        if vals:
            site_figs.setdefault(site, []).extend(vals)
            note = f"Pay figure(s) found: about Rs {min(vals):,}" + (f" to Rs {max(vals):,}" if max(vals) != min(vals) else "") + " per month."
        pay_sources.append({"title": title[:120], "url": url, "site": site, "note": note, "_has": bool(vals)})
    path_sources = []
    for r in path_results:
        if "Ray ID" in r["content"] or not role_present(r["title"] + " " + r["content"], phrases):
            continue
        path_sources.append({"title": r["title"][:120], "url": r["url"], "site": _site(r["url"]),
                             "note": "Training, eligibility and licence details for this role.", "_has": False})

    site_values = {s: median_int(v) for s, v in site_figs.items()}
    ev = evidence_range(site_values)
    pay_sources.sort(key=lambda s: not s["_has"])
    per_site: dict[str, int] = {}
    diverse = []
    for s_ in pay_sources:  # at most two pages per site, so the list shows where the evidence comes from
        per_site[s_["site"]] = per_site.get(s_["site"], 0) + 1
        if per_site[s_["site"]] <= 2:
            diverse.append(s_)
    pay_sources = diverse
    gov = lambda s: 0 if s["site"].endswith(("gov.in", "nic.in")) or s["site"].endswith("org") else 1  # noqa: E731
    path_sources.sort(key=gov)
    sources, seen = [], set()
    for s in pay_sources[:4] + path_sources[:3]:
        if s["url"] not in seen:
            seen.add(s["url"])
            sources.append({k: v for k, v in s.items() if not k.startswith("_")})
    return {"slug": slug, "sources": sources, "evidence": ev, "site_values": site_values}


def original_pay(c: dict) -> dict:
    """The hand-written range, even if an earlier run replaced it (the old values are kept in pay_previous)."""
    prev = c.get("pay_previous")
    return {**c, "pay_min": prev["pay_min"], "pay_max": prev["pay_max"]} if prev else c


def apply_result(c: dict, res: dict) -> dict:
    c = original_pay(c)  # a re-run judges the evidence against the original range, never against its own earlier edit
    d = decide(c["pay_min"], c["pay_max"], res["evidence"], salaried=c["slug"] not in NOT_SALARIED)
    out = {"sources": res["sources"], "pay_evidence": res["evidence"], "checked_on": CHECKED_ON, "pay_status": d["status"]}
    out["pay_min"], out["pay_max"] = d["pay_min"], d["pay_max"]
    out["pay_previous"] = {"pay_min": c["pay_min"], "pay_max": c["pay_max"]} if d["changed"] else None  # None = remove the key
    return {"fields": out, "decision": d}


def write_results(updates: dict[str, dict]) -> None:
    """Re-read careers.json right now and change only our keys on the listed careers."""
    doc = json.loads(CAREERS_PATH.read_text(encoding="utf-8"))
    for c in doc["careers"]:
        u = updates.get(c["slug"])
        if u:
            c.update({k: v for k, v in u.items() if v is not None})
            if u.get("pay_previous", 0) is None:
                c.pop("pay_previous", None)
    fd, tmp = tempfile.mkstemp(dir=CAREERS_PATH.parent, suffix=".tmp")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=2, ensure_ascii=False)
        f.write("\n")
    os.replace(tmp, CAREERS_PATH)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--only", default="")
    args = ap.parse_args()
    from app.core.config import get_settings
    key = get_settings().tavily_api_key
    if not key:
        sys.exit("TAVILY_API_KEY is not set")
    careers = json.loads(CAREERS_PATH.read_text(encoding="utf-8"))["careers"]
    if args.only:
        wanted = set(args.only.split(","))
        careers = [c for c in careers if c["slug"] in wanted]
    cache = _load_cache()

    def run(c):
        try:
            return c, reference_career(c, cache, key), None
        except Exception as e:  # keep going: one failed search must not stop the run
            return c, None, str(e)

    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(run, careers))
    CACHE_PATH.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")

    updates, rows = {}, []
    for c, res, err in results:
        c = original_pay(c)
        if err:
            rows.append((c["slug"], "ERROR", f"{c['pay_min']}-{c['pay_max']}", "-", "-", err[:60]))
            continue
        a = apply_result(c, res)
        updates[c["slug"]] = a["fields"]
        ev = res["evidence"]
        rows.append((c["slug"], a["fields"]["pay_status"], f"{c['pay_min']}-{c['pay_max']}",
                     f"{ev['min']}-{ev['max']} ({ev['n_sources']})" if ev["n_sources"] else "-",
                     f"{a['fields'].get('pay_min', c['pay_min'])}-{a['fields'].get('pay_max', c['pay_max'])}" if a["decision"]["changed"] else "unchanged",
                     f"{len(res['sources'])} src; {a['decision']['reason']}"))
    print(f"{'career':22} {'status':11} {'ours':14} {'evidence (sites)':22} {'new range':14} notes")
    for r in rows:
        print(f"{r[0]:22} {r[1]:11} {r[2]:14} {r[3]:22} {r[4]:14} {r[5]}")
    from collections import Counter
    print(Counter(r[1] for r in rows))
    if not args.dry_run:
        write_results(updates)
        print(f"wrote {len(updates)} careers to {CAREERS_PATH}")


if __name__ == "__main__":
    main()
