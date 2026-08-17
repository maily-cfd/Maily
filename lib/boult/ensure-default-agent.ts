import { getTemplateById } from './agent-templates';

/**
 * Idempotently give a paid, Gmail-connected user their first scheduled agent —
 * the Morning Inbox Sweep — so the "handled before you open it" promise is real
 * without them having to build an agent by hand. Returns true if it created one.
 * Never throws; safe to call (unawaited) from any authed surface.
 */
export async function ensureMorningSweepAgent(userId: string): Promise<boolean> {
  try {
    const uid = userId.toLowerCase();
    // No Gmail = nothing to sweep; don't create a doomed agent.
    const { getGmailToken } = await import('./tools/http-tokens');
    if (!(await getGmailToken(uid))) return false;

    // @ts-ignore — JS module
    const { getSupabaseAdmin } = await import('../supabase.js');
    const supabase = getSupabaseAdmin();

    // Idempotent: skip if the user already has ANY agent (don't clobber their setup).
    const { data: existing, error: readErr } = await supabase
      .from('boult_agents')
      .select('id')
      .eq('user_id', uid)
      .limit(1);
    if (readErr) return false;            // table missing / read error → no-op
    if (existing && existing.length) return false;

    const tpl = getTemplateById('morning_inbox_sweep');
    if (!tpl) return false;

    const { error } = await supabase.from('boult_agents').insert({
      user_id: uid,
      name: tpl.name,
      task_description: tpl.taskDescription,
      cron_schedule: tpl.cronSchedule,
      output_channel: tpl.outputChannel || 'gmail',
      slack_channel: null,
      skip_confirmations: tpl.skipConfirmations ?? false,
      status: 'active',
      trigger_type: 'schedule',
      trigger_config: {},
      conditions: [],
      pipeline: [],
      priority: 5,
      max_tool_calls: null,
    });
    return !error;
  } catch {
    return false;
  }
}
