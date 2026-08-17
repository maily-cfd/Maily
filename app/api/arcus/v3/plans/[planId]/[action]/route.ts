/**
 * Boult V3 — Plan Actions: Approve, Execute, Dismiss
 * POST /api/boult/v3/plans/[planId]/approve
 * POST /api/boult/v3/plans/[planId]/execute
 * POST /api/boult/v3/plans/[planId]/dismiss
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '../../../../../../../lib/auth.js';
import { getSupabaseAdmin } from '../../../../../../../lib/supabase.js';
import { executePlan } from '../../../../../../../lib/boult-v3/executor';
import { auditLogger } from '../../../../../../../lib/audit-logger.js';
import { logEvent } from "@/lib/logsso";

// ─── APPROVE ────────────────────────────────────────────────────────────────────

export async function POST(
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
    const url = new URL(request.url);
    const action = url.pathname.split('/').pop(); // 'approve', 'execute', or 'dismiss'

    const supabase = getSupabaseAdmin();

    // Verify plan exists and belongs to user
    const { data: plan, error } = await supabase
      .from('boult_plans')
      .select('id, status, findings, selected_option')
      .eq('id', planId)
      .eq('user_id', userId)
      .maybeSingle();

    if (error || !plan) {
      return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
    }

    switch (action) {
      case 'approve': {
        // Can only approve from 'proposed' status
        if (plan.status !== 'proposed') {
          return NextResponse.json(
            { error: `Cannot approve plan in '${plan.status}' status` },
            { status: 400 }
          );
        }

        // Parse request body for selected option
        const body = await request.json().catch(() => ({}));
        const selectedOption = body.selectedOption ?? plan.selected_option ?? 0;

        // Build steps from the selected option
        const findings = plan.findings as any[];
        const finding = findings?.[0];
        const option = finding?.options?.[selectedOption];

        if (!option || !option.steps) {
          return NextResponse.json(
            { error: 'No valid option or steps found' },
            { status: 400 }
          );
        }

        // Create plan steps in the database
        const steps = option.steps.map((step: any, index: number) => ({
          plan_id: planId,
          position: index,
          app: step.app,
          action: step.action,
          params: step.params || {},
          human_readable: step.humanReadable,
          irreversible: step.irreversible || false,
          status: 'pending',
        }));

        await supabase.from('boult_plan_steps').insert(steps);

        // Update plan status
        await supabase
          .from('boult_plans')
          .update({ status: 'approved', selected_option: selectedOption })
          .eq('id', planId);

        await auditLogger.log(userId, 'boult.plan_approved', { planId, selectedOption });

        return NextResponse.json({ status: 'approved', stepsCreated: steps.length });
      }

      case 'execute': {
        // Can only execute from 'approved' status
        if (plan.status !== 'approved') {
          return NextResponse.json(
            { error: `Cannot execute plan in '${plan.status}' status` },
            { status: 400 }
          );
        }

        // Start execution in background (non-blocking)
        executePlan(planId, userId).catch(err => {
          console.error('[Boult V3] Execution error:', err.message);
        });

        return NextResponse.json({ status: 'executing' });
      }

      case 'dismiss': {
        // Can dismiss from 'proposed' or 'approved'
        if (!['proposed', 'approved'].includes(plan.status)) {
          return NextResponse.json(
            { error: `Cannot dismiss plan in '${plan.status}' status` },
            { status: 400 }
          );
        }

        await supabase
          .from('boult_plans')
          .update({ status: 'dismissed' })
          .eq('id', planId);

        await auditLogger.log(userId, 'boult.plan_dismissed', { planId });

        return NextResponse.json({ status: 'dismissed' });
      }

      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }

  } catch (error) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(error) });
    console.error('[Boult V3] Plan action error:', (error as Error).message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
