"""Live web search for the assistant: a plain script, not an AI. Tavily first (short results),
Groq's built-in browser search only as a fallback. Results are cached for a day."""

from __future__ import annotations

import hashlib
from datetime import datetime, timedelta, timezone

import httpx

from app.core.config import get_settings
from app.core.db import get_db

CACHE_HOURS = 24
# Official and reliable sources are asked for first; the student still sees every source link.
PREFERRED = ["gov.in", "nic.in", "ac.in", "edu.in", "org.in"]


def _key(query: str) -> str:
    return hashlib.sha256(query.strip().lower().encode()).hexdigest()[:40]


def _cached(key: str) -> list[dict] | None:
    rows = get_db().table("search_cache").select("results, created_at").eq("key", key).limit(1).execute().data
    if not rows:
        return None
    made = datetime.fromisoformat(rows[0]["created_at"].replace("Z", "+00:00"))
    return rows[0]["results"] if datetime.now(timezone.utc) - made < timedelta(hours=CACHE_HOURS) else None


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


def web_search(query: str, max_results: int = 5) -> dict:
    query = query.strip()[:300]
    key = _key(query)
    hit = _cached(key)
    if hit is not None:
        return {"query": query, "results": hit, "cached": True}
    s = get_settings()
    provider = "tavily" if s.tavily_api_key else "groq"
    results = _tavily(query, s.tavily_api_key, max_results) if s.tavily_api_key else _groq(query)
    results.sort(key=lambda x: 0 if any(d in x["url"] for d in PREFERRED) else 1)
    get_db().table("search_cache").upsert({"key": key, "provider": provider, "query": query, "results": results,
                                          "created_at": datetime.now(timezone.utc).isoformat()}).execute()
    return {"query": query, "results": results, "cached": False}
