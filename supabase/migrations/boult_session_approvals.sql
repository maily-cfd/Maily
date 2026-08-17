-- ──────────────────────────────────────────────────────────────────────────────
-- Arcus Session Approvals — Phase 2 of the reliability overhaul.
-- Persistent state for the confirm-before-write gate. Without this, the LLM
-- could (and did) skip the request_confirmation prompt and call send_email
-- directly because nothing at the executor level checked whether the user had
-- actually approved the action.
--
-- Flow:
--   1. LLM calls request_confirmation → executor inserts a row with status='pending'
--      and returns its id to the UI as part of canvasData.pageMeta.
--   2. User clicks Confirm in the UI → POST /api/arcus/approval/confirm
--      flips status to 'approved'.
--   3. LLM next turn calls send_email / schedule_meeting / send_slack_message /
--      create_notion_page → executor looks up an 'approved' row matching
--      (conversation_id, action_type, target_key), marks it 'consumed', and
--      proceeds. If none found, the call fails with code 'confirmation_required'.
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS arcus_session_approvals (
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

CREATE INDEX IF NOT EXISTS arcus_session_approvals_lookup_idx
  ON arcus_session_approvals (conversation_id, action_type, target_key, status);
CREATE INDEX IF NOT EXISTS arcus_session_approvals_user_idx
  ON arcus_session_approvals (user_id, created_at DESC);

ALTER TABLE arcus_session_approvals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own approvals"
  ON arcus_session_approvals FOR ALL
  USING (
    user_id = auth.uid()::text
    OR user_id = (SELECT email FROM auth.users WHERE id = auth.uid())
  );
