/**
 * Boult Background Agent — Run History
 * GET /api/boult/agents/runs?agentId=<uuid>&limit=<n>
 *
 * Returns the most recent run rows for the signed-in user, optionally scoped
 * to a single agent. Backs the "Recent runs" section in the AgentsPanel UI.
 *
 * Reads from boult_agent_runs (see supabase/migrations/boult_agent_runs.sql);
 * the cron runner inserts one row per attempt and updates it with status +
 * delivery + tool_calls + artifact_links as the run progresses.
 *
 * Default limit is 7 (the "last 7 runs at a glance" the migration was
 * designed for). Hard cap is 50 to keep the payload bounded.
 */

import { NextRequest, NextResponse } from 'next/server';
// @ts-ignore — JS module, no .d.ts
import { auth } from '../../../../../lib/auth.js';
// @ts-ignore — JS module, no .d.ts
import { getSupabaseAdmin } from '../../../../../lib/supabase.js';

export const dynamic = 'force-dynamic';

const DEFAULT_LIMIT = 7;
const MAX_LIMIT = 50;

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = (session.user.email as string).toLowerCase();

  const { searchParams } = new URL(request.url);
  const agentId = searchParams.get('agentId') || undefined;
  const limitParam = parseInt(searchParams.get('limit') || '', 10);
  const limit = Number.isFinite(limitParam) && limitParam > 0
    ? Math.min(limitParam, MAX_LIMIT)
    : DEFAULT_LIMIT;

  const supabase = getSupabaseAdmin();
  const BASE_COLS = 'id, agent_id, started_at, completed_at, duration_ms, status, tool_calls, report_summary, error_message, email_delivery, slack_delivery, artifact_links, plan';

  const runQuery = (cols: string) => {
    let q = supabase
      .from('boult_agent_runs')
      .select(cols)
      .eq('user_id', userId)
      .order('started_at', { ascending: false })
      .limit(limit);
    if (agentId) q = q.eq('agent_id', agentId);
    return q;
  };

  // Try with the super-agent columns (honest outcome + full report); fall back if
  // the migration (boult_super_agent_v1.sql) hasn't been applied yet, so the
  // route never 500s on a partially-migrated DB.
  let { data, error } = await runQuery(`${BASE_COLS}, outcome_summary, report_full`);
  if (error && /(outcome_summary|report_full)/.test(error.message || '')) {
    ({ data, error } = await runQuery(BASE_COLS));
  }

  if (error?.code === '42P01') return NextResponse.json({ runs: [] });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const STUCK_THRESHOLD_MS = 2 * 60 * 1000;
  const nowMs = Date.now();
  const runs = (data ?? []).map((r: any) => {
    if (r.status !== 'running') return r;
    const startedMs = r.started_at ? new Date(r.started_at).getTime() : nowMs;
    if (!Number.isFinite(startedMs) || nowMs - startedMs < STUCK_THRESHOLD_MS) return r;
    const minutes = Math.floor((nowMs - startedMs) / 60000);
    return {
      ...r,
      status: 'error',
      duration_ms: r.duration_ms ?? (nowMs - startedMs),
      error_message: r.error_message
        || `Run never reported completion (started ${minutes}m ago). Vercel killed the function at 60s, or a DB write failed mid-update. cron-job.org will retrigger on the next scheduled tick.`,
    };
  });

  return NextResponse.json({ runs });
}
