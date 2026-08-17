
-- ──────────────────────────────────────────────────────────────────────────────
-- Arcus: Scheduled email send
-- Run this in the Supabase SQL editor.
--
-- Backs the schedule_email_send tool + the cron dispatcher (drainScheduledEmails).
-- A row is a single email to dispatch at-or-after send_at. The dispatcher claims
-- due rows atomically (status pending → sending) so concurrent cron ticks never
-- double-send, retries transient failures up to a cap, then marks sent/failed.
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS arcus_scheduled_emails (
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
CREATE INDEX IF NOT EXISTS arcus_sched_due_idx
  ON arcus_scheduled_emails (status, send_at);
CREATE INDEX IF NOT EXISTS arcus_sched_user_idx
  ON arcus_scheduled_emails (user_id, status);

-- Idempotency: a (user_id, dedup_key) is scheduled at most once.
CREATE UNIQUE INDEX IF NOT EXISTS arcus_sched_dedup_idx
  ON arcus_scheduled_emails (user_id, dedup_key)
  WHERE dedup_key IS NOT NULL;

ALTER TABLE arcus_scheduled_emails ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users manage own scheduled emails"
    ON arcus_scheduled_emails FOR ALL
    USING (user_id = auth.uid()::text OR user_id = (SELECT email FROM auth.users WHERE id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;