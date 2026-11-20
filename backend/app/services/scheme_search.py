"""Deterministic scheme search. The AI may call this as a tool; it contains no AI itself.

Ranks active schemes by how many query words appear in the name, summary or benefit
text, filtered by state and kind. Results always carry the official link.
"""

from __future__ import annotations

import re

from app.services.catalogue import schemes_with_rules

STOP = {"the", "a", "for", "of", "and", "to", "in", "scheme", "yojana", "scholarship"}


def search_schemes(query: str = "", state: str | None = None, kind: str | None = None, limit: int = 5) -> list[dict]:
    words = [w for w in re.findall(r"\w+", query.lower()) if w not in STOP]
    out = []
    for s in schemes_with_rules():
        if state and s["state"] and s["state"] != state:
            continue
        if kind and s["kind"] != kind:
            continue
        hay = " ".join(str(s.get(k) or "") for k in ("name", "slug", "benefit_text", "ministry", "kind")).lower()
        score = sum(1 for w in words if w in hay)
        if words and score == 0:
            continue
        out.append((score, s))
    out.sort(key=lambda x: (-x[0], x[1]["name"]))
    return [
        {"slug": s["slug"], "name": s["name"], "kind": s["kind"], "state": s["state"], "benefit_text": s["benefit_text"],
         "official_url": s["official_url"], "verify": s["verify"]}
        for _, s in out[:limit]
    ]
