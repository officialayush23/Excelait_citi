"""Chapter to lesson: a textbook chapter (a PDF, or photos of its pages) becomes a short lesson
in simple language, with audio per section, a quiz and flashcards.

Reading: a PDF page with a real text layer is read directly; a scanned page (and every photo)
goes through OCR (app/services/ocr.py) in the background task, page by page, with progress.

Cost: one LLM call per lesson (a second only if the first reply is not valid JSON),
then one or more Sarvam TTS calls per section. Everything is grounded in the text read
from the pages; the prompt forbids adding facts that are not in it."""

from __future__ import annotations

import base64
import io
import json
import random
import re
import time
import unicodedata
import wave
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

import httpx

from app.core.config import get_settings
from app.core.db import get_db
from app.services import ocr
from app.services.ai import LANG_NAMES
from app.services.voice import MAX_TTS_CHARS, text_to_speech

MAX_PDF_BYTES = 10 * 1024 * 1024
MAX_PAGES = 40           # pages read from one PDF
MAX_INPUT_CHARS = 12_000  # chapter text sent to the model
MIN_TEXT_CHARS = 200     # fewer characters than this in all pages is too little to write a lesson from
MIN_PAGE_CHARS = 30      # a page needs this much real text in its text layer, else it is read by OCR
MAX_OCR_PAGES = 15       # scanned pages read per lesson; later ones are skipped (and the lesson says so)
OCR_DPI = 200            # scanned PDF pages are drawn at this resolution before OCR
MAX_IMAGES = 10
MAX_IMAGE_BYTES = 8 * 1024 * 1024
SECTION_WORDS = 160      # hard cap on a section; the prompt asks for 120
SIGNED_URL_SECONDS = 6 * 3600
STALE_AFTER = timedelta(minutes=15)
PDF_BUCKET, AUDIO_BUCKET = "lesson-pdfs", "lesson-audio"
FALLBACK_MODEL = "openai/gpt-oss-20b"
LIST_COLS = "id, owner_id, title, language, status, stage, is_public, summary, page_count, created_at"


class LessonError(ValueError):
    """A problem the user can act on (bad file, scan, not allowed)."""


# ---------- reading the PDF ----------
def _clean(text: str) -> str:
    text = text.replace("­", "").replace("\x00", "")
    text = re.sub(r"-\n(?=[a-z])", "", text)          # join words hyphenated across lines
    text = re.sub(r"[ \t ]+", " ", text)
    text = re.sub(r"\s*\n\s*", "\n", text)
    return text.strip()


@dataclass
class Source:
    """What a lesson is made from. `pages` holds the text of every page; "" marks a page that
    still has to be read by OCR (its index is in `ocr_pages`, in reading order)."""

    kind: str                                   # 'pdf' or 'photo'
    pages: list[str]
    ocr_pages: list[int] = field(default_factory=list)
    pdf: bytes | None = None
    images: list[bytes] = field(default_factory=list)
    skipped: int = 0                            # scanned pages left unread because of MAX_OCR_PAGES

    @property
    def needs_ocr(self) -> bool:
        return bool(self.ocr_pages)


def is_real_text(text: str) -> bool:
    """A text layer worth using: enough letters, and not the garbage that PDFs with broken font
    maps produce ("(cid:12)", replacement characters, mostly symbols)."""
    body = re.sub(r"\s+", "", text)
    if len(body) < MIN_PAGE_CHARS or "(cid:" in text:
        return False
    letters = sum(1 for c in body if unicodedata.category(c)[0] in "LM")  # M: Devanagari vowel signs are marks
    return letters / len(body) >= 0.6 and text.count("\ufffd") <= len(body) * 0.02


def plan_pdf(pdf: bytes) -> Source:
    """Reads the text layer of each page and decides which pages need OCR."""
    from pypdf import PdfReader

    if not pdf.startswith(b"%PDF"):
        raise LessonError("This file is not a PDF.")
    try:
        reader = PdfReader(io.BytesIO(pdf))
        if reader.is_encrypted:
            try:
                reader.decrypt("")
            except Exception as e:  # noqa: BLE001
                raise LessonError("This PDF is locked with a password.") from e
        layers = []
        for p in reader.pages[:MAX_PAGES]:
            try:
                layers.append(_clean(p.extract_text() or ""))
            except Exception:  # noqa: BLE001 - one bad page: try OCR for it
                layers.append("")
    except LessonError:
        raise
    except Exception as e:  # noqa: BLE001 - pypdf raises many kinds
        raise LessonError("This PDF could not be read. Try saving it again or another file.") from e
    if not layers:
        raise LessonError("This PDF has no pages.")
    pages = [t if is_real_text(t) else "" for t in layers]
    wanted = [i for i, t in enumerate(pages) if not t]
    return Source("pdf", pages, wanted[:MAX_OCR_PAGES], pdf=pdf, skipped=max(0, len(wanted) - MAX_OCR_PAGES))


def check_images(files: list[bytes]) -> None:
    """Up to 10 JPEG/PNG/WebP photos of at most 8 MB, judged by file header, that can be opened."""
    from PIL import Image

    if not files:
        raise LessonError("Please choose a PDF or some photos.")
    if len(files) > MAX_IMAGES:
        raise LessonError(f"You can add up to {MAX_IMAGES} photos.")
    for n, data in enumerate(files, 1):
        if len(data) > MAX_IMAGE_BYTES:
            raise LessonError(f"Photo {n} is bigger than 8 MB.")
        if ocr.sniff_image(data) is None:
            raise LessonError(f"Photo {n} is not a JPEG, PNG or WebP picture.")
        try:
            with Image.open(io.BytesIO(data)) as im:
                too_big = im.width * im.height > ocr.MAX_PIXELS
        except Exception as e:  # noqa: BLE001
            raise LessonError(f"Photo {n} could not be opened.") from e
        if too_big:
            raise LessonError(f"Photo {n} is too large. Please use a smaller picture.")


def plan_photos(files: list[bytes]) -> Source:
    check_images(files)
    return Source("photo", [""] * len(files), list(range(len(files))), images=list(files))


def _render_page(doc, index: int):
    """One PDF page as an RGB image at OCR_DPI (very large pages are scaled to 3000 px)."""
    page = doc[index]
    w, h = page.get_size()
    scale = min(OCR_DPI / 72, 3000 / max(w, h, 1))
    return page.render(scale=scale).to_pil().convert("RGB")


def read_scans(source: Source, language: str, on_progress=None, ocr_fn=None, render=None) -> tuple[list[str], float | None, list]:
    """OCR every page in source.ocr_pages. Returns (page texts, mean confidence or None, per page results).
    A page's text is never left out: pages that read as nothing stay "". `on_progress(done, total)`
    is called before the first page and after each one."""
    ocr_fn = ocr_fn or ocr.ocr_image
    pages = list(source.pages)
    total = len(source.ocr_pages)
    doc = None
    results, first = [], None
    try:
        if source.kind == "pdf" and render is None:
            import pypdfium2 as pdfium

            try:
                doc = pdfium.PdfDocument(source.pdf)
            except Exception as e:  # noqa: BLE001
                raise LessonError("This PDF could not be read. Try saving it again or another file.") from e
            render = lambda i: _render_page(doc, i)  # noqa: E731
        if on_progress:
            on_progress(0, total)
        for k, idx in enumerate(source.ocr_pages):
            image = ocr.load_image(source.images[idx]) if source.kind == "photo" else render(idx)
            res = ocr_fn(image, language, first)
            del image
            results.append(res)
            if res.text.strip() and res.confidence >= ocr.RETRY_CONFIDENCE:
                first = res.script  # the next page starts with the model that just worked
            pages[idx] = _clean(res.text)
            if on_progress:
                on_progress(k + 1, total)
    finally:
        if doc is not None:
            doc.close()
    chars = sum(len(r.text) for r in results)
    conf = sum(r.confidence * len(r.text) for r in results) / chars if chars else None
    return pages, conf, results


def _cut(text: str, limit: int) -> str:
    """Cut at the last sentence end (., ?, !, Devanagari danda) within the limit."""
    if len(text) <= limit:
        return text
    head = text[:limit]
    ends = [m.end() for m in re.finditer(r"[.?!।॥](\s|$)", head)]
    if ends and ends[-1] > limit * 0.5:
        return head[: ends[-1]].strip()
    sp = head.rfind(" ")
    return head[: sp if sp > limit * 0.5 else limit].strip()


def cap_text(pages: list[str], limit: int = MAX_INPUT_CHARS) -> str:
    """Join page texts within `limit` chars. When too long, every page gets a fair share
    (short pages give their spare share to longer ones) so the whole chapter is covered,
    not only its first pages."""
    pages = [p for p in pages if p.strip()]
    sep = "\n\n"
    if not pages:
        return ""
    if sum(len(p) for p in pages) + len(sep) * (len(pages) - 1) <= limit:
        return sep.join(pages)
    budget = limit - len(sep) * (len(pages) - 1)
    share = {i: 0 for i in range(len(pages))}
    open_ = set(share)
    while open_ and budget > 0:
        each = max(1, budget // len(open_))
        for i in sorted(open_):
            give = min(each, len(pages[i]) - share[i], budget)
            share[i] += give
            budget -= give
            if share[i] >= len(pages[i]):
                open_.discard(i)
            if budget <= 0:
                break
    out = [_cut(p, share[i]) for i, p in enumerate(pages) if share[i] > 0]
    return sep.join(x for x in out if x)


# ---------- the one LLM call ----------
SYSTEM = """You turn a textbook chapter into a short lesson for rural Indian students (Class 8 to graduation).
Write every value in {language}, in short, simple sentences. Keep a technical word if needed and add its English word in brackets.
Use ONLY facts stated in the chapter text. Never add facts, numbers, names, dates or examples that are not in the text.
Every quiz answer and explanation must come from the text.
Reply with one JSON object only:
{{"title":str,"summary":"2 sentences","sections":[{{"heading":str,"text":"max 120 words"}}] (3-6, in chapter order),
"key_terms":[{{"term":str,"meaning":"one sentence"}}] (3-8),
"quiz":[{{"prompt":str,"options":[4 short strings],"answer_index":0-3,"explanation":"one sentence"}}] (5-8),
"flashcards":[{{"front":str,"back":str}}] (5-10)}}"""


def build_messages(text: str, language: str, title: str | None) -> list[dict]:
    lang = LANG_NAMES.get(language, "English")
    user = (f"Title hint: {title}\n" if title else "") + f"Chapter text:\n<<<\n{text}\n>>>"
    return [{"role": "system", "content": SYSTEM.format(language=lang)}, {"role": "user", "content": user}]


def _llm_json(messages: list[dict]) -> tuple[str, int]:
    """Returns (content, total_tokens). Main model, a short wait on 429, then the smaller model."""
    s = get_settings()
    r = None
    for model, wait in [(s.llm_model, 0), (s.llm_model, 3.0), (FALLBACK_MODEL, 0)]:
        if wait:
            time.sleep(wait)
        r = httpx.post(f"{s.llm_base_url}/chat/completions", timeout=120, headers={"Authorization": f"Bearer {s.groq_api_key}"},
                       json={"model": model, "messages": messages, "temperature": 0.2, "reasoning_effort": "low",
                             "response_format": {"type": "json_object"}, "max_completion_tokens": 6000})
        if r.status_code != 429:
            break
    assert r is not None
    r.raise_for_status()
    body = r.json()
    return body["choices"][0]["message"].get("content") or "", (body.get("usage") or {}).get("total_tokens", 0)


def parse_json(content: str) -> dict:
    s = content.strip()
    s = re.sub(r"^```(?:json)?\s*|\s*```$", "", s)
    if not s.startswith("{"):
        a, b = s.find("{"), s.rfind("}")
        if a < 0 or b <= a:
            raise ValueError("no JSON object")
        s = s[a : b + 1]
    data = json.loads(s)
    if not isinstance(data, dict):
        raise ValueError("not an object")
    return data


def _s(x) -> str:
    return re.sub(r"\s+", " ", x).strip() if isinstance(x, str) else ""


def _words(text: str, n: int) -> str:
    w = text.split()
    return text if len(w) <= n else _cut(" ".join(w[:n]), len(" ".join(w[:n])))


def normalise(data: dict, fallback_title: str = "Lesson") -> dict:
    """Checks the model's JSON and returns a clean lesson; raises ValueError if unusable."""
    sections = []
    for x in data.get("sections") or []:
        if isinstance(x, dict) and _s(x.get("text")):
            sections.append({"heading": _s(x.get("heading"))[:120] or f"{len(sections) + 1}", "text": _words(_s(x["text"]), SECTION_WORDS)})
    sections = sections[:6]
    if not sections:
        raise ValueError("no sections")

    quiz = []
    for i, q in enumerate(data.get("quiz") or []):
        if not isinstance(q, dict):
            continue
        opts = [_s(o) for o in (q.get("options") or []) if _s(o)] if isinstance(q.get("options"), list) else []
        ai = q.get("answer_index")
        if isinstance(ai, str) and ai.strip().isdigit():
            ai = int(ai)
        if not _s(q.get("prompt")) or len(opts) != 4 or len({o.lower() for o in opts}) != 4 or not isinstance(ai, int) or isinstance(ai, bool) or not 0 <= ai < 4:
            continue
        right = opts[ai]
        random.Random(i).shuffle(opts)  # models favour option A; spread answers, deterministically
        quiz.append({"prompt": _s(q["prompt"]), "options": opts, "answer_index": opts.index(right), "explanation": _s(q.get("explanation"))})
    quiz = quiz[:8]
    if len(quiz) < 3:
        raise ValueError("too few valid quiz questions")

    terms = [{"term": _s(t.get("term")), "meaning": _s(t.get("meaning"))} for t in data.get("key_terms") or [] if isinstance(t, dict)]
    terms = [t for t in terms if t["term"] and t["meaning"]][:8]
    cards = [{"front": _s(c.get("front")), "back": _s(c.get("back"))} for c in data.get("flashcards") or [] if isinstance(c, dict)]
    cards = [c for c in cards if c["front"] and c["back"]][:10] or [{"front": t["term"], "back": t["meaning"]} for t in terms]

    summary = _s(data.get("summary")) or sections[0]["text"][:240]
    return {"title": (_s(data.get("title")) or fallback_title)[:160], "summary": summary[:600], "sections": sections,
            "key_terms": terms, "quiz": quiz, "flashcards": cards}


def generate(text: str, language: str, title: str | None, llm=None) -> tuple[dict, int]:
    """One LLM call; one retry if the reply is not usable JSON. Returns (lesson, tokens)."""
    llm = llm or _llm_json
    messages = build_messages(text, language, title)
    tokens, last = 0, None
    for attempt in range(2):
        content, used = llm(messages)
        tokens += used
        try:
            return normalise(parse_json(content), title or "Lesson"), tokens
        except (ValueError, json.JSONDecodeError) as e:
            last = e
            if attempt == 0:
                messages = [*messages, {"role": "assistant", "content": content[:2000]},
                            {"role": "user", "content": f"That reply was not valid ({e}). Send only the JSON object in the exact shape asked."}]
    raise ValueError(f"lesson writer returned bad JSON: {last}")


# ---------- audio ----------
def split_for_tts(text: str, limit: int = MAX_TTS_CHARS) -> list[str]:
    """Split into chunks of at most `limit` chars, at sentence ends where possible."""
    text = _s(text)
    if not text:
        return []
    sentences = [x for x in re.split(r"(?<=[.?!।॥])\s+", text) if x]
    chunks, cur = [], ""
    for sent in sentences:
        while len(sent) > limit:  # one very long sentence: cut at a space
            piece = _cut(sent, limit)
            if cur:
                chunks.append(cur)
                cur = ""
            chunks.append(piece)
            sent = sent[len(piece):].strip()
        if not sent:
            continue
        if cur and len(cur) + 1 + len(sent) > limit:
            chunks.append(cur)
            cur = sent
        else:
            cur = f"{cur} {sent}".strip()
    if cur:
        chunks.append(cur)
    return chunks


def join_wavs(parts: list[bytes]) -> bytes:
    if len(parts) == 1:
        return parts[0]
    out = io.BytesIO()
    with wave.open(out, "wb") as w:
        for i, p in enumerate(parts):
            with wave.open(io.BytesIO(p), "rb") as r:
                if i == 0:
                    w.setparams(r.getparams())
                w.writeframes(r.readframes(r.getnframes()))
    return out.getvalue()


def section_audio(section: dict, language: str, tts=None) -> bytes:
    tts = tts or text_to_speech
    spoken = f"{section['heading']}. {section['text']}" if section.get("heading") else section["text"]
    return join_wavs([base64.b64decode(tts(chunk, language)) for chunk in split_for_tts(spoken)])


# ---------- quiz ----------
def score_quiz(questions: list[dict], answers: list) -> dict:
    """questions: [{id, answer_index, explanation}] in order; answers: chosen index per question (None = skipped)."""
    results, right = [], 0
    for i, q in enumerate(questions):
        given = answers[i] if i < len(answers) else None
        ok = isinstance(given, int) and not isinstance(given, bool) and given == q["answer_index"]
        right += ok
        results.append({"question_id": q["id"], "chosen": given, "correct": ok, "answer_index": q["answer_index"], "explanation": q.get("explanation") or ""})
    total = len(questions)
    return {"right": right, "total": total, "score": round(100 * right / total, 2) if total else 0.0, "results": results}


# ---------- database / storage ----------
def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _update(lesson_id: str, **fields) -> None:
    get_db().table("lessons").update({**fields, "updated_at": _now()}).eq("id", lesson_id).execute()


def active_count(owner_id: str) -> int:
    since = (datetime.now(timezone.utc) - STALE_AFTER).isoformat()
    rows = get_db().table("lessons").select("id").eq("owner_id", owner_id).eq("status", "processing").gte("created_at", since).execute().data
    return len(rows or [])


def start_lesson(owner_id: str, files: bytes | list[bytes], language: str, title: str | None, filename: str = "") -> tuple[dict, str | Source]:
    """Checks the upload now (a bad file fails at once), saves the row and the PDF, and returns
    (row, source). `files` is one PDF or up to 10 photos in reading order. The source is plain
    capped text when every page has a text layer, else a Source whose scanned pages are read by
    process_lesson in the background."""
    files = [files] if isinstance(files, (bytes, bytearray)) else list(files)
    if any(len(f) > (MAX_PDF_BYTES if f.startswith(b"%PDF") else MAX_IMAGE_BYTES) for f in files):
        raise LessonError("This PDF is bigger than 10 MB." if files and files[0].startswith(b"%PDF") else "A photo is bigger than 8 MB.")
    if language not in LANG_NAMES:
        raise LessonError("This language is not supported yet.")
    pdf = None
    if files and files[0].startswith(b"%PDF"):
        if len(files) > 1:
            raise LessonError("Please choose one PDF, or photos, but not both.")
        pdf = bytes(files[0])
        source = plan_pdf(pdf)
    else:
        source = plan_photos([bytes(f) for f in files])
    if not source.needs_ocr:
        text = cap_text(source.pages)
        if len(text) < MIN_TEXT_CHARS:
            raise LessonError("This PDF has too little text to make a lesson from.")
    title = _s(title)[:160] or None
    stem = _s(re.sub(r"[_-]+", " ", re.sub(r"\.pdf$", "", filename, flags=re.I)))[:160] if pdf else ""
    db = get_db()
    row = db.table("lessons").insert({"owner_id": owner_id, "title": title or stem or "Lesson", "language": language, "status": "processing",
                                      "stage": "reading" if source.needs_ocr else "writing", "source": "pdf" if pdf else "photo",
                                      "page_count": len(source.pages)}).execute().data[0]
    if pdf:
        path = f"{owner_id}/{row['id']}.pdf"
        try:
            db.storage.from_(PDF_BUCKET).upload(path, pdf, {"content-type": "application/pdf", "upsert": "true"})
            _update(row["id"], source_pdf_path=path)
        except Exception:  # noqa: BLE001 - the lesson still works without the stored original
            pass
    return row, (source if source.needs_ocr else text)


def _progress_writer(lesson_id: str):
    """Writes the OCR progress to lessons.progress; a failure (column not there yet) is ignored, once."""
    state = {"ok": True}

    def write(done: int, total: int) -> None:
        if state["ok"]:
            try:
                _update(lesson_id, progress={"ocr": {"done": done, "total": total}})
            except Exception:  # noqa: BLE001
                state["ok"] = False

    return write


def read_source(lesson_id: str, source: Source, language: str, ocr_fn=None, render=None) -> tuple[str, list[str]]:
    """Runs OCR for the scanned pages, then caps the text. Returns (chapter text, note codes).
    Raises LessonError with a message the student can act on."""
    try:
        pages, conf, _results = read_scans(source, language, _progress_writer(lesson_id), ocr_fn=ocr_fn, render=render)
    except ocr.ImageError as e:
        raise LessonError(f"{e} Please take the photo again.") from e
    except ocr.OcrError as e:
        raise LessonError("The text reader is not available right now. Please try again in a few minutes.") from e
    text = cap_text(pages)
    if len(text) < MIN_TEXT_CHARS:
        what = "photos" if source.kind == "photo" else "scanned pages"
        raise LessonError(f"We could not read enough text from these {what}. Please use clear, well lit pictures of the whole page.")
    notes = []
    if source.skipped:
        notes.append("pages_skipped")
    if conf is not None and conf < ocr.LOW_CONFIDENCE:
        notes.append("low_confidence")
    return text, notes


def process_lesson(lesson_id: str, owner_id: str, text: "str | Source", language: str, title: str | None, llm=None, tts=None,
                   ocr_fn=None, render=None) -> None:
    """Background task: read scanned pages (OCR), write the lesson, save quiz and flashcards, record audio."""
    db = get_db()
    notes: list[str] = []
    source: Source | None = None
    if isinstance(text, Source):
        source = text
        try:
            text, notes = read_source(lesson_id, source, language, ocr_fn=ocr_fn, render=render)
        except Exception as e:  # noqa: BLE001
            msg = str(e) if isinstance(e, LessonError) else "We could not read these pages. Please try again."
            _update(lesson_id, status="failed", stage=None, error=msg)
            return
        try:
            _update(lesson_id, stage="writing")
        except Exception:  # noqa: BLE001
            pass
    try:
        lesson, _tokens = generate(text, language, title, llm=llm)
    except Exception as e:  # noqa: BLE001
        _update(lesson_id, status="failed", stage=None, error=f"Could not write the lesson. Please try again. ({str(e)[:160]})")
        return
    summary = lesson["summary"]
    if notes:  # the lesson page shows these as a banner (get_lesson returns them as `notes`)
        try:
            _update(lesson_id, progress={"notes": notes})
        except Exception:  # noqa: BLE001 - progress column is optional for the lesson itself
            pass
    try:
        _update(lesson_id, title=title or lesson["title"], summary=summary, sections=lesson["sections"], key_terms=lesson["key_terms"],
                body="\n\n".join(f"{s['heading']}\n{s['text']}" for s in lesson["sections"]), stage="recording")
        quiz = db.table("quizzes").insert({"lesson_id": lesson_id, "title": title or lesson["title"], "created_by": owner_id}).execute().data[0]
        db.table("quiz_questions").insert([{"quiz_id": quiz["id"], "prompt": q["prompt"], "options": q["options"], "answer_index": q["answer_index"],
                                            "explanation": q["explanation"], "position": i} for i, q in enumerate(lesson["quiz"])]).execute()
        if lesson["flashcards"]:
            db.table("flashcards").insert([{"lesson_id": lesson_id, "front": c["front"], "back": c["back"], "position": i}
                                           for i, c in enumerate(lesson["flashcards"])]).execute()
    except Exception as e:  # noqa: BLE001
        _update(lesson_id, status="failed", stage=None, error=f"Could not save the lesson. ({str(e)[:160]})")
        return

    paths, missing = [], 0
    for i, sec in enumerate(lesson["sections"]):
        path = f"{owner_id}/{lesson_id}/{i}.wav"
        try:
            db.storage.from_(AUDIO_BUCKET).upload(path, section_audio(sec, language, tts), {"content-type": "audio/wav", "upsert": "true"})
            paths.append(path)
        except Exception:  # noqa: BLE001 - reading still works without audio
            paths.append("")
            missing += 1
    _update(lesson_id, audio_paths=paths, status="ready", stage="done",
            error=("Audio could not be made for some parts." if missing else None))


def _can_see(row: dict | None, user_id: str) -> bool:
    return bool(row) and (row["owner_id"] == user_id or (row["is_public"] and row["status"] == "ready"))


def _fetch(lesson_id: str) -> dict | None:
    rows = get_db().table("lessons").select("*").eq("id", lesson_id).limit(1).execute().data
    return rows[0] if rows else None


def list_lessons(user_id: str) -> dict:
    db = get_db()
    mine = db.table("lessons").select(LIST_COLS).eq("owner_id", user_id).order("created_at", desc=True).limit(50).execute().data or []
    shared = (db.table("lessons").select(LIST_COLS).eq("is_public", True).eq("status", "ready").neq("owner_id", user_id)
              .order("created_at", desc=True).limit(50).execute().data or [])
    return {"mine": mine, "shared": shared}


def _signed(paths: list[str]) -> dict[str, str]:
    real = [p for p in paths if p]
    if not real:
        return {}
    try:
        res = get_db().storage.from_(AUDIO_BUCKET).create_signed_urls(real, SIGNED_URL_SECONDS)
    except Exception:  # noqa: BLE001
        return {}
    return {r.get("path"): r.get("signedURL") or r.get("signedUrl") for r in res if not r.get("error")}


def _questions(lesson_id: str) -> tuple[str | None, list[dict]]:
    db = get_db()
    qz = db.table("quizzes").select("id").eq("lesson_id", lesson_id).order("created_at").limit(1).execute().data
    if not qz:
        return None, []
    qs = db.table("quiz_questions").select("id, prompt, options, answer_index, explanation, position").eq("quiz_id", qz[0]["id"]).order("position").execute().data
    return qz[0]["id"], qs or []


def get_lesson(user_id: str, lesson_id: str) -> dict:
    row = _fetch(lesson_id)
    if not _can_see(row, user_id):
        raise LookupError("lesson not found")
    assert row is not None
    if row["status"] == "processing" and datetime.fromisoformat(row["updated_at"] if row.get("updated_at") else row["created_at"]) < datetime.now(timezone.utc) - STALE_AFTER:
        _update(lesson_id, status="failed", stage=None, error="This took too long. Please upload the chapter again.")
        row = {**row, "status": "failed", "stage": None, "error": "This took too long. Please upload the chapter again."}
    out = {k: row.get(k) for k in ("id", "title", "language", "status", "stage", "error", "is_public", "summary", "page_count", "created_at")}
    out["is_owner"] = row["owner_id"] == user_id
    out["source"] = row.get("source")
    prog = row.get("progress") or {}
    out["notes"] = prog.get("notes") or []
    if row["status"] != "ready":
        out["progress"] = {"ocr": prog["ocr"]} if prog.get("ocr") else None
        return out
    audio = row.get("audio_paths") or []
    urls = _signed(audio)
    out["sections"] = [{**s, "audio_url": urls.get(audio[i]) if i < len(audio) and audio[i] else None} for i, s in enumerate(row.get("sections") or [])]
    out["key_terms"] = row.get("key_terms") or []
    quiz_id, qs = _questions(lesson_id)
    out["quiz"] = {"id": quiz_id, "questions": [{"id": q["id"], "prompt": q["prompt"], "options": q["options"]} for q in qs]} if quiz_id else None
    out["flashcards"] = get_db().table("flashcards").select("id, front, back").eq("lesson_id", lesson_id).order("position").execute().data or []
    return out


def submit_quiz(user_id: str, lesson_id: str, answers: list) -> dict:
    if not _can_see(_fetch(lesson_id), user_id):
        raise LookupError("lesson not found")
    quiz_id, qs = _questions(lesson_id)
    if not quiz_id:
        raise LookupError("quiz not found")
    result = score_quiz(qs, answers)
    get_db().table("quiz_attempts").insert({"quiz_id": quiz_id, "user_id": user_id, "score": result["score"],
                                            "answers": [r["chosen"] for r in result["results"]]}).execute()
    return result


def check_answer(user_id: str, lesson_id: str, index: int, chosen: int) -> dict:
    """Instant feedback for one question; nothing is stored (the full attempt is)."""
    if not _can_see(_fetch(lesson_id), user_id):
        raise LookupError("lesson not found")
    _, qs = _questions(lesson_id)
    if not 0 <= index < len(qs):
        raise LookupError("question not found")
    q = qs[index]
    return {"correct": chosen == q["answer_index"], "answer_index": q["answer_index"], "explanation": q.get("explanation") or ""}


def _owned(user_id: str, lesson_id: str) -> dict:
    row = _fetch(lesson_id)
    if not row or row["owner_id"] != user_id:
        raise LookupError("lesson not found")
    return row


def set_public(user_id: str, lesson_id: str, is_public: bool) -> dict:
    row = _owned(user_id, lesson_id)
    if is_public and row["status"] != "ready":
        raise LessonError("Only a finished lesson can be shared.")
    _update(lesson_id, is_public=is_public)
    return {"id": lesson_id, "is_public": is_public}


def delete_lesson(user_id: str, lesson_id: str) -> None:
    row = _owned(user_id, lesson_id)
    db = get_db()
    try:
        if row.get("audio_paths"):
            db.storage.from_(AUDIO_BUCKET).remove([p for p in row["audio_paths"] if p])
        if row.get("source_pdf_path"):
            db.storage.from_(PDF_BUCKET).remove([row["source_pdf_path"]])
    except Exception:  # noqa: BLE001 - files left behind are harmless; the row goes
        pass
    db.table("lessons").delete().eq("id", lesson_id).execute()
