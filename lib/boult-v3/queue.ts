/**
 * Boult V3 — Event Queue & Worker
 * 
 * Supabase-backed job queue replacing BullMQ for Phase 1.
 * Provides deduplication, sequential per-user processing,
 * and the core job processing pipeline.
 */

import { getSupabaseAdmin } from '../supabase.js';
import { buildContext } from './context-builder';
import { runAgenticReasoning, runPlanModeReasoning } from './reasoning';
import { emitSSEToUser } from './sse';
import { auditLogger } from '../audit-logger.js';
import type { BoultJob, BoultEvent } from './types';
import { normalizeGCalEvent } from './normalizers/gcal';
import { normalizeSlackMessage } from './normalizers/slack';
import { normalizeNotionPage } from './normalizers/notion';
import crypto from 'crypto';

// In-memory lock to prevent concurrent processing for the same user
const processingUsers = new Set<string>();

/**
 * Check deduplication before enqueuing.
 * Returns true if the event was already processed (skip it).
 */
async function isDuplicate(source: string, eventId: string): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  const dedupeKey = `dedupe:${source}:${eventId}`;

  // Check if key exists and is not expired
  const { data } = await supabase
    .from('boult_dedup_cache')
    .select('dedup_key')
    .eq('dedup_key', dedupeKey)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();

  if (data) return true; // Already processed

  // Set dedup key with 600-second TTL
  await supabase
    .from('boult_dedup_cache')
    .upsert({
      dedup_key: dedupeKey,
      expires_at: new Date(Date.now() + 600_000).toISOString(),
    });

  return false;
}

/**
 * Enqueue an event for processing.
 * Checks dedup first, then inserts into the queue table.
 */
export async function enqueueEvent(job: BoultJob, eventId?: string): Promise<boolean> {
  // Deduplication check
  if (eventId) {
    const duplicate = await isDuplicate(job.source, eventId);
    if (duplicate) {
      console.log(`[Boult V3] Skipping duplicate event: ${job.source}:${eventId}`);
      return false;
    }
  }

  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from('boult_events_queue')
    .insert({
      user_id: job.userId,
      source: job.source,
      event_type: job.eventType,
      payload: job.payload,
      status: 'pending',
    });

  if (error) {
    console.error('[Boult V3] Failed to enqueue event:', error.message);
    return false;
  }

  // Trigger processing (non-blocking)
  processNextJob(job.userId).catch(err => {
    console.error('[Boult V3] Worker error:', err.message);
  });

  return true;
}

/**
 * Process the next pending job for a user.
 * Ensures only one job per user runs at a time.
 */
async function processNextJob(userId: string): Promise<void> {
  // Per-user concurrency lock
  if (processingUsers.has(userId)) {
    return; // Another job is already processing for this user
  }

  processingUsers.add(userId);

  try {
    const supabase = getSupabaseAdmin();

    // Fetch oldest pending job for this user
    const { data: job, error } = await supabase
      .from('boult_events_queue')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error || !job) return;

    // Mark as processing
    await supabase
      .from('boult_events_queue')
      .update({ status: 'processing', attempts: (job.attempts || 0) + 1 })
      .eq('id', job.id);

    try {
      await processJob(job);

      // Mark as completed
      await supabase
        .from('boult_events_queue')
        .update({ status: 'completed', processed_at: new Date().toISOString() })
        .eq('id', job.id);

    } catch (err) {
      // Mark as failed
      await supabase
        .from('boult_events_queue')
        .update({
          status: 'failed',
          error: (err as Error).message,
          processed_at: new Date().toISOString(),
        })
        .eq('id', job.id);
    }

  } finally {
    processingUsers.delete(userId);
  }
}

/**
 * Process a single job — the core pipeline:
 * 1. Normalize the triggering event
 * 2. Build context
 * 3. Run reasoning
 * 4. If actionable, save plan and notify user
 */
async function processJob(job: Record<string, unknown>): Promise<void> {
  const userId = job.user_id as string;
  const source = job.source as string;
  const payload = job.payload as Record<string, unknown>;

  console.log(`[Boult V3] Processing ${source} event for ${userId}`);

  // Determine mode
  const isPlanMode = source === 'cron_plan_mode' || source === 'user_manual';

  // Normalize the triggering event
  let triggeringEvent: BoultEvent | undefined;
  if (!isPlanMode) {
    triggeringEvent = normalizeEvent(source, payload);
  }

  // Build context
  const mode = isPlanMode ? 'plan_mode' : 'agentic';
  const context = await buildContext(userId, mode, triggeringEvent);

  if (isPlanMode) {
    // Plan Mode — generate daily brief
    const { output, rawInput, rawOutput } = await runPlanModeReasoning(context);

    if (output) {
      await savePlanModeBrief(userId, output, rawInput, rawOutput);
    }
  } else {
    // Agentic Mode — check for actionable insights
    const { output, rawInput, rawOutput } = await runAgenticReasoning(context);

    if (output.hasActionableInsight && output.findings.length > 0) {
      const planId = await savePlan(userId, output, rawInput, rawOutput, triggeringEvent);
      
      // Notify user via SSE
      emitSSEToUser(userId, {
        type: 'plan:new',
        planId,
        severity: output.severity,
        headline: output.findings[0]?.headline,
      });

      // Audit log
      await auditLogger.log(userId, 'boult.plan_created', {
        planId,
        severity: output.severity,
        findingsCount: output.findings.length,
      });
    } else {
      console.log(`[Boult V3] No actionable insight for ${userId}`);
    }
  }
}

/**
 * Normalize a raw webhook payload into an BoultEvent.
 */
function normalizeEvent(source: string, payload: Record<string, unknown>): BoultEvent {
  switch (source) {
    case 'gcal':
      return normalizeGCalEvent(payload);
    case 'slack':
      return normalizeSlackMessage(payload);
    case 'notion':
      // Notion payload might be a batch of pages
      const pages = (payload.pages as any[]) || [];
      return normalizeNotionPage(pages[0] || {}, ''); // trigger with first page, empty content (builder will fetch full content)
    default:
      // Generic fallback
      return {
        id: crypto.randomUUID(),
        source: source as any,
        type: 'message',
        title: 'Unknown event',
        description: null,
        startAt: null,
        endAt: null,
        attendees: [],
        url: null,
        rawPayload: payload,
        detectedAt: new Date(),
      };
  }
}

/**
 * Save an agentic plan to the database.
 */
async function savePlan(
  userId: string,
  output: { severity: string; findings: any[] },
  rawInput: unknown,
  rawOutput: unknown,
  triggeringEvent?: BoultEvent
): Promise<string> {
  const supabase = getSupabaseAdmin();
  const finding = output.findings[0]; // Primary finding

  const { data: plan, error } = await supabase
    .from('boult_plans')
    .insert({
      user_id: userId,
      mode: 'agentic',
      status: 'proposed',
      severity: output.severity,
      headline: finding?.headline || null,
      impact: finding?.impact || null,
      findings: output.findings,
      raw_llm_input: rawInput,
      raw_llm_output: rawOutput,
      source: triggeringEvent?.source || 'unknown',
      triggering_event: triggeringEvent || null,
    })
    .select('id')
    .single();

  if (error || !plan) {
    throw new Error(`Failed to save plan: ${error?.message}`);
  }

  return plan.id;
}

/**
 * Save a Plan Mode brief to the database.
 */
async function savePlanModeBrief(
  userId: string,
  output: unknown,
  rawInput: unknown,
  rawOutput: unknown
): Promise<void> {
  const supabase = getSupabaseAdmin();

  // Save as a plan with mode='plan_mode'
  const { data: plan, error: planError } = await supabase
    .from('boult_plans')
    .insert({
      user_id: userId,
      mode: 'plan_mode',
      status: 'completed',
      headline: 'Your Boult Brief',
      raw_llm_input: rawInput,
      raw_llm_output: rawOutput,
      source: 'cron_plan_mode',
    })
    .select('id')
    .single();

  if (planError || !plan) {
    throw new Error(`Failed to save brief plan: ${planError?.message}`);
  }

  // Save brief data
  await supabase
    .from('boult_briefs')
    .insert({
      user_id: userId,
      plan_id: plan.id,
      brief_data: output,
    });

  // Notify user
  emitSSEToUser(userId, {
    type: 'plan:new',
    planId: plan.id,
    mode: 'plan_mode',
  });

  await auditLogger.log(userId, 'boult.brief_generated', { planId: plan.id });
}
