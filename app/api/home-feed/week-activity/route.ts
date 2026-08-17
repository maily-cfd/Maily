/**
 * GET /api/home-feed/week-activity
 *
 * Real 7-day activity series for the Command Center "Your week" chart.
 *
 * SOURCE OF TRUTH, AND WHY: every bar is counted from boult_agent_runs — the
 * actual work Boult did (tool calls + the Gmail/Calendar/Notion/Slack artifacts
 * each run produced). Nothing here is illustrative or padded. If the user has no
 * agent activity this week the endpoint says so (hasData:false) and the UI shows
 * an honest empty state rather than a fake trend — this codebase has been burned
 * before by numbers that "were only ever illustrative" reading as measured.
 *
 * Paid-gated like the rest of the feed. Degrades to an empty (not errored)
 * series if the agent-runs table is missing, so it can never break the feed.
 *
 * NOTE: an earlier revision also summed `artifact_links` into a per-app
 * breakdown here for a "by app" chart. That was dropped in favor of
 * /api/home-feed/recommendations' `appCounts` — this endpoint only sees what
 * background AGENTS touched, which is silent for any connected app a user
 * hasn't scheduled an agent against (e.g. Notion/Slack/Cal.com with zero
 * scheduled automation). recommendations already gathers LIVE, connection-gated
 * signals from every app the user actually has connected, so that's the
 * accurate source for "which of my apps are active" — see that route.
 */

import { NextResponse } from 'next/server';
// @ts-ignore — JS module
import { auth as nextAuth } from '@/lib/auth.js';
// @ts-ignore — JS module
import { getSupabaseAdmin } from '@/lib/supabase.js';
import { assertPaidAccess } from '@/lib/subscription-protection.js';
import { logEvent } from '@/lib/logsso';

const auth: any = nextAuth;
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

interface DayBucket {
  /** ISO date (yyyy-mm-dd) at the user-local day boundary we bucketed by. */
  date: string;
  /** Short weekday label for the axis, e.g. "Mon". */
  label: string;
  /** True for today's bucket — the UI can mark it "so far". */
  isToday: boolean;
  runs: number;
  /** tool_calls + all artifact-link counts across the day's runs. */
  actions: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export async function GET() {
  const session = await auth();
  const userEmail = session?.user?.email?.toLowerCase();
  if (!userEmail) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const gate = await assertPaidAccess(userEmail);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error, upgradeUrl: gate.upgradeUrl }, { status: gate.status });
  }

  // Seed 7 empty buckets, oldest first, so a quiet day is a real zero rather
  // than a gap the chart would silently collapse.
  const now = new Date();
  const buckets: DayBucket[] = [];
  const indexByDate = new Map<string, number>();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getTime() - i * DAY_MS);
    const date = d.toISOString().slice(0, 10);
    indexByDate.set(date, buckets.length);
    buckets.push({ date, label: WEEKDAY[d.getDay()], isToday: i === 0, runs: 0, actions: 0 });
  }

  try {
    const supabase = getSupabaseAdmin();
    const sinceIso = new Date(now.getTime() - 7 * DAY_MS).toISOString();

    const { data: runs, error } = await supabase
      .from('boult_agent_runs')
      .select('status, tool_calls, artifact_links, completed_at, started_at')
      .eq('user_id', userEmail)
      .gte('started_at', sinceIso)
      .order('started_at', { ascending: true })
      .limit(500);

    // Table not migrated / any error → honest empty series, never a 500.
    if (error || !runs?.length) {
      return NextResponse.json({ days: buckets, totalRuns: 0, totalActions: 0, hasData: false });
    }

    const artifactCount = (links: any): number => {
      if (!links || typeof links !== 'object') return 0;
      let n = 0;
      for (const k of ['gmail', 'calendar', 'notion', 'slack']) {
        if (Array.isArray(links[k])) n += links[k].length;
      }
      return n;
    };

    let totalRuns = 0;
    let totalActions = 0;
    for (const r of runs as any[]) {
      const when = r.completed_at || r.started_at;
      if (!when) continue;
      const date = new Date(when).toISOString().slice(0, 10);
      const idx = indexByDate.get(date);
      if (idx === undefined) continue; // outside the 7-day window
      const actions = (Number(r.tool_calls) || 0) + artifactCount(r.artifact_links);
      buckets[idx].runs += 1;
      buckets[idx].actions += actions;
      totalRuns += 1;
      totalActions += actions;
    }

    return NextResponse.json({
      days: buckets,
      totalRuns,
      totalActions,
      hasData: totalRuns > 0,
    });
  } catch (err: any) {
    logEvent({ channel: 'failures', event: '❌ API Error', description: String(err?.message || err) });
    // Never break the feed — return the seeded empty series.
    return NextResponse.json({ days: buckets, totalRuns: 0, totalActions: 0, hasData: false });
  }
}
