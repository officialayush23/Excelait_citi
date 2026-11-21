"""lessons: PDF reading, text capping, JSON checking, TTS splitting, quiz scoring and the
background pipeline, all with fakes (no network, no DB)."""

import base64
import io
import json
import wave
from types import SimpleNamespace

import pytest
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


# ---------- reading ----------
def test_blank_pdf_is_a_scan():
    w = PdfWriter()
    w.add_blank_page(width=200, height=200)
    buf = io.BytesIO()
    w.write(buf)
    with pytest.raises(L.LessonError, match="scan"):
        L.extract_pages(buf.getvalue())


def test_not_a_pdf():
    with pytest.raises(L.LessonError, match="not a PDF"):
        L.extract_pages(b"hello")


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
        L.start_lesson("me", b"0" * (L.MAX_PDF_BYTES + 1), "en", None)


def test_check_answer(monkeypatch):
    monkeypatch.setattr(L, "_fetch", lambda lid: {"owner_id": "me", "is_public": False, "status": "ready"})
    monkeypatch.setattr(L, "_questions", lambda lid: ("quiz", [{"id": "a", "answer_index": 2, "explanation": "because"}]))
    assert L.check_answer("me", "les", 0, 2) == {"correct": True, "answer_index": 2, "explanation": "because"}
    assert L.check_answer("me", "les", 0, 1)["correct"] is False
    with pytest.raises(LookupError):
        L.check_answer("me", "les", 5, 0)
    with pytest.raises(LookupError):
        L.check_answer("someone-else", "les", 0, 0)  # private lesson
