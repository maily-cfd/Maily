import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { BoultExecutorEngine } from '@/lib/boult-executor-engine';
import { DatabaseService } from '@/lib/supabase';
import { assertPaidAccess } from '@/lib/subscription-protection';
import { logEvent } from "@/lib/logsso";

export async function POST(req: Request) {
    const session = await auth();
    if (!session?.user?.email) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // STRICT paywall — Boult execution is paid-only.
    const gate = await assertPaidAccess(session.user.email);
    if (!gate.ok) {
        return NextResponse.json(
            { error: gate.error, message: gate.message, upgradeUrl: gate.upgradeUrl },
            { status: gate.status }
        );
    }

    try {
        const { plan, context = {} } = await req.json();
        
        // Setup execution context
        const executionContext = {
            ...context,
            userId: (session.user as any).id,
            accountId: (session.user as any).accountId || 'primary',
            supabase: new DatabaseService().supabase
        };

        const executor = new BoultExecutorEngine({ supabase: executionContext.supabase });
        const result = await executor.executePlan(plan, executionContext);

        return NextResponse.json(result);
    } catch (error: any) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(error) });
        console.error('[Boult Execute API] Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
