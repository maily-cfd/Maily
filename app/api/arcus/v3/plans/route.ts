/**
 * Boult V3 — Plans API
 * GET  /api/boult/v3/plans        — List plans for authenticated user (paginated)
 * POST /api/boult/v3/plans        — (internal) Create a plan
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '../../../../../lib/auth.js';
import { getSupabaseAdmin } from '../../../../../lib/supabase.js';
import { logEvent } from "@/lib/logsso";

export async function GET(request: NextRequest) {
  try {
    // Authenticate
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.email.toLowerCase();
    const supabase = getSupabaseAdmin();

    // Parse query params
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '20', 10), 50);
    const cursor = searchParams.get('cursor'); // createdAt timestamp
    const status = searchParams.get('status'); // optional filter
    const mode = searchParams.get('mode'); // 'agentic' | 'plan_mode'

    // Build query — always scoped to userId
    let query = supabase
      .from('boult_plans')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (cursor) {
      query = query.lt('created_at', cursor);
    }
    if (status) {
      query = query.eq('status', status);
    }
    if (mode) {
      query = query.eq('mode', mode);
    }

    const { data: plans, error } = await query;

    if (error) {
      // Table may not exist yet — return empty list instead of 500
      const isMissingTable = error.message?.includes('does not exist') ||
        error.message?.includes('relation') ||
        error.code === '42P01';
      if (isMissingTable) {
        console.warn('[Boult V3] boult_plans table not found — returning empty list');
        return NextResponse.json({ plans: [], nextCursor: null });
      }
      console.error('[Boult V3] Plans list error:', error.message, error.code);
      return NextResponse.json({ plans: [], nextCursor: null, _error: error.message }, { status: 200 });
    }

    if (!plans || plans.length === 0) {
      return NextResponse.json({ plans: [], nextCursor: null });
    }

    // For each plan, fetch its steps
    const plansWithSteps = await Promise.all(
      plans.map(async (plan) => {
        try {
          const { data: steps } = await supabase
            .from('boult_plan_steps')
            .select('*')
            .eq('plan_id', plan.id)
            .order('position', { ascending: true });
          return { ...plan, steps: steps || [] };
        } catch {
          logEvent({ channel: "failures", event: "❌ API Error", description: "Unknown error" });
          return { ...plan, steps: [] };
        }
      })
    );

    return NextResponse.json({
      plans: plansWithSteps,
      nextCursor: plansWithSteps.length === limit
        ? plansWithSteps[plansWithSteps.length - 1].created_at
        : null,
    });

  } catch (error: any) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(error) });
    console.error('[Boult V3] Plans API unhandled error:', error.message, error.stack?.slice(0, 300));
    // Always return a valid shape — never 500 on a feed poll
    return NextResponse.json({ plans: [], nextCursor: null }, { status: 200 });
  }
}
