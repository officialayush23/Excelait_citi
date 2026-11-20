"""Deterministic change-watcher for official scheme pages (no AI).

For each row in public.scheme_sources: fetch the URL, reduce it to visible text, hash it,
and compare with the stored hash. A changed page flips status to 'changed', stores a short
excerpt around the facts that matter (dates, income, eligibility, amounts) and notifies
every admin so a human re-verifies the scheme rule. Nothing here edits a rule.

Columns used: scheme_sources.{url, content_hash, status, last_fetched_at, last_changed_at,
notes} (0002) plus http_status and excerpt (0010_scheme_sources_crawl.sql).
"""

from __future__ import annotations

import asyncio
import hashlib
import re
from datetime import datetime, timezone
from html.parser import HTMLParser
from typing import Any
from urllib.parse import urlsplit

import httpx

USER_AGENT = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
              "Chrome/124.0 Safari/537.36 ExcelAItBot/1.0 (+scheme-change-check)")
TIMEOUT = 20.0
MAX_CONCURRENCY = 5
HOST_DELAY = 1.0          # seconds between requests to the same host
MAX_BYTES = 3_000_000
EXCERPT_MAX = 700
KEYWORDS = ("last date", "deadline", "due date", "closing date", "income", "eligib", "amount", "scholarship of", "rs.", "₹", "per annum", "apply before")
_KW_RE = re.compile("|".join(re.escape(k) for k in KEYWORDS), re.I)

_SKIP = {"script", "style", "noscript", "nav", "footer", "svg", "template", "iframe", "select", "button"}
_BLOCK = {"p", "div", "br", "li", "tr", "td", "th", "h1", "h2", "h3", "h4", "h5", "h6", "section", "article", "ul", "ol", "table"}


class _Text(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.skip = 0
        self.title = ""
        self._in_title = False

    def handle_starttag(self, tag, attrs):
        if tag == "title":
            self._in_title = True
        if tag in _SKIP:
            self.skip += 1
        elif tag in _BLOCK:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag == "title":
            self._in_title = False
        if tag in _SKIP:
            self.skip = max(0, self.skip - 1)
        elif tag in _BLOCK:
            self.parts.append("\n")

    def handle_data(self, data):
        if self._in_title:
            self.title += data
        elif not self.skip:
            self.parts.append(data)


def extract_text(html: str) -> str:
    """Visible text with scripts, styles and navigation removed and whitespace collapsed."""
    p = _Text()
    try:
        p.feed(html)
        p.close()
    except Exception:  # malformed markup: use whatever was parsed
        pass
    return normalise("".join(p.parts))


def normalise(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def content_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def make_excerpt(text: str, width: int = 110, limit: int = EXCERPT_MAX) -> str:
    """Up to a few snippets around keywords; falls back to the page start."""
    spans: list[tuple[int, int]] = []
    for m in _KW_RE.finditer(text):
        s, e = max(0, m.start() - width), min(len(text), m.end() + width)
        if spans and s <= spans[-1][1]:
            spans[-1] = (spans[-1][0], e)
        else:
            spans.append((s, e))
        if len(spans) >= 6:
            break
    out = " … ".join(text[s:e].strip() for s, e in spans) if spans else text[: limit]
    return out[:limit]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def build_update(row: dict, status_code: int | None, text: str | None, error: str | None = None, now: str | None = None) -> dict:
    """Pure decision: what to write for one source given the fetch outcome."""
    now = now or _now()
    if error or text is None:
        return {"status": "error", "http_status": status_code, "last_fetched_at": now, "notes": (error or "no content")[:300]}
    h = content_hash(text)
    upd: dict[str, Any] = {"content_hash": h, "http_status": status_code, "last_fetched_at": now,
                           "excerpt": make_excerpt(text), "notes": None}
    old = row.get("content_hash")
    if old and old != h:
        upd.update(status="changed", last_changed_at=now)
    else:
        upd["status"] = "ok"
    return upd


async def _polite(url: str, delay: float, state: dict) -> None:
    if delay <= 0:
        return
    host = urlsplit(url).netloc
    lock = state.setdefault(("lock", host), asyncio.Lock())
    async with lock:
        loop = asyncio.get_running_loop()
        wait = state.get(host, 0) - loop.time()
        if wait > 0:
            await asyncio.sleep(wait)
        state[host] = loop.time() + delay


async def fetch_source(client: httpx.AsyncClient, row: dict, sem: asyncio.Semaphore, delay: float = HOST_DELAY, state: dict | None = None) -> dict:
    """Fetch one source and return the DB update for it."""
    async with sem:
        await _polite(row["url"], delay, state if state is not None else {})
        try:
            r = await client.get(row["url"])
        except httpx.HTTPError as e:
            return build_update(row, None, None, f"{type(e).__name__}: {e}")
        if r.status_code >= 400:
            return build_update(row, r.status_code, None, f"HTTP {r.status_code}")
        ctype = r.headers.get("content-type", "")
        body = r.content[:MAX_BYTES]
        if "pdf" in ctype.lower() or body[:5] == b"%PDF-":
            text = content_hash_text_for_binary(body)
        else:
            text = extract_text(r.text if len(r.content) <= MAX_BYTES else body.decode(r.encoding or "utf-8", "replace"))
        if not text:
            return build_update(row, r.status_code, None, "page has no visible text (may need JavaScript)")
        return build_update(row, r.status_code, text)


def content_hash_text_for_binary(body: bytes) -> str:
    """PDFs: no text extraction, so fingerprint the bytes (changes whenever the file does)."""
    return f"[binary document sha256:{hashlib.sha256(body).hexdigest()}]"


def make_client(transport: httpx.AsyncBaseTransport | None = None) -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=True, transport=transport,
                             headers={"User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml,application/pdf;q=0.8,*/*;q=0.5",
                                      "Accept-Language": "en-IN,en;q=0.9"})


def admin_ids(db) -> list[str]:
    rows = db.table("user_roles").select("user_id").eq("role", "admin").execute().data or []
    return [r["user_id"] for r in rows]


def notify_admins(db, changed: list[dict]) -> int:
    if not changed:
        return 0
    admins = admin_ids(db)
    notes = []
    for c in changed:
        name = c.get("scheme_name") or c["url"]
        for uid in admins:
            notes.append({"user_id": uid, "kind": "scheme_changed", "title": f"Official page changed: {name}",
                          "body": f"Re-check the rule against {c['url']}", "link": "/app/schemes"})
    for i in range(0, len(notes), 500):
        db.table("notifications").insert(notes[i:i + 500]).execute()
    return len(notes)


async def crawl_all(db=None, transport: httpx.AsyncBaseTransport | None = None, delay: float = HOST_DELAY,
                    only_ids: list[int] | None = None) -> dict:
    """Check every scheme source. Returns counts: {checked, ok, changed, error}."""
    if db is None:
        from app.core.db import get_db
        db = get_db()
    q = db.table("scheme_sources").select("id, scheme_id, url, status, content_hash, schemes(name)")
    if only_ids:
        q = q.in_("id", only_ids)
    rows = q.execute().data or []
    sem, state = asyncio.Semaphore(MAX_CONCURRENCY), {}
    async with make_client(transport) as client:
        updates = await asyncio.gather(*(fetch_source(client, r, sem, delay, state) for r in rows))
    counts = {"checked": len(rows), "ok": 0, "changed": 0, "error": 0}
    changed = []
    for row, upd in zip(rows, updates):
        db.table("scheme_sources").update(upd).eq("id", row["id"]).execute()
        counts[upd["status"]] += 1
        if upd["status"] == "changed":
            changed.append({"url": row["url"], "scheme_name": (row.get("schemes") or {}).get("name")})
    counts["notified"] = notify_admins(db, changed)
    return counts


def search_pages(query: str, limit: int = 20, db=None) -> list[dict]:
    """Search the stored excerpts (dates, income limits, eligibility lines) of watched pages."""
    q = (query or "").strip().replace("%", " ").replace(",", " ")
    if not q:
        return []
    if db is None:
        from app.core.db import get_db
        db = get_db()
    rows = (db.table("scheme_sources").select("id, scheme_id, url, status, last_fetched_at, last_changed_at, excerpt, schemes(name, slug)")
            .ilike("excerpt", f"%{q}%").limit(limit).execute().data or [])
    return rows
