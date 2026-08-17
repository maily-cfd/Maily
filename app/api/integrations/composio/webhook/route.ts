/**
 * Composio webhook receiver — POST /api/integrations/composio/webhook
 *
 * This is the endpoint URL you paste into the Composio dashboard → Webhook.
 * It closes the loop the polling can't: the moment a user's Google grant
 * expires or Composio disables it, we flip that integration to needs_reauth
 * so the app shows "reconnect" proactively instead of failing mid-task.
 *
 * Events subscribed (check these boxes in the dashboard):
 *   - composio.connected_account.expired  → grant died, needs re-auth
 *   - composio.trigger.disabled           → auth expired / sub unrefreshable
 * (composio.trigger.message is for external-service trigger data — we don't
 *  use Composio triggers, so leave it unchecked.)
 *
 * Security: Standard Webhooks / Svix signing. Composio sends webhook-id,
 * webhook-timestamp, webhook-signature; we HMAC-SHA256 `${id}.${ts}.${body}`
 * with the base64 secret (COMPOSIO_WEBHOOK_SECRET, the `whsec_…` value from
 * the dashboard) and constant-time compare. Unsigned/invalid → 401.
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
// @ts-ignore — JS module
import { getSupabaseAdmin } from '../../../../../lib/supabase.js';
// @ts-ignore — JS module
import { decrypt } from '../../../../../lib/crypto.js';
import { markIntegrationNeedsReauth } from '../../../../../lib/boult/tools/http-tokens';
import { COMPOSIO_TOKEN_PREFIX } from '../../../../../lib/boult/composio';

export const dynamic = 'force-dynamic';

/** Standard Webhooks signature check (Svix-compatible). */
function verifySignature(rawBody: string, headers: Headers): boolean {
  const secretRaw = process.env.COMPOSIO_WEBHOOK_SECRET;
  if (!secretRaw) {
    // No secret configured — refuse rather than accept unsigned events.
    console.error('[Composio webhook] COMPOSIO_WEBHOOK_SECRET not set — rejecting.');
    return false;
  }
  const id = headers.get('webhook-id');
  const timestamp = headers.get('webhook-timestamp');
  const sigHeader = headers.get('webhook-signature');
  if (!id || !timestamp || !sigHeader) return false;

  // Reject stale deliveries (replay guard) — Standard Webhooks recommends 5 min.
  const tsSec = Number(timestamp);
  if (!Number.isFinite(tsSec) || Math.abs(Date.now() / 1000 - tsSec) > 300) return false;

  // secret is `whsec_<base64>`; the HMAC key is the base64 part decoded.
  const secretB64 = secretRaw.startsWith('whsec_') ? secretRaw.slice(6) : secretRaw;
  let key: Buffer;
  try { key = Buffer.from(secretB64, 'base64'); } catch { return false; }

  const signedContent = `${id}.${timestamp}.${rawBody}`;
  const expected = crypto.createHmac('sha256', key).update(signedContent).digest('base64');

  // The header is space-separated `v1,<sig> v1,<sig>` — one must match.
  for (const part of sigHeader.split(' ')) {
    const sig = part.includes(',') ? part.split(',')[1] : part;
    try {
      const a = Buffer.from(sig);
      const b = Buffer.from(expected);
      if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;
    } catch { /* length mismatch etc. — keep checking */ }
  }
  return false;
}

/** Find the user + provider whose Composio marker points at this account id. */
async function findRowByAccountId(accountId: string): Promise<{ userId: string; provider: 'gmail' | 'gcal' } | null> {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from('boult_integrations')
    .select('user_id, provider, access_token')
    .in('provider', ['gmail', 'gcal']);
  for (const row of data || []) {
    if (!row.access_token) continue;
    let marker = '';
    try { marker = decrypt(row.access_token); } catch { continue; }
    if (marker === `${COMPOSIO_TOKEN_PREFIX}${accountId}`) {
      return { userId: row.user_id, provider: row.provider as 'gmail' | 'gcal' };
    }
  }
  return null;
}

export async function POST(request: NextRequest) {
  // Raw body is required for signature verification — read it before parsing.
  const rawBody = await request.text();
  if (!verifySignature(rawBody, request.headers)) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }

  let event: any;
  try { event = JSON.parse(rawBody); } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }); }

  const type: string = event?.type || event?.event || '';
  // Account id lives under a few shapes across payload versions.
  const accountId: string | undefined =
    event?.data?.connected_account_id ||
    event?.data?.connectedAccountId ||
    event?.data?.connected_account?.id ||
    event?.data?.id;

  try {
    if (type.includes('connected_account.expired') || type.includes('trigger.disabled')) {
      if (accountId) {
        const match = await findRowByAccountId(accountId);
        if (match) {
          await markIntegrationNeedsReauth(match.userId, match.provider);
          console.log(`[Composio webhook] ${type} → ${match.provider} needs_reauth for ${match.userId}`);
        } else {
          console.warn(`[Composio webhook] ${type} for unknown account ${accountId}`);
        }
      }
    }
    // Any other event: acknowledge so Composio doesn't retry.
  } catch (err) {
    console.error('[Composio webhook] handler error:', (err as Error).message);
    // Still 200 — a handler error shouldn't trigger endless Composio retries;
    // the next real token use will re-detect the dead grant anyway.
  }

  return NextResponse.json({ received: true });
}
