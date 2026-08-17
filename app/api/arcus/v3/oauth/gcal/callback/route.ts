/**
 * Boult V3 — Google Calendar OAuth Callback
 * 
 * Handles the redirect from Google after the user consents.
 * Exchanges the authorization code for tokens, encrypts them,
 * stores in boult_integrations, and registers a Watch API channel.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '../../../../../../../lib/auth.js';
import { getSupabaseAdmin } from '../../../../../../../lib/supabase.js';
import { encrypt } from '../../../../../../../lib/crypto.js';
import { auditLogger } from '../../../../../../../lib/audit-logger.js';
import crypto from 'crypto';
import { logEvent } from "@/lib/logsso";

/**
 * GET — OAuth callback. Exchange code for tokens.
 */
export async function GET(request: NextRequest) {
  try {
    // 1. Verify user is authenticated
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.redirect(new URL('/login', request.url));
    }
    const userId = session.user.email.toLowerCase();

    // 2. Extract params
    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');

    if (error) {
      console.error('[Boult V3] GCal OAuth error:', error);
      return NextResponse.redirect(new URL('/dashboard/agent-talk?error=gcal_denied', request.url));
    }

    if (!code) {
      return NextResponse.redirect(new URL('/dashboard/agent-talk?error=no_code', request.url));
    }

    // 3. Validate CSRF state
    const storedState = request.cookies.get('boult_gcal_state')?.value;
    if (!state || !storedState || state !== storedState) {
      console.error('[Boult V3] GCal OAuth state mismatch');
      return NextResponse.redirect(new URL('/dashboard/agent-talk?error=csrf', request.url));
    }

    // 4. Exchange code for tokens
    const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
    const redirectUri = `${baseUrl}/api/boult/v3/oauth/gcal/callback`;

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
      const errorText = await tokenResponse.text();
      console.error('[Boult V3] Token exchange failed:', errorText);
      return NextResponse.redirect(new URL('/dashboard/agent-talk?error=token_exchange', request.url));
    }

    const tokens = await tokenResponse.json();
    const { access_token, refresh_token, expires_in, scope } = tokens;

    if (!access_token) {
      return NextResponse.redirect(new URL('/dashboard/agent-talk?error=no_token', request.url));
    }

    // 5. Register GCal Watch API channel for push notifications
    const channelId = crypto.randomUUID();
    const channelToken = crypto.randomBytes(32).toString('hex');
    const webhookUrl = `${baseUrl}/api/boult/v3/webhooks/gcal`;

    let channelExpiry: string | null = null;
    try {
      const watchResponse = await fetch(
        'https://www.googleapis.com/calendar/v3/calendars/primary/events/watch',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            id: channelId,
            type: 'web_hook',
            address: webhookUrl,
            token: channelToken,
            params: {
              // Channel expires after 7 days (max for GCal Watch API)
              ttl: String(7 * 24 * 60 * 60),
            },
          }),
        }
      );

      if (watchResponse.ok) {
        const watchData = await watchResponse.json();
        channelExpiry = watchData.expiration
          ? new Date(parseInt(watchData.expiration, 10)).toISOString()
          : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
        console.log(`[Boult V3] GCal Watch registered for ${userId}, expires: ${channelExpiry}`);
      } else {
        const watchError = await watchResponse.text();
        console.warn('[Boult V3] GCal Watch registration failed:', watchError);
        // Continue — webhooks are optional, polling can be used as fallback
      }
    } catch (watchErr) {
      logEvent({ channel: "failures", event: "❌ API Error", description: String(watchErr) });
      console.warn('[Boult V3] GCal Watch error:', (watchErr as Error).message);
    }

    // 6. Store encrypted tokens in boult_integrations
    const supabase = getSupabaseAdmin();
    const expiresAt = expires_in
      ? new Date(Date.now() + expires_in * 1000).toISOString()
      : null;

    const { error: dbError } = await supabase
      .from('boult_integrations')
      .upsert({
        user_id: userId,
        provider: 'gcal',
        access_token: encrypt(access_token),
        refresh_token: refresh_token ? encrypt(refresh_token) : null,
        scopes: scope ? scope.split(' ') : [],
        expires_at: expiresAt,
        channel_id: channelId,
        channel_token: channelToken,
        channel_expiry: channelExpiry,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,provider' });

    if (dbError) {
      console.error('[Boult V3] DB store error:', dbError.message);
      return NextResponse.redirect(new URL('/dashboard/agent-talk?error=db_store', request.url));
    }

    // 7. Audit log
    await auditLogger.log(userId, 'boult.gcal_connected', {
      channelId,
      hasRefreshToken: !!refresh_token,
      watchRegistered: !!channelExpiry,
    });

    // 8. Clear state cookie and redirect to the agent dashboard with success signal
    const successUrl = new URL('/dashboard/agent-talk', request.url);
    successUrl.searchParams.set('success', 'connected');
    successUrl.searchParams.set('provider', 'google_calendar');
    const response = NextResponse.redirect(successUrl);
    response.cookies.delete('boult_gcal_state');
    return response;

  } catch (error) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(error) });
    console.error('[Boult V3] GCal callback error:', (error as Error).message);
    return NextResponse.redirect(new URL('/dashboard/agent-talk?error=callback', request.url));
  }
}
