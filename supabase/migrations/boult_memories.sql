-- Arcus memory table — the durable native store for things the AI learns
-- about the user and explicit "remember this" facts.
--
-- This is the SOURCE OF TRUTH for the per-user memory list shown in the
-- Arcus AI settings card. Supermemory (when configured) is a secondary
-- semantic-search index; this table is what the user reads, edits, and
-- deletes. If Supermemory is unconfigured, the AI still works — it just
-- can't do fuzzy semantic recall, only exact / tag-based lookup.
--
-- Access pattern:
--   - The chat route reads recent memories at the start of each turn
--     (search by tag + recency, ranked by created_at DESC, limit ~50).
--   - The memory_save tool writes here in-band when the user says
--     "remember X" or when the LLM extracts a worth-keeping fact.
--   - The /api/agent-talk/memory routes list/edit/delete from here.

CREATE TABLE IF NOT EXISTS arcus_memories (
  id          uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id     text NOT NULL,
  content     text NOT NULL,
  tags        text[] NOT NULL DEFAULT ARRAY[]::text[],
  source      text DEFAULT 'user',  -- 'user' (manual add via UI), 'ai' (auto-extracted), 'agent_run' (background)
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_arcus_memories_user
  ON arcus_memories (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_arcus_memories_user_tags
  ON arcus_memories USING GIN (tags);
