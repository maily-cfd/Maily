/**
 * Prewarm the Today snapshot cache so even a cold first load is a fast DB read.
 *
 * Optional — the Today route already computes-on-miss and serves fresh within its
 * TTL. Point a cron-job.org entry here (every ~5 min) to keep active users' caches
 * warm. Same CRON_SECRET auth as the other crons.
 *
 *   GET /api/cron/prewarm-today
 */
import { NextRequest, NextResponse } from 'next/server';
// @ts-ignore
import { getSupabaseAdmin } from '../../../../lib/supabase.js';
import { computeTodaySnapshot, storeTodaySnapshot } from '../../home-feed/today/route';
import { logEvent } from "@/lib/logsso";

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CRON_SECRET = process.env.CRON_SECRET || 'boult-cron-secret';
const STALE_MS = 4 * 60 * 1000; // refresh caches older than this
const MAX_USERS = 40;            // bound work per tick

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization') || '';
  const ok =
    authHeader === `Bearer ${CRON_SECRET}` ||
    request.headers.get('x-boult-cron-secret') === CRON_SECRET ||
    request.headers.get('x-vercel-cron') === '1';
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = getSupabaseAdmin();

  // Active users = those with at least one active/running agent (a good proxy for
  // "will open the dashboard soon"). Bounded per tick.
  const { data: agents } = await supabase
    .from('boult_agents')
    .select('user_id')
    .in('status', ['active', 'running']);
  const users = Array.from(new Set((agents || []).map((a: any) => String(a.user_id).toLowerCase()))).slice(0, MAX_USERS);
  if (!users.length) return NextResponse.json({ ok: true, prewarmed: 0 });

  // Skip users whose cache is already fresh.
  const { data: caches } = await supabase
    .from('boult_today_cache')
    .select('user_id, generated_at')
    .in('user_id', users);
  const freshCutoff = Date.now() - STALE_MS;
  const fresh = new Set(
    (caches || [])
      .filter((c: any) => new Date(c.generated_at).getTime() > freshCutoff)
      .map((c: any) => c.user_id),
  );
  const toWarm = users.filter((u) => !fresh.has(u));

  let prewarmed = 0;
  for (const user of toWarm) {
    try {
      const snapshot = await computeTodaySnapshot(user);
      await storeTodaySnapshot(user, snapshot);
      prewarmed++;
    } catch (e: any) {
      logEvent({ channel: "failures", event: "❌ API Error", description: String(e) });
      console.warn('[prewarm-today] failed for', user, e?.message);
    }
  }
  return NextResponse.json({ ok: true, candidates: users.length, prewarmed });
}
