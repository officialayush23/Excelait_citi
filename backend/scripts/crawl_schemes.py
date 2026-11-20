"""Check every official scheme page for changes and alert admins.

    cd backend && python -m scripts.crawl_schemes            # all sources
    cd backend && python -m scripts.crawl_schemes --ids 3 4  # only these scheme_sources ids
    cd backend && python -m scripts.crawl_schemes --search "last date"

Needs supabase/migrations/0010_scheme_sources_crawl.sql applied. Run it from cron daily.
"""

from __future__ import annotations

import argparse
import asyncio
import sys

from app.services.crawler import crawl_all, search_pages


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--ids", type=int, nargs="*", help="only these scheme_sources ids")
    ap.add_argument("--search", help="search stored page excerpts instead of crawling")
    args = ap.parse_args(argv)
    if args.search:
        for r in search_pages(args.search):
            print(f"[{r['status']}] {(r.get('schemes') or {}).get('name') or r['url']}\n  {r['url']}\n  {r['excerpt'][:300]}\n")
        return 0
    c = asyncio.run(crawl_all(only_ids=args.ids))
    print(f"checked {c['checked']}: {c['ok']} ok, {c['changed']} changed, {c['error']} error; {c['notified']} admin notifications")
    return 0


if __name__ == "__main__":
    sys.exit(main())
