/**
 * Boult V3 — Webhook: Slack Event API
 * POST /api/boult/v3/webhooks/slack
 * 
 * Receives Slack Event API webhooks.
 * Verifies request signature using HMAC-SHA256.
 * Handles URL verification challenges.
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getSupabaseAdmin } from '../../../../../../lib/supabase.js';
import { enqueueEvent } from '../../../../../../lib/boult-v3/queue';
import { logEvent } from "@/lib/logsso";

export async function POST(request: NextRequest) {
  try {
    // 1. Read raw body for signature verification
    const rawBody = await request.text();
    const timestamp = request.headers.get('x-slack-request-timestamp');
    const signature = request.headers.get('x-slack-signature');

    // 2. Reject if missing headers
    if (!timestamp || !signature) {
      return NextResponse.json({ error: 'Missing Slack headers' }, { status: 401 });
    }

    // 3. Reject if timestamp is stale (>300 seconds old — replay attack prevention)
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - parseInt(timestamp, 10)) > 300) {
      return NextResponse.json({ error: 'Stale timestamp' }, { status: 401 });
    }

    // 4. Verify HMAC-SHA256 signature
    const signingSecret = process.env.SLACK_SIGNING_SECRET;
    if (!signingSecret) {
      console.error('[Boult V3] SLACK_SIGNING_SECRET not configured');
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    const sigBaseString = `v0:${timestamp}:${rawBody}`;
    const expectedSig = 'v0=' + crypto
      .createHmac('sha256', signingSecret)
      .update(sigBaseString)
      .digest('hex');

    // Timing-safe comparison
    const sigBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSig);
    if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
      console.warn('[Boult V3] Slack webhook: invalid signature');
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    // 5. Parse the verified body
    const payload = JSON.parse(rawBody);

    // 6. Handle URL verification challenge (Slack requires this for event subscriptions)
    if (payload.type === 'url_verification') {
      return NextResponse.json({ challenge: payload.challenge });
    }

    // 7. Handle event callbacks
    if (payload.type === 'event_callback') {
      const event = payload.event;
      const teamId = payload.team_id;

      // Only process message events we care about
      const relevantTypes = ['message', 'app_mention'];
      if (!event || !relevantTypes.includes(event.type)) {
        return NextResponse.json({ status: 'ignored' });
      }

      // Skip bot messages and subtypes like channel_join
      if (event.bot_id || (event.subtype && event.subtype !== 'bot_message')) {
        return NextResponse.json({ status: 'skipped' });
      }

      // Find the user who owns this Slack workspace
      const supabase = getSupabaseAdmin();
      const { data: integration } = await supabase
        .from('boult_integrations')
        .select('user_id')
        .eq('provider', 'slack')
        .filter('workspace_info->>team_id', 'eq', teamId)
        .maybeSingle();

      if (!integration) {
        return NextResponse.json({ status: 'no matching user' });
      }

      // Enqueue for processing
      const eventId = payload.event_id || `${event.ts}`;
      await enqueueEvent(
        {
          userId: integration.user_id,
          source: 'slack',
          eventType: event.type,
          payload: {
            event,
            team_id: teamId,
            event_id: payload.event_id,
          },
          timestamp: Date.now(),
        },
        `slack:${eventId}`
      );

      return NextResponse.json({ status: 'accepted' });
    }

    return NextResponse.json({ status: 'unhandled' });

  } catch (error) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(error) });
    console.error('[Boult V3] Slack webhook error:', (error as Error).message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
