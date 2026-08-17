// @ts-nocheck
/**
 * /api/boult/agents/templates
 *
 *   GET  → returns the AGENT_TEMPLATES catalog (no auth — the catalog is
 *          static config; the UI can show it on the marketing page too).
 *
 *   POST → body: { templateId, overrides? } — spawns the template as a
 *          live agent for the authenticated user. Skips the LLM-driven
 *          spec-confirm flow because the template IS the spec.
 *          Returns the same shape as /api/boult/agents/create.
 *
 * Optional `overrides` lets the user tweak schedule / channel / skipConfirmations
 * at spawn time without re-typing the whole template.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '../../../../../lib/auth.js';
import { getSupabaseAdmin } from '../../../../../lib/supabase.js';
import { AGENT_TEMPLATES, getTemplateById } from '../../../../../lib/boult/agent-templates';
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
  if (/^\d-\d$/.test(dow)) return `Weekdays at ${at}`;
  return `At ${at} (${cron})`;
}

export async function GET() {
  // Public catalog — no auth needed
  return NextResponse.json({ templates: AGENT_TEMPLATES });
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.email.toLowerCase();

    const body = await request.json();
    const templateId = (body?.templateId || '').trim();
    if (!templateId) {
      return NextResponse.json({ error: 'templateId is required' }, { status: 400 });
    }
    const template = getTemplateById(templateId);
    if (!template) {
      return NextResponse.json({ error: `Unknown templateId: ${templateId}` }, { status: 404 });
    }

    const overrides = body?.overrides || {};
    const triggerType = template.triggerType || 'schedule';
    const cron = (overrides.cron_schedule || template.cronSchedule).trim();
    // Cron only matters for schedule agents; event/condition/pipeline ignore it.
    if (triggerType === 'schedule' && cron.split(/\s+/).length !== 5) {
      return NextResponse.json({ error: `Invalid cron schedule: ${cron}` }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    // Prevent duplicate spawns of the same template — if there's already an
    // active agent with the template's name for this user, return it instead
    // of inserting a second row.
    const { data: existing } = await supabase
      .from('boult_agents')
      .select('id, name, task_description, cron_schedule, output_channel, status, skip_confirmations')
      .eq('user_id', userId)
      .eq('name', template.name)
      .in('status', ['active', 'running', 'paused'])
      .maybeSingle();
    if (existing) {
      return NextResponse.json({
        agent: existing,
        alreadyExists: true,
        message: `You already have a "${template.name}" agent. Open the Agents dashboard to manage it.`,
      });
    }

    // ── Pipeline templates — create the children first (as 'chained'), then the
    // parent with pipeline = [child ids]. The parent fires on its own trigger
    // and hands its output down the chain at run time.
    let pipelineIds: string[] = [];
    if (Array.isArray(template.pipelineChildren) && template.pipelineChildren.length) {
      for (const child of template.pipelineChildren) {
        const { data: childRow, error: childErr } = await supabase
          .from('boult_agents')
          .insert({
            user_id: userId,
            name: child.name,
            task_description: child.taskDescription.trim(),
            cron_schedule: '0 7 * * *', // unused for chained
            output_channel: child.outputChannel,
            slack_channel: null,
            skip_confirmations: child.skipConfirmations,
            status: 'active',
            trigger_type: 'chained',
          })
          .select('id')
          .single();
        if (childErr) {
          return NextResponse.json({ error: `Failed to create pipeline stage "${child.name}": ${childErr.message}` }, { status: 500 });
        }
        pipelineIds.push(childRow.id);
      }
    }

    const { data, error } = await supabase
      .from('boult_agents')
      .insert({
        user_id: userId,
        name: template.name,
        task_description: (overrides.task_description || template.taskDescription).trim(),
        cron_schedule: cron,
        output_channel: overrides.output_channel || template.outputChannel,
        slack_channel: overrides.slack_channel || null,
        skip_confirmations: overrides.skip_confirmations ?? template.skipConfirmations,
        expires_at: overrides.expires_at || null,
        status: 'active',
        trigger_type: triggerType,
        trigger_config: template.triggerConfig || {},
        conditions: template.conditions || [],
        pipeline: pipelineIds,
        priority: template.priority ?? 5,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      agent: {
        id: data.id,
        name: data.name,
        task: data.task_description,
        scheduleLabel: cronToLabel(cron),
        cron,
        channel: data.output_channel,
        skipConfirmations: data.skip_confirmations,
        status: data.status,
        template: {
          id: template.id,
          emoji: template.emoji,
          tagline: template.tagline,
        },
      },
    });
  } catch (err: any) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(err) });
    return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 });
  }
}
