/**
 * Boult scheduled email send.
 *
 * Two halves:
 *  - enqueueScheduledEmail(): writes a row to boult_scheduled_emails (status
 *    'pending'). Called at SCHEDULE time, after the normal send approval — so the
 *    dispatcher can later send without re-prompting.
 *  - drainScheduledEmails(): the cron dispatcher. Atomically claims due rows
 *    (pending → sending) so two concurrent cron ticks never double-send, sends
 *    each via the same Gmail primitive the live tools use, and marks
 *    sent/failed/retry. Fails open — never throws into the cron tick.
 *
 * Reuses the tested token + MIME primitives (no new auth surface):
 *   getGmailToken / refreshGoogleToken  → lib/boult/tools/http-tokens
 *   buildRaw                            → lib/boult/tools/encoding-helpers
 */

import { getGmailToken, refreshGoogleToken, googleFetch } from './tools/http-tokens';
import { buildRaw } from './tools/encoding-helpers';

const GMAIL_SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
const MAX_ATTEMPTS = 3;
const DEFAULT_DRAIN_LIMIT = 25;

export interface EnqueueScheduledEmailInput {
  userId: string;
  to: string;
  subject?: string;
  body: string;
  sendAt: string | Date;   // ISO 8601 or Date
  threadId?: string;
  dedupKey?: string;
  source?: 'agent' | 'chat' | 'sequence';
  agentId?: string;
}

export interface EnqueueResult {
  ok: boolean;
  id?: string;
  sendAt?: string;
  duplicate?: boolean;
  error?: string;
}

/** Validate + insert a single scheduled email. */
export async function enqueueScheduledEmail(
  supabase: any,
  input: EnqueueScheduledEmailInput,
): Promise<EnqueueResult> {
  const to = (input.to || '').trim();
  const body = (input.body || '').trim();
  if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
    return { ok: false, error: 'A valid recipient email is required.' };
  }
  if (!body) return { ok: false, error: 'Email body is required.' };

  const when = input.sendAt instanceof Date ? input.sendAt : new Date(input.sendAt);
  if (isNaN(when.getTime())) {
    return { ok: false, error: 'sendAt must be a valid ISO 8601 date/time.' };
  }
  // Guard against runaway scheduling — at most 1 year out.
  const maxFuture = Date.now() + 365 * 24 * 60 * 60 * 1000;
  if (when.getTime() > maxFuture) {
    return { ok: false, error: 'sendAt cannot be more than a year in the future.' };
  }

  const row = {
    user_id: input.userId,
    to_email: to,
    subject: input.subject || '(no subject)',
    body,
    thread_id: input.threadId || null,
    send_at: when.toISOString(),
    status: 'pending',
    dedup_key: input.dedupKey || null,
    source: input.source || 'agent',
    agent_id: input.agentId || null,
  };

  const { data, error } = await supabase
    .from('boult_scheduled_emails')
    .insert(row)
    .select('id, send_at')
    .single();

  if (error) {
    // 23505 = unique violation on (user_id, dedup_key) → already scheduled.
    if ((error as any).code === '23505') {
      return { ok: true, duplicate: true };
    }
    return { ok: false, error: error.message || 'Could not schedule the email.' };
  }
  return { ok: true, id: data.id, sendAt: data.send_at };
}

export interface DrainResult {
  claimed: number;
  sent: number;
  failed: number;
  retried: number;
}

/**
 * Cron dispatcher. Claims up to `limit` due rows atomically, sends them, and
 * records the outcome. Safe to call every tick; returns counts. Never throws.
 */
export async function drainScheduledEmails(
  supabase: any,
  opts: { limit?: number } = {},
): Promise<DrainResult> {
  const limit = opts.limit ?? DEFAULT_DRAIN_LIMIT;
  const result: DrainResult = { claimed: 0, sent: 0, failed: 0, retried: 0 };
  try {
    const nowIso = new Date().toISOString();

    // 1. Find a bounded batch of due, pending rows (ids only).
    const { data: due, error: dueErr } = await supabase
      .from('boult_scheduled_emails')
      .select('id')
      .eq('status', 'pending')
      .lte('send_at', nowIso)
      .order('send_at', { ascending: true })
      .limit(limit);
    if (dueErr || !due?.length) return result;

    const ids = due.map((r: any) => r.id);

    // 2. Atomically claim them: the .eq('status','pending') guard means a second
    //    concurrent tick can't re-claim a row this tick already took. The rows
    //    RETURNED are exactly the ones we own.
    const { data: claimed, error: claimErr } = await supabase
      .from('boult_scheduled_emails')
      .update({ status: 'sending', updated_at: nowIso })
      .in('id', ids)
      .eq('status', 'pending')
      .select('*');
    if (claimErr || !claimed?.length) return result;
    result.claimed = claimed.length;

    // 3. Send each (sequential — keeps us within Gmail per-user rate limits).
    for (const row of claimed) {
      const outcome = await sendOneScheduled(supabase, row);
      if (outcome === 'sent') result.sent++;
      else if (outcome === 'retry') result.retried++;
      else result.failed++;
    }
  } catch (e: any) {
    console.error('[scheduled-send] drain failed:', e?.message || e);
  }
  return result;
}

type SendOutcome = 'sent' | 'failed' | 'retry';

async function sendOneScheduled(supabase: any, row: any): Promise<SendOutcome> {
  const nowIso = new Date().toISOString();
  const nextAttempt = (row.attempts || 0) + 1;

  try {
    let token = await getGmailToken(row.user_id);
    if (!token) {
      return await finalizeFailure(supabase, row, nextAttempt, 'Gmail is not connected for this user.');
    }

    const raw = buildRaw(row.to_email, row.subject || '', row.body, row.thread_id || undefined);
    const reqBody: Record<string, any> = { raw };
    if (row.thread_id) reqBody.threadId = row.thread_id;
    const sendBody = JSON.stringify(reqBody);

    // googleFetch proxies through Composio for managed users (token is a composio:
    // marker) or does the direct authed send for legacy Google sign-in. The 401
    // refresh-retry below is a legacy-token concern; Composio refreshes server-side.
    let res = await googleFetch(row.user_id, 'gmail', GMAIL_SEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: sendBody,
    });
    if (res.status === 401) {
      const fresh = await refreshGoogleToken(row.user_id);
      if (fresh) {
        token = fresh;
        res = await googleFetch(row.user_id, 'gmail', GMAIL_SEND_URL, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: sendBody,
        });
      }
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      // 4xx (except 429) are permanent — bad recipient, missing scope. Don't retry.
      const permanent = res.status >= 400 && res.status < 500 && res.status !== 429;
      const msg = `Gmail send failed (${res.status}): ${errText.slice(0, 200)}`;
      return permanent
        ? await markTerminal(supabase, row, 'failed', nextAttempt, msg)
        : await finalizeFailure(supabase, row, nextAttempt, msg);
    }

    const sent = await res.json().catch(() => ({}));
    await supabase
      .from('boult_scheduled_emails')
      .update({
        status: 'sent',
        sent_at: nowIso,
        updated_at: nowIso,
        attempts: nextAttempt,
        sent_message_id: sent.id || null,
        last_error: null,
      })
      .eq('id', row.id);
    return 'sent';
  } catch (e: any) {
    // Network/timeout — transient, allow retry.
    return await finalizeFailure(supabase, row, nextAttempt, e?.message || 'send error');
  }
}

/** Transient failure: retry next tick until MAX_ATTEMPTS, then give up. */
async function finalizeFailure(supabase: any, row: any, attempt: number, error: string): Promise<SendOutcome> {
  if (attempt >= MAX_ATTEMPTS) {
    return await markTerminal(supabase, row, 'failed', attempt, error);
  }
  await supabase
    .from('boult_scheduled_emails')
    .update({ status: 'pending', attempts: attempt, last_error: error, updated_at: new Date().toISOString() })
    .eq('id', row.id);
  return 'retry';
}

async function markTerminal(supabase: any, row: any, status: 'failed', attempt: number, error: string): Promise<SendOutcome> {
  await supabase
    .from('boult_scheduled_emails')
    .update({ status, attempts: attempt, last_error: error, updated_at: new Date().toISOString() })
    .eq('id', row.id);
  return 'failed';
}
