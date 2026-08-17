/**
 * Boult Gmail scope preflight + invalidation.
 *
 * Why: Gmail returns 403 the moment a token lacks any of the scopes the call
 * needs (gmail.readonly, gmail.modify, gmail.send, …). Token refresh does NOT
 * help — refresh tokens keep the same scopes — so the only fix is the user
 * re-running the OAuth consent screen with the missing scopes. Letting the
 * LLM hit 403 mid-task and surface a generic error string was the failure
 * mode the user reported.
 *
 * This module makes 403 effectively invisible by checking *before* the loop
 * runs (preflight, cached for 1 hour) and by invalidating the cache + raising
 * a `connector_required` event the moment a 403 sneaks past the preflight.
 *
 * Auto-recovery caveat: OAuth's design requires explicit user consent for
 * scope expansion — we cannot silently re-grant. The UX optimization here is
 * (a) detect early, (b) one-click reconnect via the existing connectors
 * modal, (c) cache so we don't re-check on every turn.
 */

// @ts-ignore — JS module, no .d.ts
import { getSupabaseAdmin } from '../supabase.js';
// @ts-ignore
import { decrypt } from '../crypto.js';

import { normalizeUserId } from './user-id';
import { googleFetch } from './tools/http-tokens';

const TABLE = 'boult_integrations';
const TTL_MS = 60 * 60 * 1000; // 1 hour — Gmail scope changes are rare

export interface ScopeCheckResult {
  /** True iff Gmail responds 200 to a cheap /profile call. */
  ok: boolean;
  /** Set when ok=false. 'not_connected' | 'scope_missing' | 'transient'. */
  reason?: 'not_connected' | 'scope_missing' | 'transient';
  /** Set when ok=false and reason==='transient'. */
  status?: number;
}

/**
 * Cheap Gmail probe. Uses /users/me/profile (8KB response, no quota).
 * Reads the cache first; only hits Google when the cache is stale.
 */
export async function verifyGmailScopes(userId: string): Promise<ScopeCheckResult> {
  try {
    const supabase = getSupabaseAdmin();
    const uid = normalizeUserId(userId);

    // 1) Pull token + cache state in one round trip
    const { data, error } = await supabase
      .from(TABLE)
      .select('access_token, refresh_token, scope_ok_until')
      .eq('user_id', uid)
      .eq('provider', 'gmail')
      .maybeSingle();
    if (error || !data?.access_token) {
      return { ok: false, reason: 'not_connected' };
    }

    // 2) Cache hit — skip the probe
    const cacheTs = data.scope_ok_until ? Date.parse(data.scope_ok_until) : 0;
    if (cacheTs && cacheTs > Date.now()) {
      return { ok: true };
    }

    // 3) Probe /profile. A Composio-managed row stores `composio:<accountId>`,
    //    not a bearer token — its live Google token is masked and can't be used
    //    directly, so route the probe through googleFetch, which proxies via
    //    Composio's Execute path (masking-proof) for managed users and does the
    //    direct authed call for legacy Google sign-in.
    let token = decrypt(data.access_token);
    const isComposio = token.startsWith('composio:');
    const probe = async () =>
      googleFetch(uid, 'gmail', 'https://gmail.googleapis.com/gmail/v1/users/me/profile', {
        headers: { Authorization: `Bearer ${token}` },
      });

    let res = await probe();

    // 4) On 401 try a refresh before declaring scope-missing. 401 here means
    //    the access token expired; the refresh token may still be valid and
    //    carry the same scopes. If refresh succeeds, retry once. (Legacy only —
    //    Composio refreshes server-side, so its proxy never 401s on expiry.)
    if (res.status === 401 && !isComposio) {
      const refreshed = await refreshGmailAccessToken(uid);
      if (refreshed) {
        token = refreshed;
        res = await probe();
      }
    }

    if (res.status === 200) {
      const nextOk = new Date(Date.now() + TTL_MS).toISOString();
      await supabase
        .from(TABLE)
        .update({ scope_ok_until: nextOk })
        .eq('user_id', uid)
        .eq('provider', 'gmail');
      return { ok: true };
    }

    // A Composio-managed account gets a fixed, verified scope set from Composio's
    // OAuth client — there's no user-side reconsent to expand scopes, so a non-200
    // is never actionable as 'scope_missing'. Treat it as transient and don't nag.
    if (res.status === 403 && !isComposio) {
      // Scopes are missing — clear cache so the next turn re-checks if the
      // user has reconnected by then.
      await supabase
        .from(TABLE)
        .update({ scope_ok_until: null })
        .eq('user_id', uid)
        .eq('provider', 'gmail');
      return { ok: false, reason: 'scope_missing' };
    }

    // Transient — leave cache alone, don't block the user
    return { ok: false, reason: 'transient', status: res.status };
  } catch {
    // Network blip, etc. — fail soft (don't block the loop)
    return { ok: true };
  }
}

/**
 * Mark the cache stale so the next preflight re-probes. Called by the loop
 * when an in-flight Gmail tool returns gmail_scope_missing.
 */
export async function invalidateGmailScope(userId: string): Promise<void> {
  try {
    const supabase = getSupabaseAdmin();
    await supabase
      .from(TABLE)
      .update({ scope_ok_until: null })
      .eq('user_id', normalizeUserId(userId))
      .eq('provider', 'gmail');
  } catch {
    /* non-fatal */
  }
}

/**
 * Use the stored refresh token to mint a new access token and persist it.
 * Returns the new access token on success, or null on any failure.
 *
 * Duplicates the smaller surface of tools.ts/refreshGoogleToken so this
 * module doesn't have to import tools.ts (which would create a circular
 * dependency).
 */
async function refreshGmailAccessToken(userId: string): Promise<string | null> {
  try {
    const supabase = getSupabaseAdmin();
    const { data } = await supabase
      .from(TABLE)
      .select('refresh_token')
      .eq('user_id', userId)
      .eq('provider', 'gmail')
      .maybeSingle();
    if (!data?.refresh_token) return null;

    const refresh = decrypt(data.refresh_token);
    // Composio rows carry no local refresh token; never attempt a Google
    // refresh for them (the marker isn't a real refresh_token).
    if (refresh.startsWith('composio:')) return null;
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) return null;

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refresh,
      }),
      signal: AbortSignal.timeout(6000),
    });
    if (!tokenRes.ok) return null;
    const body = await tokenRes.json();
    const next = body.access_token as string | undefined;
    if (!next) return null;

    // @ts-ignore — JS module
    const { encrypt } = await import('../crypto.js');
    await supabase
      .from(TABLE)
      .update({ access_token: encrypt(next) })
      .eq('user_id', userId)
      .eq('provider', 'gmail');

    return next;
  } catch {
    return null;
  }
}
