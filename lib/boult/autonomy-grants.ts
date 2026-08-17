/**
 * Graduated Autonomy — the trust ladder.
 *
 * A "grant" authorizes one (action_type, target) to run without the per-action
 * approval prompt. Grants are earned: recordDecision() counts every approve/reject
 * and, on a clean track record past a threshold, flags suggested=true so the UI can
 * offer promotion (the user confirms — nothing flips to auto on its own).
 *
 * applyAutonomyGate() is the single seam the write tools call in place of their
 * inline "queue for approval" block. When a target is granted 'auto', the action is
 * deferred into boult_autonomy_actions with an undo window (Phase 2 cron drains it)
 * instead of waiting for manual approval.
 *
 * SAFE DEFAULTS: settings.enabled defaults false → resolveAutonomy always returns
 * 'inherit' → every tool behaves exactly as today until the user opts in.
 *
 * NOTE: this module must NOT import ./tools (the drainer that needs executeTool lives
 * in ./autonomy-drain to avoid a circular dependency).
 */

// @ts-ignore — JS module
import { getSupabaseAdmin } from '../supabase.js';
import { normalizeUserId } from './user-id';
import { queuePendingAction } from './agent-approvals';
import type { ToolContext } from './tools/types';

export const APPROVE_THRESHOLD = 5; // approvals (spotless) before we suggest auto
const DEFAULT_BUFFER_MIN = 10;

export type GrantLevel = 'inherit' | 'hold' | 'auto' | 'never';
export type DelayMode = 'buffer' | 'instant';

// Grant action_type — the coarse, contact-level action (distinct from the
// confirmation-level ApprovalActionType which can include a subject).
export type GrantAction =
  | 'send_email'
  | 'schedule_meeting'
  | 'send_slack_message'
  | 'send_slack_dm'
  | 'calcom_book';

// Map an executeTool tool name → the grant action it counts toward.
export function toolToGrantAction(toolName: string): GrantAction | null {
  switch (toolName) {
    case 'send_email':
    case 'schedule_email_send':
      return 'send_email';
    case 'schedule_meeting':
      return 'schedule_meeting';
    case 'calcom_create_booking':
      return 'calcom_book';
    case 'send_slack_message':
      return 'send_slack_message';
    case 'slack_send_dm':
      return 'send_slack_dm';
    default:
      return null; // cancels, notion, etc. are not part of the ladder
  }
}

/**
 * The CONTACT-level key a grant is scoped to. Coarser than normalizeTargetKey
 * (which appends the subject/time) — a grant is "auto-handle this person/channel",
 * not "this exact message".
 */
export function grantTargetKey(action: GrantAction, input: Record<string, any>): string {
  switch (action) {
    case 'send_email':
      return String(input.to || input.To || '').trim().toLowerCase();
    case 'schedule_meeting': {
      const attendees: string[] = Array.isArray(input.attendees)
        ? input.attendees
        : typeof input.Attendees === 'string'
          ? input.Attendees.split(/[,;]/).map((s: string) => s.trim())
          : [];
      return attendees.map((s) => s.toLowerCase()).sort().join(',');
    }
    case 'calcom_book':
      return String(input.email || input.Email || input.with || input.attendee || '').trim().toLowerCase();
    case 'send_slack_message':
      return String(input.channel || input.Channel || '').trim().toLowerCase();
    case 'send_slack_dm':
      return String(input.userId || input.UserId || input.user_id || input.User || '').trim().toLowerCase();
  }
}

/**
 * Map a session-approval (action_type, target_key) — whose key may carry a
 * subject/time suffix after '|' — to the coarse contact-level grant key.
 */
export function mapSessionApprovalToGrant(
  actionType: string,
  sessionTargetKey: string,
): { action: GrantAction; targetKey: string } | null {
  const head = (sessionTargetKey || '').split('|')[0]?.trim() || '';
  switch (actionType) {
    case 'send_email':         return { action: 'send_email', targetKey: head };
    case 'schedule_meeting':   return { action: 'schedule_meeting', targetKey: head };
    case 'calcom_book':        return { action: 'calcom_book', targetKey: head };
    case 'send_slack_message': return { action: 'send_slack_message', targetKey: (sessionTargetKey || '').trim() };
    case 'send_slack_dm':      return { action: 'send_slack_dm', targetKey: (sessionTargetKey || '').trim() };
    default:                   return null;
  }
}

function domainOf(targetKey: string): string | null {
  const at = targetKey.indexOf('@');
  return at >= 0 ? targetKey.slice(at + 1) : null;
}

export interface AutonomySettings {
  enabled: boolean;
  bufferMinutes: number;
  allowInstant: boolean;
}

export async function getSettings(userId: string): Promise<AutonomySettings> {
  const defaults: AutonomySettings = { enabled: false, bufferMinutes: DEFAULT_BUFFER_MIN, allowInstant: true };
  try {
    const supabase = getSupabaseAdmin();
    const { data } = await supabase
      .from('boult_autonomy_settings')
      .select('enabled, buffer_minutes, allow_instant')
      .eq('user_id', normalizeUserId(userId))
      .maybeSingle();
    if (!data) return defaults;
    return {
      enabled: !!data.enabled,
      bufferMinutes: Number(data.buffer_minutes) > 0 ? Number(data.buffer_minutes) : DEFAULT_BUFFER_MIN,
      allowInstant: data.allow_instant !== false,
    };
  } catch {
    return defaults; // fail safe → today's behavior
  }
}

export async function updateSettings(userId: string, patch: Partial<AutonomySettings>): Promise<void> {
  const supabase = getSupabaseAdmin();
  const row: Record<string, any> = { user_id: normalizeUserId(userId), updated_at: new Date().toISOString() };
  if (patch.enabled !== undefined) row.enabled = patch.enabled;
  if (patch.bufferMinutes !== undefined) row.buffer_minutes = Math.max(1, Math.min(120, patch.bufferMinutes));
  if (patch.allowInstant !== undefined) row.allow_instant = patch.allowInstant;
  await supabase.from('boult_autonomy_settings').upsert(row, { onConflict: 'user_id' });
}

export interface ResolvedAutonomy { level: GrantLevel; delayMode: DelayMode; }

/**
 * Resolve the effective autonomy for an (action, contact). Exact-contact grant
 * wins; else a domain-scope grant; else 'inherit'. Returns 'inherit' whenever the
 * global kill switch is off (→ today's behavior).
 */
export async function resolveAutonomy(userId: string, action: GrantAction, targetKey: string): Promise<ResolvedAutonomy> {
  const settings = await getSettings(userId);
  if (!settings.enabled) return { level: 'inherit', delayMode: 'buffer' };

  const clampDelay = (m: DelayMode): DelayMode => (m === 'instant' && !settings.allowInstant ? 'buffer' : m);
  try {
    const supabase = getSupabaseAdmin();
    const uid = normalizeUserId(userId);

    const { data: exact } = await supabase
      .from('boult_autonomy_grants')
      .select('level, delay_mode')
      .eq('user_id', uid)
      .eq('action_type', action)
      .eq('target_key', targetKey)
      .maybeSingle();
    if (exact && exact.level !== 'inherit') {
      return { level: exact.level as GrantLevel, delayMode: clampDelay((exact.delay_mode as DelayMode) || 'buffer') };
    }

    const domain = domainOf(targetKey);
    if (domain) {
      const { data: dom } = await supabase
        .from('boult_autonomy_grants')
        .select('level, delay_mode')
        .eq('user_id', uid)
        .eq('action_type', action)
        .eq('scope', 'domain')
        .eq('target_key', domain)
        .maybeSingle();
      if (dom && dom.level !== 'inherit') {
        return { level: dom.level as GrantLevel, delayMode: clampDelay((dom.delay_mode as DelayMode) || 'buffer') };
      }
    }
  } catch { /* fall through to inherit */ }
  return { level: 'inherit', delayMode: 'buffer' };
}

/**
 * Count an approve/reject toward the ladder. On a spotless record past the
 * threshold, flag suggested=true (UI offers promotion). A reject demotes an
 * existing 'auto' grant back to 'hold'.
 */
export async function recordDecision(params: {
  userId: string;
  action: GrantAction;
  targetKey: string;
  decision: 'approved' | 'rejected';
  label?: string;
}): Promise<void> {
  if (!params.targetKey) return;
  try {
    const supabase = getSupabaseAdmin();
    const uid = normalizeUserId(params.userId);
    const { data: row } = await supabase
      .from('boult_autonomy_grants')
      .select('id, level, approve_count, reject_count')
      .eq('user_id', uid)
      .eq('action_type', params.action)
      .eq('target_key', params.targetKey)
      .maybeSingle();

    const approve = (row?.approve_count || 0) + (params.decision === 'approved' ? 1 : 0);
    const reject = (row?.reject_count || 0) + (params.decision === 'rejected' ? 1 : 0);
    let level: GrantLevel = (row?.level as GrantLevel) || 'inherit';
    let suggested = false;

    if (params.decision === 'rejected' && level === 'auto') {
      level = 'hold'; // one rejection pulls a target off auto
    }
    // Suggest only on a spotless record while still inheriting/holding.
    if ((level === 'inherit' || level === 'hold') && reject === 0 && approve >= APPROVE_THRESHOLD) {
      suggested = true;
    }

    const payload: Record<string, any> = {
      user_id: uid,
      action_type: params.action,
      target_key: params.targetKey,
      level,
      suggested,
      approve_count: approve,
      reject_count: reject,
      last_decision_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    if (params.label) payload.label = params.label;
    await supabase.from('boult_autonomy_grants').upsert(payload, { onConflict: 'user_id,action_type,target_key' });
  } catch { /* learning is best-effort */ }
}

export async function setGrant(params: {
  userId: string;
  action: GrantAction;
  targetKey: string;
  level: GrantLevel;
  delayMode?: DelayMode;
  scope?: 'contact' | 'domain';
  label?: string;
}): Promise<void> {
  const supabase = getSupabaseAdmin();
  await supabase.from('boult_autonomy_grants').upsert(
    {
      user_id: normalizeUserId(params.userId),
      action_type: params.action,
      target_key: params.targetKey,
      level: params.level,
      delay_mode: params.delayMode || 'buffer',
      scope: params.scope || 'contact',
      label: params.label,
      suggested: false, // accepting/setting clears the pending suggestion
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,action_type,target_key' },
  );
}

export async function listGrants(userId: string): Promise<any[]> {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from('boult_autonomy_grants')
    .select('*')
    .eq('user_id', normalizeUserId(userId))
    .order('updated_at', { ascending: false })
    .limit(200);
  return data || [];
}

export async function listSuggestions(userId: string): Promise<any[]> {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from('boult_autonomy_grants')
    .select('*')
    .eq('user_id', normalizeUserId(userId))
    .eq('suggested', true)
    .order('approve_count', { ascending: false })
    .limit(50);
  return data || [];
}

export async function dismissSuggestion(userId: string, action: GrantAction, targetKey: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  await supabase
    .from('boult_autonomy_grants')
    .update({ suggested: false, level: 'hold', updated_at: new Date().toISOString() })
    .eq('user_id', normalizeUserId(userId))
    .eq('action_type', action)
    .eq('target_key', targetKey);
}

// ── Deferred auto-execution queue (Phase 2 storage; drained by ./autonomy-drain) ──

export interface EnqueueAutonomyInput {
  userId: string;
  agentId?: string;
  runId?: string;
  toolName: string;
  toolInput: Record<string, any>;
  action: GrantAction;
  targetKey: string;
  summary?: string;
  executeAt: Date;
}

export async function enqueueAutonomyAction(input: EnqueueAutonomyInput): Promise<string | null> {
  try {
    const supabase = getSupabaseAdmin();
    const { data } = await supabase
      .from('boult_autonomy_actions')
      .insert({
        user_id: normalizeUserId(input.userId),
        agent_id: input.agentId || null,
        run_id: input.runId || null,
        tool_name: input.toolName,
        tool_input: input.toolInput,
        action_type: input.action,
        target_key: input.targetKey,
        status: 'auto_scheduled',
        execute_at: input.executeAt.toISOString(),
        summary: input.summary || null,
      })
      .select('id')
      .single();
    return data?.id ?? null;
  } catch (e: any) {
    console.warn('[autonomy] enqueueAutonomyAction failed:', e?.message);
    return null;
  }
}

export async function listAutonomyActions(userId: string, opts: { includeDone?: boolean } = {}): Promise<any[]> {
  const supabase = getSupabaseAdmin();
  let q = supabase
    .from('boult_autonomy_actions')
    .select('*')
    .eq('user_id', normalizeUserId(userId))
    .order('execute_at', { ascending: false })
    .limit(100);
  q = opts.includeDone ? q : q.eq('status', 'auto_scheduled');
  const { data } = await q;
  return data || [];
}

/** User "Stop" — cancel a pending auto action before it fires. */
export async function stopAutonomyAction(userId: string, id: string): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from('boult_autonomy_actions')
    .update({ status: 'cancelled' })
    .eq('id', id)
    .eq('user_id', normalizeUserId(userId))
    .eq('status', 'auto_scheduled')
    .select('id')
    .maybeSingle();
  return !!data;
}

// ── The gate seam the write tools call ────────────────────────────────────────

export interface AutonomyGateResult {
  handled: boolean;            // true → caller returns `result` and does NOT execute
  result?: { output: string };
}

/**
 * Replaces the inline "queue for approval" block in each background write tool.
 * Returns handled:false to let the tool execute now (live chat already gated above;
 * 'own'/skipConfirmations agents; or an auto+instant grant). Returns handled:true
 * with a result when it either queues for manual approval (today's default) or
 * defers an auto action into the undo-window queue.
 */
export async function applyAutonomyGate(params: {
  userId: string;
  action: GrantAction;
  toolName: string;
  input: Record<string, any>;
  context: ToolContext;
  verb?: string; // for the user-facing message, e.g. "send", "book"
}): Promise<AutonomyGateResult> {
  const { context } = params;
  // Only the background queue path is gated here. Live chat keeps its confirmation
  // card (the user is present); 'own'/skipConfirmations agents execute as today.
  if (!context.isBackgroundAgent || !context.agentId || !context.runId) return { handled: false };
  if (context.skipConfirmations) return { handled: false };

  const targetKey = grantTargetKey(params.action, params.input);
  const { level, delayMode } = targetKey
    ? await resolveAutonomy(params.userId, params.action, targetKey)
    : { level: 'inherit' as GrantLevel, delayMode: 'buffer' as DelayMode };

  if (level === 'auto') {
    if (delayMode === 'instant') return { handled: false }; // execute now
    const settings = await getSettings(params.userId);
    const executeAt = new Date(Date.now() + settings.bufferMinutes * 60_000);
    await enqueueAutonomyAction({
      userId: params.userId,
      agentId: context.agentId,
      runId: context.runId,
      toolName: params.toolName,
      toolInput: params.input,
      action: params.action,
      targetKey,
      summary: `${params.verb || 'action'} → ${params.input.subject || params.input.title || targetKey}`,
      executeAt,
    });
    const verb = params.verb || 'send';
    return {
      handled: true,
      result: { output: `Auto-approved — will ${verb} in ${settings.bufferMinutes} min. You can Stop it from the Autonomy panel before then.` },
    };
  }

  // level 'never' | 'hold' | 'inherit' → today's behavior: queue for manual approval.
  await queuePendingAction({
    agentId: context.agentId,
    runId: context.runId,
    userId: params.userId,
    toolName: params.toolName,
    toolInput: params.input,
  });
  return { handled: true, result: { output: 'Action queued for user approval.' } };
}
