-- Arcus V3 — Database Schema (Supabase SQL)
-- Run this in Supabase SQL editor to create all required tables.
-- 
-- Tables:
--   arcus_integrations  — Connected apps with encrypted OAuth tokens
--   arcus_plans          — Plan artifacts with status state machine
--   arcus_plan_steps     — Execution steps per plan
--   arcus_events_queue   — Job queue (replaces BullMQ for Phase 1)
--   arcus_dedup_cache    — Deduplication keys with TTL

-- ─── 1. Integrations ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS arcus_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('gmail', 'gcal', 'slack', 'notion', 'calcom')),
  access_token TEXT NOT NULL,         -- AES-256-GCM encrypted
  refresh_token TEXT,                  -- AES-256-GCM encrypted
  scopes TEXT[] DEFAULT '{}',
  last_checked TIMESTAMPTZ,            -- For polling fallback (Phase 2+)
  expires_at TIMESTAMPTZ,
  channel_id TEXT,                     -- GCal Watch API channel ID
  channel_token TEXT,                  -- GCal Watch API channel verification token
  channel_expiry TIMESTAMPTZ,          -- GCal Watch API channel expiry
  workspace_info JSONB DEFAULT '{}',   -- Slack workspace metadata
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(user_id, provider)
);

-- Index for fast user lookups
CREATE INDEX IF NOT EXISTS idx_arcus_integrations_user ON arcus_integrations(user_id);

-- Migration (idempotent): older databases were created with a CHECK constraint
-- that omitted 'gmail', which silently rejected the Gmail OAuth callback's
-- upsert and broke background-agent Gmail reporting. Re-create it to include
-- every provider the Arcus V3 OAuth callbacks actually write.
DO $$
BEGIN
  ALTER TABLE arcus_integrations DROP CONSTRAINT IF EXISTS arcus_integrations_provider_check;
  ALTER TABLE arcus_integrations
    ADD CONSTRAINT arcus_integrations_provider_check
    CHECK (provider IN ('gmail', 'gcal', 'slack', 'notion', 'calcom'));
END $$;

-- ─── 2. Plans ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS arcus_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('agentic', 'plan_mode')),
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'approved', 'executing', 'completed', 'failed', 'dismissed')),
  severity TEXT CHECK (severity IN ('low', 'medium', 'high')),
  headline TEXT,
  impact TEXT,                          -- Impact sentence for the card
  findings JSONB DEFAULT '[]',          -- Full LLM findings array
  selected_option INT DEFAULT 0,        -- Which option the user selected (0-based)
  raw_llm_input JSONB,                  -- Full context sent to LLM (debugging)
  raw_llm_output JSONB,                 -- Full JSON response from LLM
  source TEXT,                          -- What triggered this plan
  triggering_event JSONB,               -- The normalized event that caused this
  created_at TIMESTAMPTZ DEFAULT now(),
  executed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_arcus_plans_user ON arcus_plans(user_id);
CREATE INDEX IF NOT EXISTS idx_arcus_plans_status ON arcus_plans(user_id, status);
CREATE INDEX IF NOT EXISTS idx_arcus_plans_created ON arcus_plans(user_id, created_at DESC);

-- ─── 3. Plan Steps ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS arcus_plan_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES arcus_plans(id) ON DELETE CASCADE,
  position INT NOT NULL,                -- Execution order, 0-indexed
  app TEXT NOT NULL,                    -- 'gcal' | 'slack'
  action TEXT NOT NULL,                 -- 'update_event' | 'send_message' | etc.
  params JSONB DEFAULT '{}',            -- Action parameters
  human_readable TEXT NOT NULL,         -- Plain English description for the UI
  irreversible BOOLEAN DEFAULT false,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'executing', 'completed', 'failed')),
  error TEXT,
  executed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_arcus_plan_steps_plan ON arcus_plan_steps(plan_id);
CREATE INDEX IF NOT EXISTS idx_arcus_plan_steps_order ON arcus_plan_steps(plan_id, position ASC);

-- ─── 4. Events Queue ────────────────────────────────────────────────────────────
-- Simple job queue table. Workers poll for 'pending' jobs.

CREATE TABLE IF NOT EXISTS arcus_events_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  source TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  processed_at TIMESTAMPTZ,
  attempts INT DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_arcus_queue_pending ON arcus_events_queue(status, created_at ASC) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_arcus_queue_user ON arcus_events_queue(user_id, status);

-- ─── 5. Deduplication Cache ─────────────────────────────────────────────────────
-- Prevents duplicate event processing. Entries auto-expire via cleanup cron.

CREATE TABLE IF NOT EXISTS arcus_dedup_cache (
  dedup_key TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL      -- TTL: created_at + 600 seconds
);

CREATE INDEX IF NOT EXISTS idx_arcus_dedup_expires ON arcus_dedup_cache(expires_at);

-- ─── 6. Plan Mode Briefs ────────────────────────────────────────────────────────
-- Stores the daily/manual brief output separately for easy retrieval.

CREATE TABLE IF NOT EXISTS arcus_briefs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  plan_id UUID REFERENCES arcus_plans(id) ON DELETE CASCADE,
  brief_data JSONB NOT NULL,            -- The structured weekly brief JSON
  generated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_arcus_briefs_user ON arcus_briefs(user_id, generated_at DESC);

-- ─── 7. Background Scheduling Agents ────────────────────────────────────────────
-- The table the scheduling feature depends on. The schedule card writes here via
-- POST /api/arcus/agents; the cron runner GET /api/cron/run-agents reads it.

CREATE TABLE IF NOT EXISTS arcus_agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  task_description TEXT NOT NULL,
  cron_schedule TEXT NOT NULL DEFAULT '0 7 * * *',
  output_channel TEXT NOT NULL DEFAULT 'gmail' CHECK (output_channel IN ('gmail', 'slack', 'both')),
  slack_channel TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'running', 'paused')),
  skip_confirmations BOOLEAN NOT NULL DEFAULT false,
  expires_at DATE,
  last_run_at TIMESTAMPTZ,
  last_report_summary TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_arcus_agents_user ON arcus_agents(user_id);
CREATE INDEX IF NOT EXISTS idx_arcus_agents_status ON arcus_agents(status);

-- Next-gen scheduling (Phase 1) — additive, mirrored from
-- supabase/migrations/arcus_agents_triggers_v1.sql. Safe defaults keep every
-- existing agent on the unchanged schedule path.
ALTER TABLE arcus_agents
  ADD COLUMN IF NOT EXISTS trigger_type    TEXT NOT NULL DEFAULT 'schedule'
    CHECK (trigger_type IN ('schedule', 'event', 'chained', 'condition')),
  ADD COLUMN IF NOT EXISTS trigger_config  JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS conditions      JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS pipeline        JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS parent_agent_id UUID,
  ADD COLUMN IF NOT EXISTS agent_state     JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS priority        INT  NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS max_tool_calls  INT;
CREATE INDEX IF NOT EXISTS idx_arcus_agents_trigger_type
  ON arcus_agents (trigger_type) WHERE trigger_type <> 'schedule';

-- ─── RLS Policies ───────────────────────────────────────────────────────────────
-- Enable Row Level Security on all tables

ALTER TABLE arcus_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE arcus_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE arcus_plan_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE arcus_events_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE arcus_briefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE arcus_agents ENABLE ROW LEVEL SECURITY;

-- Service role has full access (for API routes running server-side)
-- These policies allow the service role key to perform all operations
CREATE POLICY "Service role full access" ON arcus_integrations FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON arcus_plans FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON arcus_plan_steps FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON arcus_events_queue FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON arcus_briefs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON arcus_agents FOR ALL USING (true) WITH CHECK (true);

-- ─── Cleanup Function ──────────────────────────────────────────────────────────
-- Call periodically to remove expired dedup entries

CREATE OR REPLACE FUNCTION arcus_cleanup_dedup()
RETURNS void AS $$
BEGIN
  DELETE FROM arcus_dedup_cache WHERE expires_at < now();
END;
$$ LANGUAGE plpgsql;

-- ──────────────────────────────────────────────────────────────────────────────
-- Scheduled email send (mirror of supabase/migrations/arcus_scheduled_emails.sql)
-- Backs schedule_email_send + the cron dispatcher (drainScheduledEmails).
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS arcus_scheduled_emails (
  id               UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id          TEXT        NOT NULL,
  to_email         TEXT        NOT NULL,
  subject          TEXT,
  body             TEXT        NOT NULL,
  thread_id        TEXT,
  send_at          TIMESTAMPTZ NOT NULL,
  status           TEXT        NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','sending','sent','failed','cancelled')),
  attempts         INT         NOT NULL DEFAULT 0,
  last_error       TEXT,
  sent_message_id  TEXT,
  dedup_key        TEXT,
  source           TEXT        DEFAULT 'agent',
  agent_id         UUID,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  sent_at          TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS arcus_sched_due_idx ON arcus_scheduled_emails (status, send_at);
CREATE INDEX IF NOT EXISTS arcus_sched_user_idx ON arcus_scheduled_emails (user_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS arcus_sched_dedup_idx
  ON arcus_scheduled_emails (user_id, dedup_key) WHERE dedup_key IS NOT NULL;

-- Gmail real-time push state (mirror of supabase/migrations/arcus_gmail_watch_v1.sql)
ALTER TABLE arcus_integrations ADD COLUMN IF NOT EXISTS gmail_history_id TEXT;

-- ──────────────────────────────────────────────────────────────────────────────
-- Graduated Autonomy (mirror of supabase/migrations/arcus_autonomy_v1.sql)
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS arcus_autonomy_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'contact' CHECK (scope IN ('contact','domain')),
  action_type TEXT NOT NULL,
  target_key TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'inherit' CHECK (level IN ('inherit','hold','auto','never')),
  delay_mode TEXT NOT NULL DEFAULT 'buffer' CHECK (delay_mode IN ('buffer','instant')),
  approve_count INT NOT NULL DEFAULT 0,
  reject_count INT NOT NULL DEFAULT 0,
  suggested BOOLEAN NOT NULL DEFAULT false,
  label TEXT,
  last_decision_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, action_type, target_key)
);
CREATE INDEX IF NOT EXISTS arcus_autonomy_lookup_idx ON arcus_autonomy_grants (user_id, action_type, target_key);

CREATE TABLE IF NOT EXISTS arcus_autonomy_settings (
  user_id TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT false,
  buffer_minutes INT NOT NULL DEFAULT 10,
  allow_instant BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS arcus_autonomy_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  agent_id UUID,
  run_id TEXT,
  tool_name TEXT NOT NULL,
  tool_input JSONB NOT NULL,
  action_type TEXT,
  target_key TEXT,
  status TEXT NOT NULL DEFAULT 'auto_scheduled' CHECK (status IN ('auto_scheduled','executing','done','failed','cancelled')),
  execute_at TIMESTAMPTZ NOT NULL,
  summary TEXT,
  result TEXT,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  executed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS arcus_autonomy_actions_due_idx ON arcus_autonomy_actions (status, execute_at);

-- Home-feed deep infra (mirror of supabase/migrations/arcus_home_feed_infra.sql)
CREATE TABLE IF NOT EXISTS arcus_today_dismissals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  item_type TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, item_id)
);
CREATE INDEX IF NOT EXISTS arcus_today_dismissals_user_idx ON arcus_today_dismissals (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS arcus_today_cache (
  user_id TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
