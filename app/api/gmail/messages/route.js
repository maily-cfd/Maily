import { GmailService } from '@/lib/gmail';
import { DatabaseService } from '@/lib/supabase.js';
import { auth } from '@/lib/auth.js';
import { decrypt, encrypt } from '@/lib/crypto.js';
import { subscriptionService } from '@/lib/subscription-service.js';
import { logEvent } from "@/lib/logsso";

export async function GET(request) {
  try {
    console.log('=== TRADITIONAL MESSAGES API START ===');
    const { searchParams } = new URL(request.url);
    const maxResults = parseInt(searchParams.get('maxResults')) || 50;
    const query = searchParams.get('query') || '';

    // Get session
    const session = await auth();
    if (!session?.user?.email) {
      return Response.json({ error: 'No valid session found' }, { status: 401 });
    }

    // 🔒 SECURITY: Check access before allowing email access
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

    // Resolve the Gmail access token through the UNIFIED, hardened resolver
    // (lib/boult/tools/http-tokens.getGmailToken): it checks boult_integrations →
    // integration_credentials → user_tokens, proactively refreshes an expiring
    // token, and survives duplicate token rows. This is the SAME source of truth
    // the connectors / Settings UI uses — so "Gmail connected in Settings" and
    // "the inbox loads" can no longer disagree. The old path read only the
    // NextAuth session token (stale after a re-login) + the legacy user_tokens
    // row, which is exactly why a user connected via the connectors modal saw
    // "Failed to load Inbox" while Settings showed connected.
    let accessToken = null;
    try {
      const { getGmailToken } = await import('@/lib/boult/tools/http-tokens');
      accessToken = await getGmailToken(userEmail);
    } catch (e) {
      logEvent({ channel: "failures", event: "❌ API Error", description: String(e) });
      console.error('getGmailToken failed:', e?.message);
    }

    // Fallbacks: a present NextAuth session token, then the legacy user_tokens row.
    if (!accessToken && session.accessToken) accessToken = session.accessToken;
    const db = new DatabaseService();
    if (!accessToken) {
      try {
        console.log('📦 Falling back to user_tokens for:', userEmail);
        const userTokens = await db.getUserTokens(userEmail);
        if (userTokens?.encrypted_access_token) accessToken = decrypt(userTokens.encrypted_access_token);
        if (userTokens?.encrypted_refresh_token) refreshToken = decrypt(userTokens.encrypted_refresh_token);
      } catch (dbError) {
        logEvent({ channel: "failures", event: "❌ API Error", description: String(dbError) });
        console.error('Database error getting tokens:', dbError);
      }
    }

    if (!accessToken) {
      return Response.json({ error: 'Gmail not connected' }, { status: 401 });
    }

    // Initialize Gmail service
    const gmailService = new GmailService(accessToken, refreshToken || '');
    gmailService.setUserEmail(userEmail); // Enable token refresh persistence

    // Get page token for pagination
    const pageToken = searchParams.get('pageToken');
    console.log('📧 Fetching traditional emails:', { maxResults, query, pageToken });

    // Only fetch INBOX emails (exclude sent, drafts, etc.)
    // 'in:inbox' ensures we only get emails received by the user, not sent emails
    const inboxQuery = query ? `in:inbox ${query}` : 'in:inbox';

    // Fetch messages list
    const messagesResponse = await gmailService.getEmails(maxResults, inboxQuery, pageToken);

    if (!messagesResponse.messages || messagesResponse.messages.length === 0) {
      console.log('📭 No messages found');
      return Response.json({
        emails: [],
        totalResults: 0,
        nextPageToken: null
      });
    }

    // Get detailed information for each message in batches to be safe
    const messageIds = messagesResponse.messages.map(m => m.id);
    const emailsWithDetails = [];

    // Process in batches of 10 to be efficient but safe
    for (let i = 0; i < Math.min(messageIds.length, 50); i += 10) {
      const batch = messageIds.slice(i, i + 10);
      const batchDetails = await Promise.all(
        batch.map(async (id) => {
          try {
            const details = await gmailService.getEmailDetails(id);
            return gmailService.parseEmailData(details);
          } catch (error) {
            logEvent({ channel: "failures", event: "❌ API Error", description: String(error) });
            console.error(`Error fetching detail for ${id}:`, error);
            return null;
          }
        })
      );
      emailsWithDetails.push(...batchDetails.filter(Boolean));
    }

    console.log(`✅ Processed ${emailsWithDetails.length} messages`);

    // Sort by date descending
    emailsWithDetails.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return Response.json({
      emails: emailsWithDetails,
      totalResults: messagesResponse.resultSizeEstimate || 0,
      nextPageToken: messagesResponse.nextPageToken || null,
    });

  } catch (error) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(error) });
    console.error('=== ERROR IN TRADITIONAL MESSAGES API ===');
    console.error('Error:', error);
    const msg = String(error?.message || '').toLowerCase();
    const isTokenExpired =
      msg.includes('token expired') ||
      msg.includes('expired and refresh failed') ||
      msg.includes('no refresh token available') ||
      msg.includes('invalid_grant') ||
      msg.includes('401');
    // A genuine scope-missing 403 (token valid but lacks Gmail read scope) is also
    // a reconnect case — surface it as an actionable 401, not a generic red error.
    // We do NOT treat a bare 403 as reauth (that can be a transient rate-limit).
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
        logEvent({ channel: "failures", event: "❌ API Error", description: "Unknown error" });}
      return Response.json(
        {
          error: 'gmail_token_expired',
          message: 'Gmail sign-in expired. Reconnect to keep reading mail.',
        },
        { status: 401 },
      );
    }
    return Response.json(
      { error: 'fetch_failed', message: 'Failed to fetch emails', details: error.message },
      { status: 500 }
    );
  }
}
