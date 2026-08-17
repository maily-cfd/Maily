/**
 * Boult Background Agent Runner — Vercel Cron
 * GET /api/cron/run-agents
 *
 * Runs every 15 minutes (configure in vercel.json).
 *
 * For each active agent whose next run time has passed:
 * 1. Runs the agent task via the Boult agentic loop
 * 2. Delivers the report via Resend (email) and/or Slack
 * 3. Updates lastRunAt and lastReportSummary
 *
 * Required env vars:
 *   RESEND_API_KEY          — Resend API key (send email reports)
 *   RESEND_FROM_EMAIL       — Verified Resend sender, e.g. "Boult <boult@maily.dev>"
 *                             Defaults to "Boult AI <boult@maily.dev>"
 *
 * Optional env vars:
 *   BOULT_SLACK_BOT_TOKEN   — Slack bot token for the Maily workspace.
 *                             If set, used for all Slack delivery instead of
 *                             the user's personal Slack OAuth token.
 *   CRON_SECRET             — REQUIRED. cron-job.org sends this as
 *                             `Authorization: Bearer <CRON_SECRET>` on every
 *                             trigger. Set it in cron-job.org → job →
 *                             Headers → "Authorization: Bearer <value>" and
 *                             in Vercel env vars as the same value.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../lib/supabase.js';
// @ts-ignore - JS module
import { subscriptionService } from '../../../../lib/subscription-service.js';
import { runAgentTask, generateRunPlan } from '../../../../lib/boult/run-agent';
import { hasPendingActions } from '../../../../lib/boult/agent-approvals';
import { scoreReportSignal, decideDelivery } from '../../../../lib/boult/signal-density';
import { checkEventAgents, mergeProcessedIds } from '../../../../lib/boult/triggers/reactive-poll';
import { enqueueChainHandoff, drainChainQueue } from '../../../../lib/boult/triggers/chain';
// @ts-ignore — JS module, no .d.ts
import { EmailUI } from '../../../../lib/email-design.js';
import { drainScheduledEmails } from '../../../../lib/boult/scheduled-send';
import { drainAutonomyActions } from '../../../../lib/boult/autonomy-drain';
import { reconcileLedger } from '../../../../lib/boult/super/ledger';
import { logEvent } from "@/lib/logsso";

const CRON_SECRET = process.env.CRON_SECRET || 'boult-cron-secret';
const RESEND_FROM = process.env.RESEND_FROM_EMAIL || 'Boult AI <boult@maily.dev>';

// A 'running' row older than this is treated as a crashed/timed-out run
// (stuck lock) and is allowed to run again, instead of being excluded forever.
// Must exceed the 55-min anti-double-run guard in shouldAgentRunNow so a
// recovered agent isn't immediately re-blocked by its own stale last_run_at.
const STALE_LOCK_MIN = 60;

export const dynamic = 'force-dynamic';
// The hard function time limit. 300s is Vercel's max with Fluid Compute (the
// default runtime since 2025, available on Hobby). The whole working budget
// below derives from this number and scales automatically. If a deploy ever
// rejects it with a max-duration error, enable Fluid Compute in Vercel →
// Project Settings → Functions (or drop back to 60). NOTE: cron-job.org's
// request timeout must be ≥ this value or it aborts the tick early.
export const maxDuration = 300;

// ─────────────────────────────────────────────────────────────────────────────
// Cron entry
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization') || '';
  const isCronJobOrg =
    authHeader === `Bearer ${CRON_SECRET}` ||
    request.headers.get('x-boult-cron-secret') === CRON_SECRET;
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  if (!isCronJobOrg && !isVercelCron) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Phase 2 — fast reactive lane. Point a frequent cron-job (~every 2 min) at
  // /api/cron/run-agents?only=events: it processes ONLY event/condition agents
  // and chain hand-offs (schedule agents are skipped), cutting reactive latency
  // from ~15 min to ~2 min while reusing this whole runner (budget, delivery,
  // F3.1, run records). The classic 15-min job runs the full set as before.
  const onlyEvents = new URL(request.url).searchParams.get('only') === 'events';

  const supabase = getSupabaseAdmin();

  // ── Reap stuck runs ────────────────────────────────────────────────────────
  // A run/agent left in 'running' longer than the function could possibly live
  // means Vercel killed the function mid-run before it could write its report.
  // Close those out so the UI is truthful (a real Error, not a perpetual
  // "Running…") and the agent is freed to run again. Cutoff = the hard limit plus
  // a 2-min grace, so we never touch a run that might still be executing.
  const reapCutoffIso = new Date(Date.now() - (maxDuration + 120) * 1000).toISOString();
  try {
    await supabase
      .from('boult_agent_runs')
      .update({
        status: 'error',
        error_message: 'Run was cut short by the serverless time limit before it finished. It will retry on the next scheduled run.',
        completed_at: new Date().toISOString(),
      })
      .eq('status', 'running')
      .lt('started_at', reapCutoffIso);
    await supabase
      .from('boult_agents')
      .update({ status: 'active' })
      .eq('status', 'running')
      .lt('last_run_at', reapCutoffIso);
  } catch (e: any) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(e) });
    console.warn('[Cron] stuck-run reaper failed:', e?.message);
  }
  // Same for autonomy actions a killed function left mid-flight. Mark them failed
  // (not retried) — a row stuck in 'executing' may have partially sent, so we don't
  // risk a double-send. (No-op if the autonomy table isn't migrated.)
  try {
    await supabase
      .from('boult_autonomy_actions')
      .update({ status: 'failed', error: 'Interrupted by the serverless time limit; not retried to avoid a double-send.', executed_at: new Date().toISOString() })
      .eq('status', 'executing')
      .lt('execute_at', reapCutoffIso);
  } catch {
    logEvent({ channel: "failures", event: "❌ API Error", description: "Unknown error" }); /* table optional */ }

  const { data: agents, error } = await supabase
    .from('boult_agents')
    .select('*')
    .in('status', ['active', 'running']);

  if (error?.code === '42P01') {
    return NextResponse.json({ message: 'boult_agents table not found — skipping.' });
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!agents?.length) {
    // No scheduled agents this tick — but the independent queues must still fire:
    // scheduled emails created from chat, and autonomy actions whose undo window
    // elapsed, don't require an active agent to exist. (These also run later in the
    // normal path; only one branch executes per tick.)
    const drainResults: string[] = [];
    try {
      const mail = await drainScheduledEmails(supabase);
      if (mail.claimed) drainResults.push(`Scheduled mail: ${mail.sent} sent, ${mail.retried} retry, ${mail.failed} failed`);
    } catch (e: any) {
      logEvent({ channel: "failures", event: "❌ API Error", description: String(e) }); console.warn('[Cron] scheduled-mail drain failed:', e?.message); }
    try {
      const auto = await drainAutonomyActions(supabase);
      if (auto.claimed) drainResults.push(`Autonomy: ${auto.done} done, ${auto.failed} failed`);
    } catch (e: any) {
      logEvent({ channel: "failures", event: "❌ API Error", description: String(e) }); console.warn('[Cron] autonomy drain failed:', e?.message); }
    return NextResponse.json({ message: 'No active agents.', ran: 0, results: drainResults });
  }

  const now = new Date();
  const results: string[] = [];
  let ran = 0;

  // Working budget, sized OFF the real function limit so it scales when you raise
  // AGENT_FN_MAX_DURATION on Pro. We reserve ~13% (min 8s) of headroom so the
  // committee self-terminates and writes its report BEFORE Vercel pulls the plug,
  // and a slice for report delivery (Gmail/Slack) + DB writes. At 60s → ~52s/12s;
  // at 300s → ~261s/40s.
  const FN_LIMIT_MS = maxDuration * 1000;
  const FUNCTION_BUDGET_MS = Math.round(FN_LIMIT_MS - Math.max(8_000, FN_LIMIT_MS * 0.13));
  const DELIVERY_RESERVE_MS = Math.min(40_000, Math.max(12_000, Math.round(FN_LIMIT_MS * 0.13)));
  const cronStartedAt = Date.now();
  const timeLeftMs = () => FUNCTION_BUDGET_MS - (Date.now() - cronStartedAt);

  // Batch-fetch timezones
  const uniqueUsers = Array.from(new Set(agents.map((a: any) => a.user_id as string)));
  const tzMap: Record<string, string> = {};
  await Promise.all(
    uniqueUsers.map(async (uid: string) => {
      try {
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('preferences')
          .ilike('user_id', uid)
          .maybeSingle();
        const prefs = (profile?.preferences as Record<string, unknown>) || {};
        tzMap[uid] = (prefs.timezone as string) || 'UTC';
      } catch {
        logEvent({ channel: "failures", event: "❌ API Error", description: "Unknown error" });
        tzMap[uid] = 'UTC';
      }
    }),
  );

  // Plan gate: only DEPLOY agents for users on a paid plan (pro / annual /
  // lifetime, including active free-Pro referral grants and owner emails).
  // A free/expired user's agents stay 'active' but dormant — so the moment they
  // subscribe, their agents start running on the very next tick. This is what
  // makes "after you pay, your agents deploy automatically" actually true.
  const paidMap: Record<string, boolean> = {};
  await Promise.all(
    uniqueUsers.map(async (uid: string) => {
      try {
        const plan = await subscriptionService.getUserPlanType(uid);
        paidMap[uid] = !!plan && plan !== 'free' && plan !== 'none';
      } catch {
        logEvent({ channel: "failures", event: "❌ API Error", description: "Unknown error" });
        paidMap[uid] = false;
      }
    }),
  );

  // ── Pre-flight pass ──────────────────────────────────────────────────────
  // Walk every active agent ONCE and classify it:
  //   - expired → pause and skip
  //   - stuck-locked → either recover or skip
  //   - not due this tick → skip silently
  //   - due → add to the parallel run batch
  // No cron-time math inside the parallel batch — the schedule decision
  // happens once, here.
  const readyToRun: any[] = [];
  const polledNotFired: any[] = []; // event agents polled this tick with no match
  for (const agent of agents) {
    // Dormant until the owner is on a paid plan.
    if (!paidMap[agent.user_id]) continue;

    if (agent.expires_at) {
      const expiryEnd = new Date(`${agent.expires_at}T23:59:59Z`).getTime();
      if (now.getTime() > expiryEnd) {
        if (agent.status !== 'paused') {
          await supabase.from('boult_agents').update({ status: 'paused' }).eq('id', agent.id);
          results.push(`Expired (paused): ${agent.name}`);
        }
        continue;
      }
    }

    if (agent.status === 'running') {
      const startedMinAgo = agent.last_run_at
        ? (now.getTime() - new Date(agent.last_run_at).getTime()) / 60000
        : Infinity;
      if (startedMinAgo < STALE_LOCK_MIN) continue;
      results.push(`Recovering stuck agent: ${agent.name}`);
    }

    const userTz = tzMap[agent.user_id] || 'UTC';
    const triggerType = agent.trigger_type || 'schedule';

    // 'chained' agents never fire on the clock — only the chain drainer below.
    if (triggerType === 'chained') continue;

    // Event / condition agents: reactive poll. Gated by last_polled_at (NOT
    // last_run_at) so an idle agent that never fires still won't re-read Gmail
    // more than once per debounce window — critical now that the fast lane can
    // hit this route every ~2 min. We stamp last_polled_at whether or not it
    // fires (fired → in the post-run state update; not-fired → batched below).
    if (triggerType === 'event' || triggerType === 'condition') {
      // force_poll is set by the Gmail push webhook — a real-time signal that this
      // mailbox just changed. It bypasses the debounce for ONE poll so a new email
      // fires its agent in seconds instead of waiting out the debounce window.
      const forcePoll = agent.agent_state?.force_poll === true;
      const debMin = Number(agent.trigger_config?.debounce_min) || 15;
      const lastPolled = agent.agent_state?.last_polled_at || agent.last_run_at;
      if (!forcePoll && lastPolled && (now.getTime() - new Date(lastPolled).getTime()) / 60000 < debMin) continue;
      let reactive;
      try { reactive = await checkEventAgents(agent); } catch {
        logEvent({ channel: "failures", event: "❌ API Error", description: "Unknown error" }); reactive = null; }
      if (!reactive?.shouldFire) {
        polledNotFired.push(agent); // stamp last_polled_at after the loop
        continue;
      }
      agent._triggerSource = 'event';
      agent._matchedEvents = reactive.matchedEvents;
      agent._newProcessedIds = reactive.newProcessedIds;
      readyToRun.push(agent);
      continue;
    }

    // In the fast event lane we skip schedule agents entirely — the classic
    // 15-min job owns them.
    if (onlyEvents) continue;

    // schedule (default) — unchanged path.
    if (!shouldAgentRunNow(agent.cron_schedule, agent.last_run_at, userTz)) continue;
    agent._triggerSource = 'schedule';
    readyToRun.push(agent);
  }

  // Stamp last_polled_at for event agents we polled but that didn't fire, so the
  // fast lane respects each agent's debounce window regardless of cron cadence.
  if (polledNotFired.length) {
    const polledAt = now.toISOString();
    await Promise.all(polledNotFired.map(a =>
      supabase.from('boult_agents')
        // Clear force_poll too — the real-time nudge has now been serviced.
        .update({ agent_state: { ...(a.agent_state || {}), last_polled_at: polledAt, force_poll: false } })
        .eq('id', a.id),
    ));
  }

  // ── Chain drainer ─────────────────────────────────────────────────────────
  // Pipeline hand-offs enqueued by a parent run last tick. Load each child and
  // append it (subject to the same paid/expiry/status gate).
  try {
    const drained = await drainChainQueue(supabase);
    for (const d of drained) {
      const { data: child } = await supabase.from('boult_agents').select('*').eq('id', d.agentId).maybeSingle();
      if (!child || child.status === 'paused') continue;
      if (child.expires_at && now.getTime() > new Date(`${child.expires_at}T23:59:59Z`).getTime()) continue;
      if (!(child.user_id in paidMap)) {
        try {
          const plan = await subscriptionService.getUserPlanType(child.user_id);
          paidMap[child.user_id] = !!plan && plan !== 'free' && plan !== 'none';
        } catch {
          logEvent({ channel: "failures", event: "❌ API Error", description: "Unknown error" }); paidMap[child.user_id] = false; }
      }
      if (!paidMap[child.user_id]) continue;
      if (readyToRun.some(a => a.id === child.id)) continue; // already queued this tick
      child._triggerSource = 'chain';
      child._chainInput = d.chainInput;
      child._parentRunId = d.parentRunId;
      child._chainDepth = d.chainDepth;
      child._visited = d.visited;
      readyToRun.push(child);
      results.push(`Chained: ${child.name} (from pipeline)`);
    }
  } catch (e: any) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(e) });
    console.warn('[Cron] chain drain failed:', e?.message);
  }

  // ── Scheduled email dispatcher ────────────────────────────────────────────
  // Sends any due scheduled emails (schedule_email_send). Runs every tick —
  // even when no agents are due — so it must come BEFORE the early return below.
  try {
    const mail = await drainScheduledEmails(supabase);
    if (mail.claimed) results.push(`Scheduled mail: ${mail.sent} sent, ${mail.retried} retry, ${mail.failed} failed`);
  } catch (e: any) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(e) });
    console.warn('[Cron] scheduled-mail drain failed:', e?.message);
  }

  // ── Autonomy action dispatcher ────────────────────────────────────────────
  // Fires auto-approved actions whose undo window has elapsed. Also every tick.
  try {
    const auto = await drainAutonomyActions(supabase);
    if (auto.claimed) results.push(`Autonomy: ${auto.done} done, ${auto.failed} failed`);
  } catch (e: any) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(e) });
    console.warn('[Cron] autonomy drain failed:', e?.message);
  }

  if (readyToRun.length === 0) {
    return NextResponse.json({ message: 'No agents due this tick.', ran: 0, results });
  }

  // Highest priority first (1 = highest), so when budget is tight the agents
  // that matter most get their tool-call share before the rest.
  readyToRun.sort((a, b) => (a.priority ?? 5) - (b.priority ?? 5));

  // ── Parallel run ─────────────────────────────────────────────────────────
  // All due agents run concurrently within the same wall-clock budget. Each
  // gets the SAME deadlineMs (function ends at the same time for everyone)
  // and an equal share of the tool-call ceiling so one greedy agent can't
  // starve another in the same tick.
  const sharedBudget = timeLeftMs() - DELIVERY_RESERVE_MS;
  if (sharedBudget < 12_000) {
    results.push(`Skipped ${readyToRun.length} agent(s) — insufficient budget this tick.`);
    return NextResponse.json({ message: 'Insufficient budget.', ran: 0, results });
  }

  // Per-agent tool-call ceiling: derived from per-agent share of remaining
  // wall-clock time. Two agents running in parallel each get ~half the calls
  // a single agent would get, because they're competing for the same LLM
  // throughput. Scales with the 300s window: floor 10, cap 80 (batch tools
  // do the heavy lifting in few calls; MAX_TOOL_CALLS_BACKGROUND caps at 100).
  const perAgentSlice = sharedBudget / readyToRun.length;
  const perAgentToolCalls = Math.min(80, Math.max(10, Math.floor(perAgentSlice / 2500)));

  // F3.1 — Mark 'running' AND set last_run_at = now in ONE write up front.
  //
  // Previously only status was updated here; last_run_at was written after
  // the run completed. If Vercel's 60s timeout killed the function before
  // that post-run write, the row was left as {status:'running', last_run_at:
  // <stale>}. The stale-lock check on the next tick (60-min threshold)
  // would see the stale last_run_at, treat the agent as crash-recovered,
  // and re-run it. Long-running agents could loop indefinitely.
  //
  // By stamping last_run_at at START, even a timeout leaves a fresh
  // timestamp — the stale-lock recovery only fires after a real 60-min
  // hang, never on a normal long-but-completed run.
  const nowIso = now.toISOString();
  await Promise.all(
    readyToRun.map(a =>
      supabase.from('boult_agents')
        .update({ status: 'running', last_run_at: nowIso })
        .eq('id', a.id),
    ),
  );

  const runResults = await Promise.allSettled(
    readyToRun.map(async (agent) => {
      results.push(`Running: ${agent.name} (${agent.user_id})`);
      // FX.2 — Insert a run record so we have history beyond just the
      // most-recent on boult_agents. Updated in-flight as the run progresses.
      const runStartedAt = new Date();
      let runRecordId: string | null = null;
      try {
        const { data: runRecord } = await supabase
          .from('boult_agent_runs')
          .insert({
            agent_id: agent.id,
            user_id: agent.user_id,
            started_at: runStartedAt.toISOString(),
            status: 'running',
            // Next-gen provenance — why/how this run fired.
            trigger_source: agent._triggerSource || 'schedule',
            triggering_event: agent._matchedEvents ? { matches: agent._matchedEvents } : null,
            parent_run_id: agent._parentRunId || null,
            chain_depth: agent._chainDepth || 0,
            chain_input: agent._chainInput || null,
          })
          .select('id')
          .single();
        runRecordId = runRecord?.id || null;
      } catch (e: any) {
        logEvent({ channel: "failures", event: "❌ API Error", description: String(e) });
        // Table may not be migrated yet — non-fatal, run still proceeds.
        console.warn(`[Cron:Runs] Could not insert run record: ${e.message}`);
      }

      // Layer 1 — generate a short plain-English plan before executing, store it
      // on the run record so the UI can show "intended vs did". Best-effort: a
      // planning failure (or unmigrated `plan` column) never blocks the run.
      // Bounded to a small slice of whatever's left this tick (capped at 8s so a
      // healthy tick doesn't over-allocate to a "nice to have" preview). Below
      // 5s remaining after the delivery reserve, skip planning outright rather
      // than spend the agent's last few seconds on a preview instead of the
      // actual work — that's the swap that was producing "Plan ran, nothing else
      // did" timeouts.
      const planBudgetMs = Math.min(8_000, timeLeftMs() - DELIVERY_RESERVE_MS);
      if (runRecordId && planBudgetMs >= 5_000) {
        try {
          // generateRunPlan enforces this via deadlineAt — it's what actually caps the call.
          const plan = await generateRunPlan(agent, { deadlineMs: planBudgetMs });
          if (plan) {
            await supabase.from('boult_agent_runs').update({ plan }).eq('id', runRecordId);
          }
        } catch (e: any) {
          logEvent({ channel: "failures", event: "❌ API Error", description: String(e) });
          console.warn(`[Cron:Runs] Plan generation/store failed: ${e?.message}`);
        }
      }

      try {
        // Recompute against the REAL clock right before the real work starts.
        // `sharedBudget` was a snapshot taken before this agent's run record
        // insert + plan step (up to 8s) ran — reusing that stale number handed
        // runAgentTask a duration that started counting from ITS OWN start
        // time, not the cron tick's, so every upstream stage's time was pure
        // bonus stacked on top of the 60s Vercel cap instead of being
        // subtracted from it. That's what let a run blow past maxDuration even
        // though every individual stage thought it was respecting its budget.
        const remainingBudget = timeLeftMs() - DELIVERY_RESERVE_MS;
        const taskResult = await runAgentTask(agent, {
          // Per-agent override (advanced agents can be given a bigger/smaller
          // tool budget) falls back to the fair per-tick share.
          maxToolCalls: agent.max_tool_calls || perAgentToolCalls,
          deadlineMs: Math.max(0, remainingBudget),
        }, runRecordId || undefined);
        let report = taskResult.report;
        const { toolCalls, artifactLinks: structuredLinks } = taskResult;

        // EMPTY_RUN sentinel — the agent called zero tools and produced nothing,
        // which means the AI was temporarily unavailable (every tool-capable model
        // rate-limited). Do NOT email/Slack a misleading "no tools were called /
        // check your config" report — that blames the user for a transient model
        // outage. Mark the run skipped and bail; the next scheduled run retries.
        if (report === 'EMPTY_RUN') {
          console.warn(`[Cron] ${agent.name}: empty run (AI unavailable) — skipping delivery, will retry next run.`);
          results.push(`Skipped (AI unavailable): ${agent.name}`);
          if (runRecordId) {
            try {
              await supabase.from('boult_agent_runs').update({
                completed_at: new Date().toISOString(),
                duration_ms: Date.now() - runStartedAt.getTime(),
                // 'failed' is a known-valid status; the summary explains it was a
                // transient AI outage, not a real agent failure.
                status: 'failed',
                tool_calls: 0,
                report_summary: 'AI temporarily unavailable (models rate-limited) — no work done; retries next run.',
                email_delivery: 'failed',
                slack_delivery: 'failed',
              }).eq('id', runRecordId);
            } catch (e: any) {
              logEvent({ channel: "failures", event: "❌ API Error", description: String(e) }); console.warn('[Cron] empty-run record update threw:', e?.message); }
          }
          return;
        }

        // Stage 4 hardening — deterministic follow-through safety net. Regardless
        // of what the agent's narrative said, surface any OVERDUE commitment it
        // didn't already account for, so a dropped ball is never silent.
        try {
          const recon = await reconcileLedger(agent.user_id, agent.id, report);
          if (recon.addendum) report += recon.addendum;
        } catch {
          logEvent({ channel: "failures", event: "❌ API Error", description: "Unknown error" }); /* fail soft — ledger may be unmigrated */ }

        const runHasPending = await hasPendingActions(agent.id);

        // PART 60 — Signal-density gate. Score the report; if it's below the
        // threshold AND the agent's policy is 'suppress' (opt-in) AND there
        // are no pending approval actions, skip delivery. Pending actions
        // ALWAYS override — the user can't approve what they don't see.
        const signal = scoreReportSignal(report);
        const decision = { deliver: true, reason: 'force_always_send', score: signal.score };

        const [emailResult, slackResult] = await Promise.allSettled([
          sendEmailReport(agent.user_id, agent.name, report, runHasPending),
          sendSlackReport(agent.user_id, agent.slack_channel || null, agent.name, report, runHasPending),
        ]);

        const emailOk = emailResult.status === 'fulfilled';
        const slackOk = slackResult.status === 'fulfilled';
        const emailErr = !emailOk ? String((emailResult as PromiseRejectedResult).reason?.message || (emailResult as PromiseRejectedResult).reason || 'email_failed').slice(0, 200) : null;
        const slackErr = !slackOk ? String((slackResult as PromiseRejectedResult).reason?.message || (slackResult as PromiseRejectedResult).reason || 'slack_failed').slice(0, 200) : null;
        if (!emailOk) console.warn(`[Cron] ${agent.name} email delivery failed:`, emailErr);
        if (!slackOk) console.warn(`[Cron] ${agent.name} slack delivery failed:`, slackErr);
        results.push(`Delivered: ${agent.name} (email ${emailOk ? '✓' : '✗'}, slack ${slackOk ? '✓' : '✗'})`);

        const completedAt = new Date();
        const deliverySuffix = emailOk
          ? ''
          : ` · Email delivery failed: ${emailErr}`;
        const quietSuffix = deliverySuffix;

        // Cross-run memory: for event/condition agents, remember which items
        // we've now handled (so we never re-fire on the same email) and when we
        // last fired (for debounce).
        const agentUpdate: Record<string, any> = {
          status: 'active',
          last_run_at: completedAt.toISOString(),
          last_report_summary: (report.slice(0, 460) + quietSuffix).slice(0, 500),
        };
        if (agent._triggerSource === 'event' && Array.isArray(agent._newProcessedIds)) {
          const prior = agent.agent_state || {};
          agentUpdate.agent_state = {
            ...prior,
            processed_event_ids: mergeProcessedIds(prior.processed_event_ids, agent._newProcessedIds),
            last_fired_at: completedAt.toISOString(),
            last_polled_at: completedAt.toISOString(),
            force_poll: false, // real-time nudge serviced
          };
        }
        await supabase
          .from('boult_agents')
          .update(agentUpdate)
          .eq('id', agent.id);

        // Pipeline hand-off: enqueue each child agent with this run's summary +
        // artifacts as its chain_input. Depth/cycle-guarded inside enqueue.
        const pipeline: string[] = Array.isArray(agent.pipeline) ? agent.pipeline : [];
        if (pipeline.length) {
          const visited = [...(agent._visited || []), agent.id];
          const summaryForChild = (report || '').slice(0, 1200);
          for (const childId of pipeline) {
            await enqueueChainHandoff(supabase, agent.user_id, {
              childId,
              parentAgentId: agent.id,
              parentRunId: runRecordId,
              chainDepth: (agent._chainDepth || 0) + 1,
              visited,
              summary: summaryForChild,
              artifactLinks: structuredLinks || null,
            });
          }
        }

        // FX.2 — Update the run record with final status + delivery.
        // PART 35 — also persist tool_calls + artifact_links (defined in the
        // migration but previously left empty), so the Recent runs UI can
        // surface "drafted 8 / booked 2 / 47 tool calls" at a glance.
        // PART 60 — also persist signal_score + delivery_decision so the
        // dashboard can show "suppressed: quiet day" instead of a silent gap.
        if (runRecordId) {
          // Prefer the structured links the committee already collected; fall
          // back to parsing the report markdown only if they're absent (legacy
          // single-LLM path). Avoids re-parsing — and breaking on — the report
          // format.
          const artifactLinks = structuredLinks && Object.keys(structuredLinks).length
            ? structuredLinks
            : extractArtifactLinks(report);
          // Part 6 — no fake success. The super-agent report states its own
          // honest status ("Status: partial/blocked"); trust it over a blanket
          // 'success'. Also capture the one-line outcome (the report's first
          // line) as the run's outcome_summary.
          const statusMatch = report.match(/^\s*status:\s*(success|partial|blocked)/im);
          const runStatus = statusMatch ? statusMatch[1].toLowerCase() : 'success';
          const outcomeSummary = (report.split('\n').map(l => l.trim()).find(Boolean) || '')
            .replace(/^#+\s*/, '').replace(/\*\*/g, '').slice(0, 300);
          const coreUpdate: Record<string, any> = {
            completed_at: completedAt.toISOString(),
            duration_ms: completedAt.getTime() - runStartedAt.getTime(),
            status: runStatus,
            tool_calls: toolCalls,
            artifact_links: artifactLinks,
            report_summary: (report.slice(0, 450) + (deliverySuffix || '')).slice(0, 500),
            email_delivery: emailOk ? 'sent' : 'failed',
            slack_delivery: slackOk ? 'sent' : 'failed',
          };
          try {
            const { error: coreErr } = await supabase
              .from('boult_agent_runs')
              .update(coreUpdate)
              .eq('id', runRecordId);
            if (coreErr) {
              console.warn('[Cron] run-record core update failed:', coreErr.message);
            }
          } catch (e: any) {
            logEvent({ channel: "failures", event: "❌ API Error", description: String(e) });
            console.warn('[Cron] run-record core update threw:', e?.message);
          }
          try {
            const errBlob = !emailOk ? ` · email_err: ${emailErr}` : '';
            await supabase
              .from('boult_agent_runs')
              .update({
                signal_score: signal.score,
                delivery_decision: `${decision.reason}${errBlob} · ${signal.reasons.slice(0, 3).join(' | ')}`.slice(0, 500),
              })
              .eq('id', runRecordId);
          } catch {
            logEvent({ channel: "failures", event: "❌ API Error", description: "Unknown error" }); /* PART 60 columns may not be migrated — non-fatal */ }
          // outcome_summary + report_full are super-agent columns (may not be
          // migrated yet). report_full persists the WHOLE executive briefing so
          // the dashboard run is fully inspectable, not just a 500-char teaser.
          try {
            const superUpdate: Record<string, any> = {};
            if (outcomeSummary) superUpdate.outcome_summary = outcomeSummary;
            superUpdate.report_full = report.slice(0, 20000);
            await supabase.from('boult_agent_runs').update(superUpdate).eq('id', runRecordId);
          } catch {
            logEvent({ channel: "failures", event: "❌ API Error", description: "Unknown error" }); /* non-fatal */ }
        }

        return agent.name;
      } catch (err: any) {
        logEvent({ channel: "failures", event: "❌ API Error", description: String(err) });
        console.error(`[Cron] Agent ${agent.name} failed:`, err.message);

        // F3.3 — Transient-failure retry. If the error is something like
        // "models busy" / "timeout" / "5xx", shift last_run_at backward by
        // ~30 minutes so the next cron tick re-runs the agent ~30 min from
        // now, instead of waiting the full schedule (~24 h for a daily
        // agent). Hard failures (validation errors, auth) keep last_run_at
        // = now so they don't loop on a permanent error.
        const errStr = String(err.message || '').toLowerCase();
        const isTransient =
          errStr.includes('models are currently busy') ||
          errStr.includes('rate limit') ||
          errStr.includes('429') ||
          errStr.includes('timeout') ||
          errStr.includes('timed out') ||
          errStr.includes('etimedout') ||
          errStr.includes('econnreset') ||
          /\b5\d\d\b/.test(errStr) ||
          errStr.includes('service unavailable');

        // The 30-min retry window: schedule a re-run by pretending last_run_at
        // was 30 min before the agent's normal interval would have fired.
        // Stamp last_run_at = (now - cron_interval + 30 min). Since we don't
        // parse cron deltas here, approximate: subtract 23.5 h from now —
        // for a daily agent the next "due" check (which requires diffMin > 55
        // from current last_run_at) clears in ~30 min. For sub-daily agents
        // this is more aggressive, which is fine for transient errors.
        const RETRY_DELAY_MIN = 30;
        const APPROX_INTERVAL_MS = 24 * 60 * 60 * 1000; // assume daily
        const retryStamp = isTransient
          ? new Date(now.getTime() - APPROX_INTERVAL_MS + RETRY_DELAY_MIN * 60_000).toISOString()
          : now.toISOString();
        const summary = isTransient
          ? `Transient error (retrying in ~${RETRY_DELAY_MIN}m): ${err.message}`
          : `Error: ${err.message}`;

        await supabase
          .from('boult_agents')
          .update({ status: 'active', last_run_at: retryStamp, last_report_summary: summary })
          .eq('id', agent.id);

        // FX.2 — Update the run record with failure status.
        if (runRecordId) {
          try {
            await supabase
              .from('boult_agent_runs')
              .update({
                completed_at: new Date().toISOString(),
                duration_ms: Date.now() - runStartedAt.getTime(),
                status: isTransient ? 'transient_error' : 'error',
                error_message: String(err.message || 'unknown error').slice(0, 1000),
              })
              .eq('id', runRecordId);
          } catch {
            logEvent({ channel: "failures", event: "❌ API Error", description: "Unknown error" }); /* non-fatal */ }
        }

        // Only notify the user on hard failures — transient ones will
        // self-recover on the retry.
        if (!isTransient) {
          try { await sendErrorNotification(agent, err.message); } catch {
            logEvent({ channel: "failures", event: "❌ API Error", description: "Unknown error" }); /* non-critical */ }
        }
        throw err;
      }
    }),
  );

  ran = runResults.filter(r => r.status === 'fulfilled').length;

  return NextResponse.json({ message: `Ran ${ran} agents.`, results });
}

// ─────────────────────────────────────────────────────────────────────────────
// Cron scheduling logic
// ─────────────────────────────────────────────────────────────────────────────

function shouldAgentRunNow(cronSchedule: string, lastRunAt: string | null, timezone: string): boolean {
  const now = new Date();
  let localHour = now.getUTCHours();
  let localMin = now.getUTCMinutes();
  let localDow = now.getUTCDay();

  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      minute: 'numeric',
      weekday: 'short',
      hour12: false,
    }).formatToParts(now);

    for (const part of parts) {
      if (part.type === 'hour') localHour = parseInt(part.value) % 24;
      if (part.type === 'minute') localMin = parseInt(part.value);
      if (part.type === 'weekday') {
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const idx = days.indexOf(part.value);
        if (idx !== -1) localDow = idx;
      }
    }
  } catch {
    logEvent({ channel: "failures", event: "❌ API Error", description: "Unknown error" }); /* use UTC fallbacks */ }

  const cronParts = cronSchedule.trim().split(/\s+/);
  if (cronParts.length !== 5) return false;
  const [minPart, hourPart, , , dowPart] = cronParts;

  if (!matchCronField(hourPart, localHour, 0, 23)) return false;
  if (!matchCronField(dowPart, localDow, 0, 6)) return false;

  if (minPart !== '*' && !minPart.startsWith('*/')) {
    const targetMin = parseInt(minPart);
    if (!isNaN(targetMin) && Math.abs(localMin - targetMin) > 35) return false;
  }

  if (lastRunAt) {
    const diffMin = (now.getTime() - new Date(lastRunAt).getTime()) / 60000;
    if (diffMin < 55) return false;
  }

  return true;
}

function matchCronField(field: string, value: number, _min: number, _max: number): boolean {
  if (field === '*') return true;
  if (field.startsWith('*/')) { const s = parseInt(field.slice(2)); return !isNaN(s) && value % s === 0; }
  if (field.includes('-') && !field.includes(',')) { const [a, b] = field.split('-').map(Number); return value >= a && value <= b; }
  if (field.includes(',')) return field.split(',').map(Number).includes(value);
  return parseInt(field) === value;
}

// ─────────────────────────────────────────────────────────────────────────────
// Artifact link extraction — PART 35
// ─────────────────────────────────────────────────────────────────────────────
//
// Parse the report's "## 🔗 All Links" section into a structured object so the
// Recent runs UI can render clickable per-bucket links without re-parsing
// markdown client-side. Buckets mirror REPORT_FORMAT_SUFFIX exactly:
//   gmail   ← Gmail drafts + Emails sent
//   calendar ← Calendar events
//   notion  ← Notion pages
//   slack   ← Slack messages
//
// Returns null when no Links section is found (read-only scans, malformed
// reports) so the column stays null instead of {} — easier to filter on.

interface ArtifactLink {
  label: string;
  url: string;
}
interface ArtifactLinks {
  gmail?: ArtifactLink[];
  calendar?: ArtifactLink[];
  notion?: ArtifactLink[];
  slack?: ArtifactLink[];
}

function extractArtifactLinks(report: string): ArtifactLinks | null {
  // Find the Links section header — emoji-tolerant, also matches " All Links"
  // without the emoji in case the LLM stripped it.
  const linksHeaderRe = /^##\s+(?:[^\w\s]+\s+)?All Links[^\n]*$/im;
  const headerMatch = linksHeaderRe.exec(report);
  if (!headerMatch) return null;

  const after = report.slice(headerMatch.index + headerMatch[0].length);
  // Cut at the next ## heading or the trust-receipts footer divider, whichever
  // comes first.
  const endIdx = after.search(/\n##\s+|\n---\s*\n/);
  const section = endIdx === -1 ? after : after.slice(0, endIdx);

  // Each bucket starts with a bold label like **📧 Gmail drafts** or
  // **📤 Emails sent**. Walk line by line, attributing markdown links to the
  // most recent bucket.
  const out: ArtifactLinks = {};
  let bucket: keyof ArtifactLinks | null = null;
  const linkRe = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;

  for (const line of section.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Bucket header detection — also tolerates a leading list marker.
    const headerLine = trimmed.replace(/^[-*+]\s+/, '');
    if (/^\*\*/.test(headerLine)) {
      const lower = headerLine.toLowerCase();
      if (lower.includes('gmail draft') || lower.includes('emails sent') || lower.includes('email sent')) bucket = 'gmail';
      else if (lower.includes('calendar')) bucket = 'calendar';
      else if (lower.includes('notion')) bucket = 'notion';
      else if (lower.includes('slack')) bucket = 'slack';
      else bucket = null;
      continue;
    }

    if (!bucket) continue;
    let m: RegExpExecArray | null;
    linkRe.lastIndex = 0;
    while ((m = linkRe.exec(trimmed)) !== null) {
      const list = out[bucket] ?? (out[bucket] = []);
      list.push({ label: m[1].slice(0, 200), url: m[2].slice(0, 500) });
    }
  }

  // Empty result → return null so the DB column stays null, not {}.
  return Object.keys(out).length === 0 ? null : out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Email — Resend API
// ─────────────────────────────────────────────────────────────────────────────

async function sendEmailReport(toEmail: string, agentName: string, report: string, hasPending: boolean = false): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    const err = '[Cron] RESEND_API_KEY not set — cannot send email report.';
    console.warn(err);
    throw new Error(err);
  }

  const { Resend } = await import('resend');
  const resend = new Resend(apiKey);

  const date = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
  const subject = `${agentName} — Your Boult Report for ${date}`;
  const html = buildReportHtml(agentName, date, report, hasPending);

  // Fix 8 — retry once on transient failures (5xx / network). 4xx (bad email,
  // auth) are not retried because they will fail again immediately.
  const MAX_ATTEMPTS = 2;
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const { error } = await resend.emails.send({
        from: RESEND_FROM,
        replyTo: 'support.maily@gmail.com',
        to: toEmail,
        subject,
        html,
      });

      if (error) {
        const name = (error as any).name || 'unknown';
        const message = (error as any).message || JSON.stringify(error);
        const statusCode = (error as any).statusCode ?? 0;
        lastError = new Error(`Resend rejected: ${name} — ${message}`);
        // Retry only on server errors (5xx) — client errors (4xx) won't recover.
        if (statusCode >= 500 && attempt < MAX_ATTEMPTS) {
          console.warn(`[Cron] sendEmailReport transient error (attempt ${attempt}/${MAX_ATTEMPTS}): ${message}`);
          await new Promise(r => setTimeout(r, 1500));
          continue;
        }
        console.error('[Cron] sendEmailReport error:', lastError.message);
        throw lastError;
      }
      return; // success
    } catch (fetchErr: any) {
      logEvent({ channel: "failures", event: "❌ API Error", description: String(fetchErr) });
      // Network-level error (DNS, timeout, etc.) — retryable.
      lastError = fetchErr instanceof Error ? fetchErr : new Error(String(fetchErr));
      if (attempt < MAX_ATTEMPTS) {
        console.warn(`[Cron] sendEmailReport network error (attempt ${attempt}/${MAX_ATTEMPTS}): ${lastError.message}`);
        await new Promise(r => setTimeout(r, 1500));
        continue;
      }
      console.error('[Cron] sendEmailReport failed after retries:', lastError.message);
      throw lastError;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Markdown → HTML conversion
// ─────────────────────────────────────────────────────────────────────────────

function inlineFormat(text: string): string {
  return text
    // Escape bare < and > that aren't already HTML tags
    .replace(/&/g, '&amp;')
    .replace(/<(?![a-zA-Z/])/g, '&lt;')
    // Inline code
    .replace(/`([^`]+)`/g, '<code style="background:#f0f0f0;padding:2px 5px;border-radius:4px;font-family:monospace;font-size:0.9em;color:#e83e8c">$1</code>')
    // Bold + italic
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>')
    .replace(/_(.+?)_/g, '<em>$1</em>')
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color:#0066cc;text-decoration:underline">$1</a>');
}

function markdownToHtml(markdown: string): string {
  const lines = markdown.split('\n');
  const out: string[] = [];
  let inUl = false;
  let inOl = false;
  let inTable = false;
  let tableHeader = false;

  const closeList = () => {
    if (inUl) { out.push('</ul>'); inUl = false; }
    if (inOl) { out.push('</ol>'); inOl = false; }
  };
  const closeTable = () => {
    if (inTable) { out.push('</tbody></table>'); inTable = false; tableHeader = false; }
  };

  for (const raw of lines) {
    const line = raw;

    // ── Headings ─────────────────────────────────────────────────────────────
    const hm = line.match(/^(#{1,6})\s+(.+)/);
    if (hm) {
      closeList(); closeTable();
      const n = hm[1].length;
      const headingStyles: Record<number, string> = {
        1: 'font-size:26px;font-weight:800;color:#111;margin:32px 0 12px;padding-bottom:8px;border-bottom:2px solid #eee;letter-spacing:-0.5px',
        2: 'font-size:20px;font-weight:700;color:#222;margin:28px 0 10px',
        3: 'font-size:17px;font-weight:700;color:#333;margin:20px 0 8px',
        4: 'font-size:15px;font-weight:600;color:#444;margin:16px 0 6px',
        5: 'font-size:13px;font-weight:600;color:#666;margin:12px 0 4px;text-transform:uppercase;letter-spacing:0.5px',
        6: 'font-size:12px;font-weight:600;color:#888;margin:8px 0 4px;text-transform:uppercase;letter-spacing:1px',
      };
      out.push(`<h${n} style="${headingStyles[n]}">${inlineFormat(hm[2])}</h${n}>`);
      continue;
    }

    // ── Horizontal rule ───────────────────────────────────────────────────────
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      closeList(); closeTable();
      out.push('<hr style="border:none;border-top:1px solid #eee;margin:20px 0">');
      continue;
    }

    // ── Tables ────────────────────────────────────────────────────────────────
    if (line.startsWith('|')) {
      closeList();
      const cells = line.split('|').filter((_, i, a) => i > 0 && i < a.length - 1);

      // Separator row (e.g. | --- | --- |)
      if (cells.every(c => /^[-:\s]+$/.test(c))) {
        tableHeader = false; // next rows are body
        continue;
      }

      if (!inTable) {
        out.push(`<table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px">`);
        out.push('<thead>');
        inTable = true;
        tableHeader = true;
      }

      if (tableHeader) {
        out.push('<tr>');
        cells.forEach(c => {
          out.push(`<th style="background:#fcfcfc;border:1px solid #eee;padding:10px 14px;text-align:left;font-weight:700;color:#333">${inlineFormat(c.trim())}</th>`);
        });
        out.push('</tr></thead><tbody>');
        tableHeader = false;
      } else {
        // Zebra stripe
        const rowIdx = out.filter(l => l.startsWith('<tr') && !l.includes('</tr')).length;
        const bg = rowIdx % 2 === 0 ? '#ffffff' : '#fafafa';
        out.push(`<tr style="background:${bg}">`);
        cells.forEach(c => {
          out.push(`<td style="border:1px solid #eee;padding:9px 14px;color:#444">${inlineFormat(c.trim())}</td>`);
        });
        out.push('</tr>');
      }
      continue;
    } else if (inTable) {
      closeTable();
    }

    // ── Bullet list ───────────────────────────────────────────────────────────
    const ulm = line.match(/^(\s*)[-*+]\s+(.+)/);
    if (ulm) {
      closeTable();
      if (!inUl) { out.push('<ul style="margin:8px 0 8px 0;padding-left:24px">'); inUl = true; }
      out.push(`<li style="margin:5px 0;color:#444;line-height:1.6">${inlineFormat(ulm[2])}</li>`);
      continue;
    }

    // ── Ordered list ──────────────────────────────────────────────────────────
    const olm = line.match(/^\d+\.\s+(.+)/);
    if (olm) {
      closeTable();
      if (!inOl) { out.push('<ol style="margin:8px 0 8px 0;padding-left:24px">'); inOl = true; }
      out.push(`<li style="margin:5px 0;color:#444;line-height:1.6">${inlineFormat(olm[1])}</li>`);
      continue;
    }

    // ── Blockquote ────────────────────────────────────────────────────────────
    const bqm = line.match(/^>\s*(.+)/);
    if (bqm) {
      closeList(); closeTable();
      out.push(`<blockquote style="border-left:4px solid #ccc;background:#f9f9f9;margin:12px 0;padding:10px 16px;border-radius:0 8px 8px 0;color:#555;font-style:italic">${inlineFormat(bqm[1])}</blockquote>`);
      continue;
    }

    // ── Empty line ────────────────────────────────────────────────────────────
    if (line.trim() === '') {
      closeList(); closeTable();
      out.push('<div style="height:6px"></div>');
      continue;
    }

    // ── Paragraph ─────────────────────────────────────────────────────────────
    closeList(); closeTable();
    out.push(`<p style="margin:6px 0;color:#444;line-height:1.7;font-size:15px">${inlineFormat(line)}</p>`);
  }

  closeList();
  closeTable();
  return out.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Beautiful HTML email template (light theme)
// ─────────────────────────────────────────────────────────────────────────────

function buildReportHtml(agentName: string, date: string, report: string, hasPending: boolean = false): string {
  const UI = EmailUI;
  const body = markdownToHtml(report);

  // The pending-approval state is the ONLY thing in this email that is urgent,
  // so it is the only thing allowed to break the monochrome. It sits at the top
  // as a bordered panel rather than a coloured alert box — the old amber banner
  // read as a browser warning, not as a briefing from an employee.
  const pendingBanner = hasPending
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
         style="background-color:#F7F7F7; background-image:linear-gradient(180deg,#FFFFFF 0%,#F4F4F4 100%); border:1px solid #E2E2E2; border-left:3px solid ${UI.C.ink}; border-radius:12px; margin:0 0 22px;">
         <tr><td style="padding:16px 18px;">
           <p style="margin:0 0 4px; font-family:${UI.FONT}; font-size:13px; font-weight:600; color:${UI.C.text};">Waiting on your approval</p>
           <p style="margin:0; font-family:${UI.FONT}; font-size:13px; line-height:1.6; color:${UI.C.textMuted};">This run queued actions that send on your behalf. Nothing goes out until you approve it.</p>
         </td></tr>
       </table>`
    : '';

  const cta = hasPending
    ? UI.button('Review queued actions', 'https://maily.dev/dashboard?tab=agents&approve=pending')
    : UI.button('Open dashboard', 'https://maily.dev/dashboard');

  const content = `
    ${pendingBanner}
    ${UI.panel(`${UI.row('Agent', UI.esc(agentName))}${UI.row('Run', UI.esc(date))}`)}
    <div style="font-family:${UI.FONT}; font-size:15px; line-height:1.7; color:${UI.C.text};">
      ${body}
    </div>
    ${UI.divider()}
    ${cta}
  `;

  return UI.shell({
    // The agent's name is the headline — this is a report FROM a named
    // employee, not from a system. The old "BOULT AUTONOMOUS REPORT // ID //
    // SECURE" monospace footer was theatre; it made a briefing look like a
    // machine log, so it is gone.
    title: agentName,
    eyebrow: date,
    content,
    footerNote: hasPending ? 'Actions are waiting for your approval.' : 'Your briefing from Boult.',
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Slack — rich Block Kit report
// ─────────────────────────────────────────────────────────────────────────────

async function sendSlackReport(userId: string, channel: string | null, agentName: string, report: string, hasPending: boolean = false): Promise<void> {
  // Fix 1-3 — errors are now THROWN instead of swallowed so Promise.allSettled
  // in the caller correctly reports Slack delivery as 'failed' when it fails.
  // Previously the entire function was wrapped in try/catch that only logged,
  // making every failure invisible.

  // Platform-level bot token takes priority — no user token needed if configured.
  // Fall back to the user's own Slack OAuth token from boult_integrations.
  let token: string | null = process.env.BOULT_SLACK_BOT_TOKEN || null;

  if (!token) {
    const { decrypt } = await import('../../../../lib/crypto.js');
    const supabase = getSupabaseAdmin();
    const { data } = await supabase
      .from('boult_integrations')
      .select('access_token')
      .eq('user_id', userId)
      .eq('provider', 'slack')
      .maybeSingle();
    if (!data?.access_token) {
      // No token available — this is a config issue, not a transient failure.
      // Throw so the caller records slack_delivery: 'failed'.
      throw new Error(`No Slack token for user ${userId} and BOULT_SLACK_BOT_TOKEN not set.`);
    }
    token = decrypt(data.access_token);
  }

  // Resolve the target channel: use configured channel, or DM the user directly.
  let targetChannel = channel;
  if (!targetChannel) {
    // Look up the user's Slack member ID by email, then open a DM.
    const lookupRes = await fetch(`https://slack.com/api/users.lookupByEmail?email=${encodeURIComponent(userId)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    });
    const lookupJson = await lookupRes.json() as any;
    if (!lookupJson.ok || !lookupJson.user?.id) {
      // Fix 2 — throw instead of returning silently. Common cause: user's
      // Maily email doesn't match their Slack workspace email.
      throw new Error(`Slack users.lookupByEmail failed for ${userId}: ${lookupJson.error ?? 'users_not_found'} — user's login email may differ from their Slack email.`);
    }
    const slackUserId = lookupJson.user.id;

    // Open (or reuse) the DM channel with this user.
    const dmRes = await fetch('https://slack.com/api/conversations.open', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ users: slackUserId }),
      signal: AbortSignal.timeout(8000),
    });
    const dmJson = await dmRes.json() as any;
    if (!dmJson.ok || !dmJson.channel?.id) {
      throw new Error(`Slack conversations.open failed: ${dmJson.error ?? 'unknown'}`);
    }
    targetChannel = dmJson.channel.id;
  }

  const date = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  const blocks = buildSlackBlocks(agentName, date, report, hasPending);

  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      channel: targetChannel,
      blocks,
      text: `${agentName} — Boult Report for ${date}`,
    }),
    signal: AbortSignal.timeout(10000),
  });

  const json = await res.json() as any;
  if (!json.ok) {
    // Fix 3 — throw instead of just logging. Covers: invalid_blocks (malformed
    // mrkdwn), channel_not_found, not_in_channel, token_revoked, etc.
    throw new Error(`Slack chat.postMessage failed: ${json.error ?? 'unknown'}`);
  }
}

function buildSlackBlocks(agentName: string, date: string, report: string, hasPending: boolean = false): any[] {
  const mrkdwn = markdownToSlackMrkdwn(report);

  // Fix 5 — Split into sections of ≤3000 chars (Slack limit per block).
  // The old splitter could cut mid-formatting (*bold or _italic), producing
  // malformed mrkdwn that Slack rejects with 'invalid_blocks'. Now we:
  //   1. Split on paragraph boundaries (double newline)
  //   2. If forced to split mid-paragraph, close any open formatting
  const chunks: string[] = [];
  let remaining = mrkdwn;
  while (remaining.length > 0) {
    if (remaining.length <= 2900) {
      chunks.push(remaining);
      break;
    }
    // Prefer splitting on paragraph boundary
    let cutAt = remaining.lastIndexOf('\n\n', 2900);
    // Fallback: split on any newline
    if (cutAt <= 500) cutAt = remaining.lastIndexOf('\n', 2900);
    // Last resort: hard cut
    if (cutAt <= 500) cutAt = 2900;
    let chunk = remaining.slice(0, cutAt).trimEnd();
    // Fix dangling formatting: if there's an odd number of unescaped * or _,
    // close them to prevent Slack's mrkdwn parser from breaking.
    const starCount = (chunk.match(/(?<![\\])\*/g) || []).length;
    if (starCount % 2 !== 0) chunk += '*';
    const underCount = (chunk.match(/(?<![\\*])_(?!\*)/g) || []).length;
    if (underCount % 2 !== 0) chunk += '_';
    chunks.push(chunk);
    remaining = remaining.slice(cutAt).trimStart();
  }

  // Slack has no CSS, so "premium" here is restraint: one accent, real
  // hierarchy, and no emoji confetti. The approval prompt is the only urgent
  // thing in the message, so it keeps the single button and the only emoji.
  const pendingBlock = hasPending ? [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: '*Waiting on your approval*\nThis run queued actions that send on your behalf. Nothing goes out until you approve it.' },
      accessory: {
        type: 'button',
        text: { type: 'plain_text', text: 'Review', emoji: false },
        url: 'https://maily.dev/dashboard?tab=agents&approve=pending',
        style: 'primary',
      },
    },
  ] : [];

  const bodyBlocks = chunks.map(chunk => ({
    type: 'section',
    text: { type: 'mrkdwn', text: chunk },
  }));

  const blocks: any[] = [
    // Header
    {
      type: 'header',
      text: { type: 'plain_text', text: `${agentName}`, emoji: false },
    },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `Boult · ${date}` }],
    },
    { type: 'divider' },
    ...pendingBlock,
    // Body chunks
    ...bodyBlocks,
    { type: 'divider' },
    // Footer
    {
      type: 'context',
      elements: [
        { type: 'mrkdwn', text: `<https://maily.dev/dashboard|Open dashboard> · ${new Date().toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}` },
      ],
    },
  ];

  // Fix 9 — Slack rejects messages with >50 blocks. Truncate body and add a
  // "view full report" link if we'd exceed the limit. Header (3) + pending (0-1)
  // + divider + footer (2) = 6 fixed blocks → max 44 body blocks.
  const MAX_BLOCKS = 50;
  const fixedBlockCount = blocks.length - bodyBlocks.length;
  const maxBodyBlocks = MAX_BLOCKS - fixedBlockCount;
  if (bodyBlocks.length > maxBodyBlocks) {
    // Remove excess body blocks and add a truncation notice
    const truncated = bodyBlocks.slice(0, maxBodyBlocks - 1);
    truncated.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '_Report truncated — <https://maily.dev/dashboard?tab=agents|view full report on dashboard>_' },
    });
    // Rebuild blocks array with truncated body
    const insertIdx = blocks.indexOf(bodyBlocks[0]);
    blocks.splice(insertIdx, bodyBlocks.length, ...truncated);
  }

  return blocks;
}

// ─────────────────────────────────────────────────────────────────────────────
// Error notification — brief message when an agent run fails
// ─────────────────────────────────────────────────────────────────────────────

async function sendErrorNotification(agent: any, errorMessage: string): Promise<void> {
  const ts = new Date().toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
  const report = `# ⚠️ Agent Run Failed — ${agent.name}\n\nYour agent **${agent.name}** encountered an issue during its scheduled run at ${ts}.\n\n**Error:** ${errorMessage}\n\nThe agent has been kept active and will attempt to run again at its next scheduled time. If this error repeats, check your connected integrations or update the agent's task description.\n\n_If you need help, reply to this message or visit [maily.dev](https://maily.dev)._`;

  // Fix 7 — use Promise.allSettled so both channels are always attempted.
  // Previously sequential await meant email failure blocked Slack notification.
  const [emailResult, slackResult] = await Promise.allSettled([
    sendEmailReport(agent.user_id, `⚠️ ${agent.name} — Run Failed`, report),
    sendSlackReport(agent.user_id, agent.slack_channel || null, `⚠️ ${agent.name} — Run Failed`, report),
  ]);
  if (emailResult.status === 'rejected') console.warn(`[Cron] Error notification email failed: ${emailResult.reason?.message || emailResult.reason}`);
  if (slackResult.status === 'rejected') console.warn(`[Cron] Error notification slack failed: ${slackResult.reason?.message || slackResult.reason}`);
}

function markdownToSlackMrkdwn(markdown: string): string {
  // Fix 6 — Process in a specific order so conversions don't nest/corrupt.
  // Key change: strip inner formatting from headings first, convert bold/italic
  // AFTER headings, and sanitize the result to prevent nested *...* or _..._.
  let result = markdown;

  // Step 1: Tables → plain text (before any inline formatting)
  result = result.replace(/^\|(.+)\|$/gm, (line) => {
    const cells = line.split('|').filter((_, i, a) => i > 0 && i < a.length - 1);
    if (cells.every(c => /^[-:\s]+$/.test(c))) return ''; // separator row
    return cells.map(c => c.trim()).join('  |  ');
  });

  // Step 1.5: Markdown links → Slack link syntax. Slack mrkdwn does NOT
  // understand `[text](url)` — it would render the literal brackets. It uses
  // `<url|text>` instead. Without this, every link in a report (and the whole
  // "🔗 All Links" section) shows up as ugly raw markdown. Images (`![alt](url)`)
  // collapse to the same link form since Slack can't inline-render them here.
  // Done BEFORE bold/italic so a `*`/`_` inside a URL isn't mangled, and the
  // label is sanitized of `<`, `>`, `|` which would break the link grammar.
  result = result.replace(/!?\[([^\]]*?)\]\((https?:\/\/[^\s)]+)\)/g, (_m, label: string, url: string) => {
    const cleanLabel = label.replace(/[<>|]/g, '').trim();
    return cleanLabel ? `<${url}|${cleanLabel}>` : `<${url}>`;
  });

  // Step 2: Headings — strip any **bold** from heading text first to prevent
  // nested *...*..* which breaks Slack's parser.
  result = result.replace(/^#{1}\s+(.+)/gm, (_, text) => {
    const clean = text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1');
    return `\n*📌 ${clean}*\n`;
  });
  result = result.replace(/^#{2}\s+(.+)/gm, (_, text) => {
    const clean = text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1');
    return `\n*${clean}*\n`;
  });
  result = result.replace(/^#{3}\s+(.+)/gm, (_, text) => {
    const clean = text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1');
    return `\n_*${clean}*_\n`;
  });
  result = result.replace(/^#{4,6}\s+(.+)/gm, (_, text) => {
    const clean = text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1');
    return `\n_${clean}_\n`;
  });

  // Step 3: Bold + italic (only in body text, headings are already done)
  result = result.replace(/\*\*\*(.+?)\*\*\*/g, '*_$1_*');
  result = result.replace(/\*\*(.+?)\*\*/g, '*$1*');

  // Step 4: Horizontal rules
  result = result.replace(/^(-{3,}|\*{3,})$/gm, '──────────────────────────────');

  // Step 5: Collapse blank lines
  result = result.replace(/\n{3,}/g, '\n\n');

  return result.trim();
}
