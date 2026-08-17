-- Layer 1 — per-run plan for background agents.
--
-- Background agents previously executed with no stored plan: the user could
-- see WHAT happened (the report) but never WHAT ARCUS INTENDED before it ran.
-- This column stores a short plain-English plan generated at the start of each
-- run, so the run card can show "intended vs did" — the transparency the spec's
-- Planning layer calls for.
--
-- Written by app/api/cron/run-agents/route.ts at run start (right after the
-- run record is inserted), read by the run-history UI.
--
-- Purely additive — no existing column or row is touched.

ALTER TABLE arcus_agent_runs
  ADD COLUMN IF NOT EXISTS plan text;  -- plain-English plan generated before execution (Layer 1)
