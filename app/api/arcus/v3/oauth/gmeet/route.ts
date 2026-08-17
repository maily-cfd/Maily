/**
 * Boult V3 — Google Meet connect.
 *
 * Composio-ONLY by design. Unlike the Gmail and Calendar routes, there is no
 * own-client fallback: the Meet API v2 scopes are restricted, our own OAuth
 * client is capped/unverified for those, and the whole point of this connection
 * is to reach Meet through Composio's verified client. If Composio is not
 * configured we say so plainly rather than bouncing the user into a consent
 * screen that cannot grant what Meet needs.
 *
 * This is a SEPARATE connection from Calendar on purpose — see lib/boult/tools/
 * meet.ts. Meet links on scheduled events still come from Calendar.
 *
 * Flow:  GET here → Composio consent → /api/integrations/composio/callback?toolkit=gmeet
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '../../../../../../lib/auth.js';
import { logEvent } from '@/lib/logsso';
import { composioEnabled, initiateComposioConnection } from '../../../../../../lib/boult/composio';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.redirect(new URL('/login', request.url));
    }

    if (!composioEnabled('gmeet')) {
      // Operator-facing state, not a user error — COMPOSIO_MEET_AUTH_CONFIG_ID
      // has not been set yet. Keep the reason out of the URL the user sees.
      console.error('[Composio] Meet connect attempted but COMPOSIO_MEET_AUTH_CONFIG_ID is not set');
      return NextResponse.redirect(
        new URL('/dashboard/agent-talk?error=gmeet_unavailable&provider=google_meet', request.url),
      );
    }

    const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
    const cb = `${baseUrl}/api/integrations/composio/callback?toolkit=gmeet`;

    const { accountId, redirectUrl } = await initiateComposioConnection(session.user.email, 'gmeet', cb);
    const response = NextResponse.redirect(redirectUrl);
    response.cookies.set('composio_conn_gmeet', accountId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 900,
      path: '/',
    });
    return response;
  } catch (err) {
    logEvent({ channel: 'failures', event: '❌ API Error', description: String(err) });
    console.error('[Composio] Meet initiate failed:', (err as Error).message);
    return NextResponse.redirect(
      new URL('/dashboard/agent-talk?error=gmeet_connect_failed&provider=google_meet', request.url),
    );
  }
}
