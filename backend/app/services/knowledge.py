"""The knowledge store: everything found on the web, kept until its own time runs out.

knowledge_items holds one row per source page (scholarship, job, apprenticeship, notice or plain web
result) with its structured record and a valid_until date. Rows are shared by every student and are
deleted only by delete_expired_knowledge() once valid_until has passed. search_log records each search
so the same question is answered from the database first.

Every function here is safe to call before migration 0016 is applied: reads return nothing and
writes are skipped, so callers simply fall back to a live search."""

from __future__ import annotations

import hashlib
import logging
import re
import threading
import time
from datetime import date, datetime, time as dtime, timedelta, timezone

from app.core.db import get_db

log = logging.getLogger("knowledge")
IST = timezone(timedelta(hours=5, minutes=30))
DEFAULT_DAYS = 30           # web pages, notices and undated posts
REFRESH_HOURS = 24          # the same search is repeated on the web at most once a day
_down_until = 0.0           # set when the tables are missing; retried after a few minutes


def now() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------- pure helpers

def norm_query(q: str) -> str:
    """'  Class 10  Scholarship, Nashik ' -> 'class 10 nashik scholarship' (order-free, punctuation-free)."""
    words = re.findall(r"[\wऀ-ॿ]+", (q or "").lower())
    return " ".join(sorted(dict.fromkeys(words)))


def query_key(kind: str, q: str) -> str:
    return hashlib.sha256(f"{kind}|{norm_query(q)}".encode()).hexdigest()[:40]


def end_of_day_ist(d: date) -> datetime:
    return datetime.combine(d, dtime(23, 59, 59), IST).astimezone(timezone.utc)


def expiry_for(kind: str, deadline: date | None = None, posted: date | None = None,
               stated: date | None = None, at: datetime | None = None) -> datetime:
    """When an item stops being useful.
    scholarship: the deadline (end of that day, IST); without one, 30 days from now.
    job: the explicit apply-by date; else posted date + 30 days; else 30 days from now.
    apprenticeship: the closing date; else 30 days from now.
    web / notice: a date the page itself states; else 30 days from now."""
    at = at or now()
    later = at + timedelta(days=DEFAULT_DAYS)
    if kind == "scholarship":
        return end_of_day_ist(deadline) if deadline else later
    if kind == "job":
        if deadline:
            return end_of_day_ist(deadline)
        if posted:
            return end_of_day_ist(posted + timedelta(days=DEFAULT_DAYS))
        return later
    if kind == "apprenticeship":
        return end_of_day_ist(deadline) if deadline else later
    return end_of_day_ist(stated) if stated else later


def need_web_search(last_search_at: datetime | None, fresh_items: int, min_items: int,
                    at: datetime | None = None, refresh_hours: int = REFRESH_HOURS) -> bool:
    """The database is asked first. The web is searched only when
    - this query was never searched and the database has too few fresh items for the student's filters, or
    - the last search for the same normalised query is older than refresh_hours (daily refresh).
    A search for the same query within the last day is never repeated, even when it found little."""
    at = at or now()
    if last_search_at is None:
        return fresh_items < min_items
    return at - last_search_at >= timedelta(hours=refresh_hours)


# ---------------------------------------------------------------- database

def _ok() -> bool:
    return time.time() >= _down_until


def _fail(e: Exception) -> None:
    global _down_until
    _down_until = time.time() + 300
    log.warning("knowledge store unavailable (%s: %s); using live search only", type(e).__name__, str(e)[:160])


def _iso(x) -> str | None:
    return x.isoformat() if isinstance(x, (datetime, date)) else x


def upsert_items(items: list[dict]) -> list[dict]:
    """Insert or refresh items by source_url. first_seen_at and hits stay as they were."""
    if not items or not _ok():
        return []
    t = now().isoformat()
    rows, seen = [], set()
    for it in items:
        if not it.get("source_url") or it["source_url"] in seen:
            continue
        seen.add(it["source_url"])
        rows.append({
            "kind": it["kind"], "source_url": it["source_url"][:1000], "source_site": it.get("source_site"),
            "title": (it.get("title") or "")[:300] or it["source_url"][:300], "provider": (it.get("provider") or None),
            "data": it.get("data") or {}, "eligibility": it.get("eligibility") or {},
            "state": it.get("state"), "district": it.get("district"), "tags": list(dict.fromkeys(it.get("tags") or []))[:30],
            "valid_until": _iso(it["valid_until"]), "last_seen_at": t, "last_checked_at": it.get("last_checked_at") or t,
        })
    try:
        return get_db().table("knowledge_items").upsert(rows, on_conflict="source_url").execute().data or []
    except Exception as e:  # noqa: BLE001 - the store must never break a search
        _fail(e)
        return []


def get_items(ids: list[str], fresh_only: bool = True) -> list[dict]:
    if not ids or not _ok():
        return []
    try:
        q = get_db().table("knowledge_items").select("*").in_("id", ids[:200])
        if fresh_only:
            q = q.gt("valid_until", now().isoformat())
        rows = q.execute().data or []
    except Exception as e:  # noqa: BLE001
        _fail(e)
        return []
    order = {i: n for n, i in enumerate(ids)}
    return sorted(rows, key=lambda r: order.get(r["id"], 1 << 30))


def by_urls(urls: list[str]) -> dict[str, dict]:
    """Stored rows for these source pages (fresh or not), keyed by URL."""
    if not urls or not _ok():
        return {}
    try:
        rows = get_db().table("knowledge_items").select("*").in_("source_url", urls[:200]).execute().data or []
    except Exception as e:  # noqa: BLE001
        _fail(e)
        return {}
    return {r["source_url"]: r for r in rows}


def find(kinds: list[str], state: str | None = None, district: str | None = None,
         tags_any: list[str] | None = None, limit: int = 300) -> list[dict]:
    """Fresh items of these kinds, optionally for one state / district (rows with no state match any state)."""
    if not _ok():
        return []
    try:
        q = get_db().table("knowledge_items").select("*").in_("kind", kinds).gt("valid_until", now().isoformat())
        if state:
            q = q.or_(f'state.is.null,state.eq."{state}"')
        if district:
            q = q.ilike("district", f"%{district.strip()}%")
        if tags_any:
            q = q.overlaps("tags", tags_any)
        return q.order("last_seen_at", desc=True).limit(limit).execute().data or []
    except Exception as e:  # noqa: BLE001
        _fail(e)
        return []


def last_search(kind: str, q: str) -> dict | None:
    if not _ok():
        return None
    try:
        rows = (get_db().table("search_log").select("*").eq("query_key", query_key(kind, q)).eq("kind", kind)
                .order("created_at", desc=True).limit(1).execute().data)
    except Exception as e:  # noqa: BLE001
        _fail(e)
        return None
    return rows[0] if rows else None


def searched_at(row: dict | None) -> datetime | None:
    if not row:
        return None
    return datetime.fromisoformat(row["created_at"].replace("Z", "+00:00"))


def log_search(kind: str, q: str, item_ids: list[str], provider: str, filters: dict | None = None,
               meta: dict | None = None, valid_until: datetime | None = None) -> None:
    if not _ok():
        return
    try:
        get_db().table("search_log").insert({
            "query": q[:300], "query_key": query_key(kind, q), "kind": kind, "filters": filters or {},
            "item_ids": item_ids, "provider": provider, "meta": meta or {},
            "valid_until": _iso(max(valid_until or now(), now() + timedelta(days=DEFAULT_DAYS))),
        }).execute()
    except Exception as e:  # noqa: BLE001
        _fail(e)


def hit(ids: list[str]) -> None:
    if ids and _ok():
        try:
            get_db().rpc("knowledge_hit", {"p_ids": ids[:200]}).execute()
        except Exception as e:  # noqa: BLE001
            log.debug("hit count skipped: %s", e)


def cleanup() -> int | None:
    """Delete items whose time has run out. Also scheduled daily with pg_cron (migration 0016)."""
    try:
        return get_db().rpc("delete_expired_knowledge", {}).execute().data
    except Exception as e:  # noqa: BLE001
        log.warning("cleanup skipped: %s", str(e)[:160])
        return None


_cleaner_started = False


def start_daily_cleanup() -> None:
    """A background thread that runs cleanup() once a day (backup for pg_cron)."""
    global _cleaner_started
    if _cleaner_started:
        return
    _cleaner_started = True

    def loop() -> None:
        time.sleep(60)
        while True:
            n = cleanup()
            if n:
                log.info("deleted %s expired knowledge items", n)
            time.sleep(24 * 3600)

    threading.Thread(target=loop, name="knowledge-cleanup", daemon=True).start()
