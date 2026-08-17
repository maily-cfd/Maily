/**
 * Dedicated scheduled-email dispatcher cron.
 *
 * The 15-min run-agents cron already drains scheduled emails every tick, so this
 * is OPTIONAL. Point a more frequent cron-job.org entry (e.g. every 2–5 min) here
 * if you want tighter send-time accuracy. Same CRON_SECRET auth as run-agents.
 *
 *   GET /api/cron/send-scheduled
 *   Authorization: Bearer $CRON_SECRET   (or x-boult-cron-secret: $CRON_SECRET)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../lib/supabase.js';
import { drainScheduledEmails } from '../../../../lib/boult/scheduled-send';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CRON_SECRET = process.env.CRON_SECRET || 'boult-cron-secret';

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization') || '';
  const ok =
    authHeader === `Bearer ${CRON_SECRET}` ||
    request.headers.get('x-boult-cron-secret') === CRON_SECRET ||
    request.headers.get('x-vercel-cron') === '1';
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = getSupabaseAdmin();
  const result = await drainScheduledEmails(supabase, { limit: 50 });
  return NextResponse.json({ ok: true, ...result });
}
