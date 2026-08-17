/**
 * Boult V3 — Manual Trigger & Plan Mode
 * POST /api/boult/v3/trigger
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '../../../../../lib/auth.js';
import { enqueueEvent } from '../../../../../lib/boult-v3/queue';
import { logEvent } from "@/lib/logsso";

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.email.toLowerCase();
    const body = await request.json().catch(() => ({}));
    const mode = body.mode || 'plan_mode';

    const enqueued = await enqueueEvent({
      userId,
      source: mode === 'plan_mode' ? 'cron_plan_mode' : 'user_manual',
      eventType: mode === 'plan_mode' ? 'manual_brief' : 'manual_trigger',
      payload: { manual: true, requestedAt: new Date().toISOString() },
      timestamp: Date.now(),
    });

    return NextResponse.json({ status: 'queued', enqueued });
  } catch (error) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(error) });
    console.error('[Boult V3] Manual trigger error:', (error as Error).message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
