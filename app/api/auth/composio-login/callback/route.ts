/**
 * Composio-as-login CALLBACK — GET /api/auth/composio-login/callback
 *
 * Composio redirects here after the user finishes consent on Composio's
 * verified Google client. We:
 *   1. verify the connection reached ACTIVE
 *   2. resolve the verified identity (email) from the connection
 *   3. persist the Gmail marker row under that email (so the tool layer
 *      resolves Gmail immediately — no separate connect step needed)
 *   4. redirect to a tiny client page that completes the NextAuth sign-in
 *      (Credentials providers must be triggered client-side)
 *
 * Our own Google OAuth client is never involved.
 */

import { NextRequest, NextResponse } from 'next/server';
// @ts-ignore — JS module
import { getSupabaseAdmin } from '../../../../../lib/supabase.js';
// @ts-ignore — JS module
import { encrypt } from '../../../../../lib/crypto.js';
import {
  getComposioAccountStatus,
  getComposioIdentity,
  COMPOSIO_TOKEN_PREFIX,
} from '../../../../../lib/boult/composio';

export const dynamic = 'force-dynamic';

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export async function GET(request: NextRequest) {
  const baseUrl = process.env.NEXTAUTH_URL || new URL(request.url).origin;
  const fail = (code: string) =>
    NextResponse.redirect(new URL(`/auth/signin?error=${code}`, baseUrl));

  const accountId = request.cookies.get('composio_login_account')?.value;
  if (!accountId) return fail('composio_login_no_pending');

  try {
    // 1. Wait for ACTIVE (Composio marks it when its Google callback lands).
    let status = '';
    for (let i = 0; i < 6; i++) {
      status = await getComposioAccountStatus(accountId);
      if (status === 'ACTIVE') break;
      if (['FAILED', 'EXPIRED', 'REVOKED'].includes(status)) return fail('composio_login_denied');
      await sleep(2000);
    }
    if (status !== 'ACTIVE') return fail('composio_login_pending');

    // 2. Verified identity from the connection.
    const identity = await getComposioIdentity(accountId);
    if (!identity?.email) {
      // Surface WHY (the resolver stashes a reason) so a prod failure is
      // diagnosable from the URL instead of a bare code.
      const why = (identity as any)?._reason || 'unknown';
      console.error('[Composio login] no identity — reason:', why, 'account:', accountId);
      return NextResponse.redirect(new URL(`/auth/signin?error=composio_login_no_identity&detail=${encodeURIComponent(String(why).slice(0, 150))}`, baseUrl));
    }
    const email = identity.email;

    // 3. Persist the Gmail marker row under the real email, so Boult can use
    //    Gmail from the first turn (no second connect step).
    const supabase = getSupabaseAdmin();
    // NOTE: boult_integrations has NO `status` column — writing it makes the
    // whole upsert fail with PGRST204. A row's mere existence = connected.
    const { error: dbError } = await supabase.from('boult_integrations').upsert({
      user_id: email,
      provider: 'gmail',
      access_token: encrypt(`${COMPOSIO_TOKEN_PREFIX}${accountId}`),
      refresh_token: null,
      scopes: [],
      expires_at: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,provider' });
    if (dbError) {
      console.error('[Composio login] marker store failed:', dbError.message, '| code:', (dbError as any).code, '| details:', (dbError as any).details, '| hint:', (dbError as any).hint);
      const d = `${(dbError as any).code || ''}:${dbError.message}`.slice(0, 150);
      return NextResponse.redirect(new URL(`/auth/signin?error=composio_login_store&detail=${encodeURIComponent(d)}`, baseUrl));
    }

    // 4. Hand off to the client completer, which triggers the NextAuth
    //    credentials sign-in (Credentials can't be signed in from the server).
    const complete = new URL('/auth/composio-complete', baseUrl);
    complete.searchParams.set('accountId', accountId);
    const response = NextResponse.redirect(complete);
    response.cookies.delete('composio_login_account');
    return response;
  } catch (err) {
    console.error('[Composio login] callback error:', (err as Error).message);
    return fail('composio_login_callback');
  }
}
