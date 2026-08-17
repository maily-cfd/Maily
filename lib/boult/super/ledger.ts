/**
 * The Follow-Through Ledger (super-agent Part 1.6) — kills dropped balls.
 *
 * A persistent store of open commitments ("send Acme the deck Friday", "chase
 * Sarah if no reply by Tue"). Every run checks it FIRST: what's due, overdue,
 * still open. Items close only when actually done. This is how the agent never
 * forgets across runs.
 *
 * Backed by boult_ledger (see supabase/migrations/boult_super_agent_v1.sql).
 * All functions fail soft (log + return empty/false) so the ledger can never
 * crash a run.
 */
// @ts-ignore - JS module
import { getSupabaseAdmin } from '../../supabase.js';
import { normalizeUserId } from '../user-id';

export type LedgerStatus = 'open' | 'in_progress' | 'done' | 'cancelled';

export interface LedgerEntry {
  id: string;
  user_id: string;
  agent_id: string | null;
  what: string;
  who: string | null;
  due: string | null;       // ISO
  status: LedgerStatus;
  origin_run_id: string | null;
  closed_run_id: string | null;
  thread_id: string | null;
  detail: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface AddCommitmentInput {
  userId: string;
  agentId?: string | null;
  what: string;
  who?: string | null;
  due?: string | null;          // ISO or null
  originRunId?: string | null;
  threadId?: string | null;
  detail?: Record<string, any>;
}

/**
 * Add a commitment. Idempotent on (user, what, thread) for open items — re-adding
 * the same promise won't create duplicates (a real EA tracks one, not five).
 */
export async function addCommitment(input: AddCommitmentInput): Promise<LedgerEntry | null> {
  const what = (input.what || '').trim();
  if (!what) return null;
  const userId = normalizeUserId(input.userId);
  try {
    const supabase = getSupabaseAdmin();

    // Dedup: an existing OPEN/in-progress item with the same what (+ thread when
    // present) is the same ball — return it instead of duplicating.
    let dq = supabase
      .from('boult_ledger')
      .select('*')
      .eq('user_id', userId)
      .in('status', ['open', 'in_progress'])
      .ilike('what', what);
    if (input.threadId) dq = dq.eq('thread_id', input.threadId);
    const { data: existing } = await dq.maybeSingle();
    if (existing) return existing as LedgerEntry;

    const { data, error } = await supabase
      .from('boult_ledger')
      .insert({
        user_id: userId,
        agent_id: input.agentId || null,
        what,
        who: input.who || null,
        due: input.due || null,
        status: 'open',
        origin_run_id: input.originRunId || null,
        thread_id: input.threadId || null,
        detail: input.detail || {},
      })
      .select()
      .single();
    if (error) { console.warn('[ledger] add failed:', error.message); return null; }
    return data as LedgerEntry;
  } catch (e: any) {
    console.warn('[ledger] add threw:', e?.message);
    return null;
  }
}

/** All open/in-progress commitments for a user (newest due first, nulls last). */
export async function listOpen(userId: string, agentId?: string): Promise<LedgerEntry[]> {
  try {
    const supabase = getSupabaseAdmin();
    let q = supabase
      .from('boult_ledger')
      .select('*')
      .eq('user_id', normalizeUserId(userId))
      .in('status', ['open', 'in_progress'])
      .order('due', { ascending: true, nullsFirst: false })
      .limit(100);
    if (agentId) q = q.eq('agent_id', agentId);
    const { data } = await q;
    return (data as LedgerEntry[]) || [];
  } catch (e: any) {
    console.warn('[ledger] listOpen threw:', e?.message);
    return [];
  }
}

/** Commitments due on/before `asOf` (default now) — the "act on these first" set. */
export async function listDue(userId: string, asOf: Date = new Date(), agentId?: string): Promise<LedgerEntry[]> {
  const open = await listOpen(userId, agentId);
  return open.filter(e => e.due && new Date(e.due).getTime() <= asOf.getTime());
}

/** Split open items into overdue / due-today / upcoming for the report + planner. */
export function bucketByDue(entries: LedgerEntry[], asOf: Date = new Date()): {
  overdue: LedgerEntry[]; dueToday: LedgerEntry[]; upcoming: LedgerEntry[]; noDate: LedgerEntry[];
} {
  const startOfDay = new Date(asOf); startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(asOf); endOfDay.setHours(23, 59, 59, 999);
  const overdue: LedgerEntry[] = [], dueToday: LedgerEntry[] = [], upcoming: LedgerEntry[] = [], noDate: LedgerEntry[] = [];
  for (const e of entries) {
    if (!e.due) { noDate.push(e); continue; }
    const t = new Date(e.due).getTime();
    if (t < startOfDay.getTime()) overdue.push(e);
    else if (t <= endOfDay.getTime()) dueToday.push(e);
    else upcoming.push(e);
  }
  return { overdue, dueToday, upcoming, noDate };
}

/** Close (or cancel) a commitment — ONLY when it's actually done. */
export async function closeCommitment(id: string, closedRunId?: string | null, status: 'done' | 'cancelled' = 'done'): Promise<boolean> {
  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from('boult_ledger')
      .update({ status, closed_run_id: closedRunId || null, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) { console.warn('[ledger] close failed:', error.message); return false; }
    return true;
  } catch (e: any) {
    console.warn('[ledger] close threw:', e?.message);
    return false;
  }
}

/**
 * Post-run reconciliation (Stage 4 hardening). After a run finishes, this is the
 * DETERMINISTIC safety net that doesn't trust the agent's narrative: it loads the
 * agent's still-open commitments and, for anything OVERDUE that the report didn't
 * already mention, returns a compact addendum so a dropped ball can never be
 * silent. Returns `{ overdueCount, addendum }`; addendum is '' when nothing needs
 * surfacing. Fails soft → no addendum.
 */
export async function reconcileLedger(
  userId: string,
  agentId: string | undefined,
  reportText: string = '',
): Promise<{ overdueCount: number; addendum: string }> {
  try {
    const open = await listOpen(userId, agentId);
    const { overdue } = bucketByDue(open);
    if (!overdue.length) return { overdueCount: 0, addendum: '' };

    const reportLower = (reportText || '').toLowerCase();
    // Only surface items the report didn't already account for (dedupe on the
    // commitment text) — we don't want to repeat the agent's own follow-through.
    const unmentioned = overdue.filter(e => {
      const key = (e.what || '').toLowerCase().slice(0, 40);
      return key && !reportLower.includes(key);
    });
    if (!unmentioned.length) return { overdueCount: overdue.length, addendum: '' };

    const lines = unmentioned.slice(0, 8).map(e => {
      const due = e.due ? ` (due ${new Date(e.due).toLocaleDateString()})` : '';
      const who = e.who ? ` — ${e.who}` : '';
      return `- ${e.what}${who}${due}`;
    });
    const addendum =
      `\n\n---\n⚠️ **Still open and overdue** (carried over, not yet done):\n${lines.join('\n')}`;
    return { overdueCount: overdue.length, addendum };
  } catch (e: any) {
    console.warn('[ledger] reconcile threw:', e?.message);
    return { overdueCount: 0, addendum: '' };
  }
}

/** Mark a commitment in-progress (e.g., chased this run but awaiting a reply). */
export async function markInProgress(id: string, detail?: Record<string, any>): Promise<boolean> {
  try {
    const supabase = getSupabaseAdmin();
    const patch: Record<string, any> = { status: 'in_progress', updated_at: new Date().toISOString() };
    if (detail) patch.detail = detail;
    const { error } = await supabase.from('boult_ledger').update(patch).eq('id', id);
    return !error;
  } catch { return false; }
}
