/**
 * Boult V3 — Google Calendar connect.
 *
 * Composio-ONLY by design (founder directive 2026-07-23: every Google
 * connection — Gmail, Calendar, Meet — goes through Composio's VERIFIED client;
 * our own OAuth client is never used). Consent runs on Composio's client, which
 * refreshes the token server-side; the callback stores a `composio:<accountId>`
 * marker and the token getters resolve the live token on demand.
 *
 * There is NO own-client fallback: silently bouncing to our capped/unverified
 * client (the one looping with the same error) is exactly the bug we're removing.
 * If Composio isn't configured we say so plainly. Mirrors the Gmail + Meet routes.
 *
 * Flow:  GET here → Composio consent → /api/integrations/composio/callback?toolkit=gcal
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '../../../../../../lib/auth.js';
import { logEvent } from "@/lib/logsso";
import { composioEnabled, initiateComposioConnection } from '../../../../../../lib/boult/composio';

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.redirect(new URL('/login', request.url));
    }

    const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
    // Where to send the user back after the reconnect completes (the home-feed
    // banner passes ?returnTo=/home-feed). Threaded to the Composio callback.
    const rawReturn = new URL(request.url).searchParams.get('returnTo') || '';
    const returnTo = rawReturn.startsWith('/') && !rawReturn.startsWith('//') ? rawReturn : '';

    if (!composioEnabled('gcal')) {
      // Operator-facing state — COMPOSIO_GCAL_AUTH_CONFIG_ID is not set. Never
      // fall back to our own OAuth client (founder directive).
      console.error('[Composio] Calendar connect attempted but COMPOSIO_GCAL_AUTH_CONFIG_ID is not set');
      return NextResponse.redirect(
        new URL('/dashboard/agent-talk?error=gcal_unavailable&provider=google_calendar', request.url),
      );
    }

    const cb = `${baseUrl}/api/integrations/composio/callback?toolkit=gcal${returnTo ? `&returnTo=${encodeURIComponent(returnTo)}` : ''}`;
    const { accountId, redirectUrl } = await initiateComposioConnection(session.user.email, 'gcal', cb);
    const response = NextResponse.redirect(redirectUrl);
    response.cookies.set('composio_conn_gcal', accountId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 900,
      path: '/',
    });
    return response;
  } catch (error) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(error) });
    console.error('[Composio] Calendar initiate failed:', (error as Error).message);
    return NextResponse.redirect(
      new URL('/dashboard/agent-talk?error=gcal_connect_failed&provider=google_calendar', request.url),
    );
  }
}
