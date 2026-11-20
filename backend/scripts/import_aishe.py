"""Import the official AISHE "All Colleges as per AISHE Dashboard" list into public.colleges.

    cd backend && python -m scripts.import_aishe path/to/file.xlsx [--dry-run]
    cd backend && python -m scripts.import_aishe path/to/iti_list.csv --iti [--dry-run]

Accepts .xlsx or .csv. The header row need not be the first row; columns are found by fuzzy
header match. Rows are upserted by aishe_code in batches of 500. org_id and details are
never sent, so a claimed listing keeps its owner and its edits.

ITIs are mostly NOT in AISHE (they come under DGT/NCVT). A CSV with columns like
ITI Code / Name / State / District / Type is detected automatically (or force with --iti);
its codes are stored as 'ITI-<code>' and kind='iti'.
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Iterable

BATCH = 500

# canonical field -> header aliases (already normalised: lowercase, alphanumerics only)
ALIASES: dict[str, list[str]] = {
    "aishe_code": ["aishecode", "aishecollegecode", "collegecode", "code", "iticode", "itiid", "ncvtcode"],
    "name": ["nameoftheinstitution", "nameofinstitution", "institutionname", "collegename", "nameofcollege", "itiname", "name"],
    "state": ["state", "statename", "stateut"],
    "district": ["district", "districtname"],
    "year_est": ["yearofestablishment", "yearestablished", "yearofestd", "establishmentyear", "yearest", "year"],
    "location": ["location", "locationtype", "ruralurban"],
    "college_type": ["collegetype", "typeofcollege", "institutiontype", "type", "ititype", "category"],
    "management": ["management", "managementtype", "managedby"],
    "university": ["affiliateduniversityname", "affiliateduniversity", "universityname", "university"],
}
REQUIRED = ("aishe_code", "name")


def norm(s: object) -> str:
    return re.sub(r"[^a-z0-9]", "", str(s or "").lower())


def map_header(row: Iterable[object]) -> dict[str, int] | None:
    """Map canonical field -> column index if this row looks like a header, else None."""
    cells = [norm(c) for c in row]
    found: dict[str, int] = {}
    for field, aliases in ALIASES.items():
        best = None
        for a in aliases:  # earlier alias wins
            if a in cells:
                best = cells.index(a)
                break
        if best is None:  # fuzzy: header contains alias (min length 6 to avoid noise)
            for a in aliases:
                if len(a) >= 6:
                    for i, c in enumerate(cells):
                        if c and a in c and i not in found.values():
                            best = i
                            break
                if best is not None:
                    break
        if best is not None and best not in found.values():
            found[field] = best
    return found if all(f in found for f in REQUIRED) else None


def find_header(rows: list[list[object]], scan: int = 30) -> tuple[int, dict[str, int]]:
    for i, row in enumerate(rows[:scan]):
        m = map_header(row)
        if m:
            return i, m
    raise ValueError("Could not find a header row with an institution code and name column.")


def read_rows(path: Path) -> list[list[object]]:
    ext = path.suffix.lower()
    if ext == ".csv":
        with path.open(newline="", encoding="utf-8-sig") as f:
            return [list(r) for r in csv.reader(f)]
    if ext in (".xlsx", ".xlsm"):
        from openpyxl import load_workbook
        wb = load_workbook(path, read_only=True, data_only=True)
        try:
            ws = wb.worksheets[0]
            return [list(r) for r in ws.iter_rows(values_only=True)]
        finally:
            wb.close()
    raise ValueError(f"Unsupported file type: {ext} (use .xlsx or .csv)")


# ---------- kind derivation ----------
_RULES: list[tuple[str, re.Pattern]] = [
    ("iti", re.compile(r"\bi\.?t\.?i\.?s?\b|industrial training|industrial training institute", re.I)),
    ("hotel", re.compile(r"hotel management|catering technology|hospitality", re.I)),
    ("nursing", re.compile(r"nursing|\bgnm\b|\banm\b", re.I)),
    ("paramedical", re.compile(r"paramedic|allied health|medical laboratory|\bdmlt\b", re.I)),
    ("pharmacy", re.compile(r"pharmac", re.I)),
    ("veterinary", re.compile(r"veterinar|animal science|dairy", re.I)),
    ("agriculture", re.compile(r"agricultur|horticultur|forestry|fisheries|agri\b", re.I)),
    ("medical", re.compile(r"medical college|\bmbbs\b|institute of medical|dental|ayurved|homoeopath|homeopath|unani|\bmedical\b", re.I)),
    ("law", re.compile(r"\blaw\b|\blegal\b|\bjuridical\b", re.I)),
    ("teacher_training", re.compile(r"b\.?\s?ed\b|d\.?\s?el\.?\s?ed|\bdiet\b|teacher|college of education|education college|\beducation\b|\bteaching\b", re.I)),
    ("polytechnic", re.compile(r"polytechnic|\bdiploma\b", re.I)),
    ("engineering", re.compile(r"engineering|technology|technical|\bpolytech\b|\bnit\b|\biit\b", re.I)),
]


def derive_kind(name: str | None, college_type: str | None = None) -> str:
    text = f"{name or ''} {college_type or ''}"
    for kind, pat in _RULES:
        if pat.search(text):
            return kind
    return "general"


# ---------- row conversion ----------
def _s(v: object) -> str | None:
    if v is None:
        return None
    s = str(v).strip()
    return s or None


def _year(v: object) -> int | None:
    m = re.search(r"(1[5-9]\d\d|20\d\d)", str(v or ""))
    return int(m.group(1)) if m else None


def build_records(rows: list[list[object]], force_iti: bool | None = None) -> tuple[list[dict], int]:
    """Return (records, skipped). ITI lists are detected by the code header or forced."""
    hi, cols = find_header(rows)
    raw_header = [norm(c) for c in rows[hi]]
    is_iti = force_iti if force_iti is not None else any(h in ("iticode", "itiname", "itiid") for h in raw_header)
    out: dict[str, dict] = {}
    skipped = 0
    for row in rows[hi + 1:]:
        def get(f: str):
            i = cols.get(f)
            return row[i] if i is not None and i < len(row) else None
        code, name = _s(get("aishe_code")), _s(get("name"))
        if not code or not name:
            skipped += 1
            continue
        if is_iti and not code.upper().startswith("ITI-"):
            code = f"ITI-{code}"
        ctype = _s(get("college_type"))
        out[code] = {  # last occurrence wins; avoids duplicate keys inside one upsert batch
            "aishe_code": code, "name": name, "state": _s(get("state")), "district": _s(get("district")),
            "year_est": _year(get("year_est")), "location": _s(get("location")), "college_type": ctype,
            "management": _s(get("management")), "university": _s(get("university")),
            "kind": "iti" if is_iti else derive_kind(name, ctype),
        }
    return list(out.values()), skipped


def upsert(records: list[dict], db=None) -> int:
    if db is None:
        from app.core.db import get_db
        db = get_db()
    n = 0
    for i in range(0, len(records), BATCH):
        batch = [{**r, "updated_at": "now()"} for r in records[i:i + BATCH]]
        db.table("colleges").upsert(batch, on_conflict="aishe_code").execute()
        n += len(batch)
        print(f"  upserted {n}/{len(records)}", flush=True)
    return n


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("file", type=Path)
    ap.add_argument("--dry-run", action="store_true", help="parse and count, write nothing")
    ap.add_argument("--iti", action="store_true", help="treat the file as an ITI list (codes get an ITI- prefix)")
    args = ap.parse_args(argv)
    rows = read_rows(args.file)
    records, skipped = build_records(rows, True if args.iti else None)
    counts = Counter(r["kind"] for r in records)
    print(f"{len(records)} institutions parsed ({skipped} rows skipped)")
    for kind, n in counts.most_common():
        print(f"  {kind:<17}{n}")
    if args.dry_run:
        print("dry run: nothing written")
        return 0
    upsert(records)
    print("done")
    return 0


if __name__ == "__main__":
    sys.exit(main())
