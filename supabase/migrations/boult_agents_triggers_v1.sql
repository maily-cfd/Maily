-- Next-gen scheduling engine — Phase 1 (additive, idempotent, zero-regression).
--
-- Adds trigger / condition / pipeline / cross-run-state columns to arcus_agents
-- and trigger-provenance columns to arcus_agent_runs. Every column has a safe
-- default (trigger_type='schedule'), so EVERY existing agent keeps running
-- exactly as before — the cron's schedule path is unchanged for them.
--
-- WHY: today an agent is a single fixed cron string. This lets agents also fire
-- on real events ("email from a client"), on conditions ("deal stalls 3 days"),
-- and chain into one another (Triage -> Draft -> Digest), while accumulating
-- state across runs (agent_state).
--
-- Mirror of these ALTERs also lives in lib/arcus-v3/schema.sql (single source of
-- truth convention). Safe to run repeatedly.
--
-- Read/written by:
--   GET /api/cron/run-agents            (three-way selection: schedule|event|chain)
--   lib/arcus/triggers/reactive-poll.ts (agent_state cursor + processed ids)
--   lib/arcus/triggers/chain.ts         (pipeline hand-offs via arcus_events_queue)

ALTER TABLE arcus_agents
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
CREATE INDEX IF NOT EXISTS idx_arcus_agents_trigger_type
  ON arcus_agents (trigger_type) WHERE trigger_type <> 'schedule';

ALTER TABLE arcus_agent_runs
  ADD COLUMN IF NOT EXISTS trigger_source   TEXT,   -- schedule | event | chain | manual
  ADD COLUMN IF NOT EXISTS triggering_event JSONB,  -- the event/condition match that fired this run
  ADD COLUMN IF NOT EXISTS parent_run_id    UUID,   -- the parent run in a pipeline
  ADD COLUMN IF NOT EXISTS chain_depth      INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS chain_input      JSONB;  -- parent summary/artifacts handed to a chained child
