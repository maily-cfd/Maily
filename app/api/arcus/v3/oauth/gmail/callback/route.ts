/**
 * Boult V3 — Gmail OAuth Callback
 *
 * Exchanges the authorization code for Gmail tokens,
 * encrypts and stores them in boult_integrations under provider='gmail'.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '../../../../../../../lib/auth.js';
import { getSupabaseAdmin } from '../../../../../../../lib/supabase.js';
import { encrypt } from '../../../../../../../lib/crypto.js';
import { auditLogger } from '../../../../../../../lib/audit-logger.js';
import { logEvent } from "@/lib/logsso";

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.redirect(new URL('/login', request.url));
    }
    const userId = session.user.email.toLowerCase();

    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');

    if (error) {
      return NextResponse.redirect(new URL('/dashboard/agent-talk?error=gmail_denied', request.url));
    }
    if (!code) {
      return NextResponse.redirect(new URL('/dashboard/agent-talk?error=no_code', request.url));
    }

    // CSRF check
    const storedState = request.cookies.get('boult_gmail_state')?.value;
    if (!state || !storedState || state !== storedState) {
      return NextResponse.redirect(new URL('/dashboard/agent-talk?error=csrf', request.url));
    }

    // Exchange code for tokens
    const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
    const redirectUri = `${baseUrl}/api/boult/v3/oauth/gmail/callback`;

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID || '',
        client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenResponse.ok) {
      const err = await tokenResponse.text();
      console.error('[Boult V3] Gmail token exchange failed:', err);
      return NextResponse.redirect(new URL('/dashboard/agent-talk?error=token_exchange', request.url));
    }

    const tokens = await tokenResponse.json();
    const { access_token, refresh_token, expires_in, scope } = tokens;

    if (!access_token) {
      return NextResponse.redirect(new URL('/dashboard/agent-talk?error=no_token', request.url));
    }

    const supabase = getSupabaseAdmin();
    const expiresAt = expires_in
      ? new Date(Date.now() + expires_in * 1000).toISOString()
      : null;

    const { error: dbError } = await supabase.from('boult_integrations').upsert({
      user_id: userId,
      provider: 'gmail',
      access_token: encrypt(access_token),
      refresh_token: refresh_token ? encrypt(refresh_token) : null,
      scopes: scope ? scope.split(' ') : [],
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,provider' });

    if (dbError) {
      console.error('[Boult V3] Gmail DB store error:', dbError.message);
      return NextResponse.redirect(new URL('/dashboard/agent-talk?error=db_store', request.url));
    }

    await auditLogger.log(userId, 'boult.gmail_connected', { hasRefreshToken: !!refresh_token });

    const successUrl = new URL('/dashboard/agent-talk', request.url);
    successUrl.searchParams.set('success', 'connected');
    successUrl.searchParams.set('provider', 'gmail');
    const response = NextResponse.redirect(successUrl);
    response.cookies.delete('boult_gmail_state');
    return response;

  } catch (err) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(err) });
    console.error('[Boult V3] Gmail callback error:', (err as Error).message);
    return NextResponse.redirect(new URL('/dashboard/agent-talk?error=callback', request.url));
  }
}
