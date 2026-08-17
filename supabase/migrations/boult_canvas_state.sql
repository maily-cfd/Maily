-- ──────────────────────────────────────────────────────────────────────────────
-- Arcus Canvas State — per-conversation last-known canvas content so
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

CREATE TABLE IF NOT EXISTS arcus_canvas_state (
  conversation_id TEXT        PRIMARY KEY,
  user_id         TEXT        NOT NULL,
  title           TEXT,
  -- 'email_draft' | 'report' | 'notes' | 'analysis' | 'action_plan'
  type            TEXT,
  markdown        TEXT        NOT NULL DEFAULT '',
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS arcus_canvas_state_user_idx
  ON arcus_canvas_state (user_id, updated_at DESC);

ALTER TABLE arcus_canvas_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own canvas state"
  ON arcus_canvas_state FOR ALL
  USING (
    user_id = auth.uid()::text
    OR user_id = (SELECT email FROM auth.users WHERE id = auth.uid())
  );
