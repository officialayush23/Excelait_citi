"""Scheme page crawler: extraction, hashing, change detection, errors. httpx is mocked."""

import asyncio

import httpx

from app.services import crawler as cr

PAGE = """<html><head><title>PM Scholarship</title><style>.a{color:red}</style><script>var x="secret";</script></head>
<body><nav><a href=/>Home</a><a href=/x>Menu item</a></nav>
<h1>PM   Scholarship</h1><p>Last date to apply: 31 December 2026.</p><p>Family income must be below Rs. 8 lakh per annum.</p>
<form><div>Inside form still visible</div></form>
<footer>Copyright footer</footer></body></html>"""


def test_extract_text_strips_noise():
    t = cr.extract_text(PAGE)
    assert "PM Scholarship" in t and "Last date to apply: 31 December 2026." in t
    assert "Inside form still visible" in t
    for bad in ("secret", "color:red", "Menu item", "Copyright footer"):
        assert bad not in t
    assert "  " not in t


def test_hash_stable_across_whitespace_only_changes():
    a = cr.extract_text("<p>Hello   world</p>")
    b = cr.extract_text("<div>Hello\n\n world</div>")
    assert cr.content_hash(a) == cr.content_hash(b)
    assert cr.content_hash(a) != cr.content_hash(cr.extract_text("<p>Hello World 2</p>"))


def test_excerpt_around_keywords():
    t = cr.extract_text(PAGE)
    ex = cr.make_excerpt(t)
    assert "Last date" in ex and "income" in ex.lower()
    assert len(ex) <= cr.EXCERPT_MAX
    assert cr.make_excerpt("nothing relevant here at all") == "nothing relevant here at all"


def test_build_update_states():
    now = "2026-01-01T00:00:00+00:00"
    first = cr.build_update({"content_hash": None}, 200, "text one", now=now)
    assert first["status"] == "ok" and "last_changed_at" not in first
    h = first["content_hash"]
    same = cr.build_update({"content_hash": h}, 200, "text one", now=now)
    assert same["status"] == "ok" and "last_changed_at" not in same
    diff = cr.build_update({"content_hash": h}, 200, "text two", now=now)
    assert diff["status"] == "changed" and diff["last_changed_at"] == now and diff["content_hash"] != h
    err = cr.build_update({"content_hash": h}, 503, None, "HTTP 503", now=now)
    assert err["status"] == "error" and err["http_status"] == 503 and "content_hash" not in err


# ---------- fake db ----------
class Q:
    def __init__(self, db, name):
        self.db, self.name, self.op, self.payload, self.filt = db, name, "select", None, {}

    def select(self, *_a, **_k): return self
    def in_(self, col, vals): self.filt["in"] = vals; return self
    def eq(self, col, val): self.filt[col] = val; return self
    def update(self, p): self.op, self.payload = "update", p; return self
    def insert(self, p): self.op, self.payload = "insert", p; return self

    def execute(self):
        db = self.db
        if self.op == "select":
            if self.name == "scheme_sources":
                return type("R", (), {"data": [dict(r) for r in db.sources]})
            if self.name == "user_roles":
                return type("R", (), {"data": [{"user_id": u} for u in db.admins]})
        elif self.op == "update":
            db.updates.append((self.filt.get("id"), self.payload))
        else:
            db.inserted += self.payload if isinstance(self.payload, list) else [self.payload]
        return type("R", (), {"data": []})


class FakeDB:
    def __init__(self, sources, admins=("a1", "a2")):
        self.sources, self.admins, self.updates, self.inserted = sources, list(admins), [], []

    def table(self, name): return Q(self, name)


def _run(db, handler):
    return asyncio.run(cr.crawl_all(db=db, transport=httpx.MockTransport(handler), delay=0))


def test_crawl_detects_change_and_notifies_admins():
    old_hash = cr.content_hash(cr.extract_text("<p>old page</p>"))
    db = FakeDB([
        {"id": 1, "scheme_id": 9, "url": "https://x.gov.in/a", "status": "ok", "content_hash": old_hash, "schemes": {"name": "PM Scholarship"}},
        {"id": 2, "scheme_id": 10, "url": "https://x.gov.in/b", "status": "ok", "content_hash": cr.content_hash(cr.extract_text(PAGE)), "schemes": {"name": "Same"}},
        {"id": 3, "scheme_id": None, "url": "https://x.gov.in/c", "status": "ok", "content_hash": None, "schemes": None},
    ])

    def handler(req: httpx.Request):
        assert "Mozilla" in req.headers["user-agent"]
        return httpx.Response(200, text=PAGE if req.url.path != "/c" else "<p>brand new</p>", headers={"content-type": "text/html"})

    counts = _run(db, handler)
    assert counts["checked"] == 3 and counts["changed"] == 1 and counts["ok"] == 2 and counts["error"] == 0
    upd = dict(db.updates)
    assert upd[1]["status"] == "changed" and "Last date" in upd[1]["excerpt"]
    assert upd[2]["status"] == "ok" and upd[3]["status"] == "ok" and upd[3]["content_hash"]
    assert len(db.inserted) == 2  # one changed page x two admins
    n = db.inserted[0]
    assert n["kind"] == "scheme_changed" and n["link"] == "/app/schemes" and "PM Scholarship" in n["title"]
    assert {x["user_id"] for x in db.inserted} == {"a1", "a2"}


def test_crawl_errors_do_not_notify_or_clobber_hash():
    db = FakeDB([
        {"id": 1, "scheme_id": 1, "url": "https://x.gov.in/404", "status": "ok", "content_hash": "abc", "schemes": None},
        {"id": 2, "scheme_id": 2, "url": "https://x.gov.in/boom", "status": "ok", "content_hash": "abc", "schemes": None},
        {"id": 3, "scheme_id": 3, "url": "https://x.gov.in/empty", "status": "ok", "content_hash": "abc", "schemes": None},
    ])

    def handler(req: httpx.Request):
        if req.url.path == "/404":
            return httpx.Response(404, text="nope")
        if req.url.path == "/boom":
            raise httpx.ConnectTimeout("timed out", request=req)
        return httpx.Response(200, text="<script>only js</script>")

    counts = _run(db, handler)
    assert counts["error"] == 3 and counts["notified"] == 0 and db.inserted == []
    for _id, upd in db.updates:
        assert upd["status"] == "error" and "content_hash" not in upd and upd["notes"]
    assert dict(db.updates)[1]["http_status"] == 404


def test_redirects_followed():
    db = FakeDB([{"id": 1, "scheme_id": 1, "url": "https://x.gov.in/old", "status": "ok", "content_hash": None, "schemes": None}])

    def handler(req):
        if req.url.path == "/old":
            return httpx.Response(301, headers={"location": "https://x.gov.in/new"})
        return httpx.Response(200, text="<p>moved here</p>")

    assert _run(db, handler)["ok"] == 1


def test_concurrency_capped_at_five():
    rows = [{"id": i, "scheme_id": None, "url": f"https://h{i}.gov.in/", "status": "ok", "content_hash": None, "schemes": None} for i in range(12)]
    live = {"now": 0, "max": 0}

    class T(httpx.AsyncBaseTransport):
        async def handle_async_request(self, req):
            live["now"] += 1
            live["max"] = max(live["max"], live["now"])
            await asyncio.sleep(0.02)
            live["now"] -= 1
            return httpx.Response(200, text="<p>ok page</p>")

    counts = asyncio.run(cr.crawl_all(db=FakeDB(rows), transport=T(), delay=0))
    assert counts["ok"] == 12 and live["max"] <= 5


def test_search_pages_uses_ilike():
    seen = {}

    class S:
        def table(self, n): return self
        def select(self, *_): return self
        def ilike(self, col, pat): seen["a"] = (col, pat); return self
        def limit(self, n): return self
        def execute(self): return type("R", (), {"data": [{"id": 1}]})

    assert cr.search_pages("last date", db=S()) == [{"id": 1}]
    assert seen["a"] == ("excerpt", "%last date%")
    assert cr.search_pages("  ", db=S()) == []
