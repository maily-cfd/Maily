/**
 * Run a background agent immediately ("Run now" from the agent card).
 * POST /api/boult/agents/run  { id }
 *
 * Streams the agentic loop as Server-Sent Events (identical event format to
 * /api/boult/chat) so the browser sees live progress and the HTTP response
 * is flushed immediately. The previous implementation drained the entire
 * loop server-side before responding, which exceeded Vercel's 60s function
 * cap and returned a 504 — the route never reached the conversation-save
 * code, so "Run now" appeared to do nothing.
 *
 * The client consumes the stream and persists the conversation via
 * /api/boult/conversation once the report is produced.
 */

import { NextRequest, NextResponse } from 'next/server';
// @ts-ignore
const { auth } = require('../../../../../lib/auth.js');
import { getSupabaseAdmin } from '../../../../../lib/supabase.js';
import { buildAgentLoopArgs } from '../../../../../lib/boult/run-agent';
import { runAgentLoop } from '../../../../../lib/boult/loop';
import { logEvent } from "@/lib/logsso";

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.email.toLowerCase();

  const body = await request.json().catch(() => ({}));
  const { id } = body;
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { data: agent, error } = await supabase
    .from('boult_agents')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });

  const conversationId =
    (globalThis.crypto?.randomUUID?.() as string | undefined) ||
    `agentrun_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

  let args;
  try {
    // Leave headroom under the 60s function cap so the loop forces a final
    // report before Vercel kills the function mid-stream.
    args = await buildAgentLoopArgs(agent, { maxToolCalls: 14, deadlineMs: 50_000 });
  } catch (err: any) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(err) });
    return NextResponse.json({ error: `Agent setup failed: ${err.message}` }, { status: 500 });
  }

  let stream: ReadableStream;
  try {
    stream = runAgentLoop(args);
  } catch (err: any) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(err) });
    return NextResponse.json({ error: `Agent run failed: ${err.message}` }, { status: 500 });
  }

  // Record that a manual run happened (fire-and-forget — must not block the
  // stream). last_run_at is intentionally left untouched so a manual run
  // doesn't suppress the next scheduled run via the cron anti-double-run guard.
  supabase
    .from('boult_agents')
    .update({ last_report_summary: `Manual run started ${new Date().toISOString()}` })
    .eq('id', agent.id)
    .then(() => {}, () => {});

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Conversation-Id': conversationId,
      'X-Agent-Name': encodeURIComponent(agent.name || 'Agent'),
      'X-Agent-Task': encodeURIComponent(agent.task_description || ''),
    },
  });
}
