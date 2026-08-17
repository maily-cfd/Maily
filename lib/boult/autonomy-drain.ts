/**
 * Autonomy action drainer — fires deferred auto-approved actions once their undo
 * window has elapsed. Runs from the cron every tick.
 *
 * Reuses executeTool (the exact call the manual-approve route uses) so there's no
 * new execution path. Lives in its own module because it imports ./tools, while the
 * gate that ENQUEUES (applyAutonomyGate in ./autonomy-grants) is imported BY ./tools
 * — keeping them apart avoids a circular dependency.
 */

// @ts-ignore — JS module
import { getSupabaseAdmin } from '../supabase.js';
import { executeTool } from './tools';
import { recordLearningEvent } from './autonomy';

const DEFAULT_LIMIT = 25;

export interface AutonomyDrainResult { claimed: number; done: number; failed: number; }

export async function drainAutonomyActions(supabase?: any, opts: { limit?: number } = {}): Promise<AutonomyDrainResult> {
  const db = supabase || getSupabaseAdmin();
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const result: AutonomyDrainResult = { claimed: 0, done: 0, failed: 0 };
  try {
    const nowIso = new Date().toISOString();

    // 1. Bounded batch of due, auto_scheduled rows (ids only).
    const { data: due } = await db
      .from('boult_autonomy_actions')
      .select('id')
      .eq('status', 'auto_scheduled')
      .lte('execute_at', nowIso)
      .order('execute_at', { ascending: true })
      .limit(limit);
    if (!due?.length) return result;
    const ids = due.map((r: any) => r.id);

    // 2. Atomically claim — the .eq('status','auto_scheduled') guard means a row a
    //    user just Stopped (status='cancelled') is never claimed, and concurrent
    //    ticks can't double-fire. Returned rows are the ones we own.
    const { data: claimed } = await db
      .from('boult_autonomy_actions')
      .update({ status: 'executing' })
      .in('id', ids)
      .eq('status', 'auto_scheduled')
      .select('*');
    if (!claimed?.length) return result;
    result.claimed = claimed.length;

    // 3. Execute each via the same path as a manual approval.
    for (const row of claimed) {
      try {
        const toolResult: any = await executeTool(row.tool_name, row.tool_input || {}, row.user_id, { skipConfirmations: true });
        const failed = toolResult && toolResult.success === false;
        await db
          .from('boult_autonomy_actions')
          .update({
            status: failed ? 'failed' : 'done',
            executed_at: new Date().toISOString(),
            result: typeof toolResult?.output === 'string' ? toolResult.output.slice(0, 500) : null,
            error: failed ? String(toolResult?.error || 'tool returned failure').slice(0, 300) : null,
          })
          .eq('id', row.id);
        if (failed) result.failed++; else result.done++;

        // Learning loop: a fired auto action is an implicit approval precedent.
        if (!failed) {
          recordLearningEvent({
            userId: row.user_id,
            agentId: row.agent_id || undefined,
            toolName: row.tool_name,
            toolInput: row.tool_input || {},
            decision: 'approved',
          }).catch(() => {});
        }
      } catch (e: any) {
        await db
          .from('boult_autonomy_actions')
          .update({ status: 'failed', executed_at: new Date().toISOString(), error: String(e?.message || e).slice(0, 300) })
          .eq('id', row.id);
        result.failed++;
      }
    }
  } catch (e: any) {
    console.error('[autonomy-drain] failed:', e?.message || e);
  }
  return result;
}
