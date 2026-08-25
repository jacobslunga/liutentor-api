-- Difficulty of a generated quiz.
--
-- Students pick easy/medium/hard before generating, and that choice is the
-- single biggest driver of how a quiz turns out. Without it the log records the
-- questions but not what was asked for, so a run that came back too hard is
-- indistinguishable from one that was requested hard. It is also what the quiz
-- history in the app shows on each saved quiz.
--
-- Text rather than an enum, matching the `skill` column on ai_chat_logs: the
-- request is already validated against the zod enum before it reaches here, and
-- an enum would turn any future tier into a migration.
alter table public.ai_quiz_logs
  add column if not exists difficulty text;

-- Rows written before this column existed all used the single fixed prompt,
-- which is what "medium" now describes. Backfilling keeps aggregates over the
-- column honest instead of leaving a null bucket that means "medium, probably".
update public.ai_quiz_logs
  set difficulty = 'medium'
  where difficulty is null;

create index if not exists ai_quiz_logs_difficulty_idx
  on public.ai_quiz_logs (difficulty, created_at desc)
  where difficulty is not null;
