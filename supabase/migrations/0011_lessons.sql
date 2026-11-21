-- ExcelAIt 0011: chapter-to-lesson. A lesson made from an uploaded chapter keeps its
-- sections, key terms and per-section audio paths on the lesson row; quiz and flashcards
-- reuse the quizzes / quiz_questions / flashcards tables from 0003. NOT yet applied.

alter table public.lessons add column if not exists source text not null default 'pdf'
  check (source in ('pdf', 'photo', 'text'));
alter table public.lessons add column if not exists page_count smallint;
alter table public.lessons add column if not exists sections jsonb not null default '[]'::jsonb;   -- [{heading, text}]
alter table public.lessons add column if not exists key_terms jsonb not null default '[]'::jsonb;  -- [{term, meaning}]
alter table public.lessons add column if not exists audio_paths text[] not null default '{}';      -- lesson-audio paths, one per section ('' = none)
alter table public.lessons add column if not exists stage text
  check (stage in ('reading', 'writing', 'recording', 'done'));
alter table public.lessons add column if not exists error text;
alter table public.lessons add column if not exists updated_at timestamptz not null default now();

-- Shared lessons list.
create index if not exists lessons_public_ready_idx on public.lessons (created_at desc)
  where is_public and status = 'ready';
create index if not exists quiz_questions_quiz_position_idx on public.quiz_questions (quiz_id, position);
create index if not exists flashcards_lesson_position_idx on public.flashcards (lesson_id, position);
