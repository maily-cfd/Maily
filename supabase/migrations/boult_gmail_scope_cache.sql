-- ──────────────────────────────────────────────────────────────────────────────
-- Arcus Gmail scope cache — adds a TTL'd "we last checked, scopes were fine"
-- timestamp per arcus_integrations row. Used by the preflight check in
-- /api/arcus/chat so we surface a "reconnect Gmail" card BEFORE the LLM tries
-- to call a Gmail tool and hits 403 mid-task.
--
-- When the chat route runs:
--   * scope_ok_until > now()   → skip preflight, run the loop
--   * scope_ok_until <= now()  → ping /gmail/v1/users/me/profile:
--       200 → set scope_ok_until = now() + 1 hour
--       403 → set scope_ok_until = NULL, emit connector_required, skip loop
--   * scope_ok_until IS NULL   → same as stale; means a previous 403 invalidated
--
-- The loop also invalidates this on any in-flight 403 so the next turn re-checks.
-- ──────────────────────────────────────────────────────────────────────────────

ALTER TABLE arcus_integrations
  ADD COLUMN IF NOT EXISTS scope_ok_until TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS arcus_integrations_scope_idx
  ON arcus_integrations (user_id, provider, scope_ok_until);
