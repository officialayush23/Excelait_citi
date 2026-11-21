"""lessons: PDF reading, text capping, JSON checking, TTS splitting, quiz scoring and the
background pipeline, all with fakes (no network, no DB)."""

import base64
import io
import json
import wave
from types import SimpleNamespace

import pytest
from PIL import Image
from pypdf import PdfWriter

from app.services import lessons as L


def _good(n_quiz=6) -> dict:
    return {
        "title": "Photosynthesis",
        "summary": "Plants make food. They use sunlight.",
        "sections": [{"heading": f"Part {i}", "text": f"Leaves make food in sunlight number {i}."} for i in range(4)],
        "key_terms": [{"term": "Chlorophyll", "meaning": "The green colour in leaves."}],
        "quiz": [{"prompt": f"Q{i}?", "options": ["Sun", "Moon", "Rock", "Sand"], "answer_index": 0, "explanation": "Text says sun."} for i in range(n_quiz)],
        "flashcards": [{"front": "What do plants need?", "back": "Sunlight"}],
    }


# ---------- reading: page routing ----------
GOOD_TEXT = "Plants make their own food in the leaves using sunlight."


def _pdf(page_texts):
    """A small real PDF: a page with text has a text layer, None gives a blank (scan-like) page."""
    objs = []  # object bodies, 1-based ids; 1 catalog, 2 pages, 3 font, then page + content pairs
    kids = []
    for i, t in enumerate(page_texts):
        pid = 4 + 2 * i
        kids.append(f"{pid} 0 R")
        stream = f"BT /F1 12 Tf 50 700 Td ({t}) Tj ET" if t else ""
        objs.append((pid, f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents {pid + 1} 0 R /Resources << /Font << /F1 3 0 R >> >> >>"))
        objs.append((pid + 1, f"<< /Length {len(stream)} >>\nstream\n{stream}\nendstream"))
    head = [(1, "<< /Type /Catalog /Pages 2 0 R >>"), (2, f"<< /Type /Pages /Kids [{' '.join(kids)}] /Count {len(kids)} >>"),
            (3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")]
    out, offsets = b"%PDF-1.4\n", {}
    for oid, body in head + objs:
        offsets[oid] = len(out)
        out += f"{oid} 0 obj\n{body}\nendobj\n".encode()
    xref = len(out)
    out += f"xref\n0 {len(offsets) + 1}\n0000000000 65535 f \n".encode()
    for oid in sorted(offsets):
        out += f"{offsets[oid]:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(offsets) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF".encode()
    return out


def test_pdf_with_text_on_every_page_needs_no_ocr():
    src = L.plan_pdf(_pdf([GOOD_TEXT, GOOD_TEXT]))
    assert src.kind == "pdf" and not src.needs_ocr and src.ocr_pages == [] and src.skipped == 0
    assert all(GOOD_TEXT in p for p in src.pages)


def test_blank_pdf_page_is_routed_to_ocr():
    w = PdfWriter()
    w.add_blank_page(width=200, height=200)
    buf = io.BytesIO()
    w.write(buf)
    src = L.plan_pdf(buf.getvalue())
    assert src.needs_ocr and src.ocr_pages == [0] and src.pages == [""]


def test_mixed_pdf_is_routed_page_by_page():
    src = L.plan_pdf(_pdf([GOOD_TEXT, None, GOOD_TEXT, "hi"]))  # page 4 has too little text to trust
    assert src.ocr_pages == [1, 3]
    assert GOOD_TEXT in src.pages[0] and src.pages[1] == "" and GOOD_TEXT in src.pages[2] and src.pages[3] == ""


def test_ocr_is_capped_at_15_pages_and_the_rest_counted():
    src = L.plan_pdf(_pdf([None] * 20))
    assert src.ocr_pages == list(range(15)) and src.skipped == 5 and len(src.pages) == 20
    src = L.plan_pdf(_pdf([None, GOOD_TEXT] * 10))  # only scanned pages count toward the cap
    assert len(src.ocr_pages) == 10 and src.skipped == 0


def test_not_a_pdf_and_broken_pdf():
    with pytest.raises(L.LessonError, match="not a PDF"):
        L.plan_pdf(b"hello")
    with pytest.raises(L.LessonError, match="could not be read"):
        L.plan_pdf(b"%PDF-1.4 this is not really a pdf")


def test_is_real_text():
    assert L.is_real_text(GOOD_TEXT)
    assert L.is_real_text("प्रकाश संश्लेषण में पौधे अपना भोजन बनाते हैं।")
    assert not L.is_real_text("short")
    assert not L.is_real_text("(cid:12)(cid:45)(cid:7) " * 10)          # broken font map
    assert not L.is_real_text("\ufffd\ufffd\ufffd a b " * 10)           # replacement characters
    assert not L.is_real_text("1234567890 ... --- 4567 8901 2345 6789")   # numbers and symbols only


# ---------- reading: photos ----------
def _jpeg(size=(60, 40)):
    buf = io.BytesIO()
    Image.new("RGB", size, "white").save(buf, "JPEG")
    return buf.getvalue()


def test_check_images_accepts_jpeg_png_webp_by_header():
    png, webp = io.BytesIO(), io.BytesIO()
    Image.new("RGB", (10, 10)).save(png, "PNG")
    Image.new("RGB", (10, 10)).save(webp, "WEBP")
    src = L.plan_photos([_jpeg(), png.getvalue(), webp.getvalue()])
    assert src.kind == "photo" and src.ocr_pages == [0, 1, 2] and src.pages == ["", "", ""] and len(src.images) == 3


def test_check_images_rejects_bad_files():
    with pytest.raises(L.LessonError, match="PDF or some photos"):
        L.check_images([])
    with pytest.raises(L.LessonError, match="up to 10"):
        L.check_images([_jpeg()] * 11)
    L.check_images([_jpeg()] * 10)
    with pytest.raises(L.LessonError, match="Photo 2 is not a JPEG"):
        L.check_images([_jpeg(), b"GIF89a" + b"0" * 50])
    with pytest.raises(L.LessonError, match="Photo 1 is bigger than 8 MB"):
        L.check_images([_jpeg() + b"0" * (L.MAX_IMAGE_BYTES + 1)])
    with pytest.raises(L.LessonError, match="Photo 1 could not be opened"):
        L.check_images([b"\xff\xd8\xff" + b"garbage" * 20])  # right header, not a picture
    with pytest.raises(L.LessonError, match="Photo 1 is not"):
        L.check_images([b"%PDF-1.4" + b"0" * 50])


# ---------- reading: OCR run (OCR itself mocked) ----------
def _res(text, conf=0.95, script="en"):
    return SimpleNamespace(text=text, confidence=conf, script=script)


def test_read_scans_fills_only_the_scanned_pages_in_order_with_progress():
    src = L.Source("pdf", [GOOD_TEXT, "", "", GOOD_TEXT], ocr_pages=[1, 2], pdf=b"x")
    seen, progress = [], []

    def fake(image, language, first):
        seen.append((image, first))
        return _res(f"scanned page {image}. " * 4, 0.9, script="devanagari")

    pages, conf, results = L.read_scans(src, "hi", lambda d, n: progress.append((d, n)), ocr_fn=fake, render=lambda i: i)
    assert pages[0] == GOOD_TEXT and pages[3] == GOOD_TEXT and pages[1].startswith("scanned page 1.") and pages[2].startswith("scanned page 2.")
    assert progress == [(0, 2), (1, 2), (2, 2)]
    assert seen == [(1, None), (2, "devanagari")]  # the script that worked is tried first on the next page
    assert conf == pytest.approx(0.9) and len(results) == 2


def test_read_scans_does_not_carry_over_a_shaky_script():
    src = L.Source("pdf", ["", ""], ocr_pages=[0, 1], pdf=b"x")
    firsts = []

    def fake(image, language, first):
        firsts.append(first)
        return _res("some words here that were read badly", 0.4, script="en")

    L.read_scans(src, "hi", ocr_fn=fake, render=lambda i: i)
    assert firsts == [None, None]


def test_read_scans_photos_keep_the_given_order():
    imgs = [_jpeg((10 + i, 10)) for i in range(3)]
    src = L.plan_photos(imgs)
    widths = []
    pages, _, _ = L.read_scans(src, "en", ocr_fn=lambda im, lang, first: (widths.append(im.width), _res(f"photo {im.width}"))[1])
    assert widths == [10, 11, 12] and pages == ["photo 10", "photo 11", "photo 12"]


@pytest.fixture
def no_db(monkeypatch):
    """read_source reports progress to the DB; these tests must not reach a real one."""
    monkeypatch.setattr(L, "_update", lambda *a, **k: None)


def _long(text="The leaves make food from sunlight and water. "):
    return text * 8


def test_read_source_returns_text_and_no_notes_when_clear(no_db):
    src = L.Source("photo", [""], ocr_pages=[0], images=[_jpeg()])
    text, notes = L.read_source("les", src, "en", ocr_fn=lambda im, lang, first: _res(_long(), 0.95))
    assert "leaves make food" in text and notes == []


def test_read_source_notes_low_confidence_but_still_proceeds(no_db):
    src = L.Source("photo", [""], ocr_pages=[0], images=[_jpeg()])
    text, notes = L.read_source("les", src, "en", ocr_fn=lambda im, lang, first: _res(_long(), 0.55))
    assert text and notes == ["low_confidence"]


def test_read_source_notes_skipped_pages(no_db):
    src = L.Source("pdf", [""], ocr_pages=[0], pdf=b"x", skipped=5)
    text, notes = L.read_source("les", src, "en", ocr_fn=lambda im, lang, first: _res(_long(), 0.9), render=lambda i: i)
    assert notes == ["pages_skipped"]


def test_read_source_too_little_text_is_a_clear_error(no_db):
    src = L.Source("photo", [""], ocr_pages=[0], images=[_jpeg()])
    with pytest.raises(L.LessonError, match="enough text from these photos"):
        L.read_source("les", src, "en", ocr_fn=lambda im, lang, first: _res("", 0.0))


def test_read_source_engine_and_image_failures_are_friendly(no_db):
    from app.services import ocr

    def no_engine(im, lang, first):
        raise ocr.OcrError("models missing")

    src = L.Source("photo", [""], ocr_pages=[0], images=[_jpeg()])
    with pytest.raises(L.LessonError, match="not available right now"):
        L.read_source("les", src, "en", ocr_fn=no_engine)
    bad = L.Source("photo", [""], ocr_pages=[0], images=[b"\xff\xd8\xffjunk" * 10])
    with pytest.raises(L.LessonError, match="take the photo again"):
        L.read_source("les", bad, "en", ocr_fn=no_engine)


# ---------- capping ----------
def test_cap_short_text_kept_whole():
    assert L.cap_text(["one.", "", "two."]) == "one.\n\ntwo."


def test_cap_long_text_covers_every_page_and_fits():
    pages = [("Page %d sentence. " % i) * 300 for i in range(10)]  # ~5.4k chars each
    out = L.cap_text(pages, 12_000)
    assert len(out) <= 12_000
    for i in range(10):
        assert f"Page {i} sentence." in out
    assert out.split("\n\n")[0].endswith(".")  # cut at a sentence end


def test_cap_short_pages_give_spare_room_to_long_ones():
    pages = ["Short page.", ("Long one. " * 2000)]
    out = L.cap_text(pages, 1000)
    assert out.startswith("Short page.")
    assert 900 < len(out) <= 1000


# ---------- JSON ----------
def test_parse_json_strips_fences_and_prose():
    assert L.parse_json('```json\n{"a": 1}\n```') == {"a": 1}
    assert L.parse_json('Here it is: {"a": 2} done') == {"a": 2}
    with pytest.raises(ValueError):
        L.parse_json("no json here")


def test_normalise_good_and_shuffles_answers_consistently():
    out = L.normalise(_good())
    assert len(out["sections"]) == 4 and len(out["quiz"]) == 6
    for q in out["quiz"]:
        assert q["options"][q["answer_index"]] == "Sun"
    assert len({q["answer_index"] for q in out["quiz"]}) > 1  # not always option A
    assert out == L.normalise(_good())  # deterministic


def test_normalise_drops_bad_questions_and_caps():
    d = _good(n_quiz=4)
    d["quiz"] += [
        {"prompt": "x", "options": ["a", "b", "c"], "answer_index": 0},          # 3 options
        {"prompt": "y", "options": ["a", "a", "b", "c"], "answer_index": 0},     # duplicate option
        {"prompt": "z", "options": ["a", "b", "c", "d"], "answer_index": 7},     # bad index
        {"prompt": "w", "options": ["a", "b", "c", "d"], "answer_index": "2"},   # string index is fine
    ]
    d["sections"] = d["sections"] * 3
    d["sections"][0]["text"] = "word " * 400
    out = L.normalise(d)
    assert len(out["quiz"]) == 5
    assert len(out["sections"]) == 6
    assert len(out["sections"][0]["text"].split()) <= L.SECTION_WORDS


def test_normalise_rejects_unusable_and_fills_flashcards():
    with pytest.raises(ValueError):
        L.normalise({"sections": [], "quiz": _good()["quiz"]})
    with pytest.raises(ValueError):
        L.normalise({**_good(), "quiz": _good()["quiz"][:2]})
    d = {**_good(), "flashcards": [], "title": ""}
    out = L.normalise(d, "My chapter")
    assert out["flashcards"] == [{"front": "Chlorophyll", "back": "The green colour in leaves."}]
    assert out["title"] == "My chapter"


def test_generate_retries_once_on_bad_json():
    calls = []

    def llm(messages):
        calls.append(messages)
        return ("oops not json", 10) if len(calls) == 1 else (json.dumps(_good()), 20)

    lesson, tokens = L.generate("text", "hi", None, llm=llm)
    assert len(calls) == 2 and tokens == 30 and lesson["title"] == "Photosynthesis"
    assert "Hindi" in calls[0][0]["content"] and "ONLY facts" in calls[0][0]["content"]


def test_generate_fails_after_two_bad_replies():
    with pytest.raises(ValueError, match="bad JSON"):
        L.generate("text", "en", None, llm=lambda m: ("{}", 1))


# ---------- TTS ----------
def test_split_for_tts_limits_and_sentence_ends():
    text = " ".join(f"यह वाक्य संख्या {i} है।" for i in range(200))
    chunks = L.split_for_tts(text, 300)
    assert all(len(c) <= 300 for c in chunks)
    assert all(c.endswith("।") for c in chunks)
    assert " ".join(chunks) == text


def test_split_for_tts_long_sentence_and_empty():
    chunks = L.split_for_tts("word " * 500, 100)
    assert all(len(c) <= 100 for c in chunks) and sum(len(c.split()) for c in chunks) == 500
    assert L.split_for_tts("   ") == []


def _wav(frames: int) -> bytes:
    b = io.BytesIO()
    with wave.open(b, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(b"\x00\x00" * frames)
    return b.getvalue()


def test_section_audio_joins_chunks():
    spoken = []

    def tts(text, lang):
        spoken.append(text)
        return base64.b64encode(_wav(100)).decode()

    sec = {"heading": "Light", "text": "A sentence here. " * 200}
    audio = L.section_audio(sec, "en", tts)
    assert len(spoken) > 1 and spoken[0].startswith("Light.")
    with wave.open(io.BytesIO(audio)) as w:
        assert w.getnframes() == 100 * len(spoken)


# ---------- quiz ----------
def test_score_quiz():
    qs = [{"id": "a", "answer_index": 1, "explanation": "e1"}, {"id": "b", "answer_index": 0}, {"id": "c", "answer_index": 3}]
    r = L.score_quiz(qs, [1, 2])
    assert (r["right"], r["total"], r["score"]) == (1, 3, 33.33)
    assert [x["correct"] for x in r["results"]] == [True, False, False]
    assert r["results"][2]["chosen"] is None and r["results"][0]["explanation"] == "e1"
    assert L.score_quiz(qs, [True, 0, 3])["right"] == 2  # bools are not answers
    assert L.score_quiz([], [])["score"] == 0.0


# ---------- pipeline with a fake DB ----------
class FakeQuery:
    def __init__(self, db, table):
        self.db, self.table, self.op, self.payload = db, table, None, None

    def insert(self, payload):
        self.op, self.payload = "insert", payload
        return self

    def update(self, payload):
        self.op, self.payload = "update", payload
        return self

    def eq(self, *a):
        return self

    def execute(self):
        self.db.log.append((self.table, self.op, self.payload))
        rows = self.payload if isinstance(self.payload, list) else [self.payload]
        return SimpleNamespace(data=[{"id": f"{self.table}-1", **r} for r in rows])


class FakeBucket:
    def __init__(self, db, name):
        self.db, self.name = db, name

    def upload(self, path, data, opts):
        if self.db.fail_upload:
            raise RuntimeError("down")
        self.db.files[f"{self.name}/{path}"] = data


class FakeDB:
    def __init__(self, fail_upload=False):
        self.log, self.files, self.fail_upload = [], {}, fail_upload
        self.storage = SimpleNamespace(from_=lambda name: FakeBucket(self, name))

    def table(self, name):
        return FakeQuery(self, name)


def _updates(db):
    merged = {}
    for t, op, p in db.log:
        if t == "lessons" and op == "update":
            merged.update(p)
    return merged


def test_process_lesson_ready(monkeypatch):
    db = FakeDB()
    monkeypatch.setattr(L, "get_db", lambda: db)
    tts = lambda text, lang: base64.b64encode(_wav(10)).decode()
    L.process_lesson("les", "me", "chapter", "mr", None, llm=lambda m: (json.dumps(_good()), 5), tts=tts)
    u = _updates(db)
    assert u["status"] == "ready" and u["error"] is None and u["title"] == "Photosynthesis"
    assert u["audio_paths"] == [f"me/les/{i}.wav" for i in range(4)]
    assert len(db.files) == 4
    qq = [p for t, op, p in db.log if t == "quiz_questions"][0]
    assert len(qq) == 6 and [q["position"] for q in qq] == list(range(6))


def test_process_lesson_ready_without_audio(monkeypatch):
    db = FakeDB(fail_upload=True)
    monkeypatch.setattr(L, "get_db", lambda: db)
    L.process_lesson("les", "me", "chapter", "en", "Mine", llm=lambda m: (json.dumps(_good()), 5), tts=lambda t, l: "")
    u = _updates(db)
    assert u["status"] == "ready" and u["audio_paths"] == ["", "", "", ""] and u["error"] and u["title"] == "Mine"


def test_process_lesson_with_scans_reads_then_writes_and_adds_the_note(monkeypatch):
    db = FakeDB()
    monkeypatch.setattr(L, "get_db", lambda: db)
    src = L.Source("photo", ["", ""], ocr_pages=[0, 1], images=[_jpeg(), _jpeg()])
    tts = lambda text, lang: base64.b64encode(_wav(10)).decode()
    L.process_lesson("les", "me", src, "hi", None, llm=lambda m: (json.dumps(_good()), 5), tts=tts,
                     ocr_fn=lambda im, lang, first: _res(_long(), 0.5, "devanagari"))
    updates = [p for t, op, p in db.log if t == "lessons" and op == "update"]
    assert [p["progress"] for p in updates if "progress" in p and "ocr" in p["progress"]] == [{"ocr": {"done": d, "total": 2}} for d in (0, 1, 2)]
    stages = [p["stage"] for p in updates if "stage" in p]
    assert stages == ["writing", "recording", "done"]
    u = _updates(db)
    assert u["status"] == "ready" and u["summary"] == "Plants make food. They use sunlight."
    assert {"notes": ["low_confidence"]} in [p.get("progress") for p in updates]


def test_process_lesson_with_scans_fails_clearly_when_nothing_is_readable(monkeypatch):
    db = FakeDB()
    monkeypatch.setattr(L, "get_db", lambda: db)
    src = L.Source("photo", [""], ocr_pages=[0], images=[_jpeg()])
    L.process_lesson("les", "me", src, "en", None, llm=lambda m: pytest.fail("no lesson without text"), ocr_fn=lambda im, lang, first: _res("", 0.0))
    u = _updates(db)
    assert u["status"] == "failed" and "enough text" in u["error"]


def test_process_lesson_progress_column_missing_does_not_break_the_lesson(monkeypatch):
    db = FakeDB()
    monkeypatch.setattr(L, "get_db", lambda: db)
    real_update = L._update

    def update(lid, **f):
        if "progress" in f:
            raise RuntimeError("column progress does not exist")
        real_update(lid, **f)

    monkeypatch.setattr(L, "_update", update)
    src = L.Source("photo", [""], ocr_pages=[0], images=[_jpeg()])
    tts = lambda text, lang: base64.b64encode(_wav(10)).decode()
    L.process_lesson("les", "me", src, "en", None, llm=lambda m: (json.dumps(_good()), 5), tts=tts, ocr_fn=lambda im, lang, first: _res(_long(), 0.9))
    assert _updates(db)["status"] == "ready"


def test_process_lesson_failed_on_llm(monkeypatch):
    db = FakeDB()
    monkeypatch.setattr(L, "get_db", lambda: db)
    L.process_lesson("les", "me", "chapter", "en", None, llm=lambda m: ("nope", 1))
    u = _updates(db)
    assert u["status"] == "failed" and "try again" in u["error"]


def test_start_lesson_rejects_language_and_size():
    with pytest.raises(L.LessonError, match="language"):
        L.start_lesson("me", b"%PDF", "xx", None)
    with pytest.raises(L.LessonError, match="10 MB"):
        L.start_lesson("me", b"%PDF" + b"0" * L.MAX_PDF_BYTES, "en", None)
    with pytest.raises(L.LessonError, match="8 MB"):
        L.start_lesson("me", [_jpeg() + b"0" * L.MAX_IMAGE_BYTES], "en", None)
    with pytest.raises(L.LessonError, match="not both"):
        L.start_lesson("me", [_pdf([GOOD_TEXT]), _jpeg()], "en", None)


def test_start_lesson_text_pdf_goes_straight_to_writing(monkeypatch):
    db = FakeDB()
    monkeypatch.setattr(L, "get_db", lambda: db)
    row, source = L.start_lesson("me", _pdf([GOOD_TEXT] * 6), "en", None, "chapter_3-plants.pdf")
    ins = [p for t, op, p in db.log if t == "lessons" and op == "insert"][0]
    assert isinstance(source, str) and GOOD_TEXT in source
    assert ins["stage"] == "writing" and ins["source"] == "pdf" and ins["page_count"] == 6 and ins["title"] == "chapter 3 plants"


def test_start_lesson_scanned_pdf_waits_for_ocr(monkeypatch):
    db = FakeDB()
    monkeypatch.setattr(L, "get_db", lambda: db)
    row, source = L.start_lesson("me", _pdf([GOOD_TEXT, None, None]), "hi", None)
    ins = [p for t, op, p in db.log if t == "lessons" and op == "insert"][0]
    assert isinstance(source, L.Source) and source.ocr_pages == [1, 2]
    assert ins["stage"] == "reading" and ins["source"] == "pdf" and ins["page_count"] == 3


def test_start_lesson_photos_are_source_photo_in_given_order(monkeypatch):
    db = FakeDB()
    monkeypatch.setattr(L, "get_db", lambda: db)
    photos = [_jpeg((20 + i, 10)) for i in range(3)]
    row, source = L.start_lesson("me", photos, "mr", "Page photos")
    ins = [p for t, op, p in db.log if t == "lessons" and op == "insert"][0]
    assert ins["source"] == "photo" and ins["stage"] == "reading" and ins["page_count"] == 3 and ins["title"] == "Page photos"
    assert source.images == photos and source.kind == "photo"
    assert not db.files  # photos are not stored, only the lesson


def test_start_lesson_text_pdf_with_too_little_text(monkeypatch):
    monkeypatch.setattr(L, "get_db", lambda: FakeDB())
    with pytest.raises(L.LessonError, match="too little text"):
        L.start_lesson("me", _pdf([GOOD_TEXT]), "en", None)


def test_check_answer(monkeypatch):
    monkeypatch.setattr(L, "_fetch", lambda lid: {"owner_id": "me", "is_public": False, "status": "ready"})
    monkeypatch.setattr(L, "_questions", lambda lid: ("quiz", [{"id": "a", "answer_index": 2, "explanation": "because"}]))
    assert L.check_answer("me", "les", 0, 2) == {"correct": True, "answer_index": 2, "explanation": "because"}
    assert L.check_answer("me", "les", 0, 1)["correct"] is False
    with pytest.raises(LookupError):
        L.check_answer("me", "les", 5, 0)
    with pytest.raises(LookupError):
        L.check_answer("someone-else", "les", 0, 0)  # private lesson


# ---------- the upload endpoint ----------
@pytest.fixture
def client(monkeypatch):
    from fastapi.testclient import TestClient

    from app.api.routes import learn
    from app.core.auth import CurrentUser, get_current_user
    from app.main import create_app

    app = create_app()
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(id="u1", email=None, roles={"student"})
    started, ran = [], []
    monkeypatch.setattr(L, "active_count", lambda uid: 0)
    monkeypatch.setattr(L, "start_lesson", lambda *a: (started.append(a), ({"id": "les-1", "stage": "reading"}, "src"))[1])
    monkeypatch.setattr(L, "process_lesson", lambda *a, **k: ran.append(a))
    c = TestClient(app)
    c.started, c.ran, c.learn = started, ran, learn
    return c


def test_upload_accepts_photos_in_order(client):
    photos = [_jpeg((20 + i, 10)) for i in range(3)]
    r = client.post("/api/v1/learn/lessons", data={"language": "hi"}, files=[("files", (f"p{i}.jpg", b, "image/jpeg")) for i, b in enumerate(photos)])
    assert r.status_code == 202 and r.json() == {"id": "les-1", "status": "processing", "stage": "reading"}
    owner, data, lang, title, filename = client.started[0]
    assert owner == "u1" and data == photos and lang == "hi" and filename == "p0.jpg"
    assert client.ran and client.ran[0][2] == "src"


def test_upload_still_takes_one_pdf_as_file_or_files(client):
    pdf = _pdf([GOOD_TEXT])
    assert client.post("/api/v1/learn/lessons", files={"file": ("a.pdf", pdf, "application/pdf")}).status_code == 202
    assert client.post("/api/v1/learn/lessons", files=[("files", ("b.pdf", pdf, "application/pdf"))]).status_code == 202
    assert client.started[0][1] == [pdf] and client.started[1][1] == [pdf]


def test_upload_limits(client):
    assert client.post("/api/v1/learn/lessons", data={"language": "en"}).status_code == 422
    too_many = [("files", (f"{i}.jpg", _jpeg(), "image/jpeg")) for i in range(11)]
    assert client.post("/api/v1/learn/lessons", files=too_many).status_code == 422
    big = _jpeg() + b"0" * (L.MAX_IMAGE_BYTES + 1)
    assert client.post("/api/v1/learn/lessons", files=[("files", ("big.jpg", big, "image/jpeg"))]).status_code == 413
    assert not client.started
