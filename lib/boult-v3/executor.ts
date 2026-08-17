/**
 * Boult V3 — Execution Engine
 * 
 * Runs plan steps sequentially. Never in parallel.
 * Each step is wrapped in a 10-second timeout.
 * On failure, execution stops immediately.
 * 
 * Real-time updates are pushed via SSE after each step transition.
 */

import { getSupabaseAdmin } from '../supabase.js';
import { isAllowedAction, DEEP_LINKS } from './whitelist';
import { executeStep } from './dispatcher';
import { emitSSE } from './sse';
import { auditLogger, AUDIT_EVENTS } from '../audit-logger.js';

/**
 * Wrap a promise with a timeout. If the promise doesn't resolve
 * within `ms` milliseconds, reject with a timeout error.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Step timed out after ${ms}ms`)), ms)
  );
  return Promise.race([promise, timeout]);
}

/**
 * Execute a plan — runs all steps sequentially.
 * 
 * This function matches the exact structure from the spec:
 * - Whitelist check BEFORE any API call
 * - Sequential execution, stop on first failure
 * - SSE events emitted at each transition
 * - Audit log for every step completion/failure
 */
export async function executePlan(planId: string, userId: string): Promise<void> {
  const supabase = getSupabaseAdmin();

  // 1. Fetch plan with steps, scoped to userId
  const { data: plan, error: planError } = await supabase
    .from('boult_plans')
    .select('*')
    .eq('id', planId)
    .eq('user_id', userId)
    .maybeSingle();

  if (planError || !plan) {
    throw new Error('Plan not found or access denied');
  }

  const { data: steps, error: stepsError } = await supabase
    .from('boult_plan_steps')
    .select('*')
    .eq('plan_id', planId)
    .order('position', { ascending: true });

  if (stepsError || !steps || steps.length === 0) {
    throw new Error('No steps found for plan');
  }

  // 2. Transition plan to 'executing'
  await supabase
    .from('boult_plans')
    .update({ status: 'executing', executed_at: new Date().toISOString() })
    .eq('id', planId);

  // 3. Execute steps sequentially
  for (const step of steps) {
    // Mark step as executing
    await supabase
      .from('boult_plan_steps')
      .update({ status: 'executing' })
      .eq('id', step.id);

    emitSSE(userId, planId, { type: 'step:start', stepId: step.id });

    try {
      // ACTION WHITELIST CHECK — must happen BEFORE any API call
      if (!isAllowedAction(step.app, step.action)) {
        throw new Error(`Blocked action: ${step.app}.${step.action} is not whitelisted`);
      }

      // Execute with 10-second timeout
      await withTimeout(
        executeStep(
          { app: step.app, action: step.action, params: step.params || {} },
          userId
        ),
        10000
      );

      // Mark step as completed
      await supabase
        .from('boult_plan_steps')
        .update({ status: 'completed', executed_at: new Date().toISOString() })
        .eq('id', step.id);

      emitSSE(userId, planId, { type: 'step:done', stepId: step.id });

      // Audit log: success
      await auditLogger.log(userId, 'boult.step_completed', {
        planId,
        stepId: step.id,
        app: step.app,
        action: step.action,
      });

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';

      // Mark step as failed
      await supabase
        .from('boult_plan_steps')
        .update({ status: 'failed', error: errorMessage })
        .eq('id', step.id);

      // Mark plan as failed
      await supabase
        .from('boult_plans')
        .update({ status: 'failed' })
        .eq('id', planId);

      emitSSE(userId, planId, {
        type: 'step:failed',
        stepId: step.id,
        error: errorMessage,
        deepLink: DEEP_LINKS[step.app] || null,
      });

      // Audit log: failure
      await auditLogger.log(userId, 'boult.step_failed', {
        planId,
        stepId: step.id,
        app: step.app,
        action: step.action,
        error: errorMessage,
      });

      return; // STOP. Do not continue to next step.
    }
  }

  // 4. All steps completed — mark plan as completed
  await supabase
    .from('boult_plans')
    .update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq('id', planId);

  emitSSE(userId, planId, { type: 'plan:completed', planId });

  // Audit log: plan completed
  await auditLogger.log(userId, 'boult.plan_completed', { planId });
}
