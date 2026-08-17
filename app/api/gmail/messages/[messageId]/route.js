import { GmailService } from '@/lib/gmail.ts';
import { DatabaseService } from '@/lib/supabase.js';
import { auth } from '@/lib/auth.js';
import { decrypt } from '@/lib/crypto.js';
import { subscriptionService } from '@/lib/subscription-service.js';
import { logEvent } from "@/lib/logsso";

export async function GET(request, { params }) {
  try {
    console.log('=== SINGLE MESSAGE API START ===');
    const { messageId } = await params;
    console.log('Request params:', { messageId });

    const session = await auth();
    console.log('Session result:', { hasSession: !!session, hasUser: !!session?.user, email: session?.user?.email });

    if (!session?.user?.email) {
      return Response.json({
        error: 'No valid session found. Please sign in again.'
      }, { status: 401 });
    }

    const hasAccess = await subscriptionService.checkAccess(session.user.email);
    if (!hasAccess) {
      return Response.json({
        error: 'subscription_required',
        message: 'Access required.',
        upgradeUrl: '/pricing'
      }, { status: 403 });
    }

    const userEmail = session.user.email;
    let refreshToken = session.refreshToken || '';

    // Same unified token resolver as /api/gmail/messages — inbox list and
    // message detail must agree on which Gmail credential is live.
    let accessToken = null;
    try {
      const { getGmailToken } = await import('@/lib/boult/tools/http-tokens');
      accessToken = await getGmailToken(userEmail);
    } catch (e) {
      logEvent({ channel: "failures", event: "❌ API Error", description: String(e) });
      console.error('getGmailToken failed:', e?.message);
    }

    if (!accessToken && session.accessToken) accessToken = session.accessToken;

    const db = new DatabaseService();
    if (!accessToken) {
      try {
        const userTokens = await db.getUserTokens(userEmail);
        if (userTokens?.encrypted_access_token) accessToken = decrypt(userTokens.encrypted_access_token);
        if (userTokens?.encrypted_refresh_token) refreshToken = decrypt(userTokens.encrypted_refresh_token);
      } catch (dbError) {
        logEvent({ channel: "failures", event: "❌ API Error", description: String(dbError) });
        console.error('Database error getting tokens:', dbError);
      }
    }

    if (!accessToken) {
      return Response.json({
        error: 'No valid tokens found. Please sign in again.'
      }, { status: 401 });
    }

    const gmailService = new GmailService(accessToken, refreshToken || '');
    gmailService.setUserEmail(userEmail);

    console.log('Fetching message:', messageId);

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Request timeout')), 10000)
    );

    const fetchPromise = gmailService.getEmailDetails(messageId);
    const messageData = await Promise.race([fetchPromise, timeoutPromise]);

    console.log('Message fetched successfully');

    const parsedData = gmailService.parseEmailData(messageData);

    return new Response(JSON.stringify(parsedData), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'private, max-age=60',
      },
    });

  } catch (error) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(error) });
    console.error('=== ERROR IN SINGLE MESSAGE API ===');
    console.error('Error details:', error);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);

    const msg = String(error?.message || '').toLowerCase();
    const isTokenExpired =
      msg.includes('token expired') ||
      msg.includes('expired and refresh failed') ||
      msg.includes('no refresh token available') ||
      msg.includes('invalid_grant') ||
      msg.includes('401');
    const isScopeMissing =
      msg.includes('insufficient') ||
      msg.includes('access_token_scope') ||
      msg.includes('insufficient authentication scopes') ||
      msg.includes('scope');

    if (isTokenExpired || isScopeMissing) {
      try {
        const session2 = await auth();
        const uid = session2?.user?.email?.toLowerCase();
        if (uid) {
          const { markIntegrationNeedsReauth } = await import('@/lib/boult/tools/http-tokens');
          await markIntegrationNeedsReauth(uid, 'gmail');
        }
      } catch {
        /* ignore reauth mark failures */
      }
      return Response.json(
        {
          error: 'gmail_token_expired',
          message: 'Gmail sign-in expired. Reconnect to keep reading mail.',
        },
        { status: 401 },
      );
    }

    return Response.json(
      { error: 'Failed to fetch message', details: error.message },
      { status: 500 }
    );
  }
}
