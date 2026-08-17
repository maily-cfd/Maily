/**
 * Boult session approval state — server-side gate for irreversible writes.
 *
 * The LLM is told (in the system prompt) to call request_confirmation before
 * send_email / schedule_meeting / send_slack_message / create_notion_page.
 * But prompt-level rules drift — the LLM occasionally skips the confirmation
 * call and goes straight to the write. This module backs that rule with
 * code: every confirmation request inserts a pending row, the user's click
 * promotes it to approved, and the write tool refuses to execute unless an
 * approved row exists that matches its target.
 *
 * Backed by the boult_session_approvals table (see migration). Misses (e.g.
 * Supabase down, table not migrated) fail OPEN — we log and let the call
 * through, because failing closed would break every send for users who
 * haven't applied the migration yet. Once the migration is universally
 * applied, we can tighten this to fail closed.
 */

// @ts-ignore — JS module, no .d.ts
import { getSupabaseAdmin } from '../supabase.js';
import { normalizeUserId } from './user-id';
import { recordDecision, mapSessionApprovalToGrant } from './autonomy-grants';

// A live-chat confirm/decline is the strongest precedent signal — count it toward
// the graduated-autonomy ladder for this contact. Best-effort; never blocks.
function countSessionDecision(userId: string, actionType: string, targetKey: string, decision: 'approved' | 'rejected') {
  const grant = mapSessionApprovalToGrant(actionType, targetKey);
  if (!grant?.targetKey) return;
  recordDecision({ userId, action: grant.action, targetKey: grant.targetKey, decision, label: grant.targetKey }).catch(() => {});
}

export type ApprovalActionType =
  | 'send_email'
  | 'batch_email_send'
  | 'schedule_meeting'
  | 'send_slack_message'
  | 'send_slack_dm'
  | 'create_notion_page'
  | 'cancel_event'
  | 'calcom_book'
  | 'calcom_cancel';

const APPROVAL_TABLE = 'boult_session_approvals';

/**
 * Normalize the target identifier so the request_confirmation details and the
 * subsequent write tool input map to the same key.
 */
export function normalizeTargetKey(action: ApprovalActionType, input: Record<string, any>): string {
  switch (action) {
    case 'send_email': {
      const to = String(input.to || input.To || '').trim().toLowerCase();
      // Subject helps disambiguate two emails to the same recipient
      const subj = String(input.subject || input.Subject || '').trim().toLowerCase().slice(0, 80);
      return `${to}|${subj}`;
    }
    case 'batch_email_send': {
      // One approval covers a described batch of N sends. The batch tool
      // consumes it explicitly BY ID (consumeApprovalById), so the key only
      // needs to be stable, not reconstructable from the send input.
      const count = String(input.count || input.Count || input.recipients || '').trim();
      return `batch|${count}`;
    }
    case 'schedule_meeting': {
      const attendees: string[] = Array.isArray(input.attendees)
        ? input.attendees
        : typeof input.Attendees === 'string'
          ? input.Attendees.split(/[,;]/).map((s: string) => s.trim())
          : [];
      const at = attendees.map((s) => s.toLowerCase()).sort().join(',');
      const start = String(input.startTime || input.Start || input.When || '').trim().toLowerCase();
      return `${at}|${start}`;
    }
    case 'send_slack_message': {
      const ch = String(input.channel || input.Channel || '').trim().toLowerCase();
      return ch;
    }
    case 'send_slack_dm': {
      // DM target is a Slack user id (U0123...) — distinct from channel target
      // so reusing send_slack_message's gate would risk cross-matching.
      return String(input.userId || input.UserId || input.user_id || input.User || '').trim().toLowerCase();
    }
    case 'create_notion_page': {
      const db = String(input.database || input.Database || input.parentId || '').trim().toLowerCase();
      const title = String(input.title || input.Title || '').trim().toLowerCase().slice(0, 80);
      return `${db}|${title}`;
    }
    case 'cancel_event': {
      // Event id alone is sufficient — there is exactly one event per id.
      return String(input.eventId || input.EventId || input.event_id || '').trim().toLowerCase();
    }
    case 'calcom_book': {
      // Keyed on attendee email + start — fields a human confirmation card
      // reliably carries (eventTypeId rarely appears in the confirmation text).
      const email = String(input.email || input.Email || input.with || input.attendee || '').trim().toLowerCase();
      const start = String(input.start || input.Start || input.When || '').trim().toLowerCase();
      return `${email}|${start}`;
    }
    case 'calcom_cancel': {
      return String(input.bookingId || input.BookingId || input.booking_id || '').trim().toLowerCase();
    }
  }
}

/**
 * Record a pending approval request. Returns the row's UUID, which the UI
 * uses to POST back to /api/boult/approval/confirm when the user clicks
 * Confirm or Cancel. Returns null on any DB error — the caller should still
 * show the confirmation card (failing open).
 */
export async function recordPendingApproval(params: {
  conversationId: string;
  userId: string;
  actionType: ApprovalActionType;
  targetKey: string;
  actionLabel?: string;
}): Promise<string | null> {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from(APPROVAL_TABLE)
      .insert({
        conversation_id: params.conversationId,
        user_id: normalizeUserId(params.userId),
        action_type: params.actionType,
        target_key: params.targetKey,
        action_label: params.actionLabel || null,
        status: 'pending',
      })
      .select('id')
      .single();
    if (error) {
      console.warn('[Boult:Approvals] recordPendingApproval failed:', error.message);
      return null;
    }
    return data?.id ?? null;
  } catch (err: any) {
    console.warn('[Boult:Approvals] recordPendingApproval threw:', err.message);
    return null;
  }
}

/**
 * Look up an approved row for the given (conversation, action, target) and
 * mark it consumed in the same transaction. Returns true iff a matching
 * approved row existed and was consumed.
 *
 * Fail-open semantics — narrowed in PART 35 to only the two cases that have
 * a legitimate reason to bypass the gate:
 *
 *   1. Missing conversationId — background agents bypass the request_confirmation
 *      path entirely (their own approval is the agent creation), so an absent
 *      conversation id is structural, not a failure.
 *   2. Table missing (PG error 42P01) — migration not applied yet. Failing
 *      closed here would brick every send on under-migrated deployments.
 *
 * Every other error path (Supabase unreachable, network blip, generic
 * exception) now fails CLOSED. Before this change, a generic catch returned
 * `{ approved: true, failedOpen: true }`, which meant a Supabase timeout
 * during a confirmation lookup let the write through unconfirmed — silently
 * defeating the rule the module exists to enforce.
 */
export async function consumeApproval(params: {
  conversationId: string;
  userId: string;
  actionType: ApprovalActionType;
  targetKey: string;
  /**
   * Explicit opt-in for the background-agent bypass. When true, this caller
   * is responsible for its own approval surface (e.g. agent creation flow)
   * and consumeApproval should not gate the write. Defaults to false.
   */
  isBackgroundAgent?: boolean;
}): Promise<{ approved: boolean; failedOpen: boolean }> {
  if (params.isBackgroundAgent) {
    return { approved: true, failedOpen: true };
  }
  if (!params.conversationId) {
    // Interactive callers must always pass a conversationId. Treat the
    // omission as a configuration bug, not a free bypass — fail closed and
    // log loudly so the missing call-site is fixed.
    console.warn('[Boult:Approvals] consumeApproval called without conversationId — failing CLOSED');
    return { approved: false, failedOpen: false };
  }
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from(APPROVAL_TABLE)
      .select('id, expires_at')
      .eq('conversation_id', params.conversationId)
      .eq('user_id', normalizeUserId(params.userId))
      .eq('action_type', params.actionType)
      .eq('target_key', params.targetKey)
      .eq('status', 'approved')
      .order('approved_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      // 42P01 = table does not exist (migration not applied) — fail open.
      if ((error as any).code === '42P01') {
        console.warn('[Boult:Approvals] table missing, failing open');
        return { approved: true, failedOpen: true };
      }
      console.warn('[Boult:Approvals] consumeApproval lookup error — failing CLOSED:', error.message);
      return { approved: false, failedOpen: false };
    }

    if (!data) return { approved: false, failedOpen: false };

    // Reject if expired
    if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) {
      return { approved: false, failedOpen: false };
    }

    // Consume it so the same approval can't be reused for a second write
    await supabase
      .from(APPROVAL_TABLE)
      .update({ status: 'consumed', consumed_at: new Date().toISOString() })
      .eq('id', data.id);

    return { approved: true, failedOpen: false };
  } catch (err: any) {
    // Network blip, Supabase outage, JSON parse error, etc. — failing open
    // here would let any write through whenever Supabase is unreachable,
    // exactly the kind of silent defeat this module is supposed to prevent.
    console.warn('[Boult:Approvals] consumeApproval threw — failing CLOSED:', err.message);
    return { approved: false, failedOpen: false };
  }
}

/**
 * Consume a specific approval BY ID — the explicit handshake for batch sends.
 *
 * Key-matching (consumeApproval) works when the write tool's input can
 * reconstruct the same target key the confirmation carried. A batch of N
 * personalized emails has no single (to, subject), so the flow is explicit
 * instead: request_confirmation returns its approvalId in the tool result,
 * the user clicks Confirm, and the batch tool passes that id straight back.
 * No reconstruction, no fragile matching.
 *
 * Same fail-open/closed semantics as consumeApproval: background agents and
 * a missing table fail open; everything else fails CLOSED. Single-use.
 */
export async function consumeApprovalById(params: {
  approvalId: string;
  userId: string;
  actionType: ApprovalActionType;
  conversationId?: string;
  isBackgroundAgent?: boolean;
}): Promise<{ approved: boolean; failedOpen: boolean }> {
  if (params.isBackgroundAgent) {
    return { approved: true, failedOpen: true };
  }
  if (!params.approvalId) {
    return { approved: false, failedOpen: false };
  }
  try {
    const supabase = getSupabaseAdmin();
    let query = supabase
      .from(APPROVAL_TABLE)
      .select('id, expires_at')
      .eq('id', params.approvalId)
      .eq('user_id', normalizeUserId(params.userId))
      .eq('action_type', params.actionType)
      .eq('status', 'approved');
    if (params.conversationId) query = query.eq('conversation_id', params.conversationId);
    const { data, error } = await query.maybeSingle();

    if (error) {
      if ((error as any).code === '42P01') {
        console.warn('[Boult:Approvals] table missing, failing open');
        return { approved: true, failedOpen: true };
      }
      console.warn('[Boult:Approvals] consumeApprovalById lookup error — failing CLOSED:', error.message);
      return { approved: false, failedOpen: false };
    }
    if (!data) return { approved: false, failedOpen: false };
    if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) {
      return { approved: false, failedOpen: false };
    }

    await supabase
      .from(APPROVAL_TABLE)
      .update({ status: 'consumed', consumed_at: new Date().toISOString() })
      .eq('id', data.id);
    return { approved: true, failedOpen: false };
  } catch (err: any) {
    console.warn('[Boult:Approvals] consumeApprovalById threw — failing CLOSED:', err.message);
    return { approved: false, failedOpen: false };
  }
}

/**
 * Promote a pending approval to approved (called by the UI when the user
 * clicks Confirm). Returns true on success.
 */
export async function approvePending(params: {
  approvalId: string;
  userId: string;
}): Promise<boolean> {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from(APPROVAL_TABLE)
      .update({ status: 'approved', approved_at: new Date().toISOString() })
      .eq('id', params.approvalId)
      .eq('user_id', normalizeUserId(params.userId))
      .eq('status', 'pending')
      .select('action_type, target_key')
      .maybeSingle();
    if (error || !data) {
      if (error) console.warn('[Boult:Approvals] approvePending failed:', error.message);
      return false;
    }
    countSessionDecision(params.userId, data.action_type, data.target_key, 'approved');
    return true;
  } catch (err: any) {
    console.warn('[Boult:Approvals] approvePending threw:', err.message);
    return false;
  }
}

/**
 * PART 4 Rule 6 — did the user already decline this exact action in this
 * conversation? If yes, requestConfirmation refuses to insert a new pending
 * row and returns null so the LLM surfaces "you already declined this" rather
 * than re-prompting. One confirmation per action; no re-asks after a decline.
 *
 * Looks back across the whole conversation (no time window) — declines stick
 * until the conversation ends. Fails open (returns false) on DB error.
 */
export async function hasDeclinedApproval(params: {
  conversationId: string;
  userId: string;
  actionType: ApprovalActionType;
  targetKey: string;
}): Promise<boolean> {
  if (!params.conversationId) return false;
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from(APPROVAL_TABLE)
      .select('id')
      .eq('conversation_id', params.conversationId)
      .eq('user_id', normalizeUserId(params.userId))
      .eq('action_type', params.actionType)
      .eq('target_key', params.targetKey)
      .eq('status', 'declined')
      .limit(1)
      .maybeSingle();
    if (error) return false;
    return !!data;
  } catch {
    return false;
  }
}

/**
 * Mark a pending approval as declined.
 */
export async function declinePending(params: {
  approvalId: string;
  userId: string;
}): Promise<boolean> {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from(APPROVAL_TABLE)
      .update({ status: 'declined' })
      .eq('id', params.approvalId)
      .eq('user_id', normalizeUserId(params.userId))
      .eq('status', 'pending')
      .select('action_type, target_key')
      .maybeSingle();
    if (!error && data) countSessionDecision(params.userId, data.action_type, data.target_key, 'rejected');
    return !error;
  } catch {
    return false;
  }
}
