/**
 * POST /api/boult/connectors/disconnect
 *
 * Single source of truth for "delete this connector" from the Boult UI.
 * Deletes the user's tokens from EVERY table that may hold them:
 *   - boult_integrations  (newer V3 store)
 *   - integration_credentials  (legacy V2 store)
 *   - user_tokens  (Google login fallback; only cleared for gmail/gcal,
 *     never blown away unless the user is explicitly disconnecting Google)
 *
 * Body: { provider: 'gmail' | 'gcal' | 'notion' | 'slack' | 'cal_com' | ... }
 *
 * The legacy DELETE /api/connectors was bearer-auth-only (Supabase auth token)
 * and only deleted from one table. This route uses the same NextAuth session
 * cookie everything else in Boult uses, and reaches every store.
 */

import { NextRequest, NextResponse } from 'next/server';
// @ts-ignore — JS module
import { auth as nextAuth } from '../../../../../lib/auth.js';
import { getSupabaseAdmin } from '../../../../../lib/supabase.js';
// @ts-ignore — JS module
import { decrypt } from '../../../../../lib/crypto.js';
import { logEvent } from "@/lib/logsso";

// @ts-ignore
const auth: any = nextAuth;

export const dynamic = 'force-dynamic';

// Map UI provider id → the values each table actually stores under provider/user_email.
// Some legacy rows are under "google" / "google_calendar"; we delete both shapes.
function getDeletionKeys(provider: string): {
  boultKeys: string[];
  legacyKeys: string[];
  clearGoogleTokens: boolean;
} {
  switch (provider) {
    case 'gmail':
      return { boultKeys: ['gmail'], legacyKeys: ['google', 'gmail'], clearGoogleTokens: true };
    case 'gcal':
    case 'google-calendar':
    case 'google_calendar':
      return { boultKeys: ['gcal'], legacyKeys: ['google_calendar', 'gcal'], clearGoogleTokens: true };
    case 'notion':
      return { boultKeys: ['notion', 'notion_calendar'], legacyKeys: ['notion'], clearGoogleTokens: false };
    case 'slack':
      return { boultKeys: ['slack'], legacyKeys: ['slack'], clearGoogleTokens: false };
    case 'cal_com':
    case 'cal-com':
      return { boultKeys: ['cal_com'], legacyKeys: ['cal_com'], clearGoogleTokens: false };
    case 'google-meet':
    case 'google_meet':
      return { boultKeys: ['google_meet'], legacyKeys: ['google_meet'], clearGoogleTokens: false };
    default:
      return { boultKeys: [provider], legacyKeys: [provider], clearGoogleTokens: false };
  }
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.email.toLowerCase();

  let body: any;
  try { body = await request.json(); }
  catch {
    logEvent({ channel: "failures", event: "❌ API Error", description: "Unknown error" }); return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const provider = (body?.provider || '').trim();
  if (!provider) {
    return NextResponse.json({ error: 'provider is required' }, { status: 400 });
  }

  const { boultKeys, legacyKeys, clearGoogleTokens } = getDeletionKeys(provider);
  const supabase = getSupabaseAdmin();

  // PART 68 — Resolve all possible user-key shapes. Different flows wrote
  // rows under (a) the user's email, (b) the lowercased email, (c) the
  // Supabase auth uuid. A disconnect that only targets one shape leaves
  // orphan rows under the others, which is why the button "doesn't
  // disconnect" from the user's POV — the row keeps coming back.
  const userKeys = new Set<string>([userId, userId.toLowerCase(), userId.toUpperCase()]);
  try {
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('user_id, supabase_user_id')
      .ilike('user_id', userId)
      .maybeSingle();
    if (profile?.user_id) userKeys.add(profile.user_id);
    if (profile?.supabase_user_id) userKeys.add(profile.supabase_user_id);
  } catch {
    logEvent({ channel: "failures", event: "❌ API Error", description: "Unknown error" }); /* user_profiles may not exist or have those columns — non-fatal */ }
  const userKeyList = Array.from(userKeys);

  const deletions = {
    boult_integrations: 0,
    integration_credentials: 0,
    user_tokens: 0,
  };

  // 0. If this row is Composio-managed, revoke the connected account on
  //    Composio's side too — otherwise a stale connection lingers there and
  //    the user can never truly disconnect. Best-effort; the local delete
  //    below is what makes the app forget it regardless.
  try {
    for (const key of boultKeys) {
      for (const uk of userKeyList) {
        const { data: row } = await supabase
          .from('boult_integrations')
          .select('access_token')
          .eq('user_id', uk)
          .eq('provider', key)
          .maybeSingle();
        let marker = '';
        try { marker = row?.access_token ? decrypt(row.access_token) : ''; } catch { marker = ''; }
        if (marker.startsWith('composio:')) {
          const { deleteComposioConnection } = await import('../../../../../lib/boult/composio');
          await deleteComposioConnection(marker.slice('composio:'.length));
        }
      }
    }
  } catch (err: any) {
    console.warn('[Disconnect] Composio revoke failed (non-fatal):', err.message);
  }

  // 1. boult_integrations (newer) — delete by every resolved key shape.
  try {
    for (const key of boultKeys) {
      for (const uk of userKeyList) {
        const { count } = await supabase
          .from('boult_integrations')
          .delete({ count: 'exact' })
          .eq('user_id', uk)
          .eq('provider', key);
        if (count) deletions.boult_integrations += count;
      }
    }
  } catch (err: any) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(err) });
    console.warn('[Disconnect] boult_integrations delete failed:', err.message);
  }

  // 2. integration_credentials (legacy) — delete by both columns AND every key.
  try {
    for (const key of legacyKeys) {
      for (const uk of userKeyList) {
        const { count: c1 } = await supabase
          .from('integration_credentials')
          .delete({ count: 'exact' })
          .eq('user_email', uk)
          .eq('provider', key);
        if (c1) deletions.integration_credentials += c1;
        const { count: c2 } = await supabase
          .from('integration_credentials')
          .delete({ count: 'exact' })
          .eq('user_id', uk)
          .eq('provider', key);
        if (c2) deletions.integration_credentials += c2;
      }
    }
  } catch (err: any) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(err) });
    console.warn('[Disconnect] integration_credentials delete failed:', err.message);
  }

  // 3. user_tokens — ONLY when explicitly disconnecting a Google product. We
  //    only null the access tokens for THAT product so the user's Google
  //    login itself isn't broken. (If both Gmail and GCal share user_tokens,
  //    clearing one nukes the other — so we only delete the row when the
  //    user disconnects gmail OR gcal AND no other Google product remains.)
  if (clearGoogleTokens) {
    try {
      // Check if any OTHER Google product is still connected via boult_integrations
      const { data: remaining } = await supabase
        .from('boult_integrations')
        .select('provider')
        .eq('user_id', userId)
        .in('provider', ['gmail', 'gcal', 'google_meet']);
      const stillConnected = (remaining || []).map((r: any) => r.provider);
      if (stillConnected.length === 0) {
        const { count } = await supabase
          .from('user_tokens')
          .delete({ count: 'exact' })
          .or(`user_id.ilike."${userId}",google_email.ilike."${userId}"`);
        if (count) deletions.user_tokens += count;
      }
    } catch (err: any) {
      logEvent({ channel: "failures", event: "❌ API Error", description: String(err) });
      console.warn('[Disconnect] user_tokens conditional delete failed:', err.message);
    }
  }

  // Invalidate any cached scope-probe so the next chat turn re-checks.
  if (provider === 'gmail' || provider === 'gcal') {
    try {
      const { invalidateGmailScope } = await import('../../../../../lib/boult/gmail-scope');
      await invalidateGmailScope(userId);
    } catch {
      logEvent({ channel: "failures", event: "❌ API Error", description: "Unknown error" }); /* non-fatal */ }
  }

  return NextResponse.json({
    success: true,
    provider,
    deleted: deletions,
    totalRows: deletions.boult_integrations + deletions.integration_credentials + deletions.user_tokens,
  });
}
