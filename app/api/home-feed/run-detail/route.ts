/**
 * HomeFeed run-detail — lazy transparency payload for ONE agent run.
 *
 * The "While you were away" cards on HomeFeed are collapsed by default (fast,
 * clean). When a user expands one, the client hits this endpoint for the full
 * transparency stack of that single run:
 *   - plan   — what Boult decided to do (Layer 1, boult_agent_runs.plan)
 *   - tools  — what actually executed (boult_audit_log, humanized + counted)
 *   - links  — direct links to the artifacts (boult_agent_runs.artifact_links)
 *
 * Fetching on expand (not upfront) keeps the feed payload small and the list
 * snappy — most users never expand most runs.
 */
import { NextResponse } from 'next/server';
// @ts-ignore
import { auth } from '@/lib/auth.js';
// @ts-ignore
import { getSupabaseAdmin } from '@/lib/supabase.js';
import { summarizeToolUse, type ToolUseLine } from '@/lib/boult/tool-labels';
import { logEvent } from "@/lib/logsso";

export const dynamic = 'force-dynamic';

interface RunDetailLink { label: string; url: string }
interface RunDetailResponse {
  plan: string | null;
  tools: ToolUseLine[];
  links: {
    gmail: RunDetailLink[];
    calendar: RunDetailLink[];
    notion: RunDetailLink[];
    slack: RunDetailLink[];
  };
}

export async function GET(req: Request) {
  try {
    // @ts-ignore
    const session = await (auth as any)();
    if (!session?.user?.email) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const userEmail = (session.user.email as string).toLowerCase();

    const runId = new URL(req.url).searchParams.get('runId');
    if (!runId) {
      return NextResponse.json({ success: false, error: 'runId required' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    // Fetch the run — scoped to this user so one user can't read another's run.
    const { data: run, error } = await supabase
      .from('boult_agent_runs')
      .select('id, user_id, plan, artifact_links')
      .eq('id', runId)
      .maybeSingle();

    if (error || !run || String(run.user_id).toLowerCase() !== userEmail) {
      // Don't leak whether the id exists — same response for missing + not-yours.
      return NextResponse.json({ success: false, error: 'Run not found' }, { status: 404 });
    }

    // Tool calls for this run, in execution order.
    let tools: ToolUseLine[] = [];
    try {
      const { data: audits } = await supabase
        .from('boult_audit_log')
        .select('tool_name, success, created_at')
        .eq('run_id', runId)
        .order('created_at', { ascending: true })
        .limit(200);
      tools = summarizeToolUse((audits || []) as any[]);
    } catch {
      logEvent({ channel: "failures", event: "❌ API Error", description: "Unknown error" }); /* audit table may be unmigrated — degrade to no tools */ }

    const al = (run.artifact_links || {}) as any;
    const bucket = (k: string): RunDetailLink[] =>
      Array.isArray(al[k]) ? al[k].filter((x: any) => x?.url).map((x: any) => ({ label: String(x.label || 'Open'), url: String(x.url) })) : [];

    const payload: RunDetailResponse = {
      plan: run.plan || null,
      tools,
      links: {
        gmail: bucket('gmail'),
        calendar: bucket('calendar'),
        notion: bucket('notion'),
        slack: bucket('slack'),
      },
    };

    return NextResponse.json({ success: true, ...payload });
  } catch (err: any) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(err) });
    console.error('[home-feed/run-detail] failed:', err?.message);
    return NextResponse.json({ success: false, error: 'Failed to load run detail' }, { status: 500 });
  }
}
