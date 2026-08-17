/**
 * Boult V3 — Single Plan API
 * GET /api/boult/v3/plans/[planId] — Get single plan with steps
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '../../../../../../lib/auth.js';
import { getSupabaseAdmin } from '../../../../../../lib/supabase.js';
import { logEvent } from "@/lib/logsso";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ planId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.email.toLowerCase();
    const { planId } = await params;
    const supabase = getSupabaseAdmin();

    // ALWAYS scope to userId — never fetch by ID alone
    const { data: plan, error } = await supabase
      .from('boult_plans')
      .select('*')
      .eq('id', planId)
      .eq('user_id', userId)
      .maybeSingle();

    if (error || !plan) {
      return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
    }

    // Fetch steps
    const { data: steps } = await supabase
      .from('boult_plan_steps')
      .select('*')
      .eq('plan_id', planId)
      .order('position', { ascending: true });

    // If this is a plan_mode brief, fetch the brief data
    let brief = null;
    if (plan.mode === 'plan_mode') {
      const { data: briefData } = await supabase
        .from('boult_briefs')
        .select('brief_data, generated_at')
        .eq('plan_id', planId)
        .maybeSingle();
      brief = briefData;
    }

    return NextResponse.json({
      ...plan,
      steps: steps || [],
      brief: brief?.brief_data || null,
    });

  } catch (error) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(error) });
    console.error('[Boult V3] Plan detail error:', (error as Error).message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
