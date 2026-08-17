import { NextRequest, NextResponse } from 'next/server';
import { auth } from '../../../../lib/auth.js';
import { getSupabaseAdmin } from '../../../../lib/supabase.js';
import { decrypt } from '../../../../lib/crypto.js';
import { logEvent } from "@/lib/logsso";

function encodeRfc822(to: string, subject: string, body: string, threadId?: string): string {
  const lines = [
    `To: ${to}`,
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset=UTF-8',
    '',
    body,
  ];
  return Buffer.from(lines.join('\r\n')).toString('base64url');
}

// Translate a Gmail API failure into a user-friendly response. NEVER leak raw
// Google error JSON to the UI — that's a spec violation ("never raw error
// text"). The raw text is still captured in console.error for debugging.
function classifyGmailError(status: number, errText: string): {
  httpStatus: number;
  code: string;
  error: string;
  /** True when the client should show a "Reconnect Gmail" CTA. */
  reconnect?: boolean;
} {
  const lower = errText.toLowerCase();
  if (status === 401 || lower.includes('invalid credentials') || lower.includes('invalid_token')) {
    return {
      httpStatus: 401,
      code: 'gmail_auth_expired',
      error: 'Gmail authorization expired. Reconnect Gmail in Integrations and try again.',
      reconnect: true,
    };
  }
  if (status === 403 && (lower.includes('insufficient') || lower.includes('scope'))) {
    return {
      httpStatus: 403,
      code: 'gmail_scope_missing',
      error: 'Gmail send permission is missing. Reconnect Gmail and approve the "send mail" scope.',
      reconnect: true,
    };
  }
  if (status === 429 || lower.includes('rate limit') || lower.includes('quota')) {
    return {
      httpStatus: 429,
      code: 'gmail_rate_limited',
      error: 'Gmail rate-limited this send. Wait a minute and try again.',
    };
  }
  if (status === 400 && lower.includes('recipient')) {
    return {
      httpStatus: 400,
      code: 'gmail_invalid_recipient',
      error: 'Recipient address is invalid. Double-check the email and try again.',
    };
  }
  if (status >= 500) {
    return {
      httpStatus: 502,
      code: 'gmail_upstream',
      error: 'Gmail is having trouble right now. Try again in a moment.',
    };
  }
  return {
    httpStatus: 400,
    code: 'gmail_send_failed',
    error: 'Gmail rejected the send. Try again, or use Gmail directly if it keeps failing.',
  };
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.email.toLowerCase();
    // Accept both `body` (canonical) and `content` (used historically by
    // DraftApprovalModal + DraftGalleryCard). Without this back-compat,
    // every UI-initiated send 400'd with "Missing required fields: body".
    const payload = await req.json();
    const { to, subject, threadId } = payload;
    const body: string | undefined = payload.body ?? payload.content;

    if (!to || !subject || !body) {
      return NextResponse.json(
        { error: 'Missing required fields: to, subject, body (or content).' },
        { status: 400 },
      );
    }

    // Fetch Gmail access token — try boult_integrations first, then user_tokens fallback
    const supabase = getSupabaseAdmin();
    const { data } = await supabase
      .from('boult_integrations')
      .select('access_token')
      .eq('user_id', userId)
      .eq('provider', 'gmail')
      .maybeSingle();

    let accessToken: string | null = null;

    if (data?.access_token) {
      accessToken = decrypt(data.access_token);
    } else {
      // Fallback: tokens stored by Google sign-in flow live in user_tokens
      const { data: tokenRow } = await supabase
        .from('user_tokens')
        .select('encrypted_access_token')
        .eq('user_id', userId)
        .maybeSingle();
      if (tokenRow?.encrypted_access_token) {
        accessToken = decrypt(tokenRow.encrypted_access_token);
      }
    }

    if (!accessToken) {
      return NextResponse.json(
        {
          code: 'gmail_not_connected',
          error: 'Gmail isn’t connected. Connect Gmail in Integrations to send.',
          reconnect: true,
        },
        { status: 404 },
      );
    }

    const raw = encodeRfc822(to, subject, body, threadId);

    // googleFetch routes through Composio Proxy Execute for Composio-managed
    // users (masking-proof — the stored token is a composio: marker, not a
    // usable bearer) and does a direct authed fetch for legacy users.
    const { googleFetch } = await import('../../../../lib/boult/tools/http-tokens');
    const gmailRes = await googleFetch(
      userId, 'gmail',
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(threadId ? { raw, threadId } : { raw }),
      },
    );

    if (!gmailRes.ok) {
      const errText = await gmailRes.text().catch(() => '');
      console.error(`[send-email] Gmail API error ${gmailRes.status}:`, errText.slice(0, 500));
      const mapped = classifyGmailError(gmailRes.status, errText);
      return NextResponse.json(
        { code: mapped.code, error: mapped.error, ...(mapped.reconnect ? { reconnect: true } : {}) },
        { status: mapped.httpStatus },
      );
    }

    const sent = await gmailRes.json();
    return NextResponse.json({ success: true, messageId: sent.id, threadId: sent.threadId });

  } catch (err: any) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(err) });
    console.error('[send-email] Unexpected error:', err?.message);
    // Don't echo the raw exception to the UI — bind it to a stable shape.
    return NextResponse.json(
      { code: 'send_internal_error', error: 'Couldn’t send right now. Try again in a moment.' },
      { status: 500 },
    );
  }
}
