/**
 * Boult V3 — Slack OAuth Flow
 * 
 * Initiates Slack OAuth with the required bot scopes.
 * Redirects the user to Slack's OAuth consent screen.
 * 
 * Flow:
 *   1. GET /api/boult/v3/oauth/slack → Redirects to Slack consent
 *   2. Slack redirects to /api/boult/v3/oauth/slack/callback
 *   3. Exchange code for bot token, encrypt, store
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { auth } from '../../../../../../lib/auth.js';
import { logEvent } from "@/lib/logsso";

// Bot scopes — minimal set needed for Boult:
// channels:history, channels:read — read channel messages
// chat:write — send messages
// groups:history, groups:read — private channels the bot is in
// Note: users.profile:write is a user scope, not a bot scope — excluded here
const BOT_SCOPES = [
  'channels:history',
  'channels:read',
  'chat:write',
  'groups:history',
  'groups:read',
].join(',');

/**
 * GET — Initiate Slack OAuth. Redirects to Slack consent screen.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.redirect(new URL('/login', request.url));
    }

    // CSRF state token
    const state = crypto.randomBytes(32).toString('hex');

    const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
    const redirectUri = `${baseUrl}/api/boult/v3/oauth/slack/callback`;

    const params = new URLSearchParams({
      client_id: process.env.SLACK_CLIENT_ID || '',
      scope: BOT_SCOPES,
      redirect_uri: redirectUri,
      state,
    });

    const slackAuthUrl = `https://slack.com/oauth/v2/authorize?${params}`;

    const response = NextResponse.redirect(slackAuthUrl);
    response.cookies.set('boult_slack_state', state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 600,
      path: '/',
    });

    return response;
  } catch (error) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(error) });
    console.error('[Boult V3] Slack OAuth init error:', (error as Error).message);
    return NextResponse.redirect(new URL('/dashboard/agent-talk?error=slack_oauth_init', request.url));
  }
}
