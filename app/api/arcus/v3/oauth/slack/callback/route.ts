/**
 * Boult V3 — Slack OAuth Callback
 * 
 * Handles the redirect from Slack after consent.
 * Exchanges the code for a bot access token via oauth.v2.access,
 * encrypts and stores it.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '../../../../../../../lib/auth.js';
import { getSupabaseAdmin } from '../../../../../../../lib/supabase.js';
import { encrypt } from '../../../../../../../lib/crypto.js';
import { auditLogger } from '../../../../../../../lib/audit-logger.js';
import { logEvent } from "@/lib/logsso";

/**
 * GET — Slack OAuth callback. Exchange code for bot token.
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
      console.error('[Boult V3] Slack OAuth error:', error);
      return NextResponse.redirect(new URL('/dashboard/agent-talk?error=slack_denied', request.url));
    }

    if (!code) {
      return NextResponse.redirect(new URL('/dashboard/agent-talk?error=no_code', request.url));
    }

    // 3. Validate CSRF state
    const storedState = request.cookies.get('boult_slack_state')?.value;
    if (!state || !storedState || state !== storedState) {
      console.error('[Boult V3] Slack OAuth state mismatch');
      return NextResponse.redirect(new URL('/dashboard/agent-talk?error=csrf', request.url));
    }

    // 4. Exchange code for token via Slack's oauth.v2.access
    const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
    const redirectUri = `${baseUrl}/api/boult/v3/oauth/slack/callback`;

    const tokenResponse = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.SLACK_CLIENT_ID || '',
        client_secret: process.env.SLACK_CLIENT_SECRET || '',
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('[Boult V3] Slack token exchange HTTP error:', errorText);
      return NextResponse.redirect(new URL('/dashboard/agent-talk?error=token_exchange', request.url));
    }

    const tokenData = await tokenResponse.json();

    if (!tokenData.ok) {
      console.error('[Boult V3] Slack token exchange API error:', tokenData.error);
      return NextResponse.redirect(new URL('/dashboard/agent-talk?error=slack_api', request.url));
    }

    // Slack V2 OAuth returns bot token under access_token
    const accessToken = tokenData.access_token;
    const teamId = tokenData.team?.id;
    const teamName = tokenData.team?.name;
    const botUserId = tokenData.bot_user_id;
    const scopes = tokenData.scope?.split(',') || [];

    if (!accessToken) {
      return NextResponse.redirect(new URL('/dashboard/agent-talk?error=no_token', request.url));
    }

    // 5. Store encrypted token
    const supabase = getSupabaseAdmin();
    const { error: dbError } = await supabase
      .from('boult_integrations')
      .upsert({
        user_id: userId,
        provider: 'slack',
        access_token: encrypt(accessToken),
        refresh_token: null, // Slack bot tokens don't expire
        scopes,
        workspace_info: {
          team_id: teamId,
          team_name: teamName,
          bot_user_id: botUserId,
        },
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,provider' });

    if (dbError) {
      console.error('[Boult V3] DB store error:', dbError.message);
      return NextResponse.redirect(new URL('/dashboard/agent-talk?error=db_store', request.url));
    }

    // 6. Audit log
    await auditLogger.log(userId, 'boult.slack_connected', {
      teamId,
      teamName,
      botUserId,
    });

    // 7. Clear state cookie and redirect to the agent dashboard with success signal
    const successUrl = new URL('/dashboard/agent-talk', request.url);
    successUrl.searchParams.set('success', 'connected');
    successUrl.searchParams.set('provider', 'slack');
    const response = NextResponse.redirect(successUrl);
    response.cookies.delete('boult_slack_state');
    return response;

  } catch (error) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(error) });
    console.error('[Boult V3] Slack callback error:', (error as Error).message);
    return NextResponse.redirect(new URL('/dashboard/agent-talk?error=callback', request.url));
  }
}
