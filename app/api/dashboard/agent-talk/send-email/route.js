import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth.js';
import { DatabaseService, getSupabaseAdmin } from '@/lib/supabase.js';
import { decrypt } from '@/lib/crypto.js';
import { logEvent } from "@/lib/logsso";

// Send email on behalf of the authenticated user for Boult tasks
export async function POST(request) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized. Please sign in.' }, { status: 401 });
    }

    const body = await request.json();
    // Accept both `content` and `body` field names
    const { to, subject, content, body: bodyField, isHtml = false, threadId = null, gmailDraftId = null } = body || {};
    const emailBody = content || bodyField;

    if (!to || !subject || !emailBody) {
      return NextResponse.json(
        { error: 'Missing required fields: to, subject, content' },
        { status: 400 }
      );
    }

    const userEmail = session.user.email.toLowerCase();

    // COMPOSIO-MANAGED: send via Proxy Execute (masking-proof) and return early.
    // Must be checked BEFORE user_tokens — a Composio user's user_tokens holds
    // the identity-only login token (no Gmail scope), which would fail here.
    try {
      const { composioAccountFor, googleFetch } = await import('@/lib/boult/tools/http-tokens');
      const composioAcct = await composioAccountFor(userEmail, 'gmail');
      if (composioAcct) {
        const lines = [`To: ${to}`, `Subject: ${subject}`, `Content-Type: text/${isHtml ? 'html' : 'plain'}; charset=UTF-8`, '', emailBody];
        const raw = Buffer.from(lines.join('\r\n')).toString('base64url');
        const res = await googleFetch(userEmail, 'gmail', 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
          method: 'POST',
          headers: { Authorization: 'Bearer composio', 'Content-Type': 'application/json' },
          body: JSON.stringify(threadId ? { raw, threadId } : { raw }),
        });
        if (!res.ok) {
          const t = await res.text().catch(() => '');
          console.error('[send-email v2] Composio send failed', res.status, t.slice(0, 200));
          return NextResponse.json({ error: 'Failed to send email' }, { status: 502 });
        }
        const sent = await res.json();
        if (gmailDraftId) {
          try { await googleFetch(userEmail, 'gmail', `https://gmail.googleapis.com/gmail/v1/users/me/drafts/${gmailDraftId}`, { method: 'DELETE', headers: { Authorization: 'Bearer composio' } }); } catch { /* non-fatal */ }
        }
        return NextResponse.json({ success: true, message: 'Email sent successfully', result: sent });
      }
    } catch (e) {
      console.warn('[send-email v2] Composio path error, falling back:', e?.message);
    }

    // Try user_tokens first (Google sign-in flow)
    let accessToken = null;
    let refreshToken = '';
    const db = new DatabaseService();
    const tokens = await db.getUserTokens(userEmail);
    if (tokens?.encrypted_access_token) {
      accessToken = decrypt(tokens.encrypted_access_token);
      refreshToken = tokens.encrypted_refresh_token ? decrypt(tokens.encrypted_refresh_token) : '';
    }

    // Fallback: check boult_integrations (Gmail connected via integrations page)
    if (!accessToken) {
      const supabase = getSupabaseAdmin();
      const { data: integData } = await supabase
        .from('boult_integrations')
        .select('access_token')
        .eq('user_id', userEmail)
        .eq('provider', 'gmail')
        .maybeSingle();
      if (integData?.access_token) {
        accessToken = decrypt(integData.access_token);
      }
    }

    if (!accessToken) {
      return NextResponse.json(
        { error: 'Gmail not connected. Please sign in with Google.' },
        { status: 400 }
      );
    }

    const { GmailService } = await import('@/lib/gmail.ts');
    const gmailService = new GmailService(accessToken, refreshToken);

    const result = await gmailService.sendEmail({
      to,
      subject,
      body: emailBody,
      isHtml,
      threadId,
    });

    // Clean up the Gmail draft now that the email has been sent
    if (gmailDraftId) {
      try {
        const { googleFetch } = await import('@/lib/boult/tools/http-tokens');
        await googleFetch(userEmail, 'gmail', `https://gmail.googleapis.com/gmail/v1/users/me/drafts/${gmailDraftId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${accessToken}` },
        });
      } catch {
        logEvent({ channel: "failures", event: "❌ API Error", description: "Unknown error" });
        // Non-fatal — email is already sent
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Email sent successfully',
      result,
    });
  } catch (error) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(error) });
    console.error('Send-email endpoint error:', error);
    return NextResponse.json(
      { error: 'Failed to send email', details: error.message },
      { status: 500 }
    );
  }
}

