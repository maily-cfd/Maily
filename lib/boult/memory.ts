/**
 * Boult Memory — Supermemory v3 client.
 *
 * Stores and retrieves structured memories: relationship context,
 * user preferences, behavioral patterns, and conversation history.
 *
 * Memory types stored:
 *   [RELATIONSHIP] — client status, relationship weight, contact context
 *   [PREFERENCE]   — how the user likes things done
 *   [CONTEXT]      — general conversation history
 *
 * Never throws — memory failure must never break the conversation.
 */

import { normalizeUserId } from './user-id';

const BASE = 'https://api.supermemory.ai/v3';

function getKey(): string | null {
  return process.env.SUPERMEMORY_API_KEY || process.env.DATAFAST_API_KEY || null;
}

/**
 * Check if memory is enabled for a user via their preferences in Supabase.
 * Returns true by default (memory enabled unless explicitly disabled).
 * Never throws.
 */
export async function isMemoryEnabled(userId: string): Promise<boolean> {
  try {
    const { getSupabaseAdmin } = await import('../supabase.js');
    const supabase = getSupabaseAdmin();
    const { data } = await supabase
      .from('user_profiles')
      .select('preferences')
      .ilike('user_id', userId)
      .maybeSingle();

    const prefs = (data?.preferences as Record<string, unknown>) || {};
    return prefs.boult_memory_enabled !== false;
  } catch {
    return true; // default enabled — never break conversation
  }
}

// ── Core API ───────────────────────────────────────────────────────────────────

/**
 * Store a single memory entry. Dual-writes to:
 *   1. boult_memories Supabase table — the durable source of truth the
 *      settings UI reads, edits, and deletes from. Always written when
 *      Supabase is reachable.
 *   2. Supermemory — secondary semantic-search index. Best-effort; if
 *      SUPERMEMORY_API_KEY is missing this is silently skipped.
 *
 * source: 'user' (the user said "remember X" or added via UI),
 *         'ai' (the LLM extracted a worth-keeping fact during chat),
 *         'agent_run' (background-agent run record).
 */
export async function saveMemory(
  userId: string,
  content: string,
  tags?: string[],
  source: 'user' | 'ai' | 'agent_run' = 'ai',
): Promise<void> {
  if (!content?.trim()) return;
  const trimmed = content.slice(0, 2000);

  // F7.1 — Respect the per-user memory toggle. Previously saveMemory wrote
  // unconditionally, bypassing the user's opt-out in the settings card.
  // Manual user-added memories ('user' source) still go through — that's
  // an explicit "remember this" action the user took. Auto-extracted
  // memories ('ai' / 'agent_run') are silently skipped when the toggle
  // is off, matching how the older extractAndSaveInsights paths behaved.
  if (source !== 'user') {
    try {
      const enabled = await isMemoryEnabled(userId);
      if (!enabled) return;
    } catch {
      // If we can't determine the toggle state, fail open and write.
    }
  }

  // 1. Supabase (the durable store) — always run when possible.
  try {
    const { getSupabaseAdmin } = await import('../supabase.js');
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from('boult_memories').insert({
      user_id: normalizeUserId(userId),
      content: trimmed,
      tags: tags ?? [],
      source,
    });
    if (error) {
      // F5 — surface previously silent failures so users can see "memory not
      // configured" in logs (and we can wire a settings-card banner later).
      const { reportError } = await import('./error-reporter');
      reportError('memory.save', error, { userId, source });
    }
  } catch (err) {
    const { reportError } = await import('./error-reporter');
    reportError('memory.save.exception', err, { userId, source });
  }

  // 2. Supermemory (secondary index) — only when configured.
  const key = getKey();
  if (!key) return;
  try {
    await fetch(`${BASE}/memories`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content: trimmed,
        metadata: { userId, tags: tags ?? [], source },
      }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Silent — never break the conversation
  }
}

export interface RawMemoryItem {
  id?: string;
  text: string;
  score?: number;
  timestamp?: string;
  tags?: string[];
}

/**
 * Raw memory search — returns the underlying Supermemory items unchanged
 * (truncated for safety). Used by the `memory_search` tool when the LLM
 * needs to read individual entries rather than the prompt-injection summary.
 * Never throws; returns [] on any error.
 */
export async function searchMemoriesRaw(userId: string, query: string, limit = 8): Promise<RawMemoryItem[]> {
  // 1. Supabase (always tried first — source of truth).
  const supabaseItems: RawMemoryItem[] = [];
  try {
    const { getSupabaseAdmin } = await import('../supabase.js');
    const supabase = getSupabaseAdmin();
    const q = (query || '').trim();
    let req = supabase
      .from('boult_memories')
      .select('id, content, tags, created_at')
      .eq('user_id', normalizeUserId(userId))
      .order('created_at', { ascending: false })
      .limit(limit * 2);
    // If a real query was provided, ILIKE-filter on content. Empty query
    // returns most-recent memories (used for "load all" cases).
    if (q && q !== '*') {
      // Use textual contains as a basic filter — semantic match comes from Supermemory.
      req = req.ilike('content', `%${q.slice(0, 80)}%`);
    }
    const { data } = await req;
    for (const row of (data || []) as any[]) {
      supabaseItems.push({
        id: row.id,
        text: String(row.content || '').slice(0, 600),
        timestamp: row.created_at,
        tags: Array.isArray(row.tags) ? row.tags : undefined,
      });
    }
  } catch {
    // Table may not exist yet (migration not applied) — fall through silently.
  }

  // 2. Supermemory (semantic recall) — only when configured. Merge results
  //    de-duplicating by text.
  const key = getKey();
  if (key) {
    try {
      let results: any[] = [];
      const postRes = await fetch(`${BASE}/memories/search`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: query, limit, filters: { userId } }),
        signal: AbortSignal.timeout(5000),
      });
      if (postRes.ok) {
        const data = await postRes.json();
        results = data.results ?? data.memories ?? data.data ?? [];
      } else {
        const params = new URLSearchParams({ q: query, limit: String(limit), userId });
        const getRes = await fetch(`${BASE}/search?${params}`, {
          headers: { Authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(5000),
        });
        if (getRes.ok) {
          const data = await getRes.json();
          results = data.results ?? data.memories ?? data.data ?? [];
        }
      }
      const seen = new Set(supabaseItems.map(i => i.text));
      for (const r of results) {
        const text = String(r.content ?? r.text ?? r.memory ?? '').slice(0, 600);
        if (!text || seen.has(text)) continue;
        seen.add(text);
        supabaseItems.push({
          text,
          score: typeof r.score === 'number' ? r.score : undefined,
          timestamp: r.created_at ?? r.timestamp ?? undefined,
          tags: Array.isArray(r.metadata?.tags) ? r.metadata.tags : undefined,
        });
      }
    } catch { /* silent */ }
  }

  return supabaseItems.filter(m => m.text).slice(0, limit);
}

/**
 * Search memories relevant to the current user message.
 * Returns a formatted context string to inject into the system prompt.
 * Delegates to searchMemoriesRaw so Supabase-backed memories always work
 * even when Supermemory is unconfigured.
 */
export async function searchMemories(userId: string, query: string, limit = 6): Promise<string> {
  try {
    const items = await searchMemoriesRaw(userId, query, limit);
    if (!items.length) return '';

    // Bucket by tag prefix for structured prompt injection.
    const relationships: string[] = [];
    const preferences: string[] = [];
    const context: string[] = [];
    for (const item of items) {
      const text = item.text.slice(0, 350);
      if (!text) continue;
      if (text.startsWith('[RELATIONSHIP]')) relationships.push(text.replace('[RELATIONSHIP]', '').trim());
      else if (text.startsWith('[PREFERENCE]')) preferences.push(text.replace('[PREFERENCE]', '').trim());
      else context.push(text);
    }

    const sections: string[] = [];
    if (relationships.length) {
      sections.push(`**Relationship context (apply to prioritization and tone):**\n${relationships.map(r => `• ${r}`).join('\n')}`);
    }
    if (preferences.length) {
      sections.push(`**User preferences (apply without being told):**\n${preferences.map(p => `• ${p}`).join('\n')}`);
    }
    if (context.length) {
      sections.push(`**Past context:**\n${context.map(c => `• ${c}`).join('\n')}`);
    }

    return sections.length ? `\n\n## Memory context\n${sections.join('\n\n')}` : '';
  } catch {
    return '';
  }
}

// ── Insight extraction ─────────────────────────────────────────────────────────

// Patterns that signal relationship importance
const CLIENT_PATTERNS = [
  /\b(?:(\w[\w\s]{1,30}?)\s+is\s+(?:our\s+)?(?:biggest|top|main|key|major|important|priority|vip|most\s+important)\s+(?:client|customer|account|partner|contact))/i,
  /\b(?:biggest|top|main|key|major|vip|most\s+important)\s+(?:client|customer|account|partner)(?:[,\s]+(?:is\s+)?(\w[\w\s]{1,30}?))?/i,
  /\b(\w[\w\s]{1,30}?)\s+(?:is|are)\s+(?:a\s+)?(?:high[- ]value|strategic|enterprise|key)\s+(?:client|account|partner|customer)/i,
  /\b(invest(?:or)?|board\s+member|advisor|co[\s-]?founder|ceo|cto|vp)\s+(?:named?\s+)?(\w[\w\s]{1,20}?)\b/i,
];

// Patterns that signal user preferences
const PREFERENCE_PATTERNS = [
  { re: /\bI\s+prefer\s+(.{5,80}?)(?:\.|,|$)/i, label: (m: RegExpMatchArray) => m[1].trim() },
  { re: /\balways\s+(cc|bcc|include|add)\s+(.{3,50}?)(?:\.|,|$)/i, label: (m: RegExpMatchArray) => `Always ${m[1]} ${m[2]}`.trim() },
  { re: /\bnever\s+schedule\s+(.{5,60}?)(?:\.|,|$)/i, label: (m: RegExpMatchArray) => `Never schedule ${m[1]}`.trim() },
  { re: /\bdon'?t\s+(?:send|schedule|use|add)\s+(.{5,60}?)(?:\.|,|$)/i, label: (m: RegExpMatchArray) => `Don't ${m[1]}`.trim() },
  { re: /\bremember\s+(?:that\s+)?(?:I\s+)?(?:prefer|like|want|need)\s+(.{5,80}?)(?:\.|,|$)/i, label: (m: RegExpMatchArray) => m[1].trim() },
  { re: /\bI\s+(?:like|want|need)\s+(.{5,60}?)\s+(?:in\s+my\s+emails?|when\s+(?:replying|writing|drafting))/i, label: (m: RegExpMatchArray) => `Prefer: ${m[1]}`.trim() },
];

/**
 * Extracts high-signal insights from a conversation turn and saves them as
 * structured memories. Called fire-and-forget after each exchange.
 */
export async function extractAndSaveInsights(
  userId: string,
  userMessage: string,
  assistantReply: string,
): Promise<void> {
  // Check if memory is enabled for this user
  const enabled = await isMemoryEnabled(userId);
  if (!enabled) return;

  const combined = `${userMessage} ${assistantReply}`;
  const saves: Promise<void>[] = [];

  // ── Relationship memories ──────────────────────────────────────────────────
  for (const pattern of CLIENT_PATTERNS) {
    const match = combined.match(pattern);
    if (match) {
      // Extract the name: try capture group 1 or 2
      const name = (match[1] || match[2] || '').trim();
      if (name && name.length > 1 && name.length < 40) {
        saves.push(saveMemory(
          userId,
          `[RELATIONSHIP] ${name} is a high-value client/contact — treat their emails as urgent and prioritize their threads.`,
          ['relationship', 'client'],
        ));
      }
      break; // one relationship memory per turn is enough
    }
  }

  // ── Preference memories ────────────────────────────────────────────────────
  for (const { re, label } of PREFERENCE_PATTERNS) {
    const match = userMessage.match(re); // only from user, not assistant
    if (match) {
      const pref = label(match);
      if (pref && pref.length > 4 && pref.length < 120) {
        saves.push(saveMemory(
          userId,
          `[PREFERENCE] ${pref}`,
          ['preference'],
        ));
      }
    }
  }

  // ── General context ────────────────────────────────────────────────────────
  // Save a compressed summary of the exchange (trimmed to stay useful)
  if (userMessage.trim().length > 10 && assistantReply.trim().length > 10) {
    const summary = `[CONTEXT] User asked: "${userMessage.slice(0, 200).trim()}" — Boult replied: "${assistantReply.slice(0, 200).trim()}"`;
    saves.push(saveMemory(userId, summary, ['context']));
  }

  await Promise.allSettled(saves);
}

/**
 * Lightweight backwards-compat wrapper. Saves a raw conversation turn as context.
 */
export async function saveConversationTurn(
  userId: string,
  userMessage: string,
  assistantReply: string,
): Promise<void> {
  await extractAndSaveInsights(userId, userMessage, assistantReply);
}

/**
 * Extracts insights from raw email content automatically when Boult reads emails.
 */
export async function extractAndSaveEmailInsights(
  userId: string,
  emailText: string,
): Promise<void> {
  // Check if memory is enabled
  const enabled = await isMemoryEnabled(userId);
  if (!enabled || !emailText) return;

  const saves: Promise<void>[] = [];
  
  // ── Relationship memories from emails ────────────────────────────────────────
  for (const pattern of CLIENT_PATTERNS) {
    const match = emailText.match(pattern);
    if (match) {
      const name = (match[1] || match[2] || '').trim();
      if (name && name.length > 1 && name.length < 40) {
        saves.push(saveMemory(
          userId,
          `[RELATIONSHIP] ${name} is a high-value client/contact (extracted from email context) — prioritize their threads.`,
          ['relationship', 'client', 'auto-extracted'],
        ));
      }
      break; 
    }
  }

  // ── Preference memories from emails ──────────────────────────────────────────
  for (const { re, label } of PREFERENCE_PATTERNS) {
    const match = emailText.match(re);
    if (match) {
      const pref = label(match);
      if (pref && pref.length > 4 && pref.length < 120) {
        saves.push(saveMemory(
          userId,
          `[PREFERENCE] ${pref} (extracted from email)`,
          ['preference', 'auto-extracted'],
        ));
      }
    }
  }

  await Promise.allSettled(saves);
}
