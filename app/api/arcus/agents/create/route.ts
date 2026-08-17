// @ts-nocheck
/**
 * POST / api / boult / agents / create
  * Direct agent creation — skips the LLM loop, used by IntegrationRequiredCard
    * after the user connects all missing integrations.
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '../../../../../lib/auth.js';
import { getSupabaseAdmin } from '../../../../../lib/supabase.js';
import { logEvent } from "@/lib/logsso";

const DOW_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function cronToLabel(cron: string): string {
  const p = cron.trim().split(/\s+/);
  if (p.length !== 5) return `Schedule: ${cron}`;
  const [min, hour, , , dow] = p;
  const hh = /^\d+$/.test(hour) ? hour.padStart(2, '0') : hour;
  const mm = /^\d+$/.test(min) ? min.padStart(2, '0') : min;
  if (hour.startsWith('*/')) return `Every ${hour.slice(2)} hour(s)`;
  if (min.startsWith('*/')) return `Every ${min.slice(2)} minute(s)`;
  const at = `${hh}:${mm}`;
  if (dow === '*') return `Daily at ${at}`;
  if (/^\d$/.test(dow)) return `Weekly on ${DOW_NAMES[Number(dow)]} at ${at}`;
  return `At ${at} (${cron})`;
}

function getUtcOffsetMinutes(tz: string, date: Date): number {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    });
    const get = (t: string) => parseInt(fmt.formatToParts(date).find((p: any) => p.type === t)?.value ?? '0');
    const localAsUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
    return (localAsUtc - date.getTime()) / 60000;
  } catch {
    logEvent({ channel: "failures", event: "❌ API Error", description: "Unknown error" }); return 0; }
}

function nextRunIso(cron: string, tz = 'UTC'): string | null {
  const p = cron.trim().split(/\s+/);
  if (p.length !== 5) return null;
  const [minS, hourS, , , dowS] = p;
  const now = new Date();
  const next = new Date(now);
  if (hourS.startsWith('*/')) {
    const step = parseInt(hourS.slice(2)) || 1;
    next.setMinutes(/^\d+$/.test(minS) ? parseInt(minS) : 0, 0, 0);
    while (next <= now || next.getUTCHours() % step !== 0) next.setHours(next.getHours() + 1);
    return next.toISOString();
  }
  if (minS.startsWith('*/')) {
    const step = parseInt(minS.slice(2)) || 15;
    next.setSeconds(0, 0);
    do { next.setMinutes(next.getMinutes() + 1); } while (next <= now || next.getMinutes() % step !== 0);
    return next.toISOString();
  }
  const h = parseInt(hourS), m = parseInt(minS);
  if (isNaN(h) || isNaN(m)) return null;
  const offsetMin = getUtcOffsetMinutes(tz, now);
  const nowLocal = new Date(now.getTime() + offsetMin * 60000);
  const y = nowLocal.getUTCFullYear(), mo = nowLocal.getUTCMonth(), d = nowLocal.getUTCDate();
  let targetLocal = new Date(Date.UTC(y, mo, d, h, m, 0, 0));
  if (/^\d$/.test(dowS)) {
    const targetDow = Number(dowS);
    while (targetLocal <= nowLocal || targetLocal.getUTCDay() !== targetDow) {
      targetLocal = new Date(targetLocal.getTime() + 86_400_000);
    }
  } else if (targetLocal <= nowLocal) {
    targetLocal = new Date(targetLocal.getTime() + 86_400_000);
  }
  return new Date(targetLocal.getTime() - offsetMin * 60000).toISOString();
}

async function getUserTimezone(supabase: any, userId: string): Promise<string> {
  try {
    const { data } = await supabase
      .from('user_profiles')
      .select('preferences')
      .ilike('user_id', userId)
      .maybeSingle();
    return (data?.preferences as Record<string, unknown>)?.timezone as string || 'UTC';
  } catch {
    logEvent({ channel: "failures", event: "❌ API Error", description: "Unknown error" }); return 'UTC'; }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.email.toLowerCase();

    const body = await request.json();
    const {
      name, task_description, cron_schedule, output_channel, slack_channel, skip_confirmations, expires_at,
      // Next-gen scheduling (all optional; defaults keep the classic schedule path).
      trigger_type, trigger_config, conditions, pipeline, priority, max_tool_calls,
    } = body;

    if (!name?.trim() || !task_description?.trim()) {
      return NextResponse.json({ error: 'name and task_description are required' }, { status: 400 });
    }

    const triggerType = ['schedule', 'event', 'chained', 'condition'].includes(trigger_type) ? trigger_type : 'schedule';

    // Cron is only meaningful for schedule agents; others get a harmless default.
    const cron = (cron_schedule || '0 7 * * *').trim();
    if (triggerType === 'schedule' && cron.split(/\s+/).length !== 5) {
      return NextResponse.json({ error: `Invalid cron schedule: ${cron}` }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('boult_agents')
      .insert({
        user_id: userId,
        name: name.trim(),
        task_description: task_description.trim(),
        cron_schedule: cron,
        output_channel: output_channel || 'gmail',
        slack_channel: slack_channel || null,
        skip_confirmations: skip_confirmations ?? false,
        expires_at: expires_at || null,
        status: 'active',
        trigger_type: triggerType,
        trigger_config: trigger_config && typeof trigger_config === 'object' ? trigger_config : {},
        conditions: Array.isArray(conditions) ? conditions : [],
        pipeline: Array.isArray(pipeline) ? pipeline : [],
        priority: Number.isFinite(priority) ? priority : 5,
        max_tool_calls: Number.isFinite(max_tool_calls) ? max_tool_calls : null,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const scheduleLabel = cronToLabel(cron);
    const userTz = await getUserTimezone(supabase, userId);
    const nextRun = nextRunIso(cron, userTz);

    return NextResponse.json({
      agent: {
        id: data.id,
        name: data.name,
        task: data.task_description,
        scheduleLabel,
        cron,
        channel: data.output_channel,
        skipConfirmations: data.skip_confirmations,
        status: data.status,
        nextRun: nextRun || undefined,
      },
    });
  } catch (err: any) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(err) });
    return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 });
  }
}
