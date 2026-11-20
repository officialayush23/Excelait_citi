-- ExcelAIt 0010: crawler bookkeeping. Existing columns are reused: last_fetched_at is the
-- last check time, notes holds the error text. NOT yet applied.
alter table public.scheme_sources add column if not exists http_status smallint;
alter table public.scheme_sources add column if not exists excerpt text;
