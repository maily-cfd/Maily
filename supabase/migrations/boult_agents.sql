-- Arcus scheduled agents — the central table for background ("while you sleep")
-- agents. One row per agent the user has created.
--
-- WHY THIS FILE EXISTS:
-- The canonical CREATE TABLE for arcus_agents previously lived ONLY in
-- lib/arcus-v3/schema.sql — a different code generation's schema bundle — and
-- not in supabase/migrations/. That meant the table this project's MAIN agent
-- path depends on (GET /api/cron/run-agents, POST /api/arcus/agents/create) was
-- not represented in the migrations directory at all. The cron runner had to
-- defensively swallow a 42P01 "relation does not exist" error to avoid crashing
-- when the table was missing.
--
-- This migration makes supabase/migrations/ the single source of truth for the
-- table. It is byte-for-byte compatible with the definition in
-- lib/arcus-v3/schema.sql (IF NOT EXISTS — safe to run against a DB where the
-- table already exists; it is a no-op there).
--
-- Written by:
--   POST /api/arcus/agents/create      (direct creation)
--   POST /api/arcus/agents             (LLM-loop creation)
-- Read by:
--   GET  /api/cron/run-agents          (the scheduled runner)
--   GET  /api/arcus/agents             (settings UI list)

CREATE TABLE IF NOT EXISTS arcus_agents (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             TEXT NOT NULL,
  name                TEXT NOT NULL,
  task_description    TEXT NOT NULL,
  cron_schedule       TEXT NOT NULL DEFAULT '0 7 * * *',
  output_channel      TEXT NOT NULL DEFAULT 'gmail' CHECK (output_channel IN ('gmail', 'slack', 'both')),
  slack_channel       TEXT,
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'running', 'paused')),
  skip_confirmations  BOOLEAN NOT NULL DEFAULT false,
  expires_at          DATE,
  last_run_at         TIMESTAMPTZ,
  last_report_summary TEXT,
  created_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_arcus_agents_user   ON arcus_agents (user_id);
CREATE INDEX IF NOT EXISTS idx_arcus_agents_status ON arcus_agents (status);

-- RLS — service role (server-side API routes) has full access. Mirrors the
-- policy already declared in lib/arcus-v3/schema.sql so applying either file
-- produces the same end state.
ALTER TABLE arcus_agents ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'arcus_agents'
      AND policyname = 'Service role full access'
  ) THEN
    CREATE POLICY "Service role full access" ON arcus_agents
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
