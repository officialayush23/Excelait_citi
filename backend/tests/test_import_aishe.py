"""AISHE importer: header detection, kind derivation, batching. No network or DB."""

from openpyxl import Workbook

from scripts import import_aishe as ia


def _xlsx(path, header, rows, preamble=2):
    wb = Workbook()
    ws = wb.active
    for i in range(preamble):
        ws.append([f"Report title line {i}"])
    ws.append(header)
    for r in rows:
        ws.append(r)
    wb.save(path)


HEADER = ["S.No", "AISHE Code", "Name of the Institution", "State", "District", "Year Of Establishment",
          "Location", "College Type", "Management", "Affiliated University Name"]


def test_derive_kind():
    k = ia.derive_kind
    assert k("Govt Industrial Training Institute Pune") == "iti"
    assert k("Government Polytechnic Nagpur") == "polytechnic"
    assert k("College of Engineering and Technology") == "engineering"
    assert k("Institute of Technology") == "engineering"
    assert k("Sunrise College of Nursing") == "nursing"
    assert k("Government Medical College") == "medical"
    assert k("City College of Pharmacy") == "pharmacy"
    assert k("Paramedical Sciences Institute") == "paramedical"
    assert k("College of Agriculture") == "agriculture"
    assert k("Veterinary College") == "veterinary"
    assert k("District Institute of Education and Training (DIET)") == "teacher_training"
    assert k("Shri B.Ed College") == "teacher_training"
    assert k("Government Law College") == "law"
    assert k("Institute of Hotel Management") == "hotel"
    assert k("Govt Degree College for Arts and Commerce", "General") == "general"


def test_header_detection_with_preamble(tmp_path):
    p = tmp_path / "a.xlsx"
    _xlsx(p, HEADER, [
        [1, "C-1001", "ABC College of Engineering", "Maharashtra", "Pune", 1998, "Urban", "Affiliated", "Private", "SPPU"],
        [2, "C-1002", "Govt Arts College", "Bihar", "Gaya", "1965", "Rural", "Affiliated", "Government", "MU"],
        [3, None, "No code", "X", "Y", None, None, None, None, None],
    ])
    rows = ia.read_rows(p)
    recs, skipped = ia.build_records(rows)
    assert skipped == 1
    assert [r["aishe_code"] for r in recs] == ["C-1001", "C-1002"]
    a, b = recs
    assert a["kind"] == "engineering" and a["year_est"] == 1998 and a["university"] == "SPPU"
    assert b["kind"] == "general" and b["year_est"] == 1965 and b["location"] == "Rural"
    assert "org_id" not in a and "details" not in a


def test_slightly_different_headers(tmp_path):
    p = tmp_path / "b.xlsx"
    _xlsx(p, ["AISHE  Code", "Name of Institution", "State Name", "District Name", "Year of Establishment"],
          [["S-1", "X Nursing School", "Kerala", "Kochi", 2005]], preamble=0)
    recs, _ = ia.build_records(ia.read_rows(p))
    assert recs[0]["kind"] == "nursing" and recs[0]["district"] == "Kochi"


def test_csv_and_duplicate_codes(tmp_path):
    p = tmp_path / "c.csv"
    p.write_text("AISHE Code,Name of the Institution,State\nC-1,First College,Goa\nC-1,Renamed College,Goa\n", encoding="utf-8")
    recs, _ = ia.build_records(ia.read_rows(p))
    assert len(recs) == 1 and recs[0]["name"] == "Renamed College"


def test_iti_csv_gets_prefix(tmp_path):
    p = tmp_path / "iti.csv"
    p.write_text("ITI Code,ITI Name,State,District,Type\n1234,Govt ITI Satara,Maharashtra,Satara,Government\n", encoding="utf-8")
    recs, _ = ia.build_records(ia.read_rows(p))
    assert recs[0]["aishe_code"] == "ITI-1234" and recs[0]["kind"] == "iti"
    assert recs[0]["college_type"] == "Government"


def test_missing_header_raises():
    import pytest
    with pytest.raises(ValueError):
        ia.build_records([["foo", "bar"], [1, 2]])


class FakeDB:
    def __init__(self):
        self.calls = []

    def table(self, name):
        self.name = name
        return self

    def upsert(self, batch, on_conflict=None):
        self.calls.append((self.name, len(batch), on_conflict, batch[0]))
        return self

    def execute(self):
        return self


def test_upsert_batches_of_500():
    recs = [{"aishe_code": f"C-{i}", "name": "n", "kind": "general"} for i in range(1201)]
    db = FakeDB()
    assert ia.upsert(recs, db=db) == 1201
    assert [c[1] for c in db.calls] == [500, 500, 201]
    assert all(c[0] == "colleges" and c[2] == "aishe_code" for c in db.calls)
    assert "org_id" not in db.calls[0][3] and "details" not in db.calls[0][3]


def test_main_dry_run_prints_counts(tmp_path, capsys):
    p = tmp_path / "d.csv"
    p.write_text("AISHE Code,Name of the Institution\nC-1,Govt Polytechnic\nC-2,Some Arts College\n", encoding="utf-8")
    assert ia.main([str(p), "--dry-run"]) == 0
    out = capsys.readouterr().out
    assert "polytechnic" in out and "general" in out and "dry run" in out
