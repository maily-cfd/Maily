-- SUPER-AGENT REBUILD — Stage 1 foundation (Persistent Memory + User Model +
-- Follow-Through Ledger). Additive + idempotent; existing agents keep running.
--
-- Design: we REUSE the live tables rather than fork a 4th parallel agent system.
--   • arcus_agents     gains the compiled Mission + autonomy + escalation policy.
--   • arcus_agent_runs gains the run's decisions / criteria-met / outcome (plan
--     column already added by the trigger migration).
--   • arcus_ledger     is NEW — the Follow-Through Ledger (kills dropped balls).
--   • arcus_user_model is NEW — the living, structured model of the user.
--   • Free-text facts/decisions/corrections reuse arcus_memories (Supermemory)
--     with typed tags ['super','fact'|'decision'|'correction'|'open_loop'].

-- ── 1.1 Mission Compiler fields on the agent ────────────────────────────────
ALTER TABLE arcus_agents
  ADD COLUMN IF NOT EXISTS mission           JSONB,                 -- compiled Mission {objective, successCriteria, standingConstraints, ...}
  ADD COLUMN IF NOT EXISTS autonomy_level    TEXT NOT NULL DEFAULT 'assist'
    CHECK (autonomy_level IN ('observe', 'assist', 'own')),
  ADD COLUMN IF NOT EXISTS escalation_policy JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS output_channels   JSONB DEFAULT '[]'::jsonb;

-- ── 1.7 / Part 8 — richer run records (plan added earlier) ───────────────────
ALTER TABLE arcus_agent_runs
  ADD COLUMN IF NOT EXISTS decisions       JSONB,   -- [{action, confidence, reasoning, outcome}]
  ADD COLUMN IF NOT EXISTS criteria_met    JSONB,   -- {criterion: bool/score}
  ADD COLUMN IF NOT EXISTS outcome_summary TEXT,    -- the one-line outcome
  ADD COLUMN IF NOT EXISTS report_full     TEXT;    -- the full executive briefing (dashboard inspectability)

-- ── 1.6 Follow-Through Ledger — open commitments across runs ─────────────────
CREATE TABLE IF NOT EXISTS arcus_ledger (
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
CREATE INDEX IF NOT EXISTS idx_arcus_ledger_user_status ON arcus_ledger (user_id, status);
CREATE INDEX IF NOT EXISTS idx_arcus_ledger_due ON arcus_ledger (status, due) WHERE status IN ('open', 'in_progress');

-- ── 1.5 / Part 5 — the living user model (one row per user) ──────────────────
CREATE TABLE IF NOT EXISTS arcus_user_model (
  user_id     TEXT PRIMARY KEY,
  model       JSONB NOT NULL DEFAULT '{}'::jsonb,     -- UserModel (Part 5 schema)
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- RLS — service role full access (mirrors the rest of the arcus_* tables).
ALTER TABLE arcus_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE arcus_user_model ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='arcus_ledger' AND policyname='Service role full access') THEN
    CREATE POLICY "Service role full access" ON arcus_ledger FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='arcus_user_model' AND policyname='Service role full access') THEN
    CREATE POLICY "Service role full access" ON arcus_user_model FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
