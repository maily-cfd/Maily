-- Arcus agent coordination scratchpad
--
-- Holds short-lived "I'm working on these items" claims so multiple
-- background agents owned by the same user don't duplicate each other's
-- work in the same tick. One row per (user_id, agent_id); claims live in
-- a JSONB array with per-claim expiresAt (TTL ~10 minutes).
--
-- All access happens via lib/arcus/autonomy.ts. The agent runner reads
-- claims via readActiveClaims() before scoring its worklist, then writes
-- its own claims via writeClaim() before processing.

CREATE TABLE IF NOT EXISTS arcus_agent_scratchpad (
  user_id      text NOT NULL,
  agent_id     uuid NOT NULL,
  agent_name   text,
  claims       jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_arcus_agent_scratchpad_user
  ON arcus_agent_scratchpad (user_id, updated_at DESC);

-- We rely on application-level TTL filtering inside autonomy.ts rather than
-- a scheduled cleanup; rows are small and overwritten on every agent run,
-- so accumulating stale rows isn't a real concern.
