-- ──────────────────────────────────────────────────────────────────────────────
-- Arcus Audit Trail — Feature 5
-- Every tool call is logged here for transparency, debugging, and trust.
-- Run this in the Supabase SQL editor.
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS arcus_audit_log (
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

CREATE INDEX IF NOT EXISTS arcus_audit_user_idx   ON arcus_audit_log (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS arcus_audit_run_idx    ON arcus_audit_log (run_id);
CREATE INDEX IF NOT EXISTS arcus_audit_tool_idx   ON arcus_audit_log (user_id, tool_name);

ALTER TABLE arcus_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own audit logs"
  ON arcus_audit_log FOR ALL
  USING (
    user_id = auth.uid()::text
    OR user_id = (SELECT email FROM auth.users WHERE id = auth.uid())
  );
