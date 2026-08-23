-- Per-turn state for chat logs: what the student had selected, which skill they
-- picked, and whether web search was on.
--
-- All three already reach the chat endpoint and shape the answer, but none of
-- them were written down. The log therefore recorded *what* the student asked
-- and not *how* they asked it, which made admin unable to explain why two
-- near-identical questions produced very different answers. Reading the answer
-- text and guessing backwards was the only option.
--
-- The columns live on the user-role row only. All three describe the student's
-- request, so putting them on the assistant row too would duplicate the fact and
-- double-count it in any future aggregate.

alter table public.ai_chat_logs
  -- The text the student had highlighted in the exam when they asked. Nullable:
  -- most turns have no selection.
  add column if not exists selection_context text,

  -- The slash-command skill, as its id ("theory", "hint", …). Deliberately text
  -- and not an enum: skills are added by dropping a file into hono's src/skills,
  -- and an enum would turn every new skill into a migration. The request is
  -- already validated against SKILL_IDS by zod before it reaches here.
  add column if not exists skill text,

  -- Whether the student had web search toggled on for this turn.
  add column if not exists web_search boolean;

-- Partial indexes: both columns are null on the large majority of rows, so
-- indexing only the non-null ones keeps these small while still serving the
-- "show me every turn that used a skill" and "…that used a selection" queries
-- admin makes.
create index if not exists ai_chat_logs_skill_idx
  on public.ai_chat_logs (skill, created_at desc)
  where skill is not null;

create index if not exists ai_chat_logs_selection_context_idx
  on public.ai_chat_logs (created_at desc)
  where selection_context is not null;
