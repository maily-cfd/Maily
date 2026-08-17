import { NextRequest, NextResponse } from 'next/server';
// @ts-ignore — JS module
import { auth as nextAuth } from '../../../../../lib/auth.js';
import { approvePending, declinePending } from '../../../../../lib/boult/session-state';
import { logEvent } from "@/lib/logsso";

const auth: any = nextAuth;

export const dynamic = 'force-dynamic';

/**
 * POST /api/boult/approval/confirm
 *
 * Called by ConfirmationCard.onAction the moment the user clicks Confirm /
 * Cancel on a request_confirmation card. Flips the pending row in
 * boult_session_approvals so that the next executeTool('send_email' | ...)
 * call from the same conversation can match against it and proceed.
 *
 * Body: { approvalId: string, decision: 'confirm' | 'cancel' }
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = (session.user.email as string).toLowerCase();

  let body: { approvalId?: string; decision?: 'confirm' | 'cancel' } = {};
  try {
    body = await request.json();
  } catch {
    logEvent({ channel: "failures", event: "❌ API Error", description: "Unknown error" });
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { approvalId, decision } = body;
  if (!approvalId || (decision !== 'confirm' && decision !== 'cancel')) {
    return NextResponse.json(
      { error: 'approvalId and decision ("confirm" | "cancel") are required' },
      { status: 400 },
    );
  }

  const ok = decision === 'confirm'
    ? await approvePending({ approvalId, userId })
    : await declinePending({ approvalId, userId });

  if (!ok) {
    // Approval row may have expired, already been resolved, or never existed.
    // The UI doesn't need to retry — the gate failing open downstream covers
    // legacy in-flight rows from before this migration was applied.
    return NextResponse.json(
      { ok: false, error: 'No matching pending approval found.' },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true, decision });
}
