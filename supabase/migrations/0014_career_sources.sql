-- ExcelAIt 0014: every career shows where its pay and path figures come from, and the age it opens at.
-- Filled from shared/catalogue/careers.json by backend/scripts/reference_careers.py and scripts.seed_catalogue.

alter table public.careers
  add column if not exists sources jsonb not null default '[]'::jsonb,   -- [{title, url, site, note}]
  add column if not exists pay_evidence jsonb,                           -- {min, max, n_sources}: monthly INR found in the sources
  add column if not exists pay_status text check (pay_status in ('matches', 'differs', 'unverified')),
  add column if not exists checked_on date,
  add column if not exists pay_previous jsonb,                           -- {pay_min, pay_max} before an evidence-based change
  add column if not exists min_age smallint check (min_age between 8 and 30),
  add column if not exists hazardous_for_minors boolean not null default false;
