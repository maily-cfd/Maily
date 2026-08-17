/**
 * Boult User Mental Model — durable, structured understanding of the user so
 * the agent reasons from business context, not isolated rules.
 *
 * Read before judgment calls (injected into the system prompt), written by the
 * `update_user_model` tool as the agent learns. Never throws — a model failure
 * must never break a conversation.
 */

import { normalizeUserId } from './user-id';

export interface UserModel {
  business_type?: string;
  decision_style?: string;
  values?: string[];
  communication_style?: string;
  work_patterns?: string[];
  risk_tolerance?: string;
  relationships?: { vip?: string[]; trusted?: string[]; transactional?: string[] };
  decision_types?: { strategic?: string[]; tactical?: string[]; routine?: string[] };
  pain_points?: string[];
  opportunities?: string[];
}

/** Fetch the stored model summary for prompt injection. '' when none/disabled. */
export async function getUserModelSummary(userId: string): Promise<string> {
  try {
    const { getSupabaseAdmin } = await import('../supabase.js');
    const supabase = getSupabaseAdmin();
    const { data } = await supabase
      .from('boult_user_model')
      .select('model, summary')
      .eq('user_id', normalizeUserId(userId))
      .maybeSingle();
    if (!data) return '';
    if (data.summary && String(data.summary).trim()) return String(data.summary).trim().slice(0, 1500);
    // No summary yet — render the structured model compactly.
    return renderModel(data.model as UserModel).slice(0, 1500);
  } catch {
    return '';
  }
}

/** Render a UserModel JSON object into a compact human-readable block. */
export function renderModel(m: UserModel | null | undefined): string {
  if (!m || typeof m !== 'object') return '';
  const lines: string[] = [];
  const add = (label: string, v?: string) => { if (v && v.trim()) lines.push(`- ${label}: ${v.trim()}`); };
  const list = (label: string, arr?: string[]) => { if (arr?.length) lines.push(`- ${label}: ${arr.slice(0, 12).join(', ')}`); };

  add('Business', m.business_type);
  add('Decision style', m.decision_style);
  list('Values', m.values);
  add('Communication', m.communication_style);
  list('Work patterns', m.work_patterns);
  add('Risk tolerance', m.risk_tolerance);
  if (m.relationships) {
    list('VIP contacts (handle personally)', m.relationships.vip);
    list('Trusted (drafting ok)', m.relationships.trusted);
    list('Transactional (you handle)', m.relationships.transactional);
  }
  if (m.decision_types) {
    list('Strategic (user decides)', m.decision_types.strategic);
    list('Tactical (you can decide)', m.decision_types.tactical);
    list('Routine (you handle)', m.decision_types.routine);
  }
  list('Pain points', m.pain_points);
  list('Opportunities', m.opportunities);
  return lines.join('\n');
}

/**
 * Merge a partial update into the stored model. Arrays are merged+deduped so the
 * agent accumulates understanding rather than overwriting it; scalars replace.
 * Regenerates the injected summary. Never throws.
 */
export async function updateUserModel(userId: string, patch: Partial<UserModel>): Promise<{ ok: boolean; summary: string }> {
  try {
    const { getSupabaseAdmin } = await import('../supabase.js');
    const supabase = getSupabaseAdmin();
    const id = normalizeUserId(userId);

    const { data: existing } = await supabase
      .from('boult_user_model')
      .select('model')
      .eq('user_id', id)
      .maybeSingle();

    const merged = mergeModel((existing?.model as UserModel) || {}, patch);
    const summary = renderModel(merged);

    const { error } = await supabase
      .from('boult_user_model')
      .upsert({ user_id: id, model: merged, summary, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });

    if (error) return { ok: false, summary: '' };
    return { ok: true, summary };
  } catch {
    return { ok: false, summary: '' };
  }
}

function mergeArr(a?: string[], b?: string[]): string[] | undefined {
  if (!a && !b) return undefined;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of [...(a || []), ...(b || [])]) {
    const t = String(x).trim();
    const k = t.toLowerCase();
    if (t && !seen.has(k)) { seen.add(k); out.push(t); }
  }
  return out.slice(0, 30);
}

function mergeModel(base: UserModel, patch: Partial<UserModel>): UserModel {
  const out: UserModel = { ...base };
  if (patch.business_type) out.business_type = patch.business_type;
  if (patch.decision_style) out.decision_style = patch.decision_style;
  if (patch.communication_style) out.communication_style = patch.communication_style;
  if (patch.risk_tolerance) out.risk_tolerance = patch.risk_tolerance;
  out.values = mergeArr(base.values, patch.values);
  out.work_patterns = mergeArr(base.work_patterns, patch.work_patterns);
  out.pain_points = mergeArr(base.pain_points, patch.pain_points);
  out.opportunities = mergeArr(base.opportunities, patch.opportunities);
  if (base.relationships || patch.relationships) {
    out.relationships = {
      vip: mergeArr(base.relationships?.vip, patch.relationships?.vip),
      trusted: mergeArr(base.relationships?.trusted, patch.relationships?.trusted),
      transactional: mergeArr(base.relationships?.transactional, patch.relationships?.transactional),
    };
  }
  if (base.decision_types || patch.decision_types) {
    out.decision_types = {
      strategic: mergeArr(base.decision_types?.strategic, patch.decision_types?.strategic),
      tactical: mergeArr(base.decision_types?.tactical, patch.decision_types?.tactical),
      routine: mergeArr(base.decision_types?.routine, patch.decision_types?.routine),
    };
  }
  return out;
}
