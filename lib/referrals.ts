/**
 * Maily referrals — codes, attribution, and payout.
 *
 * THE DEAL
 *   Friend  → a free MONTH instead of the 3-day trial.
 *   You     → +30 free days when that friend actually pays.
 *
 * Why the reward lands on payment and not on signup: a reward you can mint with
 * a throwaway Gmail is not a reward, it is a faucet. Requiring a real payment
 * makes farming self-defeating — you would have to pay us more than the reward
 * is worth to earn it.
 *
 * Free time is expressed as `preferences.free_pro_until` on user_profiles
 * because the access gate ALREADY honors that field (subscription-service:
 * hasActiveFreePro → isSubscriptionActive → getUserPlanType). Inventing a
 * parallel entitlement would mean a second thing to keep in sync with billing,
 * and the two would drift. Every grant is ALSO appended to referral_rewards so
 * the balance stays explainable.
 */

import { getSupabaseAdmin } from './supabase.js';

const REFERRER_DAYS = 30;   // what you earn per paying friend
const REFERRED_DAYS = 30;   // the friend's free month, in place of the 3-day trial

/** Ambiguity-free alphabet: no O/0, I/1/L — these codes get read aloud and retyped. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function randomCode(len = 6): string {
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return out;
}

function norm(email: string): string {
  return String(email || '').trim().toLowerCase();
}

/**
 * Gmail treats dots and +tags as noise: alice@gmail.com, a.l.i.c.e@gmail.com and
 * alice+x@gmail.com are ONE inbox. Without canonicalising, a referrer can invite
 * "themselves" a dozen times from the same mailbox and the unique index on
 * referred_user_id never fires. Used ONLY for fraud comparison, never for
 * storage or lookup.
 */
function canonicalIdentity(email: string): string {
  const e = norm(email);
  const [local, domain] = e.split('@');
  if (!local || !domain) return e;
  const isGoogle = domain === 'gmail.com' || domain === 'googlemail.com';
  let l = local.split('+')[0];
  if (isGoogle) l = l.replace(/\./g, '');
  return `${l}@${isGoogle ? 'gmail.com' : domain}`;
}

/** Stable per-user code. Idempotent — returns the existing one if there is one. */
export async function getOrCreateReferralCode(userId: string): Promise<string | null> {
  const uid = norm(userId);
  if (!uid) return null;
  const supabase = getSupabaseAdmin();

  try {
    const { data: existing } = await supabase
      .from('referral_codes')
      .select('code')
      .ilike('user_id', uid)
      .limit(1)
      .maybeSingle();
    if (existing?.code) return existing.code;

    // Retry on collision. 31^6 ≈ 887M, so this effectively never loops, but a
    // silent duplicate would hand two people the same link.
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = randomCode();
      const { error } = await supabase.from('referral_codes').insert({ code, user_id: uid });
      if (!error) return code;
      if (!String(error.message || '').toLowerCase().includes('duplicate')) break;
    }
  } catch (err) {
    console.error('[referrals] getOrCreateReferralCode failed:', (err as Error).message);
  }
  return null;
}

export async function resolveCode(code: string): Promise<string | null> {
  const raw = String(code || '').trim();
  if (!raw) return null;
  const supabase = getSupabaseAdmin();

  // 1. The real code table.
  try {
    const { data } = await supabase
      .from('referral_codes')
      .select('user_id')
      .eq('code', raw.toUpperCase())
      .limit(1)
      .maybeSingle();
    if (data?.user_id) return norm(data.user_id);
  } catch { /* fall through to legacy */ }

  // 2. LEGACY LINKS. Before referral_codes existed, the rewards card handed out
  //    /invite/<username-or-email-prefix>, and those links are already in
  //    people's WhatsApp threads. Dropping them would silently break every
  //    referral shared to date — the friend gets no free month and the referrer
  //    never gets paid, with nothing anywhere saying why.
  //
  //    The original lookup was
  //        .or(`username.ilike.${code},user_id.ilike.${code}@%`)
  //    which interpolated raw input into a filter string. Rebuilt as two
  //    parameterised queries with .limit(1) — never .maybeSingle(), which
  //    ERRORS rather than returning a row when two profiles match.
  const legacy = raw.toLowerCase();
  // Only plausible identifiers reach the DB; a code with quotes or commas would
  // otherwise be handed to the query builder.
  if (!/^[a-z0-9._+-]{2,64}$/.test(legacy)) return null;

  try {
    const { data: byUsername } = await supabase
      .from('user_profiles')
      .select('user_id')
      .eq('username', legacy)
      .limit(1);
    if (byUsername?.[0]?.user_id) return norm(byUsername[0].user_id);

    // Email local-part: "alice" → alice@anything. Anchored with @ so "ali"
    // cannot match "alice@…", which the old prefix match happily did.
    const { data: byEmail } = await supabase
      .from('user_profiles')
      .select('user_id')
      .ilike('user_id', `${legacy}@%`)
      .limit(2); // 2 so we can DETECT ambiguity instead of picking blindly
    if (byEmail && byEmail.length === 1 && byEmail[0]?.user_id) {
      return norm(byEmail[0].user_id);
    }
    if (byEmail && byEmail.length > 1) {
      // Two people share an email local part on different domains. Paying the
      // wrong person is worse than paying nobody, so refuse.
      console.warn(`[referrals] legacy code "${legacy}" is ambiguous — refusing to attribute`);
      return null;
    }
  } catch (err) {
    console.error('[referrals] legacy resolve failed:', (err as Error).message);
  }
  return null;
}

export interface AttributionResult {
  ok: boolean;
  reason?: 'no_code' | 'unknown_code' | 'self_referral' | 'already_referred' | 'error';
  referrerUserId?: string;
}

/**
 * Called ONCE, when a referred user signs up. Records the referral and gives the
 * friend their free month immediately — the gift has to be real at the moment
 * they arrive, or the person who shared the link looks like they oversold it.
 */
export async function attributeSignup(newUserEmail: string, code: string): Promise<AttributionResult> {
  const referred = norm(newUserEmail);
  if (!referred) return { ok: false, reason: 'error' };
  if (!code) return { ok: false, reason: 'no_code' };

  const referrer = await resolveCode(code);
  if (!referrer) return { ok: false, reason: 'unknown_code' };

  // Self-referral, including the gmail dot/plus trick.
  if (canonicalIdentity(referrer) === canonicalIdentity(referred)) {
    return { ok: false, reason: 'self_referral', referrerUserId: referrer };
  }

  const supabase = getSupabaseAdmin();
  try {
    const { error } = await supabase.from('referrals').insert({
      code: String(code).trim().toUpperCase(),
      referrer_user_id: referrer,
      referred_user_id: referred,
      status: 'signed_up',
    });

    // The unique index on referred_user_id is the real guard — a person can only
    // be referred once, ever, no matter how many links they click.
    if (error) {
      if (String(error.message || '').toLowerCase().includes('duplicate')) {
        return { ok: false, reason: 'already_referred', referrerUserId: referrer };
      }
      throw error;
    }

    await grantFreeDays(referred, REFERRED_DAYS, 'referred_welcome');
    return { ok: true, referrerUserId: referrer };
  } catch (err) {
    console.error('[referrals] attributeSignup failed:', (err as Error).message);
    return { ok: false, reason: 'error' };
  }
}

/**
 * Called when a referred user makes their first real payment. Pays the referrer.
 * Idempotent on rewarded_at, so a webhook replay cannot double-pay.
 * Returns the referrer's email when a reward was actually granted.
 */
export async function rewardOnConversion(referredUserEmail: string): Promise<string | null> {
  const referred = norm(referredUserEmail);
  if (!referred) return null;
  const supabase = getSupabaseAdmin();

  try {
    const { data: rows } = await supabase
      .from('referrals')
      .select('id, referrer_user_id, rewarded_at')
      .ilike('referred_user_id', referred)
      .limit(1);

    const ref = rows?.[0];
    if (!ref) return null;
    if (ref.rewarded_at) return null; // already paid — replay, not a new conversion

    const until = await grantFreeDays(ref.referrer_user_id, REFERRER_DAYS, 'referrer_conversion', ref.id);
    if (!until) return null;

    await supabase
      .from('referrals')
      .update({
        status: 'converted',
        converted_at: new Date().toISOString(),
        rewarded_at: new Date().toISOString(),
        reward_days: REFERRER_DAYS,
        updated_at: new Date().toISOString(),
      })
      .eq('id', ref.id);

    return ref.referrer_user_id;
  } catch (err) {
    console.error('[referrals] rewardOnConversion failed:', (err as Error).message);
    return null;
  }
}

/**
 * Add free days to an account, STACKING from whichever is later: now, or an
 * existing grant. Stacking from `now` when a grant is still live would silently
 * burn the remaining time — refer two friends in one week and you would end up
 * with one month, not two.
 */
export async function grantFreeDays(
  userId: string,
  days: number,
  reason: string,
  referralId?: string,
): Promise<string | null> {
  const uid = norm(userId);
  if (!uid || !days) return null;
  const supabase = getSupabaseAdmin();

  try {
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('preferences')
      .ilike('user_id', uid)
      .limit(1)
      .maybeSingle();

    const prefs = profile?.preferences || {};
    const existing = prefs.free_pro_until ? new Date(prefs.free_pro_until) : null;
    const now = new Date();
    const base = existing && existing > now ? existing : now;
    const until = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);

    prefs.free_pro_until = until.toISOString();
    prefs.plan = 'pro'; // mirrors the cached flag the rest of the app reads

    const { error } = await supabase
      .from('user_profiles')
      .update({ preferences: prefs, updated_at: now.toISOString() })
      .ilike('user_id', uid);
    if (error) throw error;

    await supabase.from('referral_rewards').insert({
      user_id: uid,
      days,
      reason,
      referral_id: referralId || null,
      granted_until: until.toISOString(),
    });

    return until.toISOString();
  } catch (err) {
    console.error('[referrals] grantFreeDays failed:', (err as Error).message);
    return null;
  }
}

export interface ReferralStats {
  code: string | null;
  link: string | null;
  invited: number;
  converted: number;
  monthsEarned: number;
  freeUntil: string | null;
  pending: number;
}

/** Everything the share screen renders. */
export async function getReferralStats(userId: string, origin: string): Promise<ReferralStats> {
  const uid = norm(userId);
  const empty: ReferralStats = { code: null, link: null, invited: 0, converted: 0, monthsEarned: 0, freeUntil: null, pending: 0 };
  if (!uid) return empty;

  try {
    const supabase = getSupabaseAdmin();
    const code = await getOrCreateReferralCode(uid);

    const { data: refs } = await supabase
      .from('referrals')
      .select('status, reward_days')
      .ilike('referrer_user_id', uid);

    const list = refs || [];
    const converted = list.filter(r => r.status === 'converted').length;

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('preferences')
      .ilike('user_id', uid)
      .limit(1)
      .maybeSingle();

    const until = profile?.preferences?.free_pro_until || null;
    const live = until && new Date(until) > new Date() ? until : null;

    return {
      code,
      link: code ? `${origin.replace(/\/$/, '')}/invite/${code}` : null,
      invited: list.length,
      converted,
      monthsEarned: converted, // one month per conversion, by definition of the deal
      freeUntil: live,
      pending: list.length - converted,
    };
  } catch (err) {
    console.error('[referrals] getReferralStats failed:', (err as Error).message);
    return empty;
  }
}

export const REFERRAL_TERMS = { REFERRER_DAYS, REFERRED_DAYS };
