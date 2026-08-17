/**
 * Agent Approvals API
 * 
 * GET  /api/boult/agent-approvals — list pending actions for the current user
 * POST /api/boult/agent-approvals — approve or reject a specific action
 *
 * When an action is approved, the corresponding tool is executed immediately
 * using the stored tool_input. The row is then marked 'approved' with a
 * resolved_at timestamp. Rejected rows are marked 'rejected'.
 */

import { NextRequest, NextResponse } from 'next/server';
// @ts-ignore
import { auth as nextAuth } from '@/lib/auth.js';
import { getSupabaseAdmin } from '../../../../lib/supabase.js';
import { executeTool } from '../../../../lib/boult/tools';
import { recordLearningEvent } from '../../../../lib/boult/autonomy';
import { recordDecision, toolToGrantAction, grantTargetKey } from '../../../../lib/boult/autonomy-grants';
import { logEvent } from "@/lib/logsso";

// Count an approve/reject toward the graduated-autonomy ladder for this target.
function countTowardAutonomy(userId: string, toolName: string, toolInput: any, decision: 'approved' | 'rejected') {
  const action = toolToGrantAction(toolName);
  if (!action) return;
  const targetKey = grantTargetKey(action, toolInput || {});
  if (!targetKey) return;
  recordDecision({ userId, action, targetKey, decision, label: targetKey }).catch(() => {});
}

// @ts-ignore
const auth: any = nextAuth;

export const dynamic = 'force-dynamic';

// ─────────────────────────────────────────────────────────────────────────────
// GET — list pending actions for the authenticated user
// ─────────────────────────────────────────────────────────────────────────────

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const email = session.user.email;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('boult_agent_pending_actions')
    .select(`
      id,
      agent_id,
      run_id,
      tool_name,
      tool_input,
      status,
      created_at,
      resolved_at,
      boult_agents!inner ( name )
    `)
    .eq('user_id', email.toLowerCase())
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[AgentApprovals] GET error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Flatten agent name into each action
  const actions = (data || []).map((row: any) => ({
    id: row.id,
    agentId: row.agent_id,
    agentName: row.boult_agents?.name || 'Unknown Agent',
    runId: row.run_id,
    toolName: row.tool_name,
    toolInput: row.tool_input,
    status: row.status,
    createdAt: row.created_at,
  }));

  return NextResponse.json({ actions });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST — approve or reject an action
// Body: { actionId: string, decision: 'approve' | 'reject' }
// ─────────────────────────────────────────────────────────────────────────────

// Human-readable labels for tool names in results
const TOOL_LABELS: Record<string, string> = {
  send_email: 'Email sent',
  schedule_meeting: 'Meeting booked',
  send_slack_message: 'Slack message posted',
  slack_send_dm: 'Slack DM sent',
  create_notion_page: 'Notion page created',
  calendar_cancel_event: 'Calendar event cancelled',
};

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const email = session.user.email;

  let body: any;
  try {
    body = await request.json();
  } catch {
    logEvent({ channel: "failures", event: "❌ API Error", description: "Unknown error" });
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { actionId, decision } = body;
  if (!actionId || !['approve', 'reject'].includes(decision)) {
    return NextResponse.json({ error: 'Required: actionId (string), decision ("approve" | "reject")' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  // Fetch the action — verify it belongs to this user and is still pending.
  // Join boult_agents to pull the agent name for the learning-loop record.
  const { data: action, error: fetchErr } = await supabase
    .from('boult_agent_pending_actions')
    .select('*, boult_agents!inner ( name )')
    .eq('id', actionId)
    .eq('user_id', email.toLowerCase())
    .eq('status', 'pending')
    .maybeSingle();

  if (fetchErr) {
    console.error('[AgentApprovals] fetch error:', fetchErr.message);
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }
  if (!action) {
    return NextResponse.json({ error: 'Action not found, already resolved, or does not belong to you.' }, { status: 404 });
  }

  const agentName = (action as any).boult_agents?.name as string | undefined;

  // ── Reject path ──────────────────────────────────────────────────────────
  if (decision === 'reject') {
    await supabase
      .from('boult_agent_pending_actions')
      .update({ status: 'rejected', resolved_at: new Date().toISOString() })
      .eq('id', actionId);

    // Learning loop: persist the rejection so future runs can pattern-match
    // against this user's past corrections. Fire-and-forget — never blocks.
    recordLearningEvent({
      userId: action.user_id,
      agentId: action.agent_id,
      agentName,
      toolName: action.tool_name,
      toolInput: action.tool_input || {},
      decision: 'rejected',
    }).catch(() => {});
    countTowardAutonomy(action.user_id, action.tool_name, action.tool_input, 'rejected');

    return NextResponse.json({ success: true, message: 'Action rejected.' });
  }

  // ── Approve path — execute the tool ──────────────────────────────────────
  try {
    const result = await executeTool(
      action.tool_name,
      action.tool_input,
      action.user_id,
      // No conversationId — bypass the interactive approval gate.
      // isBackgroundAgent false + skipConfirmations true = direct execution
      { skipConfirmations: true },
    );

    await supabase
      .from('boult_agent_pending_actions')
      .update({ status: 'approved', resolved_at: new Date().toISOString() })
      .eq('id', actionId);

    // Learning loop: persist the approval. Future runs reading the same
    // recipient/target will see a positive precedent.
    recordLearningEvent({
      userId: action.user_id,
      agentId: action.agent_id,
      agentName,
      toolName: action.tool_name,
      toolInput: action.tool_input || {},
      decision: 'approved',
    }).catch(() => {});
    countTowardAutonomy(action.user_id, action.tool_name, action.tool_input, 'approved');

    const label = TOOL_LABELS[action.tool_name] || action.tool_name;
    return NextResponse.json({
      success: true,
      message: `${label} successfully.`,
      toolResult: result.output?.slice(0, 500),
    });
  } catch (err: any) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(err) });
    console.error('[AgentApprovals] execution error:', err.message);
    return NextResponse.json({
      success: false,
      error: `Failed to execute ${action.tool_name}: ${err.message}`,
    }, { status: 500 });
  }
}
