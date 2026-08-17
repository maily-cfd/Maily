import { getSupabaseAdmin } from '../supabase.js';
import { normalizeUserId } from './user-id';

export interface PendingActionParams {
  agentId: string;
  runId: string;
  userId: string;
  toolName: string;
  toolInput: Record<string, any>;
}

/**
 * Queue a write action that a background agent wanted to execute
 * but was intercepted because skipConfirmations was false.
 */
export async function queuePendingAction(params: PendingActionParams): Promise<boolean> {
  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from('boult_agent_pending_actions')
      .insert({
        agent_id: params.agentId,
        run_id: params.runId,
        user_id: normalizeUserId(params.userId),
        tool_name: params.toolName,
        tool_input: params.toolInput,
        status: 'pending',
      });
    if (error) {
      console.warn('[Boult:PendingActions] queuePendingAction failed:', error.message);
      return false;
    }
    return true;
  } catch (err: any) {
    console.warn('[Boult:PendingActions] queuePendingAction threw:', err.message);
    return false;
  }
}

/**
 * Check if a specific run has any pending actions.
 */
export async function hasPendingActions(runId: string): Promise<boolean> {
  if (!runId) return false;
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('boult_agent_pending_actions')
      .select('id')
      .eq('run_id', runId)
      .eq('status', 'pending')
      .limit(1)
      .maybeSingle();
    if (error) return false;
    return !!data;
  } catch {
    return false;
  }
}
