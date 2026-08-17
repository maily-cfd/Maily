-- ──────────────────────────────────────────────────────────────────────────────
-- Home-feed deep infra: durable dismissals + server-side Today cache
-- Run this in the Supabase SQL editor.
-- ──────────────────────────────────────────────────────────────────────────────

-- 1. Dismissed Today items — server-side so a swipe-to-dismiss survives reloads
--    and syncs across devices (was localStorage-only). The Today route filters
--    these out, so a dismissed item never comes back from the API.
CREATE TABLE IF NOT EXISTS arcus_today_dismissals (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      TEXT NOT NULL,
  item_id      TEXT NOT NULL,            -- Gmail message id / event id / action item id
  item_type    TEXT,                     -- decide | chase | showUp | actionItem
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, item_id)
);
CREATE INDEX IF NOT EXISTS arcus_today_dismissals_user_idx
  ON arcus_today_dismissals (user_id, created_at DESC);

-- 2. Today snapshot cache — the expensive Gmail/Calendar build is stored per user
--    so reloads and cross-device opens are a fast DB read instead of a ~7s fetch.
--    Served fresh within a TTL; recomputed on miss (or by the cron prewarm).
CREATE TABLE IF NOT EXISTS arcus_today_cache (
  user_id      TEXT PRIMARY KEY,
  payload      JSONB NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE arcus_today_dismissals ENABLE ROW LEVEL SECURITY;
ALTER TABLE arcus_today_cache      ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "own today dismissals" ON arcus_today_dismissals FOR ALL
    USING (user_id = auth.uid()::text OR user_id = (SELECT email FROM auth.users WHERE id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "own today cache" ON arcus_today_cache FOR ALL
    USING (user_id = auth.uid()::text OR user_id = (SELECT email FROM auth.users WHERE id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
