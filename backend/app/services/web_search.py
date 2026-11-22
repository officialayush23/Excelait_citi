"""Live web search for the assistant: a plain script, not an AI. Tavily first (short results),
Groq's built-in browser search only as a fallback.

Every result is kept in the knowledge store (kind 'web', or 'notice' for official notices) for 30 days,
or until a date the page itself states; the same question within a day is answered from the store."""

from __future__ import annotations

import re
from datetime import date, timedelta

import httpx

from app.core.config import get_settings
from app.services import knowledge as kb

# Official and reliable sources are asked for first; the student still sees every source link.
PREFERRED = ["gov.in", "nic.in", "ac.in", "edu.in", "org.in"]
NOTICE = re.compile(r"notice|notification|circular|advertisement|recruitment|admit card|result|last date", re.I)


def _key(query: str) -> str:
    """Kept for callers that still key things by query text."""
    return kb.query_key("web", query)


def _tavily(query: str, key: str, max_results: int) -> list[dict]:
    r = httpx.post("https://api.tavily.com/search", timeout=30, headers={"Authorization": f"Bearer {key}"},
                   json={"query": query, "max_results": max_results, "search_depth": "basic", "country": "india", "time_range": "year"})
    r.raise_for_status()
    return [{"title": x["title"], "url": x["url"], "snippet": (x.get("content") or "")[:300]} for x in r.json().get("results", [])]


def _groq(query: str) -> list[dict]:
    s = get_settings()
    r = httpx.post(f"{s.llm_base_url}/chat/completions", timeout=90, headers={"Authorization": f"Bearer {s.groq_api_key}"},
                   json={"model": "openai/gpt-oss-20b", "tool_choice": "required", "tools": [{"type": "browser_search"}],
                         "messages": [{"role": "user", "content": f"{query}\nAnswer in under 60 words, then list source URLs."}]})
    r.raise_for_status()
    text = r.json()["choices"][0]["message"].get("content") or ""
    return [{"title": "Web summary", "url": "", "snippet": text[:600]}]


def stated_date(snippet: str) -> date | None:
    """A future 'last date' / 'deadline' the page itself states, if any."""
    from app.services.scholarships import find_deadline
    d, _, _ = find_deadline(snippet or "")
    return d if d and d >= date.today() else None


def _items(results: list[dict]) -> list[dict]:
    out = []
    for x in results:
        if not x.get("url", "").startswith("http"):
            continue
        host = re.sub(r"^https?://(www\.)?", "", x["url"]).split("/")[0].lower()
        official = any(host.endswith(d) for d in PREFERRED)
        kind = "notice" if official and NOTICE.search(f"{x['title']} {x['snippet']}") else "web"
        out.append({"kind": kind, "source_url": x["url"], "source_site": host, "title": x["title"], "data": x,
                    "valid_until": kb.expiry_for(kind, stated=stated_date(x["snippet"])), "tags": [kind]})
    return out


def web_search(query: str, max_results: int = 5) -> dict:
    query = query.strip()[:300]
    last = kb.last_search("web", query)
    at = kb.searched_at(last)
    if last and not kb.need_web_search(at, 0, 1):  # searched within the day: answer from the store
        rows = kb.get_items(last.get("item_ids") or [])
        results = [r["data"] for r in rows] or (last.get("meta") or {}).get("results") or []
        if results:
            kb.hit([r["id"] for r in rows])
            return {"query": query, "results": results, "cached": True}
    s = get_settings()
    provider = "tavily" if s.tavily_api_key else "groq"
    results = _tavily(query, s.tavily_api_key, max_results) if s.tavily_api_key else _groq(query)
    results.sort(key=lambda x: 0 if any(d in x["url"] for d in PREFERRED) else 1)
    rows = kb.upsert_items(_items(results))
    by_url = {r["source_url"]: r["id"] for r in rows}
    kb.log_search("web", query, [by_url[x["url"]] for x in results if x["url"] in by_url], provider,
                  meta={} if by_url else {"results": results}, valid_until=kb.now() + timedelta(days=1))
    return {"query": query, "results": results, "cached": False}
