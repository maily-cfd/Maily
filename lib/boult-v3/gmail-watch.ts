/**
 * Boult — Gmail real-time push (Pub/Sub watch).
 *
 * Activation is gated on GMAIL_PUBSUB_TOPIC (a Google Cloud Pub/Sub topic, e.g.
 * "projects/my-proj/topics/gmail-boult"). When it's unset every function here is
 * a no-op and the system keeps using the reactive poll — so this is safe to ship
 * before the GCP topic exists. See docs/boult-gmail-push-setup.md for the one-time
 * GCP setup (topic, push subscription → /api/boult/v3/webhooks/gmail, and granting
 * gmail-api-push@system.gserviceaccount.com publish rights).
 *
 * Gmail watch must be renewed at least every 7 days (we renew daily). It registers
 * against the Pub/Sub topic; the topic's push subscription calls our webhook with
 * { emailAddress, historyId }. The webhook then fans the signal into the LIVE event
 * agents (see the webhook route) rather than the v3 reasoning pipeline.
 */

import { getSupabaseAdmin } from '../supabase.js';
import { getGmailToken, googleFetch } from '../boult/tools/http-tokens';

const GMAIL_WATCH_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/watch';
const GMAIL_STOP_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/stop';

export function gmailPushTopic(): string | null {
  const t = (process.env.GMAIL_PUBSUB_TOPIC || '').trim();
  return t || null;
}
export function isGmailPushEnabled(): boolean {
  return !!gmailPushTopic();
}

interface WatchOutcome { ok: boolean; historyId?: string; expiration?: string; error?: string; }

/**
 * Register (or refresh) a Gmail watch for one user. Idempotent — Gmail returns a
 * fresh historyId + expiration each call. Stores them on the user's boult_integrations
 * gmail row so the webhook + renewal have a pointer. No-op when push is disabled.
 */
export async function startGmailWatch(userId: string): Promise<WatchOutcome> {
  const topic = gmailPushTopic();
  if (!topic) return { ok: false, error: 'push_disabled' };

  const token = await getGmailToken(userId);
  if (!token) return { ok: false, error: 'gmail_not_connected' };

  let res: Response;
  try {
    res = await googleFetch(userId, 'gmail', GMAIL_WATCH_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topicName: topic,
        labelIds: ['INBOX'],
        labelFilterBehavior: 'INCLUDE',
      }),
    });
  } catch (e: any) {
    return { ok: false, error: e?.message || 'watch request failed' };
  }

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    console.error(`[gmail-watch] watch failed for ${userId} (${res.status}):`, err.slice(0, 200));
    return { ok: false, error: `watch_failed_${res.status}` };
  }

  const data = await res.json().catch(() => ({}));
  const historyId: string | undefined = data.historyId ? String(data.historyId) : undefined;
  const expiration = data.expiration
    ? new Date(parseInt(data.expiration, 10)).toISOString()
    : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const supabase = getSupabaseAdmin();
  // Persist watch state on the gmail integration row. We key by (user_id, provider)
  // — upsert so it works whether or not a v3 OAuth row already exists.
  await supabase
    .from('boult_integrations')
    .upsert(
      {
        user_id: userId,
        provider: 'gmail',
        channel_expiry: expiration,
        gmail_history_id: historyId || null,
        last_checked: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,provider' },
    );

  return { ok: true, historyId, expiration };
}

/** Stop a user's Gmail watch (on disconnect). No-op when push disabled. */
export async function stopGmailWatch(userId: string): Promise<boolean> {
  if (!isGmailPushEnabled()) return true;
  const token = await getGmailToken(userId);
  if (!token) return false;
  try {
    const res = await googleFetch(userId, 'gmail', GMAIL_STOP_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.ok || res.status === 404;
  } catch {
    return false;
  }
}

/**
 * Daily renewal. (Re)starts Gmail watches for every gmail integration whose watch
 * is missing or expires within 24h. Also bootstraps watches for newly-connected
 * users (channel_expiry null). No-op when push disabled.
 */
export async function renewGmailWatches(): Promise<{ renewed: number; failed: number }> {
  if (!isGmailPushEnabled()) return { renewed: 0, failed: 0 };

  const supabase = getSupabaseAdmin();
  const cutoff = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  // gmail rows with no watch yet (channel_expiry null) OR expiring within 24h.
  const { data: rows } = await supabase
    .from('boult_integrations')
    .select('user_id, channel_expiry')
    .eq('provider', 'gmail')
    .or(`channel_expiry.is.null,channel_expiry.lt.${cutoff}`);

  if (!rows?.length) return { renewed: 0, failed: 0 };

  let renewed = 0, failed = 0;
  for (const row of rows) {
    const out = await startGmailWatch(row.user_id);
    if (out.ok) renewed++; else failed++;
  }
  return { renewed, failed };
}
