/**
 * Lifecycle win-back nudge.
 *
 * Sends the (already-written) buildTrialNudgeEmail to the two cohorts that were
 * previously contacted by NOTHING:
 *
 *   A. Signed up, never finished onboarding.
 *   B. Finished onboarding, never started a trial / subscription.
 *
 * The nudge email itself has existed and been export-ready in email-service.js
 * this whole time — it had zero callers. This route is the caller.
 *
 * ── "SENT ONCE" WITHOUT A SENT-MARKER ──────────────────────────────────────
 * There is deliberately no per-user "nudged_at" column (that was the build
 * choice: no idempotency store). Instead the cohort is defined by a narrow
 * AGE WINDOW on signup time — accounts created between 48h and 72h ago. Run
 * this once a day and each account falls inside that 24h-wide window on exactly
 * one run, so it is emailed once and never again.
 *
 * THE ONE FAILURE MODE, stated plainly: the age window IS the dedupe. If the
 * external scheduler fires this route MORE THAN ONCE inside the same 24h band
 * for a given user, that user can receive the nudge more than once. So:
 *   - schedule it on cron-job.org at ONE fixed time per day (e.g. 15:00 UTC),
 *   - not every-N-hours.
 * If you later want hard idempotency, add a nudged_at column and gate on it;
 * the cohort queries below stay the same.
 *
 * ── TIMING NOTE ────────────────────────────────────────────────────────────
 * Both cohorts are windowed on created_at (signup), not on an onboarding
 * timestamp, because user_profiles.updated_at is rewritten on every login
 * (storeUserProfile runs in the auth flow) and is therefore not a stable
 * "onboarded at" time. In practice onboarding happens in the same session as
 * signup, so "48-72h after signup" ≈ "48-72h after onboarding" for cohort B.
 * A user who signs up and only onboards days later will fall outside the
 * window and not be nudged — an acceptable v1 gap, not a silent bug.
 *
 *   GET /api/cron/lifecycle-nudge
 *   Authorization: Bearer $CRON_SECRET   (or x-boult-cron-secret: $CRON_SECRET)
 *   ?dry=1  → compute and RETURN the cohorts without sending anything.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../lib/supabase.js';
import { sendTrialNudgeEmail } from '../../../../lib/email-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CRON_SECRET = process.env.CRON_SECRET || 'boult-cron-secret';

// Signup age band. 24h wide so a once-daily run catches each account exactly
// once; offset by 2 days so we nudge people who have had a beat to act, not
// someone who signed up this morning and is still in their first session.
const WINDOW_MIN_HOURS = 48;
const WINDOW_MAX_HOURS = 72;

const PAID_TRIAL_STATUSES = new Set(['active', 'trialing']);

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization') || '';
  const ok =
    authHeader === `Bearer ${CRON_SECRET}` ||
    request.headers.get('x-boult-cron-secret') === CRON_SECRET ||
    request.headers.get('x-vercel-cron') === '1';
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const dryRun = request.nextUrl.searchParams.get('dry') === '1';
  const supabase = getSupabaseAdmin();

  const now = Date.now();
  const windowStart = new Date(now - WINDOW_MAX_HOURS * 3600_000).toISOString(); // older bound
  const windowEnd = new Date(now - WINDOW_MIN_HOURS * 3600_000).toISOString();   // newer bound

  // 1) Everyone who signed up inside the age band.
  const { data: profiles, error: profErr } = await supabase
    .from('user_profiles')
    .select('user_id, name, onboarding_completed, created_at')
    .gte('created_at', windowStart)
    .lt('created_at', windowEnd);

  if (profErr) {
    return NextResponse.json({ error: 'profiles query failed', detail: profErr.message }, { status: 500 });
  }
  if (!profiles || profiles.length === 0) {
    return NextResponse.json({ ok: true, windowStart, windowEnd, candidates: 0, sent: 0 });
  }

  const emails = profiles.map((p: any) => String(p.user_id).toLowerCase());

  // 2) Which of them already have a trial/paid subscription — batched, one query.
  //    Anyone active/trialing on a non-free plan has already converted and is
  //    excluded from BOTH cohorts.
  const { data: subs } = await supabase
    .from('user_subscriptions')
    .select('user_id, status, plan_type')
    .in('user_id', emails);

  const converted = new Set<string>();
  for (const s of subs || []) {
    const isPaidPlan = s.plan_type && s.plan_type !== 'free' && s.plan_type !== 'none';
    if (PAID_TRIAL_STATUSES.has(s.status) && isPaidPlan) {
      converted.add(String(s.user_id).toLowerCase());
    }
  }

  // 3) Which of them have Gmail connected — batched. Only used to pick the
  //    right opening line in the email (connected-but-stalled vs never-connected).
  const { data: tokens } = await supabase
    .from('user_tokens')
    .select('user_id')
    .in('user_id', emails);

  const gmailConnected = new Set<string>((tokens || []).map((t: any) => String(t.user_id).toLowerCase()));

  // 4) Build the send list. Both cohorts get the same email; it self-adapts on
  //    the gmailConnected signal.
  const recipients = profiles
    .filter((p: any) => !converted.has(String(p.user_id).toLowerCase()))
    .map((p: any) => {
      const email = String(p.user_id).toLowerCase();
      return {
        email,
        name: p.name || null,
        cohort: p.onboarding_completed ? 'onboarded_no_trial' : 'signed_up_no_onboarding',
        gmailConnected: gmailConnected.has(email),
      };
    });

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      windowStart,
      windowEnd,
      candidates: profiles.length,
      converted: converted.size,
      wouldSend: recipients.length,
      recipients,
    });
  }

  let sent = 0;
  const failures: Array<{ email: string; error: string }> = [];
  for (const r of recipients) {
    try {
      const result = await sendTrialNudgeEmail({
        toEmail: r.email,
        toName: r.name,
        signals: { gmailConnected: r.gmailConnected, daysSinceSignup: 2 },
      });
      if (result?.success) sent += 1;
      else failures.push({ email: r.email, error: result?.error || 'unknown' });
    } catch (e: any) {
      failures.push({ email: r.email, error: e?.message || String(e) });
    }
  }

  return NextResponse.json({
    ok: true,
    windowStart,
    windowEnd,
    candidates: profiles.length,
    converted: converted.size,
    sent,
    failed: failures.length,
    failures,
  });
}
