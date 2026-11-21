"""ocr: reading order and columns, language retry logic, image checks and loading, lazy engine
reuse (all with OCR mocked), plus one real OCR run that is skipped when the models cannot be had."""

import io
import shutil
import sys
from pathlib import Path

import pytest
from PIL import Image, ImageDraw, ImageFont

from app.services import ocr
from app.services.ocr import Line, OcrPage


def L(text, x0, y0, x1=None, y1=None, score=0.95):
    return Line(text, score, x0, y0, x1 if x1 is not None else x0 + 10 * len(text), y1 if y1 is not None else y0 + 30)


# ---------- reading order ----------
def test_single_column_top_to_bottom_whatever_the_input_order():
    lines = [L("third", 100, 200), L("first", 100, 100), L("second", 100, 150)]
    assert ocr.order_lines(lines) == "first\nsecond\nthird"


def test_boxes_on_one_row_are_joined_left_to_right():
    lines = [L("world", 300, 102), L("Hello", 100, 100), L("next", 100, 150)]
    assert ocr.order_lines(lines) == "Hello world\nnext"


def test_paragraph_gap_becomes_a_blank_line():
    lines = [L("a", 100, 100), L("b", 100, 140), L("c", 100, 180), L("d", 100, 300)]
    assert ocr.order_lines(lines) == "a\nb\nc\n\nd"


def test_empty_and_blank_lines():
    assert ocr.order_lines([]) == ""
    assert ocr.order_lines([L("  ", 0, 0)]) == ""


def _two_columns(n=5):
    left = [L(f"left {i}", 100, 200 + 45 * i, 500, 230 + 45 * i) for i in range(n)]
    right = [L(f"right {i}", 600, 200 + 45 * i, 1000, 230 + 45 * i) for i in range(n)]
    return left, right


def test_two_columns_read_left_then_right():
    left, right = _two_columns()
    mixed = [x for pair in zip(right, left) for x in pair]  # interleaved, as a detector may return them
    out = ocr.order_lines(mixed).split("\n")
    assert out == [f"left {i}" for i in range(5)] + [f"right {i}" for i in range(5)]


def test_heading_across_the_gutter_splits_the_page_in_blocks():
    left, right = _two_columns(3)
    title = L("Chapter title", 100, 100, 1000, 140)
    lower_l = [L(f"l2-{i}", 100, 500 + 45 * i, 500, 530 + 45 * i) for i in range(3)]
    lower_r = [L(f"r2-{i}", 600, 500 + 45 * i, 1000, 530 + 45 * i) for i in range(3)]
    caption = L("Figure caption", 100, 450, 1000, 480)
    out = ocr.order_lines([*lower_r, *right, title, caption, *left, *lower_l]).split("\n")
    assert out[0] == "Chapter title"
    assert out[1:7] == ["left 0", "left 1", "left 2", "right 0", "right 1", "right 2"]
    assert out[7] == "Figure caption"
    assert out[8:] == ["l2-0", "l2-1", "l2-2", "r2-0", "r2-1", "r2-2"]


def test_no_gutter_in_a_single_ragged_column():
    lines = [L(f"line {i}", 100, 100 + 45 * i, 400 + 90 * (i % 4), 130 + 45 * i) for i in range(8)]
    assert ocr.order_lines(lines).split("\n") == [f"line {i}" for i in range(8)]


def test_a_gutter_needs_lines_on_both_sides():
    lines = [L(f"left {i}", 100, 100 + 45 * i, 500, 130 + 45 * i) for i in range(7)] + [L("lonely", 800, 100, 1000, 130)]
    out = ocr.order_lines(lines).split("\n")
    assert out[0] == "left 0 lonely"  # one box on the right does not make a column


def test_slightly_tilted_rows_still_group():
    # a 2 degree tilt: the right box of each row sits a few pixels lower
    lines = [L(f"a{i}", 100, 100 + 45 * i, 300, 130 + 45 * i) for i in range(3)] + [L(f"b{i}", 304, 108 + 45 * i, 520, 138 + 45 * i) for i in range(3)]
    assert ocr.order_lines(lines).split("\n") == ["a0 b0", "a1 b1", "a2 b2"]


# ---------- language and retry logic ----------
def test_language_to_script():
    assert ocr.language_script("hi") == ocr.DEVANAGARI and ocr.language_script("mr") == ocr.DEVANAGARI
    assert ocr.language_script("en") == ocr.EN
    assert ocr.language_script("ta") == ocr.LATIN and ocr.language_script("xx") == ocr.LATIN
    assert ocr.other_script(ocr.EN) == ocr.DEVANAGARI and ocr.other_script(ocr.DEVANAGARI) == ocr.EN and ocr.other_script(ocr.LATIN) == ocr.DEVANAGARI


def test_script_shares():
    assert ocr.script_shares("प्रकाश") == (1.0, 0.0)
    dev, lat = ocr.script_shares("Hello 123 ...")
    assert (dev, lat) == (0.0, 1.0)
    assert ocr.script_shares("123 !!") == (0.0, 0.0)


def _fake_reader(table, calls):
    """reader(image, script) -> (lines, secs); `table` maps script to (text, score)."""
    def reader(image, script):
        calls.append(script)
        text, score = table[script]
        return ([L(text, 10, 10, 10 + 12 * len(text), 40, score)] if text else []), 0.1
    return reader


def test_good_first_pass_is_not_retried():
    calls = []
    page = ocr.ocr_image(None, "hi", reader=_fake_reader({ocr.DEVANAGARI: ("पौधे अपना भोजन स्वयं बनाते हैं", 0.95)}, calls))
    assert calls == [ocr.DEVANAGARI] and page.passes == 1 and page.script == ocr.DEVANAGARI and page.confidence == 0.95


def test_low_confidence_retries_once_with_the_other_model_and_keeps_the_better():
    calls = []
    table = {ocr.EN: ("x7#q ;; zz", 0.31), ocr.DEVANAGARI: ("पौधे अपना भोजन स्वयं बनाते हैं", 0.93)}
    page = ocr.ocr_image(None, "en", reader=_fake_reader(table, calls))
    assert calls == [ocr.EN, ocr.DEVANAGARI]  # never more than two passes
    assert page.passes == 2 and page.script == ocr.DEVANAGARI and page.tried == [ocr.EN, ocr.DEVANAGARI] and "पौधे" in page.text


def test_retry_that_is_worse_keeps_the_first():
    calls = []
    table = {ocr.DEVANAGARI: ("अधूरा पाठ यहाँ है", 0.6), ocr.EN: ("?? ##", 0.2)}
    page = ocr.ocr_image(None, "hi", reader=_fake_reader(table, calls))
    assert calls == [ocr.DEVANAGARI, ocr.EN] and page.script == ocr.DEVANAGARI and page.text.startswith("अधूरा")


def test_latin_text_from_the_devanagari_model_is_retried_even_when_confident():
    calls = []
    table = {ocr.DEVANAGARI: ("Plants make their own food", 0.9), ocr.EN: ("Plants make their own food", 0.99)}
    page = ocr.ocr_image(None, "hi", reader=_fake_reader(table, calls))
    assert calls == [ocr.DEVANAGARI, ocr.EN] and page.script == ocr.EN


def test_blank_page_is_not_retried():
    calls = []
    page = ocr.ocr_image(None, "hi", reader=_fake_reader({ocr.DEVANAGARI: ("", 0)}, calls))
    assert calls == [ocr.DEVANAGARI] and page.text == "" and page.confidence == 0


def test_first_script_override_for_the_next_page():
    calls = []
    table = {ocr.EN: ("Plants make food in leaves", 0.97)}
    page = ocr.ocr_image(None, "hi", first=ocr.EN, reader=_fake_reader(table, calls))
    assert calls == [ocr.EN] and page.script == ocr.EN


def test_weighted_confidence_counts_characters():
    lines = [L("aaaa", 0, 0, score=1.0), L("b", 0, 40, score=0.0)]
    assert ocr.weighted_confidence(lines) == pytest.approx(0.8)
    assert ocr.weighted_confidence([]) == 0.0


# ---------- images ----------
def _img_bytes(fmt, size=(40, 30), **kw):
    buf = io.BytesIO()
    Image.new("RGB", size, "white").save(buf, fmt, **kw)
    return buf.getvalue()


def test_sniff_image_by_header():
    assert ocr.sniff_image(_img_bytes("JPEG")) == "jpeg"
    assert ocr.sniff_image(_img_bytes("PNG")) == "png"
    assert ocr.sniff_image(_img_bytes("WEBP")) == "webp"
    assert ocr.sniff_image(b"GIF89a....") is None
    assert ocr.sniff_image(b"%PDF-1.4") is None
    assert ocr.sniff_image(b"") is None
    assert ocr.sniff_image(b"RIFF\x00\x00\x00\x00WAVE") is None  # RIFF but not WebP


def test_load_image_applies_exif_rotation():
    im = Image.new("RGB", (60, 20), "white")
    ex = Image.Exif()
    ex[0x0112] = 6  # stored sideways; rotate 90 degrees clockwise to view
    buf = io.BytesIO()
    im.save(buf, "JPEG", exif=ex)
    out = ocr.load_image(buf.getvalue())
    assert out.size == (20, 60) and out.mode == "RGB"


def test_load_image_shrinks_big_pictures_and_keeps_small_ones():
    big = ocr.load_image(_img_bytes("PNG", (5000, 2500)))
    assert max(big.size) == ocr.MAX_SIDE and big.size[0] / big.size[1] == pytest.approx(2.0, abs=0.01)
    assert ocr.load_image(_img_bytes("PNG", (500, 300))).size == (500, 300)


def test_load_image_rejects_junk_and_bombs(monkeypatch):
    with pytest.raises(ocr.ImageError):
        ocr.load_image(b"not an image at all")
    monkeypatch.setattr(ocr, "MAX_PIXELS", 100)
    with pytest.raises(ocr.ImageError, match="too large"):
        ocr.load_image(_img_bytes("PNG", (50, 50)))


# ---------- engine: lazy and reused ----------
def test_engine_is_built_once_on_first_use_and_reused(monkeypatch, tmp_path):
    import rapidocr

    built = []

    class FakeRapid:
        def __init__(self, params=None):
            built.append(params)

    monkeypatch.setattr(rapidocr, "RapidOCR", FakeRapid)
    monkeypatch.setattr(ocr, "_warm", lambda eng: None)
    monkeypatch.setattr(ocr, "MODEL_DIR", tmp_path / "models")
    monkeypatch.setattr(ocr, "_engines", {})
    assert ocr.loaded_scripts() == []  # nothing loaded before a scan arrives
    a = ocr.get_engine(ocr.DEVANAGARI)
    b = ocr.get_engine(ocr.DEVANAGARI)
    ocr.get_engine(ocr.EN)
    assert a is b and len(built) == 2 and ocr.loaded_scripts() == [ocr.DEVANAGARI, ocr.EN]
    assert built[0]["Global.model_root_dir"] == str(tmp_path / "models") and "devanagari" in str(built[0]["Rec.lang_type"]).lower()
    with pytest.raises(ValueError):
        ocr.get_engine("klingon")


def test_engine_failure_is_an_ocr_error(monkeypatch, tmp_path):
    import rapidocr

    def boom(params=None):
        raise OSError("no network")

    monkeypatch.setattr(rapidocr, "RapidOCR", boom)
    monkeypatch.setattr(ocr, "MODEL_DIR", tmp_path)
    monkeypatch.setattr(ocr, "_engines", {})
    with pytest.raises(ocr.OcrError):
        ocr.get_engine(ocr.EN)
    assert ocr.loaded_scripts() == []  # a failed start is not cached


# ---------- real OCR (skipped when the models cannot be downloaded) ----------
def _font(paths, size):
    for p in paths:
        if Path(p).exists():
            return ImageFont.truetype(p, size)
    return None


def _text_image(lines, font):
    im = Image.new("RGB", (1300, 120 + 90 * len(lines)), "white")
    d = ImageDraw.Draw(im)
    for i, line in enumerate(lines):
        d.text((60, 60 + 90 * i), line, font=font, fill="black")
    return im


@pytest.fixture(scope="module")
def real_engines():
    try:
        ocr.get_engine(ocr.EN)
    except ocr.OcrError as e:
        pytest.skip(f"OCR models not available here: {e}")


def test_real_ocr_english(real_engines):
    font = _font(["/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"], 44) or ImageFont.load_default(44)
    page = ocr.ocr_image(_text_image(["Plants make their own food.", "This is called photosynthesis."], font), "en")
    text = page.text.lower()
    assert "own food" in text and "photosynthesis" in text
    assert page.confidence > 0.8 and page.script == ocr.EN and page.passes == 1


def test_real_ocr_hindi_with_the_devanagari_model(real_engines):
    font = _font(["/usr/share/fonts/truetype/noto/NotoSansDevanagari-Regular.ttf"], 46)
    if font is None:
        pytest.skip("no Devanagari font on this machine")
    page = ocr.ocr_image(_text_image(["पौधे अपना भोजन स्वयं बनाते हैं।", "पत्तियों में क्लोरोफिल होता है।"], font), "hi")
    assert page.script == ocr.DEVANAGARI and "भोजन" in page.text and "क्लोरोफिल" in page.text
