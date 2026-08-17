/**
 * The Living User Model (super-agent Part 5).
 *
 * A structured, continuously-refined model of the user that every action
 * consults: how they communicate, when they work, who's a VIP, what the agent
 * may decide vs must escalate. Stored in boult_user_model (one row per user) and
 * deep-merged on every update so the model only ever gets sharper.
 *
 * Why a dedicated store (not just free-text memory): drafting/booking/escalation
 * decisions need RELIABLE structured lookups (noMeetingWindows, vip list,
 * decisionAuthority) — not a fuzzy semantic search. Free-text facts still live in
 * boult_memories; this is the structured spine.
 */
// @ts-ignore - JS module
import { getSupabaseAdmin } from '../../supabase.js';
import { normalizeUserId } from '../user-id';

export interface UserModel {
  role?: string;
  company?: string;
  businessContext?: string;
  communicationStyle?: {
    directness?: number;       // 0-100
    warmth?: number;
    formality?: number;
    length?: 'brief' | 'normal' | 'detailed';
    signoff?: string;
    bannedPhrases?: string[];
  };
  workPatterns?: {
    workingHours?: { start?: string; end?: string };  // "09:00".."18:00"
    timezone?: string;
    noMeetingWindows?: string[];                       // ["before 10am", "Fri afternoons"]
    focusBlocks?: string[];
    responseSpeed?: string;
  };
  relationships?: {
    vip?: string[];            // always personal handling
    trusted?: string[];        // drafting OK
    transactional?: string[];  // agent handles fully
  };
  decisionAuthority?: {
    strategic?: string;        // "user decides"
    tactical?: string;         // "agent recommends"
    routine?: string;          // "agent handles"
  };
  preferences?: {
    meetingDefaults?: Record<string, any>;
    declinePolitely?: boolean;
    dealConstraints?: Record<string, any>;
  };
  painPoints?: string[];
  priorities?: string[];
}

const EMPTY: UserModel = {};

/** Load the user's model (always returns an object; {} if none yet). */
export async function getUserModel(userId: string): Promise<UserModel> {
  try {
    const supabase = getSupabaseAdmin();
    const { data } = await supabase
      .from('boult_user_model')
      .select('model')
      .eq('user_id', normalizeUserId(userId))
      .maybeSingle();
    return (data?.model as UserModel) || { ...EMPTY };
  } catch (e: any) {
    console.warn('[user-model] load threw:', e?.message);
    return { ...EMPTY };
  }
}

/** Deep-merge `patch` into the stored model (arrays union by value, objects merge). */
export async function updateUserModel(userId: string, patch: Partial<UserModel>): Promise<UserModel> {
  const uid = normalizeUserId(userId);
  try {
    const current = await getUserModel(uid);
    const merged = deepMerge(current, patch) as UserModel;
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from('boult_user_model')
      .upsert({ user_id: uid, model: merged, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    if (error) console.warn('[user-model] save failed:', error.message);
    return merged;
  } catch (e: any) {
    console.warn('[user-model] update threw:', e?.message);
    return getUserModel(uid);
  }
}

/**
 * Render the model as a compact prompt block the planner/executor can read.
 * Only includes populated fields — no empty scaffolding noise.
 */
export function renderUserModel(m: UserModel): string {
  if (!m || !Object.keys(m).length) return '';
  const L: string[] = [];
  if (m.role || m.company) L.push(`Who: ${[m.role, m.company].filter(Boolean).join(' @ ')}`);
  if (m.businessContext) L.push(`Context: ${m.businessContext}`);
  const cs = m.communicationStyle;
  if (cs && Object.keys(cs).length) {
    const bits: string[] = [];
    if (cs.directness != null) bits.push(`directness ${cs.directness}/100`);
    if (cs.warmth != null) bits.push(`warmth ${cs.warmth}/100`);
    if (cs.length) bits.push(`length ${cs.length}`);
    if (cs.signoff) bits.push(`signs off "${cs.signoff}"`);
    if (cs.bannedPhrases?.length) bits.push(`never write: ${cs.bannedPhrases.join(', ')}`);
    if (bits.length) L.push(`Voice: ${bits.join('; ')}`);
  }
  const wp = m.workPatterns;
  if (wp && Object.keys(wp).length) {
    const bits: string[] = [];
    if (wp.workingHours?.start) bits.push(`hours ${wp.workingHours.start}-${wp.workingHours.end || ''}`);
    if (wp.timezone) bits.push(wp.timezone);
    if (wp.noMeetingWindows?.length) bits.push(`no meetings: ${wp.noMeetingWindows.join(', ')}`);
    if (bits.length) L.push(`Work: ${bits.join('; ')}`);
  }
  const r = m.relationships;
  if (r) {
    if (r.vip?.length) L.push(`VIPs (always personal): ${r.vip.join(', ')}`);
    if (r.transactional?.length) L.push(`Handle fully: ${r.transactional.join(', ')}`);
  }
  if (m.priorities?.length) L.push(`Priorities: ${m.priorities.join(', ')}`);
  if (m.painPoints?.length) L.push(`Pain points: ${m.painPoints.join(', ')}`);
  return L.length ? `USER MODEL (what I know about you — never re-ask these):\n${L.map(l => `- ${l}`).join('\n')}` : '';
}

function deepMerge(base: any, patch: any): any {
  if (Array.isArray(base) && Array.isArray(patch)) {
    return Array.from(new Set([...base, ...patch]));
  }
  if (isObj(base) && isObj(patch)) {
    const out: any = { ...base };
    for (const k of Object.keys(patch)) {
      out[k] = k in base ? deepMerge(base[k], patch[k]) : patch[k];
    }
    return out;
  }
  return patch === undefined ? base : patch;
}
function isObj(v: any): boolean {
  return v && typeof v === 'object' && !Array.isArray(v);
}
