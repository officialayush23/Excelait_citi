-- ExcelAIt 0015: lessons made from scanned PDFs and photos are read by OCR in the background.
-- `progress` carries what the UI shows while that happens and what the lesson should say after:
--   {"ocr": {"done": 3, "total": 8}}            while reading (stage = 'reading')
--   {"notes": ["low_confidence", "pages_skipped"]}   once written
-- lessons.source already allows 'photo' (0011). NOT yet applied.

alter table public.lessons add column if not exists progress jsonb;
