/**
 * Composio managed-auth bridge — AUTH LAYER ONLY.
 *
 * Why this exists: Maily's own Google OAuth client is in Testing status
 * (100-user cap, verification pending). Composio's managed Google app is a
 * verified OAuth client, so users who connect Gmail/Calendar through it are
 * not subject to OUR client's cap. We use Composio strictly as the OAuth +
 * token vendor: the user consents on Composio's client, Composio stores and
 * refreshes the Google tokens, and we pull the live access token so the
 * ENTIRE existing tool layer (direct Gmail/Calendar REST calls) keeps
 * working unchanged. No agent-engine changes, no Composio tool execution.
 *
 * Feature flag: a toolkit routes through Composio ONLY when BOTH env vars
 * exist — absent env = the legacy own-client OAuth, untouched:
 *   COMPOSIO_API_KEY                  (dashboard → Settings → API Keys)
 *   COMPOSIO_GMAIL_AUTH_CONFIG_ID     (auth config id, "ac_…", for Gmail)
 *   COMPOSIO_GCAL_AUTH_CONFIG_ID     (auth config id for Google Calendar)
 *
 * Dashboard prerequisites (one-time):
 *   1. Create the auth configs (Gmail scopes: userinfo.email,
 *      userinfo.profile, gmail.modify — nothing else).
 *   2. Settings → Project Configuration → turn OFF "Mask Connected Account
 *      Secrets". Without this, state.val.access_token comes back masked
 *      ("ya29...") and getComposioAccessToken refuses it with a loud error.
 *
 * Storage: the connected-account id is stored in boult_integrations.
 * access_token as encrypt(`composio:<accountId>`) — the token getters in
 * tools/http-tokens.ts detect the prefix and resolve the live token here.
 *
 * SDK surface used (verified against @composio/core 0.14.0 type defs):
 *   composio.connectedAccounts.initiate(userId, authConfigId, { callbackUrl })
 *     → ConnectionRequest { id, redirectUrl }
 *   composio.connectedAccounts.get(accountId)
 *     → { status: 'INITIALIZING'|'INITIATED'|'ACTIVE'|'FAILED'|'EXPIRED'|
 *          'INACTIVE'|'REVOKED', state?: { val?: { access_token } } }
 */

import { Composio } from '@composio/core';

// 'gmeet' is a SEPARATE connection from 'gcal' on purpose. Putting a Meet link
// on a calendar event is Calendar's job (conferenceData) and still runs through
// schedule_meeting. This toolkit is the Meet REST API v2 — standalone spaces,
// plus the post-meeting artifacts Calendar cannot see: transcripts, recordings
// and attendance.
export type ComposioToolkit = 'gmail' | 'gcal' | 'gmeet';

let _client: Composio | null = null;
function client(): Composio {
  if (!_client) {
    _client = new Composio({ apiKey: process.env.COMPOSIO_API_KEY });
  }
  return _client;
}

export function composioAuthConfigId(toolkit: ComposioToolkit): string | undefined {
  if (toolkit === 'gmail') return process.env.COMPOSIO_GMAIL_AUTH_CONFIG_ID;
  if (toolkit === 'gmeet') return process.env.COMPOSIO_MEET_AUTH_CONFIG_ID;
  return process.env.COMPOSIO_GCAL_AUTH_CONFIG_ID;
}

/** True when this toolkit should connect through Composio instead of our own Google client. */
export function composioEnabled(toolkit: ComposioToolkit): boolean {
  return !!(process.env.COMPOSIO_API_KEY && composioAuthConfigId(toolkit));
}

export const COMPOSIO_TOKEN_PREFIX = 'composio:';

/**
 * Start a Composio-managed OAuth connection. Returns the Google consent URL
 * (on Composio's verified client) and the connected-account id we must
 * verify + persist at callback time.
 */
export async function initiateComposioConnection(
  userEmail: string,
  toolkit: ComposioToolkit,
  callbackUrl: string,
): Promise<{ accountId: string; redirectUrl: string }> {
  const authConfigId = composioAuthConfigId(toolkit);
  if (!authConfigId) throw new Error(`Composio auth config for ${toolkit} is not configured`);
  // Composio deprecated `.initiate()` for MANAGED-OAuth auth configs (returns
  // HTTP 400 "no longer supported. Use POST /api/v3/connected_accounts/link").
  // `.link()` is the current method — same (userId, authConfigId, {callbackUrl})
  // signature and same { id, redirectUrl } result.
  //
  // allowMultiple: true is REQUIRED for RECONNECTS. Once a user has an ACTIVE
  // connection for this auth config, link() otherwise THROWS "Multiple connected
  // accounts found for user … Please use the allowMultiple option" — the route's
  // catch then bounced the user to /dashboard/agent-talk with an error instead of
  // Composio consent (LIVE-CONFIRMED 2026-07-23 on the founder's account, which
  // already had ACTIVE googlecalendar + googlemeet connections). With the flag it
  // mints a fresh consent + accountId; the callback re-points boult_integrations
  // to the new account. Harmless for first-time connects (no existing account).
  const req = await client().connectedAccounts.link(
    userEmail.toLowerCase(),
    authConfigId,
    { callbackUrl, allowMultiple: true } as any,
  );
  if (!req.redirectUrl) {
    throw new Error('Composio did not return a redirect URL for the connection request');
  }
  return { accountId: req.id, redirectUrl: req.redirectUrl };
}

/** Raw status of a connected account ('ACTIVE' = usable). */
export async function getComposioAccountStatus(accountId: string): Promise<string> {
  const account = await client().connectedAccounts.get(accountId);
  return account.status;
}

/**
 * Keep exactly ONE connected account per toolkit for a user: delete every OTHER
 * connection under the same auth config, keeping `keepAccountId`. Called after a
 * reconnect persists the fresh account. Because `link()` runs with allowMultiple
 * (so a reconnect never throws on an existing account), connections would
 * otherwise accumulate — and the Gmail/Calendar proxy resolves by user+toolkit,
 * so several ACTIVE connections for one toolkit make it ambiguous. Best-effort:
 * a failed prune never blocks the reconnect. Returns how many it deleted.
 */
export async function pruneOtherComposioConnections(
  userEmail: string,
  toolkit: ComposioToolkit,
  keepAccountId: string,
): Promise<number> {
  const authConfigId = composioAuthConfigId(toolkit);
  if (!authConfigId) return 0;
  let deleted = 0;
  try {
    const list: any = await client().connectedAccounts.list({ userIds: [userEmail.toLowerCase()] } as any);
    const items: any[] = list?.items || list?.data || [];
    for (const acc of items) {
      if (!acc?.id || acc.id === keepAccountId) continue;
      const accCfg = acc?.authConfig?.id || acc?.authConfigId;
      if (accCfg !== authConfigId) continue; // only the SAME toolkit's config
      try {
        await client().connectedAccounts.delete(acc.id);
        tokenCache.delete(acc.id);
        deleted++;
      } catch { /* best-effort */ }
    }
  } catch { /* listing failed — leave duplicates rather than risk a wrong delete */ }
  return deleted;
}

/** Revoke + delete a connected account on Composio (best-effort; used on disconnect). */
export async function deleteComposioConnection(accountId: string): Promise<void> {
  tokenCache.delete(accountId);
  await client().connectedAccounts.delete(accountId);
}

// ── Composio-as-login: identity from a connected Google account ───────────────
// When Composio is the SOLE Google touchpoint, the account connection (which
// includes the openid/email/profile identity scopes) IS the login. We read the
// live access token and call Google's userinfo endpoint to get the verified
// identity. We use userinfo (not the id_token) because Composio's id_token has
// Composio's client as its `aud`, which we can't verify against our own client —
// userinfo works regardless of which OAuth client minted the token.

export interface ComposioIdentity {
  email: string;
  name?: string;
  picture?: string;
  sub?: string;
}

/**
 * Resolve the verified Google identity behind a connected account. Returns null
 * if the account isn't ACTIVE, the token is masked, or Google rejects it.
 */
export async function getComposioIdentity(accountId: string): Promise<(ComposioIdentity & { _reason?: string }) | null> {
  // Resolve identity WITHOUT reading the raw token — so it works even with
  // "Mask Connected Account Secrets" ON. Masking only hides tokens from GET
  // responses; it does NOT affect tool EXECUTION (Composio uses the real
  // token server-side). So we ask Composio to run GMAIL_GET_PROFILE, which
  // returns the account's emailAddress. The connection was created with a
  // userId we control (the pending_ id in the login cookie), which the
  // executor requires to locate the connection.
  const bail = (reason: string) => {
    console.error('[Composio] identity fail:', reason, 'account:', accountId);
    return { email: '', _reason: reason } as any;
  };
  try {
    const userId = await userIdForAccount(accountId);
    if (!userId) return bail('no_userid_for_account');
    let res: any;
    try {
      res = await client().tools.execute('GMAIL_GET_PROFILE', {
        userId,
        arguments: {},
        version: 'latest',
        dangerouslySkipVersionCheck: true,
      } as any);
    } catch (e: any) {
      return bail(`execute_threw:${(e?.message || e).toString().slice(0, 80)}`);
    }
    if (!res?.successful) return bail(`execute_unsuccessful:${JSON.stringify(res?.error || res?.data || '').slice(0, 80)}`);
    const d = res.data || {};
    const email: string | undefined = d.emailAddress || d.email || d.response_data?.emailAddress;
    if (!email) return bail(`no_email_in_result:${JSON.stringify(d).slice(0, 80)}`);
    return { email: String(email).toLowerCase() };
  } catch (err: any) {
    return bail(`outer:${(err?.message || err).toString().slice(0, 80)}`);
  }
}

// ── Tool execution bridge ────────────────────────────────────────────────────
// Run a Composio-managed tool (e.g. GMAIL_FETCH_EMAILS) using the connection's
// REAL token server-side — works with secret masking ON, so Boult never needs
// the raw token. Keyed by the account id our marker row stores. Cached userId
// lookups keep an inbox sweep from re-resolving on every call.

const accountUserIdCache = new Map<string, string>();

export interface ComposioExecResult {
  ok: boolean;
  data: any;
  error?: string;
}

/**
 * Execute a Composio tool for the given connected account. Resolves the
 * account's userId (required by the executor), runs the tool with the real
 * token, and returns { ok, data }.
 */
export async function composioExecute(
  accountId: string,
  slug: string,
  args: Record<string, any> = {},
): Promise<ComposioExecResult> {
  const userId = await userIdForAccount(accountId);
  if (!userId) return { ok: false, data: null, error: 'no_userid_for_account' };
  try {
    const res: any = await client().tools.execute(slug, {
      userId,
      arguments: args,
      version: 'latest',
      dangerouslySkipVersionCheck: true,
    } as any);
    if (!res?.successful) {
      return { ok: false, data: res?.data ?? null, error: JSON.stringify(res?.error ?? '').slice(0, 200) };
    }
    return { ok: true, data: res.data ?? {} };
  } catch (err: any) {
    return { ok: false, data: null, error: (err?.message || String(err)).slice(0, 200) };
  }
}

/** True when Gmail/GCal tools should run THROUGH Composio execution (masking-proof). */
export function composioToolsEnabled(): boolean {
  return !!(process.env.COMPOSIO_API_KEY && process.env.COMPOSIO_TOOLS === '1');
}

// ── Proxy Execute: raw provider request with server-side token injection ──────
// Composio's proxyExecute sends a normal Google API request and injects the
// connected account's token server-side, returning the RAW Google response —
// identical to calling Google directly. This is the masking-proof way to keep
// the entire existing tool layer's Google URL-building + response parsing
// UNCHANGED: executors just route their fetch() through here. Support's
// recommended path (docs/extending-sessions/proxy-execute) after they removed
// the ability to disable secret masking.

export interface ProxyResult {
  status: number;
  data: any;
  ok: boolean;
}

/**
 * Make a raw Google API request through Composio for a connected account.
 * `endpoint` is the Google path AFTER the host (e.g.
 * '/gmail/v1/users/me/messages?q=...'). NEVER include the host or an
 * Authorization header — Composio injects the credential.
 */
export async function composioProxy(
  accountId: string,
  toolkit: 'gmail' | 'googlecalendar',
  endpoint: string,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' = 'GET',
  body?: any,
  extraHeaders?: Array<{ name: string; value: string }>,
): Promise<ProxyResult> {
  const userId = await userIdForAccount(accountId);
  if (!userId) return { status: 0, data: null, ok: false };
  const session = await client().create(userId);
  const parameters = (extraHeaders || []).map(h => ({ name: h.name, value: h.value, in: 'header' as const }));
  const res: any = await (session as any).proxyExecute({
    toolkit,
    endpoint,
    method,
    ...(body !== undefined ? { body } : {}),
    ...(parameters.length ? { parameters } : {}),
  });
  const status = typeof res?.status === 'number' ? res.status : 0;
  return { status, data: res?.data ?? null, ok: status >= 200 && status < 300 };
}

/** The userId a connected account belongs to (needed to execute tools on it). */
async function userIdForAccount(accountId: string): Promise<string | null> {
  const cached = accountUserIdCache.get(accountId);
  if (cached) return cached;
  try {
    const acct: any = await client().connectedAccounts.get(accountId);
    // SDK may not surface it; fall back to the raw v3 endpoint which does.
    let uid: string | null = acct?.userId || null;
    if (!uid) {
      const res = await fetch(`https://backend.composio.dev/api/v3/connected_accounts/${accountId}`, {
        headers: { 'x-api-key': process.env.COMPOSIO_API_KEY || '' },
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) uid = (await res.json())?.user_id || null;
    }
    if (uid) accountUserIdCache.set(accountId, uid);
    return uid;
  } catch {
    return null;
  }
}

/** True when Composio should be the SOLE Google touchpoint (login included). */
export function composioLoginEnabled(): boolean {
  return !!(process.env.COMPOSIO_API_KEY && process.env.COMPOSIO_GMAIL_AUTH_CONFIG_ID && process.env.COMPOSIO_LOGIN === '1');
}

// ── Live token resolution ────────────────────────────────────────────────────
// Composio refreshes the Google token on their side; we fetch it on demand
// and cache briefly so tool bursts (an inbox sweep is dozens of Gmail calls)
// don't hammer their API. force=true busts the cache — used by the 401-retry
// path in refreshGoogleToken.

// 4 minutes: Google tokens live ~60min and Composio refreshes them
// proactively server-side, so a short TTL means a token that DID rotate is
// stale for at most one cache window — and ~15 fetches/hour/user is nothing.
// (Our refreshGoogleToken deliberately returns null for Composio rows: there
// is no local refresh_token; recovery is simply this cache expiring.)
const tokenCache = new Map<string, { token: string; at: number }>();
const TOKEN_CACHE_TTL_MS = 4 * 60 * 1000;

/** Detect a dashboard-masked secret ("ya29...") — unusable as a bearer token. */
function looksMasked(token: string): boolean {
  return token.length < 20 || token.includes('...');
}

export async function getComposioAccessToken(
  accountId: string,
  opts: { force?: boolean } = {},
): Promise<string | null> {
  const cached = tokenCache.get(accountId);
  if (!opts.force && cached && Date.now() - cached.at < TOKEN_CACHE_TTL_MS) {
    return cached.token;
  }
  try {
    const account = await client().connectedAccounts.get(accountId);
    if (account.status !== 'ACTIVE') {
      console.warn(`[Composio] account ${accountId} status=${account.status} — treating as disconnected`);
      return null;
    }
    const val = (account.state as any)?.val;
    const token: unknown = val?.access_token;
    if (typeof token !== 'string' || !token) {
      console.error('[Composio] connected account has no access_token in state.val — is the auth scheme OAUTH2?');
      return null;
    }
    if (looksMasked(token)) {
      console.error(
        '[Composio] access_token is MASKED. Fix: Composio dashboard → Settings → ' +
        'Project Configuration → turn OFF "Mask Connected Account Secrets".',
      );
      return null;
    }
    tokenCache.set(accountId, { token, at: Date.now() });
    return token;
  } catch (err: any) {
    console.warn('[Composio] token fetch failed:', err?.message);
    // Fall back to a still-fresh cached token on transient API errors.
    return cached?.token ?? null;
  }
}
