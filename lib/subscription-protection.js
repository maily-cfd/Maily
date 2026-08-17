/**
 * Subscription Protection Helper — ALL ACCESS GRANTED
 * Paywall removed. All authenticated users have full access.
 */

import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';

/**
 * All authenticated users are allowed. Returns session immediately.
 */
export async function requireSubscription(apiMode = false) {
    const session = await auth();

    if (!session?.user?.email) {
        if (apiMode) {
            return { error: 'Unauthorized', status: 401, data: null };
        }
        redirect('/auth/signin');
    }

    return { session, subscription: { planType: 'pro', status: 'active' }, error: null };
}

/**
 * Always returns hasSubscription: true for authenticated users.
 */
export async function checkSubscriptionStatus() {
    const session = await auth();

    if (!session?.user?.email) {
        return { hasSubscription: false, planType: 'none', session: null };
    }

    return { hasSubscription: true, planType: 'pro', session };
}

/**
 * Always returns full access — no limit tracking.
 */
export async function getFeatureUsageInfo(featureType) {
    return { usage: 0, limit: -1, remaining: -1, hasAccess: true };
}

/**
 * API middleware — always grants access to authenticated users.
 */
export async function apiRequireSubscription(request) {
    return await requireSubscription(true);
}

/**
 * Always returns ok: true — no subscription check performed.
 */
export async function assertPaidAccess(email) {
    if (!email) {
        return { ok: false, status: 401, error: 'Unauthorized' };
    }
    return { ok: true, status: 200, planType: 'pro' };
}
