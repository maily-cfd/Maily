-- ──────────────────────────────────────────────────────────────────────────────
-- Arcus: Graduated Autonomy (the Trust Ladder)
-- Run this in the Supabase SQL editor.
--
-- Per-target earned-autonomy: a "grant" authorizes one (action_type, target) to
-- run without the per-action approval prompt. Grants are earned — every
-- approve/reject increments the ledger here, and past a threshold with a clean
-- record we set suggested=true so the UI can offer promotion (user confirms).
-- Auto actions don't fire silently: they land in arcus_autonomy_actions with an
-- execute_at buffer the user can Stop before it runs (the undo window).
--
-- SAFE DEFAULTS: arcus_autonomy_settings.enabled defaults false, so until a user
-- turns autonomy on AND accepts a suggestion, behavior is identical to today.
-- ──────────────────────────────────────────────────────────────────────────────

-- 1. Per-target grant ledger + active grant + pending suggestion.
CREATE TABLE IF NOT EXISTS arcus_autonomy_grants (
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
CREATE INDEX IF NOT EXISTS arcus_autonomy_lookup_idx
  ON arcus_autonomy_grants (user_id, action_type, target_key);
CREATE INDEX IF NOT EXISTS arcus_autonomy_user_idx
  ON arcus_autonomy_grants (user_id, level);

-- 2. Per-user global autonomy settings (the kill switch). Default OFF.
CREATE TABLE IF NOT EXISTS arcus_autonomy_settings (
  user_id        TEXT PRIMARY KEY,
  enabled        BOOLEAN NOT NULL DEFAULT false,             -- master kill switch
  buffer_minutes INT NOT NULL DEFAULT 10,                    -- undo window length
  allow_instant  BOOLEAN NOT NULL DEFAULT true,              -- may users set targets to instant
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Deferred auto-execution queue (the undo window). The cron drains due rows
--    via executeTool(skipConfirmations:true). A user "Stop" sets status=cancelled
--    before execute_at, so a cancelled row is never claimed.
CREATE TABLE IF NOT EXISTS arcus_autonomy_actions (
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
CREATE INDEX IF NOT EXISTS arcus_autonomy_actions_due_idx
  ON arcus_autonomy_actions (status, execute_at);
CREATE INDEX IF NOT EXISTS arcus_autonomy_actions_user_idx
  ON arcus_autonomy_actions (user_id, status);

-- RLS — users see only their own rows.
ALTER TABLE arcus_autonomy_grants   ENABLE ROW LEVEL SECURITY;
ALTER TABLE arcus_autonomy_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE arcus_autonomy_actions  ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "own autonomy grants" ON arcus_autonomy_grants FOR ALL
    USING (user_id = auth.uid()::text OR user_id = (SELECT email FROM auth.users WHERE id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "own autonomy settings" ON arcus_autonomy_settings FOR ALL
    USING (user_id = auth.uid()::text OR user_id = (SELECT email FROM auth.users WHERE id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "own autonomy actions" ON arcus_autonomy_actions FOR ALL
    USING (user_id = auth.uid()::text OR user_id = (SELECT email FROM auth.users WHERE id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
