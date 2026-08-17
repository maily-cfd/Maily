/**
 * Boult — Webhook: Gmail real-time push (Cloud Pub/Sub).
 * POST /api/boult/v3/webhooks/gmail
 *
 * The Pub/Sub push subscription on GMAIL_PUBSUB_TOPIC delivers a message whenever
 * a watched mailbox changes. Body shape (verified against Google docs):
 *   { message: { data: base64url(JSON{emailAddress, historyId}), messageId }, subscription }
 *
 * We do NOT route this into the v3 reasoning pipeline (enqueueEvent/processNextJob
 * is a different, non-live path). Instead we fan the signal into the LIVE event
 * agents: clear their poll-debounce so the next fast-lane tick fires them
 * immediately, then kick that lane. The reactive poll remains the permanent
 * fallback, so a missed/duplicate push never loses an email — it just polls.
 *
 * Returns 200 quickly (Pub/Sub redelivers on non-2xx); all work is best-effort.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../../../lib/supabase.js';
import { isGmailPushEnabled } from '../../../../../../lib/boult-v3/gmail-watch';
import { logEvent } from "@/lib/logsso";

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function alreadyHandled(supabase: any, messageId: string): Promise<boolean> {
  if (!messageId) return false;
  const key = `dedupe:gmail-push:${messageId}`;
  const { data } = await supabase
    .from('boult_dedup_cache')
    .select('dedup_key')
    .eq('dedup_key', key)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();
  if (data) return true;
  await supabase.from('boult_dedup_cache').upsert({
    dedup_key: key,
    expires_at: new Date(Date.now() + 600_000).toISOString(),
  });
  return false;
}

export async function POST(request: NextRequest) {
  // Always 200 so Pub/Sub doesn't hammer redelivery; we just no-op on problems.
  try {
    if (!isGmailPushEnabled()) {
      return NextResponse.json({ status: 'push_disabled' });
    }

    const body = await request.json().catch(() => null);
    const msg = body?.message;
    if (!msg?.data) return NextResponse.json({ status: 'no_message' });

    let decoded: { emailAddress?: string; historyId?: string } = {};
    try {
      decoded = JSON.parse(Buffer.from(msg.data, 'base64').toString('utf8'));
    } catch {
      logEvent({ channel: "failures", event: "❌ API Error", description: "Unknown error" });
      return NextResponse.json({ status: 'bad_payload' });
    }
    const userId = (decoded.emailAddress || '').toLowerCase();
    if (!userId) return NextResponse.json({ status: 'no_user' });

    const supabase = getSupabaseAdmin();

    // Dedup on the Pub/Sub messageId — Pub/Sub is at-least-once delivery.
    if (await alreadyHandled(supabase, msg.messageId || '')) {
      return NextResponse.json({ status: 'duplicate' });
    }

    // Confirm this user actually has a registered watch (defends against spoofed
    // posts: only known gmail integrations are honored). Update the history pointer.
    const { data: integ } = await supabase
      .from('boult_integrations')
      .select('user_id')
      .eq('provider', 'gmail')
      .eq('user_id', userId)
      .maybeSingle();
    if (!integ) return NextResponse.json({ status: 'unknown_mailbox' });

    if (decoded.historyId) {
      await supabase
        .from('boult_integrations')
        .update({ gmail_history_id: String(decoded.historyId), last_checked: new Date().toISOString() })
        .eq('provider', 'gmail')
        .eq('user_id', userId);
    }

    // Fan into the live event agents: clear the poll-debounce so the next event
    // lane tick re-reads Gmail for this user right away, then kick that lane.
    const fired = await nudgeEventAgents(supabase, userId);
    if (fired > 0) kickEventLane();

    return NextResponse.json({ status: 'ok', nudged: fired });
  } catch (e: any) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(e) });
    console.error('[gmail-webhook] error:', e?.message || e);
    return NextResponse.json({ status: 'error' }); // still 200 — avoid redelivery storms
  }
}

/** Set agent_state.force_poll on this user's event/condition agents. Returns count. */
async function nudgeEventAgents(supabase: any, userId: string): Promise<number> {
  const { data: agents } = await supabase
    .from('boult_agents')
    .select('id, agent_state, trigger_type, status')
    .eq('user_id', userId)
    .in('trigger_type', ['event', 'condition'])
    .neq('status', 'paused');
  if (!agents?.length) return 0;

  await Promise.all(
    agents.map((a: any) =>
      supabase
        .from('boult_agents')
        .update({ agent_state: { ...(a.agent_state || {}), force_poll: true } })
        .eq('id', a.id),
    ),
  );
  return agents.length;
}

/** Fire-and-forget kick of the fast event lane so the nudge is acted on in seconds. */
function kickEventLane(): void {
  const base = (process.env.NEXTAUTH_URL || process.env.HOST || '').replace(/\/$/, '');
  const secret = process.env.CRON_SECRET;
  if (!base || !secret) return;
  fetch(`${base}/api/cron/run-agents?only=events`, {
    headers: { Authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(2000),
  }).catch(() => { /* the scheduled fast lane will still pick up the nudge */ });
}
