"""Reading text from page images (scanned PDF pages and phone photos) with RapidOCR.

RapidOCR runs PaddleOCR's PP-OCRv5 mobile models through onnxruntime (no PaddlePaddle).
Nothing is loaded at import time: the first scan or photo that arrives builds the engine
for its script, and the engine is then reused for every later page (one per script).

Models: PP-OCRv5 mobile detection (shared by every script) plus one recognition model per
script: devanagari (Hindi, Marathi), en (English) and latin (everything else that uses Latin
letters). They are downloaded on first use from RapidOCR's model repository (ModelScope) and
cached in OCR_MODEL_DIR (default ~/.cache/excelait/rapidocr). To fetch them ahead of time,
for example while building a deploy image, run:  python -m app.services.ocr --prefetch

Pipeline per page: detect lines, recognise each line, order the lines top to bottom and left
to right (two column pages: left column, then right column), and report a confidence from 0
to 1. If the first pass looks wrong for the script (low confidence, or Latin letters read by
the Devanagari model) the page is read once more with the other model; at most 2 passes."""

from __future__ import annotations

import io
import logging
import os
try:  # Unix only; Windows has no resource module
    import resource
except ImportError:  # pragma: no cover
    resource = None
import statistics
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path

log = logging.getLogger("excelait.ocr")

MODEL_DIR = Path(os.environ.get("OCR_MODEL_DIR") or Path.home() / ".cache" / "excelait" / "rapidocr")
MAX_SIDE = int(os.environ.get("OCR_MAX_SIDE", "2000"))  # longest image side handed to the detector; bigger photos are shrunk
MAX_PIXELS = 80_000_000    # refuse decompression bombs before decoding
TEXT_SCORE = 0.3           # RapidOCR drops lines below this; we judge quality ourselves
RETRY_CONFIDENCE = 0.75    # a first pass below this is tried again with the other model
LOW_CONFIDENCE = 0.70      # a whole job below this gets the "photo was unclear" note

DEVANAGARI, EN, LATIN = "devanagari", "en", "latin"
SCRIPTS = (DEVANAGARI, EN, LATIN)


class OcrError(RuntimeError):
    """The OCR engine could not be started or run (models missing, no network, bad image)."""


class ImageError(ValueError):
    """The picture cannot be used (not an image, damaged, too large)."""


# ---------- result types ----------
@dataclass
class Line:
    text: str
    score: float
    x0: float
    y0: float
    x1: float
    y1: float

    @property
    def h(self) -> float:
        return max(1.0, self.y1 - self.y0)

    @property
    def cx(self) -> float:
        return (self.x0 + self.x1) / 2

    @property
    def cy(self) -> float:
        return (self.y0 + self.y1) / 2


@dataclass
class OcrPage:
    text: str
    confidence: float          # character-weighted mean line score, 0 to 1
    script: str                # the model whose reading was kept
    passes: int = 1
    seconds: float = 0.0
    peak_rss_mb: float = 0.0   # process peak resident memory after this page
    lines: int = 0
    tried: list[str] = field(default_factory=list)


def language_script(language: str) -> str:
    """Model to try first for the language the student picked."""
    return {"hi": DEVANAGARI, "mr": DEVANAGARI, "en": EN}.get(language, LATIN)


def other_script(script: str) -> str:
    return EN if script == DEVANAGARI else DEVANAGARI


# ---------- image loading ----------
def sniff_image(data: bytes) -> str | None:
    """'jpeg', 'png' or 'webp' by file header (never by file name or declared type)."""
    if data[:3] == b"\xff\xd8\xff":
        return "jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return None


def load_image(data: bytes):
    """Bytes to an upright RGB PIL image no larger than MAX_SIDE (phone EXIF rotation applied)."""
    from PIL import Image, ImageOps

    try:
        im = Image.open(io.BytesIO(data))
        if im.width * im.height > MAX_PIXELS:
            raise ImageError("This picture is too large.")
        im = ImageOps.exif_transpose(im)
        im = im.convert("RGB")
    except ImageError:
        raise
    except Exception as e:  # noqa: BLE001 - PIL raises many kinds, including DecompressionBombError
        raise ImageError("This picture could not be opened.") from e
    return shrink(im)


def shrink(im, limit: int = MAX_SIDE):
    from PIL import Image

    big = max(im.size)
    if big > limit:
        r = limit / big
        im = im.resize((max(1, round(im.width * r)), max(1, round(im.height * r))), Image.LANCZOS)
    return im


# ---------- reading order ----------
def _rows(lines: list[Line], mh: float) -> str:
    """Single column: group boxes into rows by height, left to right in a row; a gap clearly
    bigger than the usual line spacing starts a new paragraph (blank line)."""
    rows: list[list[Line]] = []
    for ln in sorted(lines, key=lambda x: x.cy):
        if rows and abs(ln.cy - statistics.fmean(x.cy for x in rows[-1])) <= 0.4 * max(mh, ln.h):
            rows[-1].append(ln)
        else:
            rows.append([ln])
    centres = [statistics.fmean(x.cy for x in r) for r in rows]
    steps = [b - a for a, b in zip(centres, centres[1:])]
    pitch = statistics.median(steps) if steps else 0
    out = []
    for i, row in enumerate(rows):
        row.sort(key=lambda x: x.x0)
        if i and pitch and steps[i - 1] > 1.6 * pitch:
            out.append("")
        out.append(" ".join(x.text for x in row))
    return "\n".join(out)


def _gutter(lines: list[Line], mh: float) -> tuple[float, float] | None:
    """Left and right edge of a clear empty vertical band between two columns, or None."""
    if len(lines) < 6:
        return None
    xmin, xmax = min(x.x0 for x in lines), max(x.x1 for x in lines)
    width = xmax - xmin
    if width <= 0:
        return None
    body = sorted(((x.x0, x.x1) for x in lines if x.x1 - x.x0 < 0.6 * width))
    if len(body) < 6:
        return None
    merged: list[list[float]] = []
    for a, b in body:
        if merged and a <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], b)
        else:
            merged.append([a, b])
    best = None
    for (_, left), (right, _) in zip(merged, merged[1:]):
        mid = (left + right) / 2
        gap = right - left
        if xmin + 0.3 * width <= mid <= xmin + 0.7 * width and gap >= max(0.5 * mh, 0.025 * width):
            if best is None or gap > best[1] - best[0]:
                best = (left, right)
    if best is None:
        return None
    mid = (best[0] + best[1]) / 2
    n_left = sum(1 for x in lines if x.cx < mid and x.x1 - x.x0 < 0.6 * width)
    n_right = sum(1 for x in lines if x.cx >= mid and x.x1 - x.x0 < 0.6 * width)
    return best if n_left >= 3 and n_right >= 3 else None


def order_lines(lines: list[Line]) -> str:
    """Text of a page in reading order. Two column pages read the left column, then the right;
    a line that crosses the gutter (a heading, a figure caption) splits the page in blocks that
    are read one after the other."""
    lines = [x for x in lines if x.text.strip()]
    if not lines:
        return ""
    mh = statistics.median(x.h for x in lines)
    g = _gutter(lines, mh)
    if g is None:
        return _rows(lines, mh)
    mid = (g[0] + g[1]) / 2
    blocks: list[str] = []
    left: list[Line] = []
    right: list[Line] = []

    def flush() -> None:
        for col in (left, right):
            if col:
                blocks.append(_rows(col, mh))
        left.clear()
        right.clear()

    for ln in sorted(lines, key=lambda x: x.cy):
        if ln.x0 < g[0] and ln.x1 > g[1]:
            flush()
            blocks.append(ln.text)
        elif ln.cx < mid:
            left.append(ln)
        else:
            right.append(ln)
    flush()
    return "\n".join(blocks)


# ---------- quality ----------
def script_shares(text: str) -> tuple[float, float]:
    """(devanagari share, latin share) of the letters in `text`."""
    dev = sum(1 for c in text if "ऀ" <= c <= "ॿ")
    lat = sum(1 for c in text if c.isascii() and c.isalpha())
    total = dev + lat
    return (dev / total, lat / total) if total else (0.0, 0.0)


def weighted_confidence(lines: list[Line]) -> float:
    n = sum(len(x.text) for x in lines)
    return sum(x.score * len(x.text) for x in lines) / n if n else 0.0


def _junk(text: str) -> float:
    """Share of characters that are not letters, digits, spaces or ordinary punctuation."""
    chars = [c for c in text if not c.isspace()]
    if not chars:
        return 0.0
    ok = sum(1 for c in chars if c.isalnum() or "ािीुूृेैोौंँः़्।॥" in c or c in ".,;:!?'\"()-%/+=[]")
    return 1 - ok / len(chars)


def needs_retry(page: OcrPage, script: str) -> bool:
    """True when a first pass looks wrong: low confidence, or Latin text read by the Devanagari model."""
    if not page.text.strip():
        return False  # nothing detected: the other model uses the same detector, it would find nothing too
    if page.confidence < RETRY_CONFIDENCE:
        return True
    _, lat = script_shares(page.text)
    return script == DEVANAGARI and lat > 0.7


def _quality(page: OcrPage, script: str) -> float:
    q = page.confidence * (1 - _junk(page.text))
    _, lat = script_shares(page.text)
    if script == DEVANAGARI and lat > 0.7:
        q *= 0.8  # Latin letters from the Devanagari model: the English model should read them
    return q


def choose(first: OcrPage, first_script: str, second: OcrPage, second_script: str) -> tuple[OcrPage, str]:
    """Keep the better of two passes; a tie keeps the first."""
    if _quality(second, second_script) > _quality(first, first_script):
        return second, second_script
    return first, first_script


# ---------- engine ----------
_engines: dict[str, object] = {}
_engine_lock = threading.Lock()
_run_slots = threading.Semaphore(int(os.environ.get("OCR_CONCURRENCY", "1")))  # one page at a time keeps memory flat


def _params(script: str) -> dict:
    from rapidocr import LangRec, ModelType, OCRVersion

    rec = {DEVANAGARI: LangRec.DEVANAGARI, EN: LangRec.EN, LATIN: LangRec.LATIN}[script]
    v5, mobile = OCRVersion.PPOCRV5, ModelType.MOBILE
    p = {
        "Global.model_root_dir": str(MODEL_DIR),
        "Global.text_score": TEXT_SCORE,
        "Global.use_cls": False,           # photos are rotated upright from EXIF; skips a model download
        "Global.max_side_len": MAX_SIDE,
        "Global.log_level": "warning",
        "Det.ocr_version": v5, "Det.model_type": mobile,
        "Rec.ocr_version": v5, "Rec.model_type": mobile, "Rec.lang_type": rec,
    }
    threads = os.environ.get("OCR_THREADS")
    if threads:
        p["EngineConfig.onnxruntime.intra_op_num_threads"] = int(threads)
    return p


def get_engine(script: str):
    """The RapidOCR engine for a script, built on first use and reused after that."""
    if script not in SCRIPTS:
        raise ValueError(f"unknown script {script!r}")
    with _engine_lock:
        eng = _engines.get(script)
        if eng is None:
            t = time.perf_counter()
            try:
                from rapidocr import RapidOCR

                MODEL_DIR.mkdir(parents=True, exist_ok=True)
                eng = RapidOCR(params=_params(script))
                _warm(eng)  # makes the first real page as fast as the rest (and downloads missing models now)
            except Exception as e:  # noqa: BLE001 - download, import and onnx errors alike
                raise OcrError(f"The text reader could not start ({type(e).__name__}).") from e
            _engines[script] = eng
            log.info("ocr engine %s ready in %.1fs", script, time.perf_counter() - t)
        return eng


def _warm(eng) -> None:
    import numpy as np

    img = np.full((64, 256, 3), 255, np.uint8)
    img[20:44, 20:236] = 0  # a dark bar: the detector finds a box and the recogniser model is loaded too
    eng(img)


def loaded_scripts() -> list[str]:
    return sorted(_engines)


def _peak_rss_mb() -> float:
    if resource is None:
        return 0.0
    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024  # Linux reports KB


def _read(image, script: str) -> tuple[list[Line], float]:
    import numpy as np

    eng = get_engine(script)
    arr = np.asarray(image)[:, :, ::-1].copy()  # RGB to BGR, as OpenCV based code expects
    t = time.perf_counter()
    with _run_slots:
        out = eng(arr)
    secs = time.perf_counter() - t
    lines: list[Line] = []
    if out.txts:
        for box, txt, sc in zip(out.boxes, out.txts, out.scores):
            xs, ys = [p[0] for p in box], [p[1] for p in box]
            if str(txt).strip():
                lines.append(Line(str(txt).strip(), float(sc), min(xs), min(ys), max(xs), max(ys)))
    return lines, secs


def _page(lines: list[Line], script: str, secs: float) -> OcrPage:
    text = order_lines(lines)
    return OcrPage(text=text, confidence=round(weighted_confidence(lines), 3), script=script, seconds=secs, lines=len(lines))


def ocr_image(image, language: str = "en", first: str | None = None, reader=None) -> OcrPage:
    """Read one PIL image. `first` overrides the model tried first (a job keeps the script that
    won on the previous page). `reader(image, script) -> (lines, seconds)` is for tests."""
    reader = reader or _read
    script = first if first in SCRIPTS else language_script(language)
    lines, secs = reader(image, script)
    page = _page(lines, script, secs)
    page.tried = [script]
    if needs_retry(page, script):
        alt = other_script(script)
        lines2, secs2 = reader(image, alt)
        page2 = _page(lines2, alt, secs2)
        keep, kept_script = choose(page, script, page2, alt)
        keep.passes, keep.seconds, keep.tried = 2, secs + secs2, [script, alt]
        keep.script = kept_script
        page = keep
    page.peak_rss_mb = round(_peak_rss_mb(), 1)
    log.info("ocr page: %d lines, conf %.2f, script %s, passes %d, %.1fs, peak rss %.0f MB",
             page.lines, page.confidence, page.script, page.passes, page.seconds, page.peak_rss_mb)
    return page


def prefetch() -> None:
    """Download and load every model now (deploy step)."""
    for s in SCRIPTS:
        get_engine(s)
    print(f"models ready in {MODEL_DIR}: " + ", ".join(sorted(p.name for p in MODEL_DIR.glob('*.onnx'))))


if __name__ == "__main__":
    import sys

    if "--prefetch" in sys.argv:
        prefetch()
    else:
        print("usage: python -m app.services.ocr --prefetch")
