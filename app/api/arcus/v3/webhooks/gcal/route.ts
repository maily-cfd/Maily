/**
 * Boult V3 — Webhook: Google Calendar
 * POST /api/boult/v3/webhooks/gcal
 * 
 * Receives push notifications from Google Calendar Watch API.
 * Verifies channel token, then enqueues a job.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../../../lib/supabase.js';
import { enqueueEvent } from '../../../../../../lib/boult-v3/queue';
import { logEvent } from "@/lib/logsso";

export async function POST(request: NextRequest) {
  try {
    // 1. Extract Google webhook headers
    const channelId = request.headers.get('x-goog-channel-id');
    const channelToken = request.headers.get('x-goog-channel-token');
    const resourceState = request.headers.get('x-goog-resource-state');
    const resourceId = request.headers.get('x-goog-resource-id');

    // 2. Reject if missing required headers
    if (!channelId || !channelToken) {
      return NextResponse.json({ error: 'Missing channel headers' }, { status: 401 });
    }

    // 3. Verify channel token against stored token
    const supabase = getSupabaseAdmin();
    const { data: integration } = await supabase
      .from('boult_integrations')
      .select('user_id, channel_id, channel_token')
      .eq('channel_id', channelId)
      .eq('provider', 'gcal')
      .maybeSingle();

    if (!integration || integration.channel_token !== channelToken) {
      console.warn('[Boult V3] GCal webhook: invalid channel token');
      return NextResponse.json({ error: 'Invalid channel token' }, { status: 401 });
    }

    // 4. Skip 'sync' notifications (initial registration confirmation)
    if (resourceState === 'sync') {
      return NextResponse.json({ status: 'sync acknowledged' });
    }

    // 5. Enqueue for processing
    const enqueued = await enqueueEvent(
      {
        userId: integration.user_id,
        source: 'gcal',
        eventType: resourceState || 'event_updated',
        payload: {
          channelId,
          resourceId,
          resourceState,
        },
        timestamp: Date.now(),
      },
      `gcal:${resourceId}:${resourceState}`
    );

    return NextResponse.json({ status: 'accepted', enqueued });

  } catch (error) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(error) });
    console.error('[Boult V3] GCal webhook error:', (error as Error).message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
