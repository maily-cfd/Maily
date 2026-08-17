-- === Schema from d:\PROJECTS\maily-\lib\boult-v3\schema.sql ===
-- Boult V3 — Database Schema (Supabase SQL)
-- Run this in Supabase SQL editor to create all required tables.
-- 
-- Tables:
--   boult_integrations  — Connected apps with encrypted OAuth tokens
--   boult_plans          — Plan artifacts with status state machine
--   boult_plan_steps     — Execution steps per plan
--   boult_events_queue   — Job queue (replaces BullMQ for Phase 1)
--   boult_dedup_cache    — Deduplication keys with TTL

-- ─── 1. Integrations ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS boult_integrations (
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
CREATE INDEX IF NOT EXISTS idx_boult_integrations_user ON boult_integrations(user_id);

-- Migration (idempotent): older databases were created with a CHECK constraint
-- that omitted 'gmail', which silently rejected the Gmail OAuth callback's
-- upsert and broke background-agent Gmail reporting. Re-create it to include
-- every provider the Boult V3 OAuth callbacks actually write.
DO $$
BEGIN
  ALTER TABLE boult_integrations DROP CONSTRAINT IF EXISTS boult_integrations_provider_check;
  ALTER TABLE boult_integrations
    ADD CONSTRAINT boult_integrations_provider_check
    CHECK (provider IN ('gmail', 'gcal', 'slack', 'notion', 'calcom'));
END $$;

-- ─── 2. Plans ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS boult_plans (
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

CREATE INDEX IF NOT EXISTS idx_boult_plans_user ON boult_plans(user_id);
CREATE INDEX IF NOT EXISTS idx_boult_plans_status ON boult_plans(user_id, status);
CREATE INDEX IF NOT EXISTS idx_boult_plans_created ON boult_plans(user_id, created_at DESC);

-- ─── 3. Plan Steps ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS boult_plan_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES boult_plans(id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS idx_boult_plan_steps_plan ON boult_plan_steps(plan_id);
CREATE INDEX IF NOT EXISTS idx_boult_plan_steps_order ON boult_plan_steps(plan_id, position ASC);

-- ─── 4. Events Queue ────────────────────────────────────────────────────────────
-- Simple job queue table. Workers poll for 'pending' jobs.

CREATE TABLE IF NOT EXISTS boult_events_queue (
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

CREATE INDEX IF NOT EXISTS idx_boult_queue_pending ON boult_events_queue(status, created_at ASC) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_boult_queue_user ON boult_events_queue(user_id, status);

-- ─── 5. Deduplication Cache ─────────────────────────────────────────────────────
-- Prevents duplicate event processing. Entries auto-expire via cleanup cron.

CREATE TABLE IF NOT EXISTS boult_dedup_cache (
  dedup_key TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL      -- TTL: created_at + 600 seconds
);

CREATE INDEX IF NOT EXISTS idx_boult_dedup_expires ON boult_dedup_cache(expires_at);

-- ─── 6. Plan Mode Briefs ────────────────────────────────────────────────────────
-- Stores the daily/manual brief output separately for easy retrieval.

CREATE TABLE IF NOT EXISTS boult_briefs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  plan_id UUID REFERENCES boult_plans(id) ON DELETE CASCADE,
  brief_data JSONB NOT NULL,            -- The structured weekly brief JSON
  generated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_boult_briefs_user ON boult_briefs(user_id, generated_at DESC);

-- ─── 7. Background Scheduling Agents ────────────────────────────────────────────
-- The table the scheduling feature depends on. The schedule card writes here via
-- POST /api/boult/agents; the cron runner GET /api/cron/run-agents reads it.

CREATE TABLE IF NOT EXISTS boult_agents (
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

CREATE INDEX IF NOT EXISTS idx_boult_agents_user ON boult_agents(user_id);
CREATE INDEX IF NOT EXISTS idx_boult_agents_status ON boult_agents(status);

-- Next-gen scheduling (Phase 1) — additive, mirrored from
-- supabase/migrations/boult_agents_triggers_v1.sql. Safe defaults keep every
-- existing agent on the unchanged schedule path.
ALTER TABLE boult_agents
  ADD COLUMN IF NOT EXISTS trigger_type    TEXT NOT NULL DEFAULT 'schedule'
    CHECK (trigger_type IN ('schedule', 'event', 'chained', 'condition')),
  ADD COLUMN IF NOT EXISTS trigger_config  JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS conditions      JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS pipeline        JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS parent_agent_id UUID,
  ADD COLUMN IF NOT EXISTS agent_state     JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS priority        INT  NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS max_tool_calls  INT;
CREATE INDEX IF NOT EXISTS idx_boult_agents_trigger_type
  ON boult_agents (trigger_type) WHERE trigger_type <> 'schedule';

-- ─── RLS Policies ───────────────────────────────────────────────────────────────
-- Enable Row Level Security on all tables

ALTER TABLE boult_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE boult_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE boult_plan_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE boult_events_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE boult_briefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE boult_agents ENABLE ROW LEVEL SECURITY;

-- Service role has full access (for API routes running server-side)
-- These policies allow the service role key to perform all operations
CREATE POLICY "Service role full access" ON boult_integrations FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON boult_plans FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON boult_plan_steps FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON boult_events_queue FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON boult_briefs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON boult_agents FOR ALL USING (true) WITH CHECK (true);

-- ─── Cleanup Function ──────────────────────────────────────────────────────────
-- Call periodically to remove expired dedup entries

CREATE OR REPLACE FUNCTION boult_cleanup_dedup()
RETURNS void AS $$
BEGIN
  DELETE FROM boult_dedup_cache WHERE expires_at < now();
END;
$$ LANGUAGE plpgsql;

-- ──────────────────────────────────────────────────────────────────────────────
-- Scheduled email send (mirror of supabase/migrations/boult_scheduled_emails.sql)
-- Backs schedule_email_send + the cron dispatcher (drainScheduledEmails).
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS boult_scheduled_emails (
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
CREATE INDEX IF NOT EXISTS boult_sched_due_idx ON boult_scheduled_emails (status, send_at);
CREATE INDEX IF NOT EXISTS boult_sched_user_idx ON boult_scheduled_emails (user_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS boult_sched_dedup_idx
  ON boult_scheduled_emails (user_id, dedup_key) WHERE dedup_key IS NOT NULL;

-- Gmail real-time push state (mirror of supabase/migrations/boult_gmail_watch_v1.sql)
ALTER TABLE boult_integrations ADD COLUMN IF NOT EXISTS gmail_history_id TEXT;

-- ──────────────────────────────────────────────────────────────────────────────
-- Graduated Autonomy (mirror of supabase/migrations/boult_autonomy_v1.sql)
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS boult_autonomy_grants (
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
CREATE INDEX IF NOT EXISTS boult_autonomy_lookup_idx ON boult_autonomy_grants (user_id, action_type, target_key);

CREATE TABLE IF NOT EXISTS boult_autonomy_settings (
  user_id TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT false,
  buffer_minutes INT NOT NULL DEFAULT 10,
  allow_instant BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS boult_autonomy_actions (
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
CREATE INDEX IF NOT EXISTS boult_autonomy_actions_due_idx ON boult_autonomy_actions (status, execute_at);

-- Home-feed deep infra (mirror of supabase/migrations/boult_home_feed_infra.sql)
CREATE TABLE IF NOT EXISTS boult_today_dismissals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  item_type TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, item_id)
);
CREATE INDEX IF NOT EXISTS boult_today_dismissals_user_idx ON boult_today_dismissals (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS boult_today_cache (
  user_id TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- === Migration: access_requests.sql ===
-- ============================================
-- Access Requests Table
-- Stores gated access requests from the landing page
-- Users request access → admin approves → user gets approval email → signs up
-- ============================================

CREATE TABLE IF NOT EXISTS access_requests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  has_international_card BOOLEAN NOT NULL DEFAULT false,
  x_handle TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  approved_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Unique constraint on email (one request per email)
CREATE UNIQUE INDEX IF NOT EXISTS idx_access_requests_email_unique ON access_requests(LOWER(email));

-- Fast lookup by status for admin dashboard
CREATE INDEX IF NOT EXISTS idx_access_requests_status ON access_requests(status);

-- RLS: disable for now (accessed via service role key from API routes)
ALTER TABLE access_requests ENABLE ROW LEVEL SECURITY;


-- === Migration: boult_agent_pending_actions.sql ===
-- Migration: boult_agent_pending_actions
-- Stores write actions that a background agent wanted to execute, but were
-- intercepted because skip_confirmations was false.

CREATE TABLE IF NOT EXISTS public.boult_agent_pending_actions (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    agent_id uuid NOT NULL REFERENCES public.boult_agents(id) ON DELETE CASCADE,
    run_id text NOT NULL,
    user_id text NOT NULL,
    tool_name text NOT NULL,
    tool_input jsonb NOT NULL,
    status text NOT NULL DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    resolved_at timestamp with time zone
);

CREATE INDEX IF NOT EXISTS boult_agent_pending_actions_run_id_idx ON public.boult_agent_pending_actions(run_id);
CREATE INDEX IF NOT EXISTS boult_agent_pending_actions_user_id_idx ON public.boult_agent_pending_actions(user_id);
CREATE INDEX IF NOT EXISTS boult_agent_pending_actions_agent_id_idx ON public.boult_agent_pending_actions(agent_id);

ALTER TABLE public.boult_agent_pending_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own pending actions"
    ON public.boult_agent_pending_actions FOR SELECT
    USING (user_id = current_setting('request.jwt.claims', true)::json->>'sub');

CREATE POLICY "Users can update their own pending actions"
    ON public.boult_agent_pending_actions FOR UPDATE
    USING (user_id = current_setting('request.jwt.claims', true)::json->>'sub');


-- === Migration: boult_agent_runs.sql ===
-- Boult agent run history (FX.2)
--
-- The boult_agents table only stores last_run_at + last_report_summary
-- (one most-recent record). Users couldn't see whether Tuesday's run
-- actually went out, what got delivered, what failed.
--
-- This table records one row per cron-tick attempt, including delivery
-- status per channel. Settings card can show the last 7 runs at a glance.

CREATE TABLE IF NOT EXISTS boult_agent_runs (
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

CREATE INDEX IF NOT EXISTS idx_boult_agent_runs_user
  ON boult_agent_runs (user_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_boult_agent_runs_agent
  ON boult_agent_runs (agent_id, started_at DESC);

-- Used by the cron pre-flight pass when checking whether to retry. Lets us
-- count recent transient failures cheaply to back off escalating retries.
CREATE INDEX IF NOT EXISTS idx_boult_agent_runs_recent_failures
  ON boult_agent_runs (agent_id, status, started_at DESC)
  WHERE status IN ('error', 'transient_error');


-- === Migration: boult_agent_runs_part60_signal.sql ===
-- PART 60 — signal-density columns for boult_agent_runs.
--
-- WHY THIS FILE EXISTS:
-- The cron runner (app/api/cron/run-agents/route.ts) scores each run's report
-- for "signal density" and attempts to persist the result:
--
--     await supabase.from('boult_agent_runs').update({
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

ALTER TABLE boult_agent_runs
  ADD COLUMN IF NOT EXISTS signal_score      int,   -- 0-100 report signal density (PART 60)
  ADD COLUMN IF NOT EXISTS delivery_decision text;  -- why the report was/ wasn't delivered + top signal reasons


-- === Migration: boult_agent_runs_plan.sql ===
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

ALTER TABLE boult_agent_runs
  ADD COLUMN IF NOT EXISTS plan text;  -- plain-English plan generated before execution (Layer 1)


-- === Migration: boult_agent_scratchpad.sql ===
-- Boult agent coordination scratchpad
--
-- Holds short-lived "I'm working on these items" claims so multiple
-- background agents owned by the same user don't duplicate each other's
-- work in the same tick. One row per (user_id, agent_id); claims live in
-- a JSONB array with per-claim expiresAt (TTL ~10 minutes).
--
-- All access happens via lib/boult/autonomy.ts. The agent runner reads
-- claims via readActiveClaims() before scoring its worklist, then writes
-- its own claims via writeClaim() before processing.

CREATE TABLE IF NOT EXISTS boult_agent_scratchpad (
  user_id      text NOT NULL,
  agent_id     uuid NOT NULL,
  agent_name   text,
  claims       jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_boult_agent_scratchpad_user
  ON boult_agent_scratchpad (user_id, updated_at DESC);

-- We rely on application-level TTL filtering inside autonomy.ts rather than
-- a scheduled cleanup; rows are small and overwritten on every agent run,
-- so accumulating stale rows isn't a real concern.


-- === Migration: boult_agents.sql ===
-- Boult scheduled agents — the central table for background ("while you sleep")
-- agents. One row per agent the user has created.
--
-- WHY THIS FILE EXISTS:
-- The canonical CREATE TABLE for boult_agents previously lived ONLY in
-- lib/boult-v3/schema.sql — a different code generation's schema bundle — and
-- not in supabase/migrations/. That meant the table this project's MAIN agent
-- path depends on (GET /api/cron/run-agents, POST /api/boult/agents/create) was
-- not represented in the migrations directory at all. The cron runner had to
-- defensively swallow a 42P01 "relation does not exist" error to avoid crashing
-- when the table was missing.
--
-- This migration makes supabase/migrations/ the single source of truth for the
-- table. It is byte-for-byte compatible with the definition in
-- lib/boult-v3/schema.sql (IF NOT EXISTS — safe to run against a DB where the
-- table already exists; it is a no-op there).
--
-- Written by:
--   POST /api/boult/agents/create      (direct creation)
--   POST /api/boult/agents             (LLM-loop creation)
-- Read by:
--   GET  /api/cron/run-agents          (the scheduled runner)
--   GET  /api/boult/agents             (settings UI list)

CREATE TABLE IF NOT EXISTS boult_agents (
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

CREATE INDEX IF NOT EXISTS idx_boult_agents_user   ON boult_agents (user_id);
CREATE INDEX IF NOT EXISTS idx_boult_agents_status ON boult_agents (status);

-- RLS — service role (server-side API routes) has full access. Mirrors the
-- policy already declared in lib/boult-v3/schema.sql so applying either file
-- produces the same end state.
ALTER TABLE boult_agents ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'boult_agents'
      AND policyname = 'Service role full access'
  ) THEN
    CREATE POLICY "Service role full access" ON boult_agents
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;


-- === Migration: boult_agents_triggers_v1.sql ===
-- Next-gen scheduling engine — Phase 1 (additive, idempotent, zero-regression).
--
-- Adds trigger / condition / pipeline / cross-run-state columns to boult_agents
-- and trigger-provenance columns to boult_agent_runs. Every column has a safe
-- default (trigger_type='schedule'), so EVERY existing agent keeps running
-- exactly as before — the cron's schedule path is unchanged for them.
--
-- WHY: today an agent is a single fixed cron string. This lets agents also fire
-- on real events ("email from a client"), on conditions ("deal stalls 3 days"),
-- and chain into one another (Triage -> Draft -> Digest), while accumulating
-- state across runs (agent_state).
--
-- Mirror of these ALTERs also lives in lib/boult-v3/schema.sql (single source of
-- truth convention). Safe to run repeatedly.
--
-- Read/written by:
--   GET /api/cron/run-agents            (three-way selection: schedule|event|chain)
--   lib/boult/triggers/reactive-poll.ts (agent_state cursor + processed ids)
--   lib/boult/triggers/chain.ts         (pipeline hand-offs via boult_events_queue)

ALTER TABLE boult_agents
  ADD COLUMN IF NOT EXISTS trigger_type    TEXT NOT NULL DEFAULT 'schedule'
    CHECK (trigger_type IN ('schedule', 'event', 'chained', 'condition')),
  ADD COLUMN IF NOT EXISTS trigger_config  JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS conditions      JSONB DEFAULT '[]'::jsonb,   -- AND-array; [] = match all
  ADD COLUMN IF NOT EXISTS pipeline        JSONB DEFAULT '[]'::jsonb,   -- ordered child agent ids
  ADD COLUMN IF NOT EXISTS parent_agent_id UUID,
  ADD COLUMN IF NOT EXISTS agent_state     JSONB DEFAULT '{}'::jsonb,   -- cross-run memory
  ADD COLUMN IF NOT EXISTS priority        INT  NOT NULL DEFAULT 5,     -- 1 = highest
  ADD COLUMN IF NOT EXISTS max_tool_calls  INT;                         -- null = use cron default

-- Event/condition agents are selected by reactive-poll, not by cron time.
CREATE INDEX IF NOT EXISTS idx_boult_agents_trigger_type
  ON boult_agents (trigger_type) WHERE trigger_type <> 'schedule';

ALTER TABLE boult_agent_runs
  ADD COLUMN IF NOT EXISTS trigger_source   TEXT,   -- schedule | event | chain | manual
  ADD COLUMN IF NOT EXISTS triggering_event JSONB,  -- the event/condition match that fired this run
  ADD COLUMN IF NOT EXISTS parent_run_id    UUID,   -- the parent run in a pipeline
  ADD COLUMN IF NOT EXISTS chain_depth      INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS chain_input      JSONB;  -- parent summary/artifacts handed to a chained child


-- === Migration: boult_audit_log.sql ===
-- ──────────────────────────────────────────────────────────────────────────────
-- Boult Audit Trail — Feature 5
-- Every tool call is logged here for transparency, debugging, and trust.
-- Run this in the Supabase SQL editor.
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS boult_audit_log (
  id            UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       TEXT        NOT NULL,
  run_id        TEXT,                          -- groups tool calls within one agent run
  tool_name     TEXT        NOT NULL,
  input_summary TEXT,                          -- first 500 chars of JSON input
  output_summary TEXT,                         -- first 500 chars of output
  duration_ms   INTEGER,
  success       BOOLEAN     DEFAULT true,
  error_message TEXT,
  iteration     INTEGER,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS boult_audit_user_idx   ON boult_audit_log (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS boult_audit_run_idx    ON boult_audit_log (run_id);
CREATE INDEX IF NOT EXISTS boult_audit_tool_idx   ON boult_audit_log (user_id, tool_name);

ALTER TABLE boult_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own audit logs"
  ON boult_audit_log FOR ALL
  USING (
    user_id = auth.uid()::text
    OR user_id = (SELECT email FROM auth.users WHERE id = auth.uid())
  );


-- === Migration: boult_autonomy_v1.sql ===
-- ──────────────────────────────────────────────────────────────────────────────
-- Boult: Graduated Autonomy (the Trust Ladder)
-- Run this in the Supabase SQL editor.
--
-- Per-target earned-autonomy: a "grant" authorizes one (action_type, target) to
-- run without the per-action approval prompt. Grants are earned — every
-- approve/reject increments the ledger here, and past a threshold with a clean
-- record we set suggested=true so the UI can offer promotion (user confirms).
-- Auto actions don't fire silently: they land in boult_autonomy_actions with an
-- execute_at buffer the user can Stop before it runs (the undo window).
--
-- SAFE DEFAULTS: boult_autonomy_settings.enabled defaults false, so until a user
-- turns autonomy on AND accepts a suggestion, behavior is identical to today.
-- ──────────────────────────────────────────────────────────────────────────────

-- 1. Per-target grant ledger + active grant + pending suggestion.
CREATE TABLE IF NOT EXISTS boult_autonomy_grants (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          TEXT NOT NULL,
  scope            TEXT NOT NULL DEFAULT 'contact'           -- contact | domain
                     CHECK (scope IN ('contact','domain')),
  action_type      TEXT NOT NULL,                            -- normalizeTargetKey action
  target_key       TEXT NOT NULL,                            -- normalized recipient/channel/domain
  level            TEXT NOT NULL DEFAULT 'inherit'           -- inherit | hold | auto | never
                     CHECK (level IN ('inherit','hold','auto','never')),
  delay_mode       TEXT NOT NULL DEFAULT 'buffer'            -- buffer | instant
                     CHECK (delay_mode IN ('buffer','instant')),
  approve_count    INT NOT NULL DEFAULT 0,
  reject_count     INT NOT NULL DEFAULT 0,
  suggested        BOOLEAN NOT NULL DEFAULT false,           -- promotion awaiting user confirm
  label            TEXT,                                     -- human display ("alex@bigco.com")
  last_decision_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, action_type, target_key)
);
CREATE INDEX IF NOT EXISTS boult_autonomy_lookup_idx
  ON boult_autonomy_grants (user_id, action_type, target_key);
CREATE INDEX IF NOT EXISTS boult_autonomy_user_idx
  ON boult_autonomy_grants (user_id, level);

-- 2. Per-user global autonomy settings (the kill switch). Default OFF.
CREATE TABLE IF NOT EXISTS boult_autonomy_settings (
  user_id        TEXT PRIMARY KEY,
  enabled        BOOLEAN NOT NULL DEFAULT false,             -- master kill switch
  buffer_minutes INT NOT NULL DEFAULT 10,                    -- undo window length
  allow_instant  BOOLEAN NOT NULL DEFAULT true,              -- may users set targets to instant
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Deferred auto-execution queue (the undo window). The cron drains due rows
--    via executeTool(skipConfirmations:true). A user "Stop" sets status=cancelled
--    before execute_at, so a cancelled row is never claimed.
CREATE TABLE IF NOT EXISTS boult_autonomy_actions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      TEXT NOT NULL,
  agent_id     UUID,                                         -- null for live-chat origin
  run_id       TEXT,
  tool_name    TEXT NOT NULL,                                -- executeTool tool name
  tool_input   JSONB NOT NULL,
  action_type  TEXT,                                         -- grant action_type
  target_key   TEXT,
  status       TEXT NOT NULL DEFAULT 'auto_scheduled'
                 CHECK (status IN ('auto_scheduled','executing','done','failed','cancelled')),
  execute_at   TIMESTAMPTZ NOT NULL,
  summary      TEXT,                                         -- human label for the feed
  result       TEXT,
  error        TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  executed_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS boult_autonomy_actions_due_idx
  ON boult_autonomy_actions (status, execute_at);
CREATE INDEX IF NOT EXISTS boult_autonomy_actions_user_idx
  ON boult_autonomy_actions (user_id, status);

-- RLS — users see only their own rows.
ALTER TABLE boult_autonomy_grants   ENABLE ROW LEVEL SECURITY;
ALTER TABLE boult_autonomy_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE boult_autonomy_actions  ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "own autonomy grants" ON boult_autonomy_grants FOR ALL
    USING (user_id = auth.uid()::text OR user_id = (SELECT email FROM auth.users WHERE id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "own autonomy settings" ON boult_autonomy_settings FOR ALL
    USING (user_id = auth.uid()::text OR user_id = (SELECT email FROM auth.users WHERE id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "own autonomy actions" ON boult_autonomy_actions FOR ALL
    USING (user_id = auth.uid()::text OR user_id = (SELECT email FROM auth.users WHERE id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- === Migration: boult_canvas_state.sql ===
-- ──────────────────────────────────────────────────────────────────────────────
-- Boult Canvas State — per-conversation last-known canvas content so
-- update_canvas with mode='append' can server-side concatenate without
-- requiring the LLM to resend the entire markdown payload.
--
-- One row per conversation_id. Upserted on open_canvas and on every
-- update_canvas call (regardless of mode). Append mode reads the row,
-- concatenates the new markdown with a blank-line separator, writes back
-- the merged content, and returns the merged content to the UI.
--
-- Background-agent runs without a conversation id fall back to
-- mode='replace' behaviour even when mode='append' is requested.
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS boult_canvas_state (
  conversation_id TEXT        PRIMARY KEY,
  user_id         TEXT        NOT NULL,
  title           TEXT,
  -- 'email_draft' | 'report' | 'notes' | 'analysis' | 'action_plan'
  type            TEXT,
  markdown        TEXT        NOT NULL DEFAULT '',
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS boult_canvas_state_user_idx
  ON boult_canvas_state (user_id, updated_at DESC);

ALTER TABLE boult_canvas_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own canvas state"
  ON boult_canvas_state FOR ALL
  USING (
    user_id = auth.uid()::text
    OR user_id = (SELECT email FROM auth.users WHERE id = auth.uid())
  );


-- === Migration: boult_contacts_and_rules.sql ===
-- ──────────────────────────────────────────────────────────────────────────────
-- Boult: Relationship Memory + Delegation Rules
-- Run this in the Supabase SQL editor.
-- ──────────────────────────────────────────────────────────────────────────────

-- Feature 4: Relationship Memory
-- Tracks every person the user emails. Auto-populated on send/draft;
-- enriched manually via remember_about_contact tool.
CREATE TABLE IF NOT EXISTS boult_contacts (
  id               UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id          TEXT        NOT NULL,
  contact_email    TEXT        NOT NULL,
  contact_name     TEXT,
  last_contact_at  TIMESTAMPTZ,
  email_count      INTEGER     DEFAULT 0,
  notes            TEXT,
  tags             TEXT[]      DEFAULT '{}',
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, contact_email)
);

CREATE INDEX IF NOT EXISTS boult_contacts_user_idx ON boult_contacts (user_id);
CREATE INDEX IF NOT EXISTS boult_contacts_email_idx ON boult_contacts (user_id, contact_email);

-- Row Level Security
ALTER TABLE boult_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own contacts"
  ON boult_contacts FOR ALL
  USING (user_id = auth.uid()::text OR user_id = (SELECT email FROM auth.users WHERE id = auth.uid()));

-- Feature 6: Delegation Rules
-- Standing instructions Boult applies automatically during proactive triage.
-- e.g. "whenever someone asks for a meeting time, propose 3 slots automatically"
CREATE TABLE IF NOT EXISTS boult_delegation_rules (
  id               UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id          TEXT        NOT NULL,
  name             TEXT        NOT NULL,
  trigger_keywords TEXT[]      DEFAULT '{}',
  trigger_from     TEXT,
  trigger_subject  TEXT,
  action_type      TEXT        NOT NULL CHECK (action_type IN ('draft_reply', 'notify', 'label', 'forward')),
  action_config    JSONB       DEFAULT '{}',
  is_active        BOOLEAN     DEFAULT true,
  run_count        INTEGER     DEFAULT 0,
  last_triggered   TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS boult_rules_user_idx ON boult_delegation_rules (user_id, is_active);

ALTER TABLE boult_delegation_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own rules"
  ON boult_delegation_rules FOR ALL
  USING (user_id = auth.uid()::text OR user_id = (SELECT email FROM auth.users WHERE id = auth.uid()));

-- Triage log — tracks what Boult surfaced in each proactive scan
-- (optional, useful for analytics and avoiding duplicate alerts)
CREATE TABLE IF NOT EXISTS boult_triage_log (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     TEXT        NOT NULL,
  thread_id   TEXT,
  reason      TEXT,          -- 'urgent', 'followup', 'delegation_match'
  rule_name   TEXT,
  surfaced_at TIMESTAMPTZ DEFAULT NOW(),
  actioned    BOOLEAN     DEFAULT false
);

CREATE INDEX IF NOT EXISTS boult_triage_log_user_idx ON boult_triage_log (user_id, surfaced_at DESC);


-- === Migration: boult_gmail_scope_cache.sql ===
-- ──────────────────────────────────────────────────────────────────────────────
-- Boult Gmail scope cache — adds a TTL'd "we last checked, scopes were fine"
-- timestamp per boult_integrations row. Used by the preflight check in
-- /api/boult/chat so we surface a "reconnect Gmail" card BEFORE the LLM tries
-- to call a Gmail tool and hits 403 mid-task.
--
-- When the chat route runs:
--   * scope_ok_until > now()   → skip preflight, run the loop
--   * scope_ok_until <= now()  → ping /gmail/v1/users/me/profile:
--       200 → set scope_ok_until = now() + 1 hour
--       403 → set scope_ok_until = NULL, emit connector_required, skip loop
--   * scope_ok_until IS NULL   → same as stale; means a previous 403 invalidated
--
-- The loop also invalidates this on any in-flight 403 so the next turn re-checks.
-- ──────────────────────────────────────────────────────────────────────────────

ALTER TABLE boult_integrations
  ADD COLUMN IF NOT EXISTS scope_ok_until TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS boult_integrations_scope_idx
  ON boult_integrations (user_id, provider, scope_ok_until);


-- === Migration: boult_gmail_watch_v1.sql ===
-- ──────────────────────────────────────────────────────────────────────────────
-- Boult: Gmail real-time push (Pub/Sub watch) state
-- Run this in the Supabase SQL editor.
--
-- Reuses the existing channel_id / channel_token / channel_expiry columns on
-- boult_integrations (added for GCal). Gmail also needs a history pointer so the
-- webhook can fetch only the messages added since the last notification.
-- ──────────────────────────────────────────────────────────────────────────────

ALTER TABLE boult_integrations
  ADD COLUMN IF NOT EXISTS gmail_history_id TEXT;


-- === Migration: boult_home_feed_infra.sql ===
-- ──────────────────────────────────────────────────────────────────────────────
-- Home-feed deep infra: durable dismissals + server-side Today cache
-- Run this in the Supabase SQL editor.
-- ──────────────────────────────────────────────────────────────────────────────

-- 1. Dismissed Today items — server-side so a swipe-to-dismiss survives reloads
--    and syncs across devices (was localStorage-only). The Today route filters
--    these out, so a dismissed item never comes back from the API.
CREATE TABLE IF NOT EXISTS boult_today_dismissals (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      TEXT NOT NULL,
  item_id      TEXT NOT NULL,            -- Gmail message id / event id / action item id
  item_type    TEXT,                     -- decide | chase | showUp | actionItem
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, item_id)
);
CREATE INDEX IF NOT EXISTS boult_today_dismissals_user_idx
  ON boult_today_dismissals (user_id, created_at DESC);

-- 2. Today snapshot cache — the expensive Gmail/Calendar build is stored per user
--    so reloads and cross-device opens are a fast DB read instead of a ~7s fetch.
--    Served fresh within a TTL; recomputed on miss (or by the cron prewarm).
CREATE TABLE IF NOT EXISTS boult_today_cache (
  user_id      TEXT PRIMARY KEY,
  payload      JSONB NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE boult_today_dismissals ENABLE ROW LEVEL SECURITY;
ALTER TABLE boult_today_cache      ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "own today dismissals" ON boult_today_dismissals FOR ALL
    USING (user_id = auth.uid()::text OR user_id = (SELECT email FROM auth.users WHERE id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "own today cache" ON boult_today_cache FOR ALL
    USING (user_id = auth.uid()::text OR user_id = (SELECT email FROM auth.users WHERE id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- === Migration: boult_memories.sql ===
-- Boult memory table — the durable native store for things the AI learns
-- about the user and explicit "remember this" facts.
--
-- This is the SOURCE OF TRUTH for the per-user memory list shown in the
-- Boult AI settings card. Supermemory (when configured) is a secondary
-- semantic-search index; this table is what the user reads, edits, and
-- deletes. If Supermemory is unconfigured, the AI still works — it just
-- can't do fuzzy semantic recall, only exact / tag-based lookup.
--
-- Access pattern:
--   - The chat route reads recent memories at the start of each turn
--     (search by tag + recency, ranked by created_at DESC, limit ~50).
--   - The memory_save tool writes here in-band when the user says
--     "remember X" or when the LLM extracts a worth-keeping fact.
--   - The /api/agent-talk/memory routes list/edit/delete from here.

CREATE TABLE IF NOT EXISTS boult_memories (
  id          uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id     text NOT NULL,
  content     text NOT NULL,
  tags        text[] NOT NULL DEFAULT ARRAY[]::text[],
  source      text DEFAULT 'user',  -- 'user' (manual add via UI), 'ai' (auto-extracted), 'agent_run' (background)
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_boult_memories_user
  ON boult_memories (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_boult_memories_user_tags
  ON boult_memories USING GIN (tags);


-- === Migration: boult_scheduled_emails.sql ===

-- ──────────────────────────────────────────────────────────────────────────────
-- Boult: Scheduled email send
-- Run this in the Supabase SQL editor.
--
-- Backs the schedule_email_send tool + the cron dispatcher (drainScheduledEmails).
-- A row is a single email to dispatch at-or-after send_at. The dispatcher claims
-- due rows atomically (status pending → sending) so concurrent cron ticks never
-- double-send, retries transient failures up to a cap, then marks sent/failed.
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS boult_scheduled_emails (
  id               UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id          TEXT        NOT NULL,
  to_email         TEXT        NOT NULL,
  subject          TEXT,
  body             TEXT        NOT NULL,
  thread_id        TEXT,                                  -- reply into a thread when set
  send_at          TIMESTAMPTZ NOT NULL,                  -- dispatch at-or-after this time
  status           TEXT        NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','sending','sent','failed','cancelled')),
  attempts         INT         NOT NULL DEFAULT 0,
  last_error       TEXT,
  sent_message_id  TEXT,
  dedup_key        TEXT,                                  -- optional idempotency key per user
  source           TEXT        DEFAULT 'agent',           -- agent | chat | sequence
  agent_id         UUID,                                  -- originating background agent, if any
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  sent_at          TIMESTAMPTZ
);

-- Hot path: the dispatcher selects pending rows due now, oldest first.
CREATE INDEX IF NOT EXISTS boult_sched_due_idx
  ON boult_scheduled_emails (status, send_at);
CREATE INDEX IF NOT EXISTS boult_sched_user_idx
  ON boult_scheduled_emails (user_id, status);

-- Idempotency: a (user_id, dedup_key) is scheduled at most once.
CREATE UNIQUE INDEX IF NOT EXISTS boult_sched_dedup_idx
  ON boult_scheduled_emails (user_id, dedup_key)
  WHERE dedup_key IS NOT NULL;

ALTER TABLE boult_scheduled_emails ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users manage own scheduled emails"
    ON boult_scheduled_emails FOR ALL
    USING (user_id = auth.uid()::text OR user_id = (SELECT email FROM auth.users WHERE id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- === Migration: boult_session_approvals.sql ===
-- ──────────────────────────────────────────────────────────────────────────────
-- Boult Session Approvals — Phase 2 of the reliability overhaul.
-- Persistent state for the confirm-before-write gate. Without this, the LLM
-- could (and did) skip the request_confirmation prompt and call send_email
-- directly because nothing at the executor level checked whether the user had
-- actually approved the action.
--
-- Flow:
--   1. LLM calls request_confirmation → executor inserts a row with status='pending'
--      and returns its id to the UI as part of canvasData.pageMeta.
--   2. User clicks Confirm in the UI → POST /api/boult/approval/confirm
--      flips status to 'approved'.
--   3. LLM next turn calls send_email / schedule_meeting / send_slack_message /
--      create_notion_page → executor looks up an 'approved' row matching
--      (conversation_id, action_type, target_key), marks it 'consumed', and
--      proceeds. If none found, the call fails with code 'confirmation_required'.
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS boult_session_approvals (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id TEXT        NOT NULL,
  user_id         TEXT        NOT NULL,
  -- 'send_email' | 'schedule_meeting' | 'send_slack_message' | 'create_notion_page'
  action_type     TEXT        NOT NULL,
  -- Recipient / channel / database key — normalized to lowercase. The executor
  -- recomputes this from the write tool's inputs and matches against the row
  -- to prevent "approved to send to A, then send to B" mismatches.
  target_key      TEXT        NOT NULL,
  -- Human-readable label shown to the user, copied from request_confirmation.action
  action_label    TEXT,
  status          TEXT        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'approved', 'declined', 'consumed')),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  approved_at     TIMESTAMPTZ,
  consumed_at     TIMESTAMPTZ,
  -- Auto-expire so a stale pending row can't be confirmed days later
  expires_at      TIMESTAMPTZ DEFAULT NOW() + INTERVAL '1 hour'
);

CREATE INDEX IF NOT EXISTS boult_session_approvals_lookup_idx
  ON boult_session_approvals (conversation_id, action_type, target_key, status);
CREATE INDEX IF NOT EXISTS boult_session_approvals_user_idx
  ON boult_session_approvals (user_id, created_at DESC);

ALTER TABLE boult_session_approvals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own approvals"
  ON boult_session_approvals FOR ALL
  USING (
    user_id = auth.uid()::text
    OR user_id = (SELECT email FROM auth.users WHERE id = auth.uid())
  );


-- === Migration: boult_super_agent_v1.sql ===
-- SUPER-AGENT REBUILD — Stage 1 foundation (Persistent Memory + User Model +
-- Follow-Through Ledger). Additive + idempotent; existing agents keep running.
--
-- Design: we REUSE the live tables rather than fork a 4th parallel agent system.
--   • boult_agents     gains the compiled Mission + autonomy + escalation policy.
--   • boult_agent_runs gains the run's decisions / criteria-met / outcome (plan
--     column already added by the trigger migration).
--   • boult_ledger     is NEW — the Follow-Through Ledger (kills dropped balls).
--   • boult_user_model is NEW — the living, structured model of the user.
--   • Free-text facts/decisions/corrections reuse boult_memories (Supermemory)
--     with typed tags ['super','fact'|'decision'|'correction'|'open_loop'].

-- ── 1.1 Mission Compiler fields on the agent ────────────────────────────────
ALTER TABLE boult_agents
  ADD COLUMN IF NOT EXISTS mission           JSONB,                 -- compiled Mission {objective, successCriteria, standingConstraints, ...}
  ADD COLUMN IF NOT EXISTS autonomy_level    TEXT NOT NULL DEFAULT 'assist'
    CHECK (autonomy_level IN ('observe', 'assist', 'own')),
  ADD COLUMN IF NOT EXISTS escalation_policy JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS output_channels   JSONB DEFAULT '[]'::jsonb;

-- ── 1.7 / Part 8 — richer run records (plan added earlier) ───────────────────
ALTER TABLE boult_agent_runs
  ADD COLUMN IF NOT EXISTS decisions       JSONB,   -- [{action, confidence, reasoning, outcome}]
  ADD COLUMN IF NOT EXISTS criteria_met    JSONB,   -- {criterion: bool/score}
  ADD COLUMN IF NOT EXISTS outcome_summary TEXT,    -- the one-line outcome
  ADD COLUMN IF NOT EXISTS report_full     TEXT;    -- the full executive briefing (dashboard inspectability)

-- ── 1.6 Follow-Through Ledger — open commitments across runs ─────────────────
CREATE TABLE IF NOT EXISTS boult_ledger (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        TEXT NOT NULL,
  agent_id       UUID,
  what           TEXT NOT NULL,                       -- "Send Acme the deck"
  who            TEXT,                                -- "acme@co.com" / "Sarah Chen"
  due            TIMESTAMPTZ,                         -- when it's due (null = no hard date)
  status         TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_progress', 'done', 'cancelled')),
  origin_run_id  UUID,
  closed_run_id  UUID,
  thread_id      TEXT,                                -- gmail thread for dedup/chasing
  detail         JSONB DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_boult_ledger_user_status ON boult_ledger (user_id, status);
CREATE INDEX IF NOT EXISTS idx_boult_ledger_due ON boult_ledger (status, due) WHERE status IN ('open', 'in_progress');

-- ── 1.5 / Part 5 — the living user model (one row per user) ──────────────────
CREATE TABLE IF NOT EXISTS boult_user_model (
  user_id     TEXT PRIMARY KEY,
  model       JSONB NOT NULL DEFAULT '{}'::jsonb,     -- UserModel (Part 5 schema)
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- RLS — service role full access (mirrors the rest of the boult_* tables).
ALTER TABLE boult_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE boult_user_model ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='boult_ledger' AND policyname='Service role full access') THEN
    CREATE POLICY "Service role full access" ON boult_ledger FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='boult_user_model' AND policyname='Service role full access') THEN
    CREATE POLICY "Service role full access" ON boult_user_model FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;


-- === Migration: boult_user_model.sql ===
-- Boult User Mental Model — the persistent, evolving understanding of WHO the
-- user is, so every agent decision is grounded in business context, not just
-- isolated rules. One row per user. The agent reads it before judgment calls
-- and updates it (via the update_user_model tool) as it learns.
--
-- This is the structural backbone of "thinking like the user's business brain":
-- relationship tiers, decision style, work patterns, and what's strategic vs.
-- routine — held as durable structure rather than scattered memory fragments.

CREATE TABLE IF NOT EXISTS boult_user_model (
  user_id        TEXT PRIMARY KEY,
  -- Free-form structured profile. Shape (all optional, agent fills over time):
  -- {
  --   business_type, decision_style, values[], communication_style,
  --   work_patterns[], risk_tolerance,
  --   relationships: { vip[], trusted[], transactional[] },
  --   decision_types: { strategic[], tactical[], routine[] },
  --   pain_points[], opportunities[]
  -- }
  model          JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- A short plain-English summary the prompt injects verbatim (cheaper than
  -- re-serializing the whole JSON each turn).
  summary        TEXT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE boult_user_model ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'boult_user_model'
      AND policyname = 'Service role full access'
  ) THEN
    CREATE POLICY "Service role full access" ON boult_user_model
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;


-- === Migration: landing_leads.sql ===
-- Landing-page leads — emails captured from an OPT-IN field on maily.xyz.
--
-- Every row is someone who typed their OWN email into the capture field. We
-- deliberately store nothing about the anonymous-visitor side — no IP, no
-- fingerprint, no de-anonymisation. You cannot email a pageview, and we do not
-- try to turn one into a person. This table only exists so the capture form can
-- (a) fire the hook email once and (b) never email the same address twice.
--
-- `email` is the PRIMARY KEY, so a re-submit is a unique-violation the API
-- treats as "already captured" and silently ignores — no duplicate emails.

CREATE TABLE IF NOT EXISTS landing_leads (
  email            text PRIMARY KEY,
  source           text,                         -- which surface captured it (e.g. 'landing')
  hook_emailed_at  timestamptz,                  -- when the hook email actually went out
  converted        boolean NOT NULL DEFAULT false, -- flip true if they later sign up
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_landing_leads_created ON landing_leads (created_at DESC);

-- Service-role only. The capture route uses the admin client; nothing here is
-- client-writable, so the endpoint is the single controlled way in.
ALTER TABLE landing_leads ENABLE ROW LEVEL SECURITY;


-- === Migration: referrals.sql ===
-- Maily referrals — the real backbone.
--
-- WHY THIS EXISTS
-- The original system had no table at all. A referral was a cookie, an
-- `invited_by` string on user_profiles, and an inviter lookup that guessed:
--     .or(`username.ilike.${code},user_id.ilike.${code}@%`)
-- That is unindexed, matches the WRONG account when two users share a name
-- prefix, interpolates user input straight into a filter, and pairs with
-- .maybeSingle() — which returns an ERROR (not a row) the moment two profiles
-- match, silently dropping the reward. Codes now live in their own table with a
-- unique constraint, and every referral is a row with a lifecycle you can audit.

-- ── Codes ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS referral_codes (
  code           text PRIMARY KEY,
  user_id        text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- One code per user. Re-running code generation must be idempotent, never a
-- second code that splits the same person's credit across two links.
CREATE UNIQUE INDEX IF NOT EXISTS idx_referral_codes_user ON referral_codes(lower(user_id));

-- ── Referrals ────────────────────────────────────────────────────────────────
-- One row per referred PERSON, created the moment they sign up (not on click —
-- a click is anonymous and would let anyone inflate someone's stats).
CREATE TABLE IF NOT EXISTS referrals (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code              text NOT NULL,
  referrer_user_id  text NOT NULL,
  referred_user_id  text NOT NULL,
  -- signed_up -> trialing -> converted   (rejected = failed a fraud check)
  status            text NOT NULL DEFAULT 'signed_up',
  -- Set once, when the reward is actually granted. Doubles as the idempotency
  -- guard: a non-null value means the referrer has already been paid for this
  -- person and must never be paid again.
  rewarded_at       timestamptz,
  reward_days       integer,
  converted_at      timestamptz,
  rejected_reason   text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- A person can only ever be referred ONCE. This is the single most important
-- constraint here: without it, a friend who signs up, deletes, and returns via a
-- different link pays out twice.
CREATE UNIQUE INDEX IF NOT EXISTS idx_referrals_referred_once ON referrals(lower(referred_user_id));
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(lower(referrer_user_id));
CREATE INDEX IF NOT EXISTS idx_referrals_status ON referrals(status);

-- ── Reward ledger ────────────────────────────────────────────────────────────
-- Append-only. preferences.free_pro_until on user_profiles stays the value the
-- access gate reads (it already does), but that field is a moving target with no
-- history — you cannot answer "why does this account have Pro until October?"
-- from it. Every grant is recorded here so the balance is always explainable.
CREATE TABLE IF NOT EXISTS referral_rewards (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       text NOT NULL,
  days          integer NOT NULL,
  reason        text NOT NULL,           -- 'referrer_conversion' | 'referred_welcome'
  referral_id   uuid REFERENCES referrals(id) ON DELETE SET NULL,
  granted_until timestamptz,             -- the free_pro_until this grant produced
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_referral_rewards_user ON referral_rewards(lower(user_id));

-- Service-role only. Nothing here is client-writable: a user who could INSERT
-- into referrals could mint themselves free months.
ALTER TABLE referral_codes   ENABLE ROW LEVEL SECURITY;
ALTER TABLE referrals        ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_rewards ENABLE ROW LEVEL SECURITY;


-- === Migration: user_profiles_gmail_provider.sql ===
-- Records HOW each user connected Gmail, directly on the users table, so the
-- split between Composio-managed sign-in and direct Google OAuth is countable
-- without joining boult_integrations or decrypting a marker token:
--
--   SELECT gmail_provider, count(*)
--   FROM user_profiles
--   GROUP BY gmail_provider;
--
-- Values written by persistUserData on each login (best-effort, non-fatal):
--   'composio' — signed in through the composio-login credentials provider
--   'google'   — signed in through our direct Google OAuth client
-- Existing rows stay NULL until that user next logs in (see the optional
-- backfill note in the PR / chat if you want historical rows filled in).

ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS gmail_provider text;

CREATE INDEX IF NOT EXISTS idx_user_profiles_gmail_provider
  ON user_profiles (gmail_provider);
