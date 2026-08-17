/**
 * Boult tool layer — OAuth token resolution for Gmail / GCal / Notion / Slack.
 *
 * Pulled out of the 9500-line tools.ts in PART 39a. Every domain executor
 * (Gmail/Calendar/Notion/Slack) consults one of the get*Token helpers below
 * before hitting its upstream API. The Google helpers also know how to
 * refresh an expired token via the stored refresh_token.
 *
 * Token storage shape — historic V2 vs current V3 — is normalised here so
 * callers don't have to know which table the user's credentials happen to
 * live in.
 */

// @ts-ignore — JS module
import { getSupabaseAdmin } from '../../supabase.js';
// @ts-ignore — JS module
import { decrypt, encrypt } from '../../crypto.js';
import { normalizeUserId } from '../user-id';
import { failureResult, type ToolResult } from './types';

// Composio-managed connections store `composio:<accountId>` (encrypted) in
// boult_integrations.access_token — the live Google token lives on Composio's
// verified client and is resolved on demand. Kept as a local literal (not
// imported) so this hot token path never loads the Composio SDK unless a
// row actually uses it. There is deliberately NO local refresh for these
// rows: Composio refreshes server-side and the bridge's short token cache
// is the recovery window (see lib/boult/composio.ts).
const COMPOSIO_PREFIX = 'composio:';
async function resolveComposioToken(marker: string, force = false): Promise<string | null> {
  const { getComposioAccessToken } = await import('../composio');
  return getComposioAccessToken(marker.slice(COMPOSIO_PREFIX.length), { force });
}

/**
 * When COMPOSIO_TOOLS=1 AND this user's gmail/gcal is Composio-managed, return
 * the Composio connected-account id. Null otherwise — caller uses its direct
 * path. Cached per (uid,provider) to avoid a DB hit on every Google call in a
 * burst.
 */
const composioAcctCache = new Map<string, { id: string | null; at: number }>();
const ACCT_CACHE_TTL = 5 * 60 * 1000;
export async function composioAccountFor(
  userId: string,
  provider: 'gmail' | 'gcal' | 'gmeet',
): Promise<string | null> {
  const { composioToolsEnabled } = await import('../composio');
  if (!composioToolsEnabled()) return null;
  const uid = normalizeUserId(userId);
  const key = `${uid}|${provider}`;
  const c = composioAcctCache.get(key);
  if (c && Date.now() - c.at < ACCT_CACHE_TTL) return c.id;
  let id: string | null = null;
  try {
    const supabase = getSupabaseAdmin();
    const { data } = await supabase
      .from('boult_integrations')
      .select('access_token')
      .eq('user_id', uid)
      .eq('provider', provider)
      .maybeSingle();
    if (data?.access_token) {
      const dec = decrypt(data.access_token);
      if (dec.startsWith(COMPOSIO_PREFIX)) id = dec.slice(COMPOSIO_PREFIX.length);
    }
  } catch { /* null */ }
  composioAcctCache.set(key, { id, at: Date.now() });
  return id;
}

/**
 * fetch()-compatible Google request that TRANSPARENTLY routes through Composio
 * Proxy Execute for Composio-managed users (masking-proof: Composio injects the
 * token server-side and returns the RAW Google response), or does a direct
 * authenticated fetch for legacy users. Returns a real Response so every
 * executor's existing `.ok` / `.status` / `.json()` / `.text()` code is
 * UNCHANGED. This is the one seam that makes all ~38 Gmail/GCal executors
 * masking-proof without rewriting their parsing.
 *
 * `url` is the FULL Google URL (as the executors already build). For the proxy
 * path we strip the host to the path+query Composio expects.
 */
export async function googleFetch(
  userId: string,
  provider: 'gmail' | 'gcal',
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
): Promise<Response> {
  const accountId = await composioAccountFor(userId, provider);
  if (accountId) return composioFetchByAccount(accountId, provider, url, init);
  // Legacy direct path — unchanged behavior.
  return fetch(url, init as any);
}

/**
 * The Proxy Execute half of googleFetch, addressed by Composio connected-account
 * id instead of userId. Use when the caller already holds the account id — e.g.
 * a `composio:<accountId>` marker read straight out of boult_integrations — and
 * has no user identity in scope (GmailService constructed with just a token).
 */
export async function composioFetchByAccount(
  accountId: string,
  provider: 'gmail' | 'gcal',
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
): Promise<Response> {
  const { composioProxy } = await import('../composio');
  const u = new URL(url);
  const toolkit = provider === 'gmail' ? 'gmail' : 'googlecalendar';
  // Strip the host, then strip whatever the toolkit's OWN base URL already
  // carries — Composio prepends it, so anything we repeat here gets DOUBLED.
  //
  //   gmail          base https://gmail.googleapis.com  (no path)
  //                  -> send '/gmail/v1/users/me/...'          as-is
  //   googlecalendar base https://www.googleapis.com/calendar/v3
  //                  -> send '/calendars/primary/events', NOT
  //                     '/calendar/v3/calendars/primary/events'
  //
  // Getting this wrong is silent: the request still reaches Google, which
  // answers 404 with an HTML error page, so it reads like a missing resource
  // rather than a malformed URL. Verified live against a real connected
  // account — '/calendars/primary/events' returns 200, the '/calendar/v3'
  // -prefixed form returns 404.
  let endpoint = u.pathname + u.search;
  if (toolkit === 'googlecalendar') endpoint = endpoint.replace(/^\/calendar\/v3/, '');
  const method = (init?.method || 'GET').toUpperCase() as any;
  let body: any = undefined;
  if (init?.body) { try { body = JSON.parse(init.body); } catch { body = init.body; } }
  // Carry through non-auth headers (e.g. Content-Type) — never Authorization.
  const extra = Object.entries(init?.headers || {})
    .filter(([k]) => k.toLowerCase() !== 'authorization')
    .map(([name, value]) => ({ name, value: String(value) }));
  try {
    const r = await composioProxy(accountId, toolkit, endpoint, method, body, extra);
    // Rebuild a real Response so callers' .ok/.json()/.text() just work.
    const status = r.status || 502;
    const payload = r.data == null ? '' : (typeof r.data === 'string' ? r.data : JSON.stringify(r.data));
    // 204/205/304 are null-body statuses — the Response constructor THROWS if you
    // hand them any body, even ''. DELETEs (Gmail drafts, Calendar events) return
    // 204, so without this a successful delete would throw into the catch below
    // and surface as a fabricated 502.
    const nullBody = status === 204 || status === 205 || status === 304;
    return new Response(nullBody ? null : payload, {
      status,
      headers: { 'content-type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: { message: e?.message || 'proxy failed' } }), { status: 502, headers: { 'content-type': 'application/json' } });
  }
}

/** True when a stored/decrypted token is a Composio marker, not a bearer token. */
export function isComposioMarker(token: unknown): token is string {
  return typeof token === 'string' && token.startsWith(COMPOSIO_PREFIX);
}

/**
 * Does the login token in user_tokens actually carry the scope a caller needs?
 *
 * The `user_tokens` row is the LOGIN token. That used to be a safe fallback for
 * Gmail and Calendar because our own OAuth client requested those scopes at
 * sign-in. Under Composio, login requests `openid email profile` ONLY (see
 * LOGIN_SCOPE in lib/auth.js) — so for anyone who signed up after that flag went
 * on, the login token can NEVER satisfy Gmail or Calendar. Returning it anyway
 * produced a truthy token that sailed past every `if (!token)` gate and then
 * died at Google with a 403, which the UI reported as the confusing "your token
 * has Gmail scopes but not Calendar scopes".
 *
 * We check the granted scope string persisted at login (auth.js stores
 * `account.scope`) rather than the env flag, because users are MIXED: legacy
 * accounts still hold full-scope login tokens and must keep working.
 *
 * Absent/empty scopes means a pre-scopes-column row — treat as permitted so we
 * never regress an old account that would otherwise work.
 */
function loginTokenHasScope(scopes: unknown, need: 'gmail' | 'gcal'): boolean {
  if (typeof scopes !== 'string' || !scopes.trim()) return true;
  return need === 'gmail'
    ? /mail\.google\.com|auth\/gmail\./.test(scopes)
    : /auth\/calendar/.test(scopes);
}

/** Extract the connected-account id from a `composio:<accountId>` marker. */
export function composioAccountIdFromMarker(marker: string): string {
  return marker.slice(COMPOSIO_PREFIX.length);
}

/**
 * Refresh a Google access token using the stored refresh token.
 * Stores the new access token back wherever the credentials currently live
 * (boult_integrations → integration_credentials → user_tokens, in priority order).
 * Returns the new access token, or null if refresh fails.
 */
export async function refreshGoogleToken(userId: string): Promise<string | null> {
  try {
    const supabase = getSupabaseAdmin();
    const uid = normalizeUserId(userId);

    // 0. Composio-managed rows have no local refresh_token — Composio refreshes
    // on its side. A "refresh" here means: bust the bridge cache and re-fetch
    // the live token (used by the caller's 401-retry path). This must run
    // BEFORE the own-client branches so a Composio row never falls through to
    // a Google refresh it can't do.
    const { data: composioRow } = await supabase
      .from('boult_integrations')
      .select('access_token')
      .eq('user_id', uid)
      .in('provider', ['gcal', 'gmail'])
      .maybeSingle();
    if (composioRow?.access_token) {
      const dec = decrypt(composioRow.access_token);
      // Masked secrets mean the live token is usually unreachable — hand back the
      // marker so the caller's 401-retry re-issues through the proxy rather than
      // treating a null as "refresh failed / needs reauth".
      if (dec.startsWith(COMPOSIO_PREFIX)) return (await resolveComposioToken(dec, true)) || dec;
    }

    // 1. Try to find in boult_integrations (V3)
    const { data: v3 } = await supabase
      .from('boult_integrations')
      .select('refresh_token, provider')
      .eq('user_id', uid)
      .in('provider', ['gcal', 'gmail'])
      .maybeSingle();

    if (v3?.refresh_token) {
      const refreshToken = decrypt(v3.refresh_token);
      const newToken = await performGoogleRefresh(refreshToken);
      if (newToken) {
        await supabase
          .from('boult_integrations')
          .update({
            access_token: encrypt(newToken),
            expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', uid)
          .eq('provider', v3.provider);
        return newToken;
      }
    }

    // 2. Try to find in integration_credentials (legacy V2)
    const { data: legacy } = await supabase
      .from('integration_credentials')
      .select('encrypted_refresh_token, refresh_token, provider')
      .eq('user_id', uid)
      .in('provider', ['google_calendar', 'google'])
      .maybeSingle();

    if (legacy) {
      const encryptedRf = legacy.encrypted_refresh_token || (legacy.refresh_token ? encrypt(legacy.refresh_token) : null);
      if (encryptedRf) {
        const refreshToken = decrypt(encryptedRf);
        const newToken = await performGoogleRefresh(refreshToken);
        if (newToken) {
          await supabase
            .from('integration_credentials')
            .update({
              encrypted_access_token: encrypt(newToken),
              access_token: newToken,
              expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('user_id', uid)
            .eq('provider', legacy.provider);
          return newToken;
        }
      }
    }

    // 3. Fallback to user_tokens
    const { data: ut } = await supabase
      .from('user_tokens')
      .select('encrypted_refresh_token')
      .or(`user_id.ilike."${uid}",google_email.ilike."${uid}"`)
      .limit(1)
      .maybeSingle();

    if (ut?.encrypted_refresh_token) {
      const refreshToken = decrypt(ut.encrypted_refresh_token);
      const newToken = await performGoogleRefresh(refreshToken);
      if (newToken) {
        await supabase
          .from('user_tokens')
          .update({
            encrypted_access_token: encrypt(newToken),
            access_token_expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
            updated_at: new Date().toISOString(),
          })
          .or(`user_id.ilike."${uid}",google_email.ilike."${uid}"`);
        return newToken;
      }
    }

    return null;
  } catch {
    return null;
  }
}

export async function performGoogleRefresh(refreshToken: string): Promise<string | null> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) return null;
  const json = await res.json();
  return json.access_token || null;
}

// Google access tokens live ~1 hour. We refresh PROACTIVELY when the stored
// token is within this buffer of expiry (or already expired, or has no recorded
// expiry), so API calls never hit a stale token, fail with 401, and falsely
// trip "needs reauth" — the root cause of users losing Gmail/Calendar daily.
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000; // 5 minutes

function isExpiredOrExpiring(expiresAt: string | null | undefined): boolean {
  if (!expiresAt) return true; // no recorded expiry → treat as stale, refresh to be safe
  const t = new Date(expiresAt).getTime();
  if (!Number.isFinite(t)) return true;
  return t - Date.now() <= TOKEN_REFRESH_BUFFER_MS;
}

export async function getGmailToken(userId: string): Promise<string | null> {
  try {
    const supabase = getSupabaseAdmin();
    const uid = normalizeUserId(userId);

    // 1. boult_integrations (V3 OAuth flow) — proactively refresh if expiring.
    const { data: v3 } = await supabase
      .from('boult_integrations')
      .select('access_token, expires_at')
      .eq('user_id', uid)
      .eq('provider', 'gmail')
      .maybeSingle();
    if (v3?.access_token) {
      const dec = decrypt(v3.access_token);
      // Composio-managed row — try for the live Google token, but Composio masks
      // connected-account secrets permanently, so that usually comes back null.
      // Fall back to the marker itself: it's a truthy "Gmail IS connected" signal
      // that callers' `if (!token)` gates accept, and both googleFetch and
      // GmailService recognize it and route through Proxy Execute instead of
      // sending it as a bearer. Never usable as a credential by itself.
      if (dec.startsWith(COMPOSIO_PREFIX)) return (await resolveComposioToken(dec)) || dec;
      if (isExpiredOrExpiring(v3.expires_at)) {
        const refreshed = await refreshGoogleToken(uid);
        if (refreshed) return refreshed;
        // Refresh failed but we still have a token — return it; the caller's
        // 401-retry path + markIntegrationNeedsReauth handle a truly-dead grant.
      }
      return dec;
    }

    // 2. integration_credentials (legacy OAuth flow)
    const { data: legacy } = await supabase
      .from('integration_credentials')
      .select('encrypted_access_token, expires_at')
      .eq('user_id', uid)
      .eq('provider', 'google')
      .maybeSingle();
    if (legacy?.encrypted_access_token) {
      if (isExpiredOrExpiring(legacy.expires_at)) {
        const refreshed = await refreshGoogleToken(uid);
        if (refreshed) return refreshed;
      }
      return decrypt(legacy.encrypted_access_token);
    }

    // 3. user_tokens (populated automatically on Google login via NextAuth)
    // .limit(1) is REQUIRED: a user with >1 token row (re-login, email-vs-uid
    // dupes) makes a bare .maybeSingle() return {data:null, error} — which used
    // to fall through to "Gmail not connected" for a fully-connected account.
    const { data: ut } = await supabase
      .from('user_tokens')
      .select('encrypted_access_token, access_token_expires_at, scopes')
      .or(`user_id.ilike."${uid}",google_email.ilike."${uid}"`)
      .limit(1)
      .maybeSingle();
    if (ut?.encrypted_access_token && loginTokenHasScope(ut.scopes, 'gmail')) {
      if (isExpiredOrExpiring(ut.access_token_expires_at)) {
        const refreshed = await refreshGoogleToken(uid);
        if (refreshed) return refreshed;
      }
      return decrypt(ut.encrypted_access_token);
    }

    return null;
  } catch {
    return null;
  }
}

export async function getGcalToken(userId: string): Promise<string | null> {
  try {
    const supabase = getSupabaseAdmin();
    const uid = normalizeUserId(userId);

    // 1. boult_integrations (V3 OAuth flow) — proactively refresh if expiring.
    const { data: v3 } = await supabase
      .from('boult_integrations')
      .select('access_token, expires_at')
      .eq('user_id', uid)
      .eq('provider', 'gcal')
      .maybeSingle();
    if (v3?.access_token) {
      const dec = decrypt(v3.access_token);
      // Composio-managed row — see the note in getGmailToken: the live token is
      // masked, so fall back to the marker, which googleFetch routes via proxy.
      if (dec.startsWith(COMPOSIO_PREFIX)) return (await resolveComposioToken(dec)) || dec;
      if (isExpiredOrExpiring(v3.expires_at)) {
        const refreshed = await refreshGoogleToken(uid);
        if (refreshed) return refreshed;
      }
      return dec;
    }

    // 2. integration_credentials (legacy OAuth flow)
    const { data: legacy } = await supabase
      .from('integration_credentials')
      .select('encrypted_access_token, expires_at')
      .eq('user_id', uid)
      .eq('provider', 'google_calendar')
      .maybeSingle();
    if (legacy?.encrypted_access_token) {
      if (isExpiredOrExpiring(legacy.expires_at)) {
        const refreshed = await refreshGoogleToken(uid);
        if (refreshed) return refreshed;
      }
      return decrypt(legacy.encrypted_access_token);
    }

    // 3. user_tokens — ONLY when that login token actually granted Calendar.
    // It no longer does for Composio-era signups (login is identity-only), and
    // handing back a scope-less token here is exactly what produced the bogus
    // "reconnect Calendar — your token has Gmail scopes but not Calendar scopes"
    // on accounts that had simply never connected Calendar at all.
    // .limit(1) guards against the multi-row .maybeSingle() error — see
    // getGmailToken for why this silently broke connected accounts.
    const { data: ut } = await supabase
      .from('user_tokens')
      .select('encrypted_access_token, access_token_expires_at, scopes')
      .or(`user_id.ilike."${uid}",google_email.ilike."${uid}"`)
      .limit(1)
      .maybeSingle();
    if (ut?.encrypted_access_token && loginTokenHasScope(ut.scopes, 'gcal')) {
      if (isExpiredOrExpiring(ut.access_token_expires_at)) {
        const refreshed = await refreshGoogleToken(uid);
        if (refreshed) return refreshed;
      }
      return decrypt(ut.encrypted_access_token);
    }

    return null;
  } catch {
    return null;
  }
}

export async function getNotionToken(userId: string): Promise<string | null> {
  try {
    const supabase = getSupabaseAdmin();
    // Check both 'notion' and 'notion_calendar' — they share the same OAuth
    // token but users may have connected only one of the two.
    const { data } = await supabase
      .from('boult_integrations')
      .select('access_token')
      .eq('user_id', userId)
      .in('provider', ['notion', 'notion_calendar'])
      .limit(1)
      .maybeSingle();
    if (data?.access_token) return decrypt(data.access_token);
    return null;
  } catch {
    return null;
  }
}

export async function getSlackToken(userId: string): Promise<string | null> {
  try {
    const supabase = getSupabaseAdmin();
    const { data } = await supabase
      .from('boult_integrations')
      .select('access_token')
      .eq('user_id', userId)
      .eq('provider', 'slack')
      .maybeSingle();
    if (data?.access_token) return decrypt(data.access_token);
    return null;
  } catch {
    return null;
  }
}

// ── Scope error helpers ──────────────────────────────────────────────────────

/**
 * Shown when the Calendar API rejects the token for lack of calendar scope.
 * This happens when the only Google token on file is the Gmail/login token
 * (no calendar.events scope). The fix is a dedicated Calendar reconnect.
 */
export const CALENDAR_SCOPE_MESSAGE =
  'I need calendar access to do that. The current Google connection only has email permissions. ' +
  'Open the connectors button in the prompt box, pick Google Calendar, finish the Google sign-in, and ask me again.';

/**
 * PART 68 — When a Google product (Gmail or Calendar) consistently returns a
 * scope error after a refresh attempt, the integration row is stale and the
 * UI is wrongly showing "Connected." Mark it as needs-reauth so the next
 * /api/connectors fetch reports the truth and the prompt-box icon updates.
 *
 * We don't delete the row outright (the user may have other Google products
 * still working off the same OAuth grant); we set status='needs_reauth' and
 * stamp last_scope_error_at. The /api/connectors endpoint treats
 * needs_reauth as "show as disconnected with a reconnect prompt."
 */
export async function markIntegrationNeedsReauth(userId: string, provider: 'gmail' | 'gcal'): Promise<void> {
  try {
    const supabase = getSupabaseAdmin();
    const uid = normalizeUserId(userId);
    const nowIso = new Date().toISOString();
    // boult_integrations is the source of truth for the prompt-box UI.
    await supabase
      .from('boult_integrations')
      .update({ status: 'needs_reauth', updated_at: nowIso })
      .eq('user_id', uid)
      .eq('provider', provider);
    // Belt-and-braces — also mark the legacy table if a row lives there.
    const legacyKey = provider === 'gmail' ? 'google' : 'google_calendar';
    await supabase
      .from('integration_credentials')
      .update({ status: 'needs_reauth', updated_at: nowIso })
      .eq('user_id', uid)
      .eq('provider', legacyKey);
    // Invalidate scope-probe cache so the next chat turn re-checks.
    if (provider === 'gmail') {
      try {
        const { invalidateGmailScope } = await import('../gmail-scope');
        await invalidateGmailScope(uid);
      } catch { /* non-fatal */ }
    }
  } catch (err) {
    // Best-effort — UI still shows the connector_required card from the
    // emitted SSE event, so the user has a path forward either way.
    console.warn('[Boult:tokens] markIntegrationNeedsReauth failed:', (err as any)?.message);
  }
}

/**
 * Gmail returns 403 when the OAuth token does not carry one of the Gmail
 * scopes the call requires (e.g. gmail.readonly, gmail.modify, gmail.send).
 * Most often this hits users who connected Google Sign-In before Boult added
 * Gmail-specific permissions. The fix is a Gmail reconnect from the connectors
 * modal, which re-runs the OAuth consent screen with the missing scopes.
 */
export const GMAIL_SCOPE_MESSAGE =
  'I need Gmail access to do that. The current Google token is missing the required Gmail permissions. ' +
  'Open the connectors button in the prompt box, pick Gmail, finish the Google sign-in, and ask me again.';

/**
 * A *scope* error means the token is valid but lacks the permission the call
 * needs — Google signals this with **403** (insufficientPermissions /
 * ACCESS_TOKEN_SCOPE_INSUFFICIENT). The fix for that is a reconnect.
 *
 * A **401** is NOT a scope error: it means the access token is expired or
 * invalid. Every caller already runs a refresh-and-retry before reaching this
 * check, so a surviving 401 is a transient auth failure (refresh blip, network
 * error, clock skew) — it must fall through to a retryable "upstream" failure,
 * NOT a reconnect card. Treating 401 as a scope error was telling users to
 * reconnect Google Calendar even though their connection was never broken.
 */
export function isScopeError(status: number): boolean {
  return status === 403;
}

/**
 * A Google 403 means ONE of two completely different things, and the response
 * body is the only way to tell them apart:
 *
 *   'scope' — the token genuinely lacks a required OAuth scope. Body carries
 *             `ACCESS_TOKEN_SCOPE_INSUFFICIENT` / "insufficient authentication
 *             scopes" / `insufficientPermissions`. THIS is the only 403 that
 *             should produce a reconnect card + flip the integration to
 *             needs_reauth.
 *
 *   'rate'  — Google is throttling the user/app: `rateLimitExceeded`,
 *             `userRateLimitExceeded`, `dailyLimitExceeded`, `quotaExceeded`
 *             (domain usageLimits). The connection is perfectly healthy and
 *             the call must simply be retried later.
 *
 * Treating EVERY 403 as a scope error was the root cause of healthy Gmail/
 * Calendar accounts being flipped to needs_reauth (shown as "disconnected,
 * reconnect") the instant a bulk inbox sweep tripped Google's per-user rate
 * limit. An unrecognised 403 defaults to 'rate' on purpose: a false "you're
 * throttled, I'll retry" is harmless and self-healing, whereas a false
 * "reconnect" corrupts a working integration and is what users were hitting.
 */
export function classifyGoogle403(body: string): 'scope' | 'rate' {
  const lower = (body || '').toLowerCase();
  if (
    lower.includes('access_token_scope_insufficient') ||
    lower.includes('insufficient authentication scopes') ||
    lower.includes('insufficientpermissions') ||
    lower.includes('insufficient permission')
  ) {
    return 'scope';
  }
  return 'rate';
}

/**
 * Pick the right failure for a non-ok Gmail response. A 403 is split into a
 * true scope error (reconnect) vs. a transient rate-limit (retry) by reading
 * the body — see classifyGoogle403. 404 is a missing message/thread; everything
 * else is bucketed as upstream_gmail with the raw status surfaced.
 */
export async function gmailHttpFailure(res: Response, contextLabel: string): Promise<ToolResult> {
  if (res.status === 403) {
    const body = await res.text().catch(() => '');
    if (classifyGoogle403(body) === 'scope') {
      return failureResult(GMAIL_SCOPE_MESSAGE, 'gmail_scope_missing');
    }
    return failureResult(
      `${contextLabel} — Gmail is briefly rate-limited by Google. The connection is fine; I'll retry shortly.`,
      'gmail_rate_limited',
    );
  }
  if (res.status === 404) return failureResult(`${contextLabel} (404 not found).`, 'not_found');
  return failureResult(`${contextLabel} (${res.status}).`, 'upstream_gmail');
}

/**
 * Calendar counterpart of gmailHttpFailure's 403 branch. Returns a ToolResult
 * only when the body proves it is a real scope error; returns null for a
 * rate-limit/other 403 so the caller can fall through to its normal upstream
 * handling instead of wrongly telling the user to reconnect Calendar.
 */
export async function gcal403Failure(res: Response): Promise<ToolResult | null> {
  if (res.status !== 403) return null;
  const body = await res.text().catch(() => '');
  if (classifyGoogle403(body) === 'scope') {
    return failureResult(CALENDAR_SCOPE_MESSAGE, 'gcal_scope_missing');
  }
  return failureResult(
    'Calendar is briefly rate-limited by Google. The connection is fine; I\'ll retry shortly.',
    'gcal_rate_limited',
  );
}
