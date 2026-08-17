-- ──────────────────────────────────────────────────────────────────────────────
-- Arcus: Relationship Memory + Delegation Rules
-- Run this in the Supabase SQL editor.
-- ──────────────────────────────────────────────────────────────────────────────

-- Feature 4: Relationship Memory
-- Tracks every person the user emails. Auto-populated on send/draft;
-- enriched manually via remember_about_contact tool.
CREATE TABLE IF NOT EXISTS arcus_contacts (
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

CREATE INDEX IF NOT EXISTS arcus_contacts_user_idx ON arcus_contacts (user_id);
CREATE INDEX IF NOT EXISTS arcus_contacts_email_idx ON arcus_contacts (user_id, contact_email);

-- Row Level Security
ALTER TABLE arcus_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own contacts"
  ON arcus_contacts FOR ALL
  USING (user_id = auth.uid()::text OR user_id = (SELECT email FROM auth.users WHERE id = auth.uid()));

-- Feature 6: Delegation Rules
-- Standing instructions Arcus applies automatically during proactive triage.
-- e.g. "whenever someone asks for a meeting time, propose 3 slots automatically"
CREATE TABLE IF NOT EXISTS arcus_delegation_rules (
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

CREATE INDEX IF NOT EXISTS arcus_rules_user_idx ON arcus_delegation_rules (user_id, is_active);

ALTER TABLE arcus_delegation_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own rules"
  ON arcus_delegation_rules FOR ALL
  USING (user_id = auth.uid()::text OR user_id = (SELECT email FROM auth.users WHERE id = auth.uid()));

-- Triage log — tracks what Arcus surfaced in each proactive scan
-- (optional, useful for analytics and avoiding duplicate alerts)
CREATE TABLE IF NOT EXISTS arcus_triage_log (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     TEXT        NOT NULL,
  thread_id   TEXT,
  reason      TEXT,          -- 'urgent', 'followup', 'delegation_match'
  rule_name   TEXT,
  surfaced_at TIMESTAMPTZ DEFAULT NOW(),
  actioned    BOOLEAN     DEFAULT false
);

CREATE INDEX IF NOT EXISTS arcus_triage_log_user_idx ON arcus_triage_log (user_id, surfaced_at DESC);
