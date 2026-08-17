/**
 * Boult V3 — Plan Mode Cron
 * GET /api/boult/v3/cron/plan-mode
 *
 * Called by Vercel Cron or an external scheduler.
 * Iterates all users with planModeEnabled=true and enqueues
 * a plan-mode-brief job for each user whose local time is 7AM (±30min).
 *
 * Security: protected by CRON_SECRET header check.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../../../lib/supabase.js';
import { enqueueEvent } from '../../../../../../lib/boult-v3/queue';
import { logEvent } from "@/lib/logsso";

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  // Verify cron secret to prevent unauthorized triggers
  const cronSecret = request.headers.get('authorization');
  const expectedSecret = process.env.CRON_SECRET || process.env.AUTH_SECRET;

  if (!expectedSecret || cronSecret !== `Bearer ${expectedSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const supabase = getSupabaseAdmin();
    const now = new Date();

    // Fetch all users who have at least one active Boult integration
    // (having an integration implies they want Boult to watch their apps)
    const { data: integrations } = await supabase
      .from('boult_integrations')
      .select('user_id')
      .not('access_token', 'is', null);

    if (!integrations || integrations.length === 0) {
      return NextResponse.json({ status: 'no_users', processed: 0 });
    }

    // Deduplicate user IDs
    const userIds = [...new Set(integrations.map(i => i.user_id))];
    let enqueued = 0;

    for (const userId of userIds) {
      // Check if user's local time is approximately 7AM (±30min window)
      // by looking up their timezone preference
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('preferences')
        .ilike('user_id', userId)
        .maybeSingle();

      const prefs = profile?.preferences as Record<string, unknown> || {};
      const timezone = (prefs.timezone as string) || 'UTC';
      const planModeEnabled = prefs.planModeEnabled !== false; // default true

      if (!planModeEnabled) continue;

      // Check if it's ~7AM in the user's timezone
      const userLocalHour = getHourInTimezone(now, timezone);
      if (userLocalHour < 6 || userLocalHour > 8) continue; // Only fire 6-8AM window

      // Check if we already generated a brief today for this user
      const todayStart = new Date(now);
      todayStart.setHours(0, 0, 0, 0);

      const { data: existingBrief } = await supabase
        .from('boult_plans')
        .select('id')
        .eq('user_id', userId)
        .eq('mode', 'plan_mode')
        .gte('created_at', todayStart.toISOString())
        .limit(1)
        .maybeSingle();

      if (existingBrief) continue; // Already generated today

      // Enqueue plan mode job
      await enqueueEvent({
        userId,
        source: 'cron_plan_mode',
        eventType: 'daily_brief',
        payload: { cronTriggeredAt: now.toISOString() },
        timestamp: Date.now(),
      });

      enqueued++;
    }

    return NextResponse.json({ status: 'ok', processed: userIds.length, enqueued });

  } catch (error) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(error) });
    console.error('[Boult V3] Plan Mode cron error:', (error as Error).message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

/**
 * Get the current hour in a given IANA timezone.
 */
function getHourInTimezone(date: Date, timezone: string): number {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      hour12: false,
      timeZone: timezone,
    });
    return parseInt(formatter.format(date), 10);
  } catch {
    logEvent({ channel: "failures", event: "❌ API Error", description: "Unknown error" });
    return date.getUTCHours(); // fallback to UTC
  }
}
