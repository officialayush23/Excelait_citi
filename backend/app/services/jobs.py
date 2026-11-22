"""Current job openings from reputed job sites, found with Tavily and read with plain code.

The model never writes a listing: it only sees the compact lines this module returns, and the
student sees each posting with its site, link and date. Every posting found is kept in the knowledge
store (knowledge_items) until its own time runs out (apply-by date, or posted date + 30 days), so a
posting found for one student is shown to the next student in the same district from the database."""

from __future__ import annotations

import re
from concurrent.futures import ThreadPoolExecutor
from datetime import date

import httpx

from app.core.config import get_settings
from app.services import knowledge as kb

MIN_STORED = 5            # fewer stored fresh postings than this for role + place -> search the web
JOB_SITES = ["apna.co", "workindia.in", "in.indeed.com", "naukri.com", "ncs.gov.in"]
APPRENTICE_SITES = ["apprenticeshipindia.gov.in"]
SITE_NAMES = {"apna.co": "apna", "workindia.in": "WorkIndia", "in.indeed.com": "Indeed", "naukri.com": "Naukri",
              "ncs.gov.in": "National Career Service", "apprenticeshipindia.gov.in": "Apprenticeship India (Govt)"}
# Nearby big job markets to try when a district has nothing.
NEARBY = {"maharashtra": ["Pune", "Mumbai", "Nashik", "Nagpur", "Aurangabad"], "uttar pradesh": ["Lucknow", "Kanpur", "Noida"]}
DROP = re.compile(r"salar|career-advice|/blog|/explorer/|interview-question|/companies/|/cmp/|/resume|how-to", re.IGNORECASE)


def _site(url: str) -> str | None:
    host = re.sub(r"^https?://(www\.)?", "", url).split("/")[0].lower()
    return next((s for s in [*JOB_SITES, *APPRENTICE_SITES] if host == s or host.endswith("." + s)), None)


def _tavily_search(query: str, domain: str) -> list[dict]:
    s = get_settings()
    raw = domain in ("workindia.in", "apna.co")
    r = httpx.post("https://api.tavily.com/search", timeout=40, headers={"Authorization": f"Bearer {s.tavily_api_key}"},
                   json={"query": query, "max_results": 6, "search_depth": "advanced", "country": "india", "include_domains": [domain],
                         **({"include_raw_content": "markdown"} if raw else {})})
    r.raise_for_status()
    out = []
    for x in r.json().get("results", []):
        row = {"title": x.get("title") or "", "url": x["url"], "snippet": (x.get("content") or "")[:300], "published": x.get("published_date")}
        text = x.get("raw_content") or ""
        if domain == "workindia.in" and text:
            row["parsed"] = [_parse_workindia_post(x["url"], text)] if "/jobs/" in x["url"] else _parse_workindia_list(text)
        elif domain == "apna.co" and text:
            row["parsed"] = _parse_apna_list(text)
        out.append(row)
    return out


def _tavily_extract(urls: list[str]) -> dict[str, str]:
    if not urls:
        return {}
    s = get_settings()
    try:
        r = httpx.post("https://api.tavily.com/extract", timeout=60, headers={"Authorization": f"Bearer {s.tavily_api_key}"},
                       json={"urls": urls, "extract_depth": "basic", "format": "markdown"})
        r.raise_for_status()
        return {x["url"]: (x.get("raw_content") or "")[:40000] for x in r.json().get("results", [])}
    except httpx.HTTPError:
        return {}


# ---------------- page readers (plain code, one per site) ----------------

def _title_from_slug(slug: str) -> str:
    return slug.replace("__", " / ").replace("_", " ").strip().title()


def _workindia_slug(url: str) -> tuple[str, str] | None:
    """/jobs/iti_electrician-akurdi-pune-8345083 -> ('Iti Electrician', 'Akurdi, Pune')"""
    m = re.search(r"/jobs/([a-z0-9_]+)-([a-z0-9_-]+?)-(\d{5,})/?$", url)
    if not m:
        return None
    parts = m.group(2).split("-")
    return _title_from_slug(m.group(1)), ", ".join(p.replace("_", " ").title() for p in parts)


def _parse_workindia_post(url: str, text: str) -> dict | None:
    t = _workindia_slug(url)
    if not t:
        return None
    pay = re.search(r"Rs\.\s?(\d[\d,]*)\s*-\s*Rs\.\s?(\d[\d,]*)", text)
    posted = re.search(r"Posted on:\s*(\d{1,2})/(\d{1,2})/(\d{4})", text)
    emp = re.search(r"Ans\.\s*(.+?) will provide a salary", text)
    return {"title": t[0], "employer": emp.group(1).strip()[:80] if emp else None, "place": t[1],
            "pay": f"Rs {pay.group(1)} - Rs {pay.group(2)} a month" if pay else None,
            "posted": f"{posted.group(3)}-{int(posted.group(1)):02d}-{int(posted.group(2)):02d}" if posted else None,
            "site": "workindia.in", "url": url}


def _parse_workindia_list(text: str) -> list[dict]:
    out = []
    for title, url in re.findall(r"## \[([^\]]+)\]\((https://www\.workindia\.in/jobs/[^)\s]+)\)", text):
        t = _workindia_slug(url)
        out.append({"title": title.strip(), "employer": None, "place": t[1] if t else None, "pay": None, "posted": None,
                    "site": "workindia.in", "url": url})
    return out


def _parse_apna_list(text: str) -> list[dict]:
    """Apna listing pages hold each post as [## Title\\n\\nCompany\\n\\nPlace\\n\\n₹a - ₹b ...](/job/...)."""
    out = []
    for chunk, href in re.findall(r"\[## (.+?)\]\((/job/[^)\s]+)\)", text, re.DOTALL):
        lines = [x.strip() for x in chunk.split("\n") if x.strip()]
        if len(lines) < 3:
            continue
        pay = next((x for x in lines if x.startswith("₹")), None)
        out.append({"title": lines[0][:90], "employer": lines[1][:80], "place": lines[2][:80],
                    "pay": (pay.replace("₹", "Rs ") + " a month") if pay else None, "posted": None,
                    "part_time": "Part Time" in lines, "site": "apna.co", "url": "https://apna.co" + href})
    return out


def _kind(url: str) -> str:
    """'post' for one job, 'page' for a listing page, 'drop' for anything else (guides, salary pages)."""
    if DROP.search(url):
        return "drop"
    if re.search(r"apna\.co/job/|workindia\.in/jobs/[a-z0-9_]+-[a-z0-9_-]+-\d{5,}|indeed\.com/viewjob|naukri\.com/job-listings-|apprenticeshipindia\.gov\.in/apprenticeship/opportunity-view/|ncs\.gov\.in/.*job-?detail", url, re.IGNORECASE):
        return "post"
    if re.search(r"jobs|job-listing|vacanc|apprenticeship/opportunity", url, re.IGNORECASE):
        return "page"
    return "drop"


def _stems(role: str) -> list[str]:
    words = [w for w in re.findall(r"[a-z]+", role.lower()) if len(w) >= 4 and w not in {"jobs", "fresher", "part", "time", "near", "work"}]
    return [w[:6] for w in words] or [role.lower()[:6]]


def _matches(text: str, stems: list[str]) -> bool:
    t = text.lower()
    return any(s in t for s in stems)


def _slugify(x: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", x.lower()).strip("-")


def apprentice_only(sites: list[str]) -> bool:
    return all(s in APPRENTICE_SITES for s in sites)


def _canonical_pages(role: str, city: str) -> list[str]:
    r, c = _slugify(role), _slugify(city)
    return [f"https://apna.co/jobs/{r}-jobs-in-{c}", f"https://www.workindia.in/{r}-jobs-in-{c}/"]


def search_links(role: str, city: str) -> list[dict]:
    """The sites' own search pages for this role and place, for 'see more on the site'."""
    q, c = httpx.QueryParams({"q": role, "l": city}), _slugify(city)
    return [{"title": f"{role.title()} jobs in {city.title()}", "site": "in.indeed.com", "url": f"https://in.indeed.com/jobs?{q}", "snippet": ""},
            {"title": f"{role.title()} jobs in {city.title()}", "site": "naukri.com", "url": f"https://www.naukri.com/{_slugify(role)}-jobs-in-{c}", "snippet": ""},
            {"title": f"{role.title()} jobs in {city.title()}", "site": "apna.co", "url": f"https://apna.co/jobs/{_slugify(role)}-jobs-in-{c}", "snippet": ""}]


def _search_place(role: str, place: str, sites: list[str], part_time: bool) -> tuple[list[dict], list[dict]]:
    extra = " part time" if part_time else ""
    stems, p = _stems(role), place.lower().split(",")[0].strip()
    queries = {s: (f"{role} apprenticeship {place}" if s in APPRENTICE_SITES else f"{role} jobs in {place}{extra}") for s in sites}
    with ThreadPoolExecutor(max_workers=len(sites)) as ex:
        found = dict(zip(sites, ex.map(lambda s: _safe_search(queries[s], s), sites)))
    posts, pages = [], []
    for site, rows in found.items():
        for r in rows:
            k = _kind(r["url"])
            text = f"{r['title']} {r['url']}"
            if k == "drop" or not _matches(text, stems):
                continue
            if k == "page" and p not in text.lower() and site not in APPRENTICE_SITES:
                continue
            (posts if k == "post" else pages).append({**r, "site": site})
    # Read the best listing pages and the single posts that need it, with plain code. The sites' own
    # listing pages for role + city are read directly too, since search does not always return them.
    to_read = [] if apprentice_only(sites) else _canonical_pages(role, p)[:1]
    texts = _tavily_extract(to_read)
    items: list[dict] = [it for rows in found.values() for r in rows for it in (r.get("parsed") or []) if it]
    for x in posts:
        if x.get("parsed"):
            continue
        else:
            it = {"title": re.sub(r"\s*[-|].*$", "", x["title"]).strip()[:90] or role.title(), "employer": None, "place": None,
                  "pay": None, "posted": (x.get("published") or "")[:10] or None, "site": x["site"], "url": x["url"]}
            if x["site"] == "workindia.in" and (t := _workindia_slug(x["url"])):
                it.update(title=t[0], place=t[1])
        if it:
            items.append(it)
    for url in to_read:
        txt = texts.get(url) or ""
        if "apna.co" in url:
            items += _parse_apna_list(txt)
        elif "workindia.in" in url and "/jobs/" not in url:
            items += _parse_workindia_list(txt)
    # keep relevant, local, unique
    seen, keep = set(), []
    for it in items:
        if it["url"] in seen or not _matches(it["title"], stems):
            continue
        where = (it.get("place") or "") + " " + it["url"]
        if it.get("place") and p not in where.lower() and it["site"] not in APPRENTICE_SITES:
            continue
        seen.add(it["url"])
        keep.append(it)
    page_rows = [{"title": x["title"][:90], "site": x["site"], "url": x["url"], "snippet": x["snippet"][:160]} for x in pages
                 if x["url"] not in seen][:3]
    if not apprentice_only(sites):
        have = {x["site"] for x in page_rows}
        page_rows += [x for x in search_links(role, place) if x["site"] not in have]
    return keep, page_rows


def _safe_search(query: str, site: str) -> list[dict]:
    try:
        return _tavily_search(query, site)
    except httpx.HTTPError:
        return []


MAX_AGE_DAYS = 120


def _recent(posts: list[dict]) -> list[dict]:
    """Drop posts older than MAX_AGE_DAYS; newest first, undated last."""
    today = date.today()
    keep = []
    for x in posts:
        try:
            d = date.fromisoformat(x["posted"]) if x.get("posted") else None
        except ValueError:
            d = None
        if d and (today - d).days > MAX_AGE_DAYS:
            continue
        keep.append((d, x))
    keep.sort(key=lambda t: (t[0] is None, -(t[0].toordinal() if t[0] else 0)))
    return [x for _, x in keep]


def _query(role: str, place: str, apprenticeship_only: bool, part_time: bool) -> str:
    return f"{role} {'apprenticeship' if apprenticeship_only else 'jobs'} {place}{' part time' if part_time else ''}"


def _date(x) -> date | None:
    try:
        return date.fromisoformat(str(x)[:10]) if x else None
    except ValueError:
        return None


def _store(items: list[dict], role: str, place: str, state: str | None) -> list[str]:
    """Keep every posting until its own time runs out; returns the stored ids."""
    stems = _stems(role)
    rows = []
    for it in items:
        kind = "apprenticeship" if it["site"] in APPRENTICE_SITES else "job"
        until = kb.expiry_for(kind, deadline=_date(it.get("apply_by")), posted=_date(it.get("posted")))
        if until <= kb.now():
            continue
        rows.append({"kind": kind, "source_url": it["url"], "source_site": it["site"], "title": it["title"], "provider": it.get("employer"),
                     "data": it, "state": state, "district": place, "valid_until": until,
                     "tags": [*stems, it["site"], *(["part_time"] if it.get("part_time") else [])]})
    return [r["id"] for r in kb.upsert_items(rows)]


def _stored(role: str, place: str, apprenticeship_only: bool) -> list[dict]:
    """Fresh postings already in the store for this role and place (found earlier for any student)."""
    kinds = ["apprenticeship"] if apprenticeship_only else ["job", "apprenticeship"]
    rows = kb.find(kinds, district=place.split(",")[0].strip(), tags_any=_stems(role), limit=60)
    out = []
    for r in rows:
        it = dict(r["data"] or {})
        if it.get("url") and _matches(it.get("title") or "", _stems(role)):
            out.append({**it, "_id": r["id"]})
    return out


def _flag_low_pay(posts: list[dict], state: str | None, part_time: bool) -> None:
    """Mark full-time postings whose whole stated monthly pay range is below the state's minimum wage
    (work_rules.minimum_wage). Part-time posts, daily pay and states without a state-wide figure are never flagged."""
    if part_time or not state:
        return
    try:
        from app.services.work_rules import minimum_wage
        mw = minimum_wage(state, "unskilled")
    except Exception:  # noqa: BLE001 - helper missing or no rule for this state
        return
    if not isinstance(mw, dict) or not isinstance(mw.get("per_month"), (int, float)):
        return
    for it in posts:
        pay = it.get("pay") or ""
        if it.get("part_time") or "month" not in pay.lower():
            continue
        nums = [int(x.replace(",", "")) for x in re.findall(r"\d[\d,]{2,}", pay)]
        if nums and max(nums) < mw["per_month"]:
            it["below_minimum_wage"] = True
            it["minimum_wage_ref"] = mw


def find_jobs(role: str, place: str, state: str | None = None, apprenticeship_only: bool = False, part_time: bool = False) -> dict:
    role = (role or "").strip()[:60] or "jobs"
    place = (place or state or "").strip()[:60]
    sites = APPRENTICE_SITES if apprenticeship_only else [*JOB_SITES, *APPRENTICE_SITES]
    kind = "apprenticeship" if apprenticeship_only else "job"
    q = _query(role, place, apprenticeship_only, part_time)
    nearby = [c for c in NEARBY.get((state or "").lower(), []) if c.lower() not in place.lower()]
    last = kb.last_search(kind, q)
    stored = _stored(role, place, apprenticeship_only) if place else []
    searched, from_store = place, False
    if place and not kb.need_web_search(kb.searched_at(last), len(stored), MIN_STORED):
        # The database answers: postings found earlier (for this or another student) that have not expired.
        meta = (last or {}).get("meta") or {}
        searched = meta.get("searched_place") or place
        posts = stored if searched == place else (_stored(role, searched, apprenticeship_only) or stored)
        pages = meta.get("pages") or ([] if apprentice_only(sites) else search_links(role, place))
        from_store = True
        kb.hit([x["_id"] for x in posts if x.get("_id")])
    else:
        posts, pages = _search_place(role, place, sites, part_time) if place else ([], [])
        if not posts and nearby:
            searched = nearby[0]
            posts, pages2 = _search_place(role, searched, sites, part_time)
            pages = pages or pages2
        ids = _store(posts, role, searched, state)
        if place:
            kb.log_search(kind, q, ids, "tavily", filters={"role": role, "place": place, "state": state, "part_time": part_time},
                          meta={"pages": pages, "searched_place": searched})
    posts = [{k: v for k, v in x.items() if k != "_id"} for x in _recent(posts)[:12]]
    _flag_low_pay(posts, state, part_time)
    used = sorted({x["site"] for x in posts} | {x["site"] for x in pages})
    return {"role": role, "place": place, "searched_place": searched, "items": posts, "pages": pages,
            "sites": sites, "sites_used": used, "site_names": {s: SITE_NAMES[s] for s in sites},
            "apprenticeship_only": apprenticeship_only, "checked_on": date.today().isoformat(),
            "nearby": nearby[:2], "from_store": from_store}


def compact(res: dict) -> str:
    """What the model sees: numbered lines it may refer to, nothing it could embellish."""
    if not res["items"]:
        return f"no current openings found for {res['role']} near {res['place']} on {', '.join(res['sites'])}; listing pages {len(res['pages'])}; nearby {res['nearby']}"
    lines = [f"{i + 1}. {x['title']} | {x.get('employer') or '-'} | {x.get('place') or '-'} | {x['site']}" for i, x in enumerate(res["items"][:8])]
    head = f"{len(res['items'])} openings" + (f" (none in {res['place']}, shown for {res['searched_place']})" if res["searched_place"] != res["place"] else "")
    return head + "\n" + "\n".join(lines)
