-- Arcus User Mental Model — the persistent, evolving understanding of WHO the
-- user is, so every agent decision is grounded in business context, not just
-- isolated rules. One row per user. The agent reads it before judgment calls
-- and updates it (via the update_user_model tool) as it learns.
--
-- This is the structural backbone of "thinking like the user's business brain":
-- relationship tiers, decision style, work patterns, and what's strategic vs.
-- routine — held as durable structure rather than scattered memory fragments.

CREATE TABLE IF NOT EXISTS arcus_user_model (
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

ALTER TABLE arcus_user_model ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'arcus_user_model'
      AND policyname = 'Service role full access'
  ) THEN
    CREATE POLICY "Service role full access" ON arcus_user_model
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
