import { NextRequest, NextResponse } from 'next/server';
import { auth } from '../../../../lib/auth.js';
import { logEvent } from "@/lib/logsso";

export const dynamic = 'force-dynamic';

async function getSupabase() {
  const { getSupabaseAdmin } = await import('../../../../lib/supabase.js');
  return getSupabaseAdmin();
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.email.toLowerCase();

  try {
    const supabase = await getSupabase();
    const { data } = await supabase
      .from('user_profiles')
      .select('preferences')
      .ilike('user_id', userId)
      .maybeSingle();

    const prefs = (data?.preferences as Record<string, unknown>) || {};
    return NextResponse.json({
      personality: (prefs.boult_personality as string) || '',
      instructionsEnabled: prefs.boult_instructions_enabled !== false,
      memoryEnabled: prefs.boult_memory_enabled !== false,
      // PART 45 — user-tunable voice + length controls. Defaults are 'warm'
      // and 'normal' to match the PART 43 voice rewrite; users who want the
      // old terse style switch to 'direct' + 'brief'.
      communicationStyle: (prefs.boult_communication_style as string) || 'warm',
      verbosity: (prefs.boult_verbosity as string) || 'normal',
      // PART 47 — write-action confirmation mode. Default 'ask' (current
      // behavior: inline previews + confirm before send/schedule/post/create).
      // Users who trust Boult pick 'auto' — writes execute immediately, no
      // preview, no confirmation. Persists so the choice survives reload.
      actionMode: (prefs.boult_action_mode as string) || 'ask',
      // PART 61 — pre-meeting prep. Default on with a 25-minute lead time.
      meetingPrepEnabled: prefs.boult_meeting_prep_enabled !== false,
      meetingPrepLeadMinutes: typeof prefs.boult_meeting_prep_lead_minutes === 'number'
        ? prefs.boult_meeting_prep_lead_minutes
        : 25,
      // PART 62 — post-meeting follow-up draft. Default on.
      meetingFollowupEnabled: prefs.boult_meeting_followup_enabled !== false,
    });
  } catch {
    logEvent({ channel: "failures", event: "❌ API Error", description: "Unknown error" });
    return NextResponse.json({
      personality: '',
      instructionsEnabled: true,
      memoryEnabled: true,
      communicationStyle: 'warm',
      verbosity: 'normal',
      actionMode: 'ask',
      meetingPrepEnabled: true,
      meetingPrepLeadMinutes: 25,
      meetingFollowupEnabled: true,
    });
  }
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.email.toLowerCase();

  let personality = '';
  let instructionsEnabled: boolean | undefined;
  let communicationStyle: string | undefined;
  let verbosity: string | undefined;
  let actionMode: string | undefined;
  let meetingPrepEnabled: boolean | undefined;
  let meetingPrepLeadMinutes: number | undefined;
  let meetingFollowupEnabled: boolean | undefined;
  try {
    const body = await request.json();
    personality = (body.personality as string) || '';
    if (typeof body.instructionsEnabled === 'boolean') {
      instructionsEnabled = body.instructionsEnabled;
    }
    if (typeof body.communicationStyle === 'string' && ['direct', 'balanced', 'warm'].includes(body.communicationStyle)) {
      communicationStyle = body.communicationStyle;
    }
    if (typeof body.verbosity === 'string' && ['brief', 'normal', 'detailed'].includes(body.verbosity)) {
      verbosity = body.verbosity;
    }
    if (typeof body.actionMode === 'string' && ['ask', 'auto'].includes(body.actionMode)) {
      actionMode = body.actionMode;
    }
    if (typeof body.meetingPrepEnabled === 'boolean') {
      meetingPrepEnabled = body.meetingPrepEnabled;
    }
    if (typeof body.meetingPrepLeadMinutes === 'number' && body.meetingPrepLeadMinutes >= 5 && body.meetingPrepLeadMinutes <= 120) {
      meetingPrepLeadMinutes = Math.round(body.meetingPrepLeadMinutes);
    }
    if (typeof body.meetingFollowupEnabled === 'boolean') {
      meetingFollowupEnabled = body.meetingFollowupEnabled;
    }
  } catch {
    logEvent({ channel: "failures", event: "❌ API Error", description: "Unknown error" });
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  try {
    const supabase = await getSupabase();

    // Fetch existing preferences to merge (don't overwrite other pref keys)
    const { data: existing } = await supabase
      .from('user_profiles')
      .select('preferences')
      .ilike('user_id', userId)
      .maybeSingle();

    const existingPrefs = (existing?.preferences as Record<string, unknown>) || {};
    const updatedPrefs: Record<string, unknown> = { ...existingPrefs, boult_personality: personality };
    if (instructionsEnabled !== undefined) {
      updatedPrefs.boult_instructions_enabled = instructionsEnabled;
    }
    if (communicationStyle !== undefined) {
      updatedPrefs.boult_communication_style = communicationStyle;
    }
    if (verbosity !== undefined) {
      updatedPrefs.boult_verbosity = verbosity;
    }
    if (actionMode !== undefined) {
      updatedPrefs.boult_action_mode = actionMode;
    }
    if (meetingPrepEnabled !== undefined) {
      updatedPrefs.boult_meeting_prep_enabled = meetingPrepEnabled;
    }
    if (meetingPrepLeadMinutes !== undefined) {
      updatedPrefs.boult_meeting_prep_lead_minutes = meetingPrepLeadMinutes;
    }
    if (meetingFollowupEnabled !== undefined) {
      updatedPrefs.boult_meeting_followup_enabled = meetingFollowupEnabled;
    }

    if (existing) {
      await supabase
        .from('user_profiles')
        .update({ preferences: updatedPrefs })
        .ilike('user_id', userId);
    } else {
      await supabase
        .from('user_profiles')
        .insert({ user_id: userId, preferences: updatedPrefs });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(err) });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
