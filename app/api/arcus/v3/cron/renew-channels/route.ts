/**
 * Boult V3 — GCal Channel Renewal Cron
 * GET /api/boult/v3/cron/renew-channels
 *
 * Checks for Google Calendar webhook channels expiring within 24 hours
 * and renews them to ensure continuous event ingestion.
 *
 * Security: protected by CRON_SECRET header check.
 */

import { NextRequest, NextResponse } from 'next/server';
import { renewExpiredChannels } from '../../../../../../lib/boult-v3/gcal-watch';
import { renewGmailWatches } from '../../../../../../lib/boult-v3/gmail-watch';
import { logEvent } from "@/lib/logsso";

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  // Verify cron secret
  const cronSecret = request.headers.get('authorization');
  const expectedSecret = process.env.CRON_SECRET || process.env.AUTH_SECRET;

  if (!expectedSecret || cronSecret !== `Bearer ${expectedSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // GCal channels + Gmail watches (the latter no-ops unless GMAIL_PUBSUB_TOPIC
    // is set). Gmail renewal also bootstraps watches for newly-connected mailboxes.
    const [gcal, gmail] = await Promise.all([
      renewExpiredChannels(),
      renewGmailWatches(),
    ]);
    return NextResponse.json({ status: 'ok', gcal, gmail });
  } catch (error) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(error) });
    console.error('[Boult V3] Channel renewal cron error:', (error as Error).message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
