-- Arcus agent run history (FX.2)
--
-- The arcus_agents table only stores last_run_at + last_report_summary
-- (one most-recent record). Users couldn't see whether Tuesday's run
-- actually went out, what got delivered, what failed.
--
-- This table records one row per cron-tick attempt, including delivery
-- status per channel. Settings card can show the last 7 runs at a glance.

CREATE TABLE IF NOT EXISTS arcus_agent_runs (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  agent_id        uuid NOT NULL,
  user_id         text NOT NULL,
  started_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  duration_ms     int,
  status          text NOT NULL DEFAULT 'running', -- running | success | error | transient_error
  tool_calls      int DEFAULT 0,
  report_summary  text,
  error_message   text,
  email_delivery  text, -- 'sent' | 'failed' | 'skipped' | null
  slack_delivery  text, -- 'sent' | 'failed' | 'skipped' | null
  artifact_links  jsonb, -- { gmail: [...], notion: [...], calendar: [...], slack: [...] }
  PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_arcus_agent_runs_user
  ON arcus_agent_runs (user_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_arcus_agent_runs_agent
  ON arcus_agent_runs (agent_id, started_at DESC);

-- Used by the cron pre-flight pass when checking whether to retry. Lets us
-- count recent transient failures cheaply to back off escalating retries.
CREATE INDEX IF NOT EXISTS idx_arcus_agent_runs_recent_failures
  ON arcus_agent_runs (agent_id, status, started_at DESC)
  WHERE status IN ('error', 'transient_error');
