import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { BoultPlanner } from '@/lib/boult-planner';
import { assertPaidAccess } from '@/lib/subscription-protection';
import { logEvent } from "@/lib/logsso";

export async function POST(req: Request) {
    const session = await auth();
    if (!session?.user?.email) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // STRICT paywall — Boult planning is paid-only.
    const gate = await assertPaidAccess(session.user.email);
    if (!gate.ok) {
        return NextResponse.json(
            { error: gate.error, message: gate.message, upgradeUrl: gate.upgradeUrl },
            { status: gate.status }
        );
    }

    try {
        const { intent, context } = await req.json();
        
        const planner = new BoultPlanner();
        const plan = await planner.plan(intent, context);

        return NextResponse.json(plan);
    } catch (error: any) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(error) });
        console.error('[Boult Plan API] Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
