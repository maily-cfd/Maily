/**
 * Persistent Memory — typed layer (super-agent Part 1.5).
 *
 * The moat: after every run the agent writes back what it learned; before every
 * run it loads relevant memory so it NEVER starts from zero and NEVER re-asks a
 * known fact. This wraps the existing Supermemory store (lib/boult/memory.ts +
 * boult_memories) with four typed categories so recall is precise:
 *   fact        — durable truths ("Sarah Chen = priority VC, replies within 4h")
 *   decision    — a call made + its outcome ("Declined recruiter X — user approved")
 *   correction  — user edited the agent ("made my draft more direct → be more direct")
 *   open_loop   — a soft note carried forward (hard deadlines go in the Ledger)
 *
 * The structured spine (user model, ledger) lives in its own tables; this is the
 * semantic, free-text recall layer.
 */
import { saveMemory, searchMemories, searchMemoriesRaw } from '../memory';

export type MemoryKind = 'fact' | 'decision' | 'correction' | 'open_loop';

const TAG = 'super';

function tagsFor(kind: MemoryKind, agentName?: string): string[] {
  const t = [TAG, kind];
  if (agentName) t.push(`agent:${agentName.toLowerCase().slice(0, 40)}`);
  return t;
}

/** Save a durable fact the agent learned. */
export function saveFact(userId: string, fact: string, agentName?: string): Promise<void> {
  return saveMemory(userId, `[FACT] ${fact}`.slice(0, 2000), tagsFor('fact', agentName), 'agent_run');
}

/** Save a decision + its outcome so the agent can pattern-match next time. */
export function saveDecision(userId: string, decision: string, outcome?: string, agentName?: string): Promise<void> {
  const body = outcome ? `[DECISION] ${decision} → ${outcome}` : `[DECISION] ${decision}`;
  return saveMemory(userId, body.slice(0, 2000), tagsFor('decision', agentName), 'agent_run');
}

/** Save a correction the user made — the most valuable signal (it sharpens voice/judgment). */
export function saveCorrection(userId: string, correction: string, agentName?: string): Promise<void> {
  return saveMemory(userId, `[CORRECTION] ${correction}`.slice(0, 2000), tagsFor('correction', agentName), 'user');
}

/** Save a soft carry-forward note (hard-deadline commitments go in the Ledger). */
export function saveOpenLoop(userId: string, note: string, agentName?: string): Promise<void> {
  return saveMemory(userId, `[OPEN_LOOP] ${note}`.slice(0, 2000), tagsFor('open_loop', agentName), 'agent_run');
}

/**
 * Load relevant memory for a run as a compact prompt block. Pulls semantic
 * matches for the mission/query plus the agent's own recent history, dedups, and
 * prioritizes corrections > decisions > facts (corrections are the sharpest).
 */
export async function loadRelevantMemory(
  userId: string,
  query: string,
  opts: { agentName?: string; limit?: number } = {},
): Promise<string> {
  const limit = opts.limit ?? 10;
  try {
    const raw = await searchMemoriesRaw(userId, query, Math.max(limit * 2, 16));
    const superItems = raw.filter(r => (r.tags || []).includes(TAG));
    if (!superItems.length) {
      // Fall back to the generic semantic recall so we still aren't blank.
      return searchMemories(userId, query, limit);
    }
    const weight = (tags: string[]) =>
      tags.includes('correction') ? 0 : tags.includes('decision') ? 1 : tags.includes('fact') ? 2 : 3;
    const sorted = superItems
      .sort((a, b) => weight(a.tags || []) - weight(b.tags || []))
      .slice(0, limit)
      .map(r => `- ${r.text}`);
    return sorted.length ? `WHAT I'VE LEARNED (prior runs — don't re-derive):\n${sorted.join('\n')}` : '';
  } catch (e: any) {
    console.warn('[super-memory] load threw:', e?.message);
    try { return await searchMemories(userId, query, limit); } catch { return ''; }
  }
}
