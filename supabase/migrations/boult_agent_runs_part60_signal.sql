-- PART 60 — signal-density columns for arcus_agent_runs.
--
-- WHY THIS FILE EXISTS:
-- The cron runner (app/api/cron/run-agents/route.ts) scores each run's report
-- for "signal density" and attempts to persist the result:
--
--     await supabase.from('arcus_agent_runs').update({
--       signal_score:      signal.score,
--       delivery_decision: `${decision.reason} ...`,
--     }).eq('id', runRecordId);
--
-- ...but no migration ever added these two columns. The write was wrapped in a
-- try/catch with the comment "PART 60 columns may not be migrated — non-fatal",
-- so every signal write has been silently failing: the data is computed each run
-- and then thrown away. The dashboard can never show "suppressed: quiet day"
-- because the column it would read is null for every row.
--
-- This migration adds the missing columns so the existing write succeeds. It is
-- purely additive — no existing column or row is touched, and the cron route
-- needs no code change (it already writes these column names).

ALTER TABLE arcus_agent_runs
  ADD COLUMN IF NOT EXISTS signal_score      int,   -- 0-100 report signal density (PART 60)
  ADD COLUMN IF NOT EXISTS delivery_decision text;  -- why the report was/ wasn't delivered + top signal reasons
