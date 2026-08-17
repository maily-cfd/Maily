import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { subscriptionService, PLANS } from '@/lib/subscription-service';
import { DatabaseService } from '@/lib/supabase';
import { logEvent } from "@/lib/logsso";

/**
 * GET - All authenticated users are reported as having an active Pro plan.
 * No subscription check performed — everything is free.
 */
export async function GET(request) {
    try {
        const session = await auth();
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Return a hardcoded "pro" subscription so all client-side gates pass.
        return NextResponse.json({
            success: true,
            subscription: {
                hasActiveSubscription: true,
                planType: 'pro',
                planName: 'Pro',
                planPrice: 0,
                subscriptionStartedAt: null,
                subscriptionEndsAt: null,
                daysRemaining: 99999,
                status: 'active',
                isEndingSoon: false,
                isExpired: false
            },
            features: {},
            upgradeToStarter: null,
            upgradeToPro: null,
            debugInfo: {
                rawPlanType: 'pro',
                hasPlanObject: true,
                availablePlans: Object.keys(PLANS)
            }
        });
    } catch (error) {
        logEvent({ channel: "failures", event: "❌ API Error", description: String(error) });
        console.error('Error getting subscription status:', error);
        return NextResponse.json({ error: 'Failed to get subscription status' }, { status: 500 });
    }
}

export async function POST(request) {
    return NextResponse.json({ error: 'Not used.' }, { status: 403 });
}
