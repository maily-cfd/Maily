-- ──────────────────────────────────────────────────────────────────────────────
-- Arcus: Gmail real-time push (Pub/Sub watch) state
-- Run this in the Supabase SQL editor.
--
-- Reuses the existing channel_id / channel_token / channel_expiry columns on
-- arcus_integrations (added for GCal). Gmail also needs a history pointer so the
-- webhook can fetch only the messages added since the last notification.
-- ──────────────────────────────────────────────────────────────────────────────

ALTER TABLE arcus_integrations
  ADD COLUMN IF NOT EXISTS gmail_history_id TEXT;
