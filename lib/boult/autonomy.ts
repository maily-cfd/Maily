/**
 * Boult Autonomy Infrastructure
 *
 * Pieces that turn an LLM-with-tools into a genuine autonomous worker:
 *
 *   1. WORKLIST       — filter at source. Returns a filtered, deduplicated
 *                       list of items the agent should actually process,
 *                       not the raw inbox.
 *
 *   2. COORDINATION   — shared scratchpad in `boult_agent_scratchpad`.
 *                       Parallel agents read each other's claims so two
 *                       agents don't draft a reply to the same thread.
 *
 *   3. SELF-CORRECTION — generic-filler detector. The agent calls this on
 *                        a draft and gets back a score + the specific
 *                        sentences flagged as generic. It re-drafts if
 *                        the score is too high.
 *
 *   4. LEARNING        — approval/rejection feedback writes structured
 *                        memories under tags ["learning", tool_name] so
 *                        future runs can pattern-match against past
 *                        corrections.
 *
 * All four primitives are designed to be called by the LLM as tools.
 * The route at app/api/boult/agent-approvals fires the learning hook
 * directly server-side when the user clicks Approve/Reject.
 */

import { getSupabaseAdmin } from '../supabase.js';
import { saveMemory, searchMemoriesRaw } from './memory';
import { normalizeUserId } from './user-id';

// ─────────────────────────────────────────────────────────────────────────────
// 1. WORKLIST — filter at source
// ─────────────────────────────────────────────────────────────────────────────

export interface WorklistItem {
  /** Stable id — Gmail thread id, calendar event id, Notion page id. */
  id: string;
  /** What kind of item this is. */
  kind: 'email_thread' | 'calendar_event' | 'notion_page';
  /** Short human-readable label — sender + subject, or event title. */
  label: string;
  /** Priority tier: 1 = client thread, 2 = revenue signal, 3 = scheduling, 4 = other. */
  tier: 1 | 2 | 3 | 4;
  /** Free-text signal — why this matters (revenue keyword, client name match, etc). */
  signal?: string;
}

export interface WorklistOptions {
  /** Items the previous run already processed — skip these unless they have new activity. */
  previouslyProcessedIds: Set<string>;
  /** Items currently claimed by another agent (from coordination scratchpad). */
  claimedByOthers: Set<string>;
}

/**
 * Tier-1 client detection: emails from senders the user has exchanged 3+
 * emails with in the last 90 days. We approximate this by looking at the
 * sender's domain count in memory (search for "[CONTACT_FREQ]" entries).
 * For now this is a heuristic — the LLM can override by reading specific
 * threads. The real value is the budget guard: even a rough Tier-1 filter
 * cuts a 200-email inbox to ~30 items.
 */
// Exported so the trigger condition evaluator (lib/boult/conditions.ts) matches
// the SAME vocabulary the worklist scorer uses — one source of truth.
export const REVENUE_KEYWORDS =
  /\b(contract|invoice|payment|proposal|deal|renewal|pricing|quote|sow|po\b|purchase order|signed|approve|terms)\b/i;
export const SCHEDULING_KEYWORDS =
  /\b(meeting|schedule|book|availability|calendar|invite|sync|call)\b/i;
export const NEWSLETTER_KEYWORDS =
  /\b(unsubscribe|newsletter|digest|weekly roundup|view in browser|click here|special offer|sale ends|view email)\b/i;

/**
 * Score one raw email line into a WorklistItem. Input shape mirrors the
 * `search_gmail` tool output: one item per line, with sender, subject and
 * snippet separated by " — " or " | ".
 *
 * Returns null when the item should be silently dropped (newsletter/promo).
 */
export function scoreEmailLine(
  line: string,
  threadId: string,
  knownClientDomains: Set<string>,
): WorklistItem | null {
  if (NEWSLETTER_KEYWORDS.test(line)) return null;

  const senderMatch = line.match(/from:\s*<?([^\s<>]+@[^\s<>]+)>?/i) ||
                      line.match(/<([^<>]+@[^<>]+)>/) ||
                      line.match(/([\w.+-]+@[\w-]+\.[\w.-]+)/);
  const sender = senderMatch?.[1]?.toLowerCase() || '';
  const domain = sender.split('@')[1] || '';

  let tier: WorklistItem['tier'] = 4;
  let signal = '';

  if (REVENUE_KEYWORDS.test(line)) {
    tier = 2;
    const m = line.match(REVENUE_KEYWORDS);
    if (m) signal = `revenue:${m[0].toLowerCase()}`;
  }
  if (knownClientDomains.has(domain) || (domain && knownClientDomains.has(`*@${domain}`))) {
    tier = 1;
    signal = signal ? `client + ${signal}` : 'client_thread';
  }
  if (tier === 4 && SCHEDULING_KEYWORDS.test(line)) {
    tier = 3;
    const m = line.match(SCHEDULING_KEYWORDS);
    if (m) signal = `scheduling:${m[0].toLowerCase()}`;
  }

  return {
    id: threadId,
    kind: 'email_thread',
    label: line.slice(0, 140),
    tier,
    signal: signal || undefined,
  };
}

/**
 * Sort + dedup a raw scored list. Items the previous run handled get filtered.
 * Items claimed by another concurrently-running agent get filtered.
 * Within remaining items, lower tier wins (1 before 4).
 */
export function buildWorklist(
  scored: WorklistItem[],
  opts: WorklistOptions,
): WorklistItem[] {
  const seen = new Set<string>();
  const out: WorklistItem[] = [];
  for (const item of scored) {
    if (seen.has(item.id)) continue;
    if (opts.previouslyProcessedIds.has(item.id)) continue;
    if (opts.claimedByOthers.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  out.sort((a, b) => a.tier - b.tier);
  return out;
}

/**
 * Parse a previous run's memory record into the set of ids it processed.
 * The record format we save (in run-agent.ts) doesn't include item ids today —
 * agents write the ids via `agent_record_processed` (below). This helper
 * pulls the most recent processed-ids record for the given agent.
 */
export async function loadPreviouslyProcessedIds(
  userId: string,
  agentName: string,
): Promise<Set<string>> {
  try {
    const items = await searchMemoriesRaw(
      userId,
      `[PROCESSED_IDS] ${agentName}`,
      4,
    );
    const ids = new Set<string>();
    for (const item of items) {
      // Format: "[PROCESSED_IDS] <agentName> | <iso> | id1,id2,id3"
      const parts = item.text.split('|');
      const idsCsv = parts[parts.length - 1] || '';
      for (const raw of idsCsv.split(',')) {
        const id = raw.trim();
        if (id) ids.add(id);
      }
    }
    return ids;
  } catch {
    return new Set();
  }
}

/**
 * Persist this run's processed ids so the next run can dedup.
 * Fire-and-forget; never blocks the agent.
 */
export async function recordProcessedIds(
  userId: string,
  agentName: string,
  ids: string[],
): Promise<void> {
  if (!ids.length) return;
  const content = `[PROCESSED_IDS] ${agentName} | ${new Date().toISOString()} | ${ids.slice(0, 100).join(',')}`;
  await saveMemory(userId, content, ['agent_run', 'processed_ids', agentName]);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. COORDINATION — shared scratchpad
// ─────────────────────────────────────────────────────────────────────────────
//
// Backed by a JSONB row per (user_id, agent_id) in `boult_agent_scratchpad`.
// If the table is missing, every helper here fails open — coordination is a
// nice-to-have, never a blocker. The migration that creates it ships in
// supabase/migrations/boult_agent_scratchpad.sql alongside this file.

interface ScratchpadClaim {
  agentId: string;
  agentName: string;
  itemIds: string[];
  claimedAt: string; // iso
  expiresAt: string; // iso — stale claims older than 10 min are ignored
}

const CLAIM_TTL_MIN = 10;

export async function readActiveClaims(
  userId: string,
  excludeAgentId?: string,
): Promise<Set<string>> {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('boult_agent_scratchpad')
      .select('agent_id, agent_name, claims')
      .eq('user_id', normalizeUserId(userId));
    if (error) return new Set();

    const now = Date.now();
    const claimed = new Set<string>();
    for (const row of data || []) {
      if (excludeAgentId && row.agent_id === excludeAgentId) continue;
      const claims: ScratchpadClaim[] = Array.isArray(row.claims) ? row.claims : [];
      for (const claim of claims) {
        if (new Date(claim.expiresAt).getTime() < now) continue;
        for (const id of claim.itemIds) claimed.add(id);
      }
    }
    return claimed;
  } catch {
    return new Set();
  }
}

export async function writeClaim(
  userId: string,
  agentId: string,
  agentName: string,
  itemIds: string[],
): Promise<void> {
  if (!itemIds.length) return;
  try {
    const supabase = getSupabaseAdmin();
    const claim: ScratchpadClaim = {
      agentId,
      agentName,
      itemIds: itemIds.slice(0, 200),
      claimedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + CLAIM_TTL_MIN * 60_000).toISOString(),
    };
    await supabase
      .from('boult_agent_scratchpad')
      .upsert(
        {
          user_id: normalizeUserId(userId),
          agent_id: agentId,
          agent_name: agentName,
          claims: [claim],
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,agent_id' },
      );
  } catch {
    // Coordination is best-effort. The agent still works without it; the
    // worst case is two agents both touch a thread in the same 10-min window.
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. SELF-CORRECTION — generic-filler detector
// ─────────────────────────────────────────────────────────────────────────────

const GENERIC_PHRASES: Array<{ re: RegExp; weight: number; reason: string }> = [
  { re: /\bI hope this (email )?finds you well\b/i,                weight: 25, reason: 'opens with hope-this-finds-you' },
  { re: /\bplease (let me know|do not hesitate to (let me know|reach out|contact me))\b/i, weight: 20, reason: 'closes with let-me-know-if' },
  { re: /\b(I am|I'?m) reaching out (to you )?(today )?(to|about|regarding)\b/i, weight: 15, reason: 'self-narrating opener' },
  { re: /\bthank you for (reaching out|your (email|message))\b/i, weight: 10, reason: 'thank-you-for-reaching-out (only OK on first contact)' },
  { re: /\b(looking forward to (hearing|your reply)|awaiting your response)\b/i, weight: 15, reason: 'looking-forward filler' },
  { re: /\b(it (was|is) (great|nice|a pleasure) to)\b/i,           weight: 10, reason: 'platitude opener' },
  { re: /\b(as discussed|as mentioned|as per (our|your))\b/i,      weight: 8,  reason: 'as-discussed (often vague)' },
  { re: /\b(circling back|touching base|just following up|wanted to (check in|follow up))\b/i, weight: 12, reason: 'business-speak filler' },
  { re: /\b(I would (like|love) to (take this opportunity|extend my))/i, weight: 18, reason: 'opportunity-filler' },
  { re: /\bsynerg(y|ies)\b/i,                                       weight: 25, reason: 'corporate jargon' },
  { re: /\b(at your earliest convenience|whenever you (have a moment|are free))\b/i, weight: 12, reason: 'over-formal closer' },
];

export interface FillerScore {
  /** 0–100 where 100 means the entire draft is generic filler. */
  score: number;
  /** Phrases that contributed to the score. */
  flagged: Array<{ phrase: string; reason: string }>;
  /** True if a re-draft is recommended (score >= 35). */
  shouldRedraft: boolean;
}

export function detectGenericFiller(draftBody: string): FillerScore {
  if (!draftBody || draftBody.trim().length < 20) {
    return { score: 0, flagged: [], shouldRedraft: false };
  }
  const flagged: Array<{ phrase: string; reason: string }> = [];
  let raw = 0;
  for (const { re, weight, reason } of GENERIC_PHRASES) {
    const m = draftBody.match(re);
    if (m) {
      raw += weight;
      flagged.push({ phrase: m[0], reason });
    }
  }
  // Normalize against draft length so a 50-word email with one platitude
  // scores higher than a 500-word email with the same platitude.
  const wordCount = draftBody.split(/\s+/).filter(Boolean).length;
  const lengthFactor = wordCount > 0 ? Math.min(1.5, 80 / wordCount) : 1;
  const score = Math.min(100, Math.round(raw * lengthFactor));
  return {
    score,
    flagged,
    shouldRedraft: score >= 35,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. LEARNING — approval/rejection feedback
// ─────────────────────────────────────────────────────────────────────────────

export interface LearningEvent {
  userId: string;
  agentId?: string;
  agentName?: string;
  toolName: string;
  toolInput: Record<string, any>;
  decision: 'approved' | 'rejected';
}

/**
 * Save a learning memory when the user approves or rejects an agent action.
 * The memory format is tagged so the next agent run can search for prior
 * rejections of similar actions and adjust before executing.
 *
 * Example outcomes:
 *   approve → "[LEARNING:approved] send_email to alex@bigco — user accepted Q3 follow-up draft"
 *   reject  → "[LEARNING:rejected] send_email to alex@bigco — user rejected; re-draft with more specifics next time"
 */
export async function recordLearningEvent(event: LearningEvent): Promise<void> {
  try {
    const target = describeToolTarget(event.toolName, event.toolInput);
    const tag = event.decision === 'approved' ? 'approved' : 'rejected';
    const guidance =
      event.decision === 'approved'
        ? 'Pattern accepted — repeat for similar targets.'
        : 'Pattern rejected — do not repeat the same action on the same target without re-checking with the user.';

    const content = [
      `[LEARNING:${tag}]`,
      event.toolName,
      target ? `→ ${target}` : '',
      event.agentName ? `(agent: ${event.agentName})` : '',
      '·',
      guidance,
    ]
      .filter(Boolean)
      .join(' ');

    await saveMemory(event.userId, content, [
      'learning',
      tag,
      event.toolName,
      ...(event.agentName ? [event.agentName] : []),
    ]);
  } catch {
    // Learning is best-effort; never blocks the approval API.
  }
}

function describeToolTarget(toolName: string, input: Record<string, any>): string {
  switch (toolName) {
    case 'send_email':
      return [input.to, input.subject].filter(Boolean).join(' — ');
    case 'schedule_meeting':
      return [input.title || input.summary, input.startTime || input.start].filter(Boolean).join(' @ ');
    case 'create_notion_page':
      return [input.title, input.databaseHint].filter(Boolean).join(' in ');
    case 'send_slack_message':
    case 'slack_send_dm':
      return [input.channel || input.user, (input.text || '').slice(0, 60)].filter(Boolean).join(' — ');
    case 'calendar_cancel_event':
      return input.eventId || '';
    default:
      return '';
  }
}
