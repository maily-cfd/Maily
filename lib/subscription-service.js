/**
 * Subscription Service for Maily
 * Handles Polar payment integration, subscription management, and feature usage tracking
 */

import { getSupabaseAdmin } from './supabase.js';
import crypto from 'crypto';

// Plan configurations - Now using Polar
// New 4-tier pricing: Weekly ($8.99/wk), Monthly ($29/mo), Annual ($16.58/mo billed $199/yr), Lifetime ($499 one-time)
export const PLANS = {
    weekly: {
        id: 'weekly',
        name: 'Weekly',
        price: 8.99,
        polarProductId: '71aac0a5-ac56-42d8-8a96-88619fa0e4ab',
        polarPriceId: null, // price id not needed — matched by product id / name / amount
        polarCheckoutUrl: 'https://buy.polar.sh/polar_cl_nnRbdFq1yLPLgMs9GxDUTx1O6t30yz400ZSR54dcWia',
        checkoutUrl: 'https://buy.polar.sh/polar_cl_nnRbdFq1yLPLgMs9GxDUTx1O6t30yz400ZSR54dcWia',
        limits: {
            draft_reply: { limit: -1, period: 'monthly' },
            schedule_call: { limit: -1, period: 'monthly' },
            ai_notes: { limit: -1, period: 'monthly' },
            sift_analysis: { limit: -1, period: 'daily' },
            boult_ai: { limit: -1, period: 'daily' },
            email_summary: { limit: -1, period: 'daily' },
            openai_tokens: { limit: -1, period: 'monthly' }
        }
    },
    pro: {
        id: 'pro',
        name: 'Monthly',
        price: 29,
        polarProductId: '30b7f9fb-142d-42d1-a62e-d6b3661996ce',
        polarPriceId: '585d2a3e-3fe5-490d-af1f-d0e9d6b736a9',
        polarCheckoutUrl: 'https://buy.polar.sh/polar_cl_iFCJ2Mq7UbVBQTIiMGwI3STQZTvGfT1EBLyiM1HM5ca',
        checkoutUrl: 'https://buy.polar.sh/polar_cl_iFCJ2Mq7UbVBQTIiMGwI3STQZTvGfT1EBLyiM1HM5ca',
        // Legacy Whop IDs (kept for backward compatibility)
        whopProductId: 'plan_HjjXVb5SWxdOK',
        whopCheckoutUrl: 'https://whop.com/checkout/plan_HjjXVb5SWxdOK',
        limits: {
            draft_reply: { limit: -1, period: 'monthly' }, // -1 means unlimited
            schedule_call: { limit: -1, period: 'monthly' },
            ai_notes: { limit: -1, period: 'monthly' },
            sift_analysis: { limit: -1, period: 'daily' },
            boult_ai: { limit: -1, period: 'daily' },
            email_summary: { limit: -1, period: 'daily' },
            openai_tokens: { limit: -1, period: 'monthly' } // unlimited
        }
    },
    annual: {
        id: 'annual',
        name: 'Annual',
        price: 16.58, // Billed as $199/year upfront
        annualPrice: 199,
        polarProductId: '7c2009e2-38d3-4bbe-9ed0-658a9265d1b1',
        polarPriceId: '6c313193-76f4-4cb8-b34c-8871e7f4ad20',
        polarCheckoutUrl: 'https://buy.polar.sh/polar_cl_I2DWGQPxxX0lvNGzbAeSRbkdCP6TgU9Ybsy7O3pkReC',
        checkoutUrl: 'https://buy.polar.sh/polar_cl_I2DWGQPxxX0lvNGzbAeSRbkdCP6TgU9Ybsy7O3pkReC',
        limits: {
            draft_reply: { limit: -1, period: 'monthly' },
            schedule_call: { limit: -1, period: 'monthly' },
            ai_notes: { limit: -1, period: 'monthly' },
            sift_analysis: { limit: -1, period: 'daily' },
            boult_ai: { limit: -1, period: 'daily' },
            email_summary: { limit: -1, period: 'daily' },
            openai_tokens: { limit: -1, period: 'monthly' }
        }
    },
    lifetime: {
        id: 'lifetime',
        name: 'Lifetime Founder',
        price: 499,
        polarProductId: 'bcb352db-38bf-4dbc-bf59-1835f621f8e7',
        polarPriceId: null, // price id not needed — matched by product id / name / amount
        polarCheckoutUrl: 'https://buy.polar.sh/polar_cl_T848DqQDK82361tmecJpNmtFgfPubJSb4Eyza2l8yrV',
        checkoutUrl: 'https://buy.polar.sh/polar_cl_T848DqQDK82361tmecJpNmtFgfPubJSb4Eyza2l8yrV',
        limits: {
            draft_reply: { limit: -1, period: 'monthly' },
            schedule_call: { limit: -1, period: 'monthly' },
            ai_notes: { limit: -1, period: 'monthly' },
            sift_analysis: { limit: -1, period: 'daily' },
            boult_ai: { limit: -1, period: 'daily' },
            email_summary: { limit: -1, period: 'daily' },
            openai_tokens: { limit: -1, period: 'monthly' }
        }
    },
    // Legacy aliases — kept so existing DB records don't crash lookups
    free: {
        id: 'free',
        name: 'No Plan',
        price: 0,
        limits: {
            draft_reply: { limit: 0, period: 'daily' },
            schedule_call: { limit: 0, period: 'monthly' },
            ai_notes: { limit: 0, period: 'monthly' },
            sift_analysis: { limit: 0, period: 'daily' },
            boult_ai: { limit: 0, period: 'daily' },
            email_summary: { limit: 0, period: 'daily' },
            openai_tokens: { limit: 0, period: 'monthly' }
        }
    },
    none: {
        id: 'free',
        name: 'No Plan',
        price: 0,
        limits: {
            draft_reply: { limit: 0, period: 'daily' },
            schedule_call: { limit: 0, period: 'monthly' },
            ai_notes: { limit: 0, period: 'monthly' },
            sift_analysis: { limit: 0, period: 'daily' },
            boult_ai: { limit: 0, period: 'daily' },
            email_summary: { limit: 0, period: 'daily' },
            openai_tokens: { limit: 0, period: 'monthly' }
        }
    },
    // Legacy starter/basic aliases → map to pro limits for backward compat
    starter: {
        id: 'pro',
        name: 'Monthly',
        price: 29,
        limits: {
            draft_reply: { limit: -1, period: 'monthly' },
            schedule_call: { limit: -1, period: 'monthly' },
            ai_notes: { limit: -1, period: 'monthly' },
            sift_analysis: { limit: -1, period: 'daily' },
            boult_ai: { limit: -1, period: 'daily' },
            email_summary: { limit: -1, period: 'daily' },
            openai_tokens: { limit: -1, period: 'monthly' }
        }
    },
    basic: {
        id: 'pro',
        name: 'Monthly',
        price: 29,
        limits: {
            draft_reply: { limit: -1, period: 'monthly' },
            schedule_call: { limit: -1, period: 'monthly' },
            ai_notes: { limit: -1, period: 'monthly' },
            sift_analysis: { limit: -1, period: 'daily' },
            boult_ai: { limit: -1, period: 'daily' },
            email_summary: { limit: -1, period: 'daily' },
            openai_tokens: { limit: -1, period: 'monthly' }
        }
    }
};

// Feature types for tracking
export const FEATURE_TYPES = {
    DRAFT_REPLY: 'draft_reply',
    SCHEDULE_CALL: 'schedule_call',
    AI_NOTES: 'ai_notes',
    SIFT_ANALYSIS: 'sift_analysis',
    BOULT_AI: 'boult_ai',
    EMAIL_SUMMARY: 'email_summary',
    OPENAI_TOKENS: 'openai_tokens'
};

/**
 * Owner/admin emails that always receive Pro access regardless of DB state.
 * Set OWNER_EMAILS in .env.local as a comma-separated list.
 * Example: OWNER_EMAILS=me@example.com,admin@example.com
 */
function getOwnerEmails() {
    const raw = process.env.OWNER_EMAILS || '';
    return raw.split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
}

export function isOwnerEmail(email) {
    if (!email) return false;
    return getOwnerEmails().includes(email.toLowerCase());
}

function normalizePlanConfig() {
    const featureKeys = Object.values(FEATURE_TYPES);

    const normalizeFeature = (planId, featureType, cfg) => {
        const period = cfg?.period || 'daily';
        let limit = cfg?.limit;

        // Ensure Boult AI has a healthy default if missing
        if (featureType === FEATURE_TYPES.BOULT_AI && (limit === undefined || limit === null)) {
            limit = (planId === 'pro' || planId === 'annual' || planId === 'lifetime' || planId === 'starter' || planId === 'basic') ? -1 : 0;
        }

        // No-plan / legacy free users get 0 limits (must subscribe)
        if (planId === 'free' || planId === 'none') {
            return { limit: limit ?? 0, period };
        }

        // All paid plans (pro, annual, lifetime, legacy starter/basic) get unlimited
        if (planId === 'weekly' || planId === 'pro' || planId === 'annual' || planId === 'lifetime' || planId === 'starter' || planId === 'basic') {
            return { limit: -1, period };
        }

        return cfg;
    };

    // Normalize all plan tiers
    for (const planKey of Object.keys(PLANS)) {
        for (const featureType of featureKeys) {
            if (PLANS[planKey]?.limits) {
                PLANS[planKey].limits[featureType] = normalizeFeature(planKey, featureType, PLANS[planKey].limits?.[featureType]);
            }
        }
    }
}

normalizePlanConfig();

/**
 * How much access a plan grants when the PROVIDER doesn't tell us when the
 * period ends. This is not an edge case — it is the common path: `order.paid`
 * is an ORDER payload and carries no `current_period_end`, and it is one of our
 * activation triggers. Every plan here is recurring (weekly renews every 7 days
 * until cancelled), so Polar DOES send a period end on subscription.* events —
 * but whichever event lands last wins the upsert, and order.paid has no period
 * data to offer. So this default is what actually lands in
 * `subscription_ends_at` for a large share of activations AND renewals.
 *
 * Getting it wrong silently grants the WRONG AMOUNT of access: weekly used to
 * fall through to the +1 month default, i.e. $8.99 bought a month, and annual
 * still granted 1 month instead of 1 year.
 * Lifetime is absent on purpose — it's the one non-recurring product and is
 * special-cased to a null end date.
 */
function applyDefaultPeriod(date, planType) {
    if (planType === 'weekly') {
        date.setDate(date.getDate() + 7);
        return date;
    }
    return addMonthsClamped(date, planType === 'annual' ? 12 : 1);
}

/**
 * Add months, clamping to the last valid day of the target month.
 *
 * A bare `setMonth(getMonth() + 1)` OVERFLOWS on month-ends: Jan 31 + 1 month
 * becomes "Feb 31", which JS silently rolls forward to Mar 3 — so someone who
 * subscribed on the 31st was handed ~3 free days, and Feb 29 + 12 months landed
 * on Mar 1 instead of Feb 28. Setting the day to 1 before moving the month keeps
 * the arithmetic inside the intended month, then we clamp back.
 */
function addMonthsClamped(date, months) {
    const day = date.getDate();
    date.setDate(1);
    date.setMonth(date.getMonth() + months);
    const lastDayOfTargetMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    date.setDate(Math.min(day, lastDayOfTargetMonth));
    return date;
}

export class SubscriptionService {
    constructor() {
        this._supabase = null;
        this._connectionTested = false;
    }

    get supabase() {
        if (!this._supabase) {
            this._supabase = getSupabaseAdmin();
        }
        return this._supabase;
    }

    async testConnection() {
        if (this._connectionTested) return true;
        try {
            console.log('🧪 Checking subscription DB connection...');
            const { data, error } = await this.supabase
                .from('user_subscriptions')
                .select('count')
                .limit(1);

            if (error) {
                console.error(`❌ DB Connection failed: ${error.message}`);
                return false;
            }
            this._connectionTested = true;
            return true;
        } catch (error) {
            return false;
        }
    }

    /**
     * Get plan information for AI context
     */
    getPlanInfo(planType, subscriptionEndDate) {
        const plan = PLANS[planType?.toLowerCase()] || PLANS.free;
        const now = new Date();
        const isActive = subscriptionEndDate ? new Date(subscriptionEndDate) > now : true;

        return {
            planName: plan.name,
            planType: plan.id,
            status: isActive ? 'active' : 'expired',
            expiresAt: subscriptionEndDate || 'never'
        };
    }

    // throwOnError: callers that gate paid access (assertPaidAccess) pass true so a
    // TRANSIENT DB failure throws (→ they can fail OPEN) instead of being silently
    // mislabeled as "no subscription" / free, which would lock out a paying user.
    // Default stays false (return null on error) for the many lenient callers.
    async getUserSubscription(userId, { throwOnError = false } = {}) {
        if (!userId) return null;
        userId = userId.toLowerCase();
        try {
            const { data, error } = await this.supabase
                .from('user_subscriptions')
                .select('*')
                .ilike('user_id', userId)
                .order('updated_at', { ascending: false })
                .limit(1);

            if (error) throw error;
            return Array.isArray(data) && data.length > 0 ? data[0] : null;
        } catch (error) {
            console.error('Error in getUserSubscription:', error);
            if (throwOnError) throw error;
            return null;
        }
    }

    async isSubscriptionActive(userId) {
        // All users have full access — no subscription required.
        return true;
    }

    async isSubscriptionExpired(userId) {
        const subscription = await this.getUserSubscription(userId);
        if (!subscription) return false;
        
        // If it's not a free plan but the date has passed
        const planType = subscription.plan_type?.toLowerCase();
        if (planType === 'free' || planType === 'none') return false;

        if (!subscription.subscription_ends_at) return false;

        const now = new Date();
        const endDate = new Date(subscription.subscription_ends_at);
        return endDate < now;
    }

    // Paid-access gate for data API routes (Gmail, contacts, bulk processing).
    //
    // This used to read `isActive || planType === 'free' || ...`, which returned
    // TRUE FOR EVERY CALLER: getUserPlanType returns 'free' for expired subs,
    // invalid status, AND users with no subscription row — exactly the people the
    // gate exists to stop. So the `|| 'free'` arm made the whole expression
    // unconditionally true and the ~11 routes behind it were never paywalled.
    // There is no free tier (PLANS.free grants 0 of everything), so "free" must
    // mean NO access here.
    //
    // Semantics deliberately mirror assertPaidAccess() in lib/subscription-protection.js
    // (fail OPEN on infra error, never on a genuine 'free'), rather than inventing
    // a second, subtly different notion of "paid".
    async checkAccess(userId) {
        // All users have full access — no subscription required.
        return true;
    }

    /**
     * Determine plan type from Polar/Whop data
     */
    determinePlanType(data) {
        // 1. Check by exact Polar Product ID or Price ID (Most reliable)
        const productId = data.product_id || (typeof data.product === 'string' ? data.product : data.product?.id);
        const priceId = data.price_id || (typeof data.price === 'string' ? data.price : data.price?.id);

        console.log('🔍 [SERVICE] Detecting plan by IDs:', { productId, priceId });

        // Organization cross-check if available
        const orgId = data.organization_id || data.organization?.id;
        if (orgId && process.env.POLAR_ORGANIZATION_ID && orgId !== process.env.POLAR_ORGANIZATION_ID) {
            console.warn('⚠️ [SERVICE] Webhook organization ID mismatch:', { orgId, expected: process.env.POLAR_ORGANIZATION_ID });
        }

        if (productId === PLANS.weekly.polarProductId) {
            return 'weekly';
        }
        if (productId === PLANS.lifetime.polarProductId) {
            return 'lifetime';
        }
        if (productId === PLANS.annual.polarProductId || (PLANS.annual.polarPriceId && priceId === PLANS.annual.polarPriceId)) {
            return 'annual';
        }
        if (productId === PLANS.pro.polarProductId || (PLANS.pro.polarPriceId && priceId === PLANS.pro.polarPriceId)) {
            return 'pro';
        }

        // 2. Check by name (Fallback)
        const productName = (data.product?.name || data.product_name || '').toLowerCase();
        const priceName = (data.price?.name || data.price_name || '').toLowerCase();

        console.log('🔍 [SERVICE] Fallback to names:', { productName, priceName });

        if (productName.includes('lifetime') || priceName.includes('lifetime')) {
            return 'lifetime';
        }
        if (productName.includes('annual') || priceName.includes('annual') || productName.includes('yearly')) {
            return 'annual';
        }
        if (productName.includes('weekly') || priceName.includes('weekly') || productName.includes('week')) {
            return 'weekly';
        }
        if (productName.includes('pro') || priceName.includes('pro') || productName.includes('monthly')) {
            return 'pro';
        }
        // Legacy: starter/basic names map to pro
        if (productName.includes('starter') || priceName.includes('starter') || productName.includes('basic') || productName.includes('maily')) {
            return 'pro';
        }

        // 3. Check by price amount (Fallback)
        const priceAmount = data.price?.price_amount || data.amount || 0;
        if (priceAmount >= 40000) { // $400+ is Lifetime
            return 'lifetime';
        } else if (priceAmount >= 15000) { // $150+ is Annual
            return 'annual';
        } else if (priceAmount >= 2000) { // $20+ is Monthly/Pro
            return 'pro';
        } else if (priceAmount >= 500 && priceAmount <= 1200) { // ~$8.99 is Weekly
            // BANDED, not open-ended. An unbounded `>= 500` would sweep every
            // charge from $5.00–$19.99 into a full-access plan — e.g. a discounted
            // Monthly — where the old behaviour was to fall through to 'none' and
            // grant nothing. This fallback only fires when BOTH the product id and
            // the product name failed to match, so it must stay conservative:
            // misfiring grants unlimited access, while falling through to 'none'
            // is merely a support ticket.
            return 'weekly';
        }

        // Default to 'none' if we really don't know
        console.warn('⚠️ [SERVICE] Could not determine plan type, defaulting to none', {
            productId, priceId, productName, priceAmount
        });
        return 'none';
    }

    /**
     * Returns true if the user currently holds an active referral "free Pro"
     * grant (preferences.free_pro_until in the future). Used to elevate an
     * otherwise-free user to Pro without touching their real subscription row,
     * so it never conflicts with a Polar-paid subscription.
     */
    async hasActiveFreePro(userId) {
        try {
            const { data } = await this.supabase
                .from('user_profiles')
                .select('preferences')
                .ilike('user_id', userId)
                .maybeSingle();
            const until = data?.preferences?.free_pro_until;
            return !!until && new Date(until) > new Date();
        } catch {
            return false;
        }
    }

    async getUserPlanType(userId) {
        if (isOwnerEmail(userId)) return 'pro';

        // A live referral reward elevates an otherwise-free user to Pro.
        const fallbackPlan = (await this.hasActiveFreePro(userId)) ? 'pro' : 'free';

        const subscription = await this.getUserSubscription(userId);
        if (!subscription) {
            console.log(`📋 [PLAN] No subscription found for ${userId}, defaulting to ${fallbackPlan}`);
            return fallbackPlan;
        }

        // Status check
        const validStatuses = ['active', 'cancelled', 'trialing'];
        if (!validStatuses.includes(subscription.status)) {
            console.log(`📋 [PLAN] Invalid status '${subscription.status}' for ${userId}, defaulting to ${fallbackPlan}`);
            return fallbackPlan;
        }

        // Expiration check - ALWAYS check if end date exists
        if (subscription.subscription_ends_at) {
            const now = new Date();
            const endDate = new Date(subscription.subscription_ends_at);
            if (endDate <= now) {
                console.log(`📋 [PLAN] Subscription expired for ${userId} (ended ${subscription.subscription_ends_at}), defaulting to ${fallbackPlan}`);
                return fallbackPlan;
            }
        }

        let planType = subscription.plan_type?.toLowerCase();
        console.log(`📋 [PLAN] ${userId} | Raw plan_type: ${subscription.plan_type} | Status: ${subscription.status} | Ends: ${subscription.subscription_ends_at}`);
        const mapping = { 
            'starter': 'pro',      // Legacy starter → pro
            'pro': 'pro', 
            'professional': 'pro', 
            'premium': 'pro', 
            'basic': 'pro',        // Legacy basic → pro
            'weekly': 'weekly',
            'annual': 'annual',
            'yearly': 'annual',
            'lifetime': 'lifetime',
            'founder': 'lifetime',
            'free': 'free',
            'none': 'free',
            'unknown': 'free',
            '': 'free'
        };
        const normalized = mapping[planType] || planType || 'free';

        if (PLANS[normalized]) return normalized;
        
        // Fallback: search for keywords in plan_type if not direct match
        if (planType && typeof planType === 'string') {
            if (planType.includes('lifetime') || planType.includes('founder')) return 'lifetime';
            if (planType.includes('annual') || planType.includes('yearly')) return 'annual';
            if (planType.includes('weekly') || planType.includes('week')) return 'weekly';
            if (planType.includes('pro') || planType.includes('starter') || planType.includes('basic') || planType.includes('maily')) return 'pro';
        }

        return fallbackPlan;
    }

    async downgradeToFree(userId) {
        if (!userId) return null;
        userId = userId.toLowerCase();
        try {
            console.log(`📉 Downgrading ${userId} to Free plan (deleting subscription record)`);
            const { error } = await this.supabase
                .from('user_subscriptions')
                .delete()
                .ilike('user_id', userId);

            if (error) throw error;
            
            // Update user profile plan
            try {
                const { data: profile } = await this.supabase
                    .from('user_profiles')
                    .select('preferences')
                    .ilike('user_id', userId)
                    .maybeSingle();

                if (profile) {
                    const preferences = profile.preferences || {};
                    preferences.plan = 'free';
                    await this.supabase
                        .from('user_profiles')
                        .update({ preferences, updated_at: new Date().toISOString() })
                        .ilike('user_id', userId);
                }
            } catch (pErr) {
                console.error('Error updating profile plan for free:', pErr);
            }

            // Also reset usage to give them a fresh start on the free tier
            await this.resetAllFeatureUsage(userId, new Date(), null, true);
            
            return { success: true, plan: 'free' };
        } catch (error) {
            console.error('Error in downgradeToFree:', error);
            return null;
        }
    }

    async activateSubscription(userId, planType, subscriptionId = null, providerDates = null, paymentMethodInfo = null) {
        if (!userId) throw new Error('User ID is required');
        
        // If it's the free plan, we just want to clear any existing subscription record
        if (planType?.toLowerCase() === 'free') {
            return await this.downgradeToFree(userId);
        }

        userId = userId.toLowerCase();
        try {
            const plan = PLANS[planType];
            if (!plan) throw new Error(`Invalid plan type: ${planType}`);

            const existingSubscription = await this.getUserSubscription(userId);
            const isActive = existingSubscription && existingSubscription.status === 'active';
            const now = new Date();
            let isNewSubscription = true;

            const isWebhookRenewal = !!providerDates?.isRenewal;

            if (existingSubscription) {
                const existingEndDate = new Date(existingSubscription.subscription_ends_at);
                if (isWebhookRenewal || (isActive && existingEndDate > now)) {
                    isNewSubscription = false;
                }
            }

            let startDate = now;
            let endDate = applyDefaultPeriod(new Date(now), planType);

            if (providerDates) {
                if (providerDates.createdAt) {
                    const ts = Number(providerDates.createdAt);
                    if (!isNaN(ts) && ts > 0) startDate = new Date(ts * 1000);
                }
                if (providerDates.validUntil) {
                    const ts = Number(providerDates.validUntil);
                    if (!isNaN(ts) && ts > 0) endDate = new Date(ts * 1000);
                } else if (providerDates.expiresAt) {
                    const ts = Number(providerDates.expiresAt);
                    if (!isNaN(ts) && ts > 0) endDate = new Date(ts * 1000);
                }
            }

            if (isNaN(startDate.getTime())) startDate = now;
            if (isNaN(endDate.getTime())) {
                endDate = applyDefaultPeriod(new Date(startDate), planType);
            }

            const subscriptionData = {
                user_id: userId,
                whop_membership_id: subscriptionId,
                whop_product_id: plan.polarProductId || plan.whopProductId,
                plan_type: planType,
                plan_price: plan.price,
                subscription_started_at: startDate.toISOString(),
                // Lifetime is a one-time purchase — it never expires (null end).
                // Polar sends no period_end for it, which would otherwise default
                // to +1 month and silently downgrade the user after a month.
                subscription_ends_at: (planType === 'free' || planType === 'lifetime') ? null : endDate.toISOString(),
                // 'trialing' only when Polar explicitly says so (free-trial sub).
                // It's treated as active everywhere, so access is unchanged — it
                // just lets the UI show "Free trial" + a "Cancel free trial" action.
                status: providerDates?.isTrialing ? 'trialing' : 'active',
                updated_at: now.toISOString(),
                source: providerDates ? (providerDates.provider || 'Provider') : 'Calculated'
            };

            // Store payment method info if provided (from Polar webhook)
            if (paymentMethodInfo?.last4) {
                subscriptionData.payment_method_last4 = paymentMethodInfo.last4;
            }
            if (paymentMethodInfo?.brand) {
                subscriptionData.payment_method_brand = paymentMethodInfo.brand;
            }

            const { data, error } = await this.supabase
                .from('user_subscriptions')
                .upsert(subscriptionData, { onConflict: 'user_id', ignoreDuplicates: false })
                .select()
                .single();

            if (error) throw error;

            // Update user profile plan
            try {
                const { data: profile } = await this.supabase
                    .from('user_profiles')
                    .select('preferences')
                    .ilike('user_id', userId)
                    .maybeSingle();

                if (profile) {
                    const preferences = profile.preferences || {};
                    preferences.plan = planType;
                    
                    // Conversion Reward Logic for Referrals
                    if (isNewSubscription && planType !== 'free' && !preferences.conversion_rewarded) {
                        try {
                            const { data: userProfile } = await this.supabase
                                .from('user_profiles')
                                .select('invited_by')
                                .ilike('user_id', userId)
                                .maybeSingle();
                            
                            const inviterCode = userProfile?.invited_by;
                            // Payout now runs through lib/referrals, which looks the referrer
                            // up in the `referrals` table by the REFERRED user — not by
                            // guessing at the code with
                            //   .or(`username.ilike.${code},user_id.ilike.${code}@%`)
                            // That guess interpolated user input into a filter, could match
                            // the wrong account when two usernames shared a prefix, and paired
                            // with .maybeSingle(), which returns an ERROR rather than a row as
                            // soon as two profiles matched — silently dropping the reward.
                            // Idempotency also moved onto the referral row itself
                            // (rewarded_at), so a webhook replay cannot double-pay even if
                            // this profile flag is lost.
                            try {
                                const { rewardOnConversion } = await import('./referrals');
                                const rewardedReferrer = await rewardOnConversion(userId);
                                if (rewardedReferrer) {
                                    console.log(`🎁 Referral payout: ${rewardedReferrer} earned a free month because ${userId} converted`);
                                    try {
                                        const { sendReferralEarnedEmail } = await import('./email-service.js');
                                        sendReferralEarnedEmail({ toEmail: rewardedReferrer })
                                            .catch(e => console.warn('[referrals] earned-email failed:', e?.message));
                                    } catch { /* email is a nicety, never block the grant */ }
                                }
                            } catch (refErr) {
                                console.error('[referrals] payout failed:', refErr?.message);
                            }

                            if (inviterCode) {
                                preferences.conversion_rewarded = true; // legacy flag, kept for older rows
                            }
                        } catch (convErr) {
                            console.error('Error processing conversion rewards:', convErr);
                        }
                    }

                    await this.supabase
                        .from('user_profiles')
                        .update({ preferences, updated_at: now.toISOString() })
                        .ilike('user_id', userId);
                }
            } catch (pErr) {
                console.error('Error updating profile plan:', pErr);
            }

            await this.resetAllFeatureUsage(userId, startDate, endDate, isNewSubscription);
            return data;
        } catch (error) {
            console.error('Error in activateSubscription:', error);
            throw error;
        }
    }

    async cancelSubscription(userId) {
        if (!userId) return null;
        userId = userId.toLowerCase();
        try {
            const { data, error } = await this.supabase
                .from('user_subscriptions')
                .update({ status: 'cancelled', updated_at: new Date().toISOString() })
                .ilike('user_id', userId)
                .select();

            if (error) throw error;
            return Array.isArray(data) && data.length > 0 ? data[0] : null;
        } catch (error) {
            return null;
        }
    }

    async checkAndUpdateExpiredSubscriptions() {
        try {
            const now = new Date().toISOString();
            const { data, error } = await this.supabase
                .from('user_subscriptions')
                .update({ status: 'expired', updated_at: now })
                .eq('status', 'active')
                .lt('subscription_ends_at', now);

            return data;
        } catch (error) {
            return null;
        }
    }

    async resetAllFeatureUsage(userId, periodStart, periodEnd, isNewSubscription = true) {
        if (!isNewSubscription || !userId) return;
        userId = userId.toLowerCase();
        try {
            await this.supabase.from('user_feature_usage').delete().ilike('user_id', userId);
        } catch (error) {
            console.error('Error in resetAllFeatureUsage:', error);
        }
    }

    async getFeatureUsage(userId, featureType) {
        if (!userId) return { usage: 0, limit: 0, remaining: 0, hasAccess: false, planType: 'free' };
        userId = userId.toLowerCase();
        try {
            const subscription = await this.getUserSubscription(userId);
            const planType = await this.getUserPlanType(userId);
            const isActive = await this.isSubscriptionActive(userId);

            // For free tier, allow access even without a subscription record
            const isFree = planType === 'free';

            // For non-free tier, if subscription record is missing OR inactive, 
            // we let it fall through to the limits check which will handle the fallback
            // rather than a hard block that returns 0 credits.
            if (!isFree && (!subscription || !isActive)) {
                console.warn(`⚠️ [LIMITS] Subscription inactive for ${userId}. Falling back to standard limits.`);
                // We don't return early here, we let the planType determine the limits.
                // If planType was already downgraded to 'free' above, it will use free limits.
            }

            // ROBUST FALLBACK: If plan or limits are missing, always inherit from Free
            let plan = PLANS[planType] || PLANS.free;
            let featureLimits = plan?.limits[featureType] || PLANS.free.limits[featureType];

            // Safety net: hardcoded minimums if even PLANS.free is corrupted
            if (!featureLimits) {
                console.warn(`🚨 [LIMITS] Missing config for ${featureType}. Using hardcoded safety net.`);
                const safetyLimit = featureType === 'boult_ai' ? 50 : 10;
                featureLimits = { limit: safetyLimit, period: 'daily' };
            }

            // Fetch permanent bonus credits from profile preferences
            let bonusLimit = 0;
            try {
                const { data: profile } = await this.supabase
                    .from('user_profiles')
                    .select('preferences')
                    .ilike('user_id', userId)
                    .maybeSingle();
                
                if (profile?.preferences?.bonus_credits?.[featureType]) {
                    bonusLimit = Number(profile.preferences.bonus_credits[featureType]) || 0;
                }
            } catch (err) {
                console.warn('Error fetching bonus credits:', err);
            }

            const totalLimit = featureLimits.limit === -1 ? -1 : featureLimits.limit + bonusLimit;

            // If limit is 0 (and no bonus), the feature is not available on this plan
            if (totalLimit === 0) {
                return { usage: 0, limit: 0, remaining: 0, hasAccess: false, planType, period: featureLimits.period };
            }

            if (featureLimits.limit === -1) {
                return { usage: 0, limit: -1, remaining: -1, hasAccess: true, isUnlimited: true, planType, period: featureLimits.period };
            }

            const isDaily = featureLimits.period === 'daily';
            const today = new Date().toISOString().split('T')[0];

            let query = this.supabase
                .from('user_feature_usage')
                .select('id, usage_count, updated_at')
                .ilike('user_id', userId)
                .eq('feature_type', featureType);

            if (isDaily) {
                query = query.eq('last_reset_date', today);
                // For daily limits, the reset date is sufficient. 
                // We no longer strictly enforce period_start/end boundaries to avoid sync issues.
            } else {
                // Free users with no subscription record: use current month
                const monthStart = new Date();
                monthStart.setDate(1);
                query = query.gte('period_start', monthStart.toISOString().split('T')[0]);
            }

            // Use order and limit(1) instead of maybeSingle() to handle potential duplicates gracefully
            // Sorting by updated_at ensures we get the most recent record if duplicates exist
            const { data: usageRows, error: queryError } = await query
                .order('updated_at', { ascending: false })
                .limit(1);

            if (queryError) throw queryError;

            const row = usageRows?.[0];
            const usage = row?.usage_count || 0;

            // For unlimited plans (limit === -1), always grant access
            const isUnlimited = featureLimits.limit === -1;
            const remaining = isUnlimited ? -1 : Math.max(0, totalLimit - usage);
            const hasAccess = isUnlimited ? true : remaining > 0;

            return {
                id: row?.id,
                usage,
                limit: totalLimit,
                remaining,
                hasAccess,
                isUnlimited,
                period: featureLimits.period,
                planType,
                updatedAt: row?.updated_at,
            };
        } catch (error) {
            console.error('💥 [getFeatureUsage] CRITICAL ERROR for', userId, featureType, '=>', error);
            return { usage: 0, limit: 0, remaining: 0, hasAccess: false, planType: 'free' };
        }
    }

    async canUseFeature(userId, featureType) {
        if (!userId) {
            console.error('🔴 [CREDITS] Attempted to check credits without UserID');
            return false;
        }
        try {
            const usage = await this.getFeatureUsage(userId, featureType);
            const hasAccess = usage.hasAccess || usage.isUnlimited;
            
            console.log(`🔍 [CREDITS] ${userId} | ${featureType} | Usage: ${usage.usage}/${usage.limit} | isUnlimited: ${usage.isUnlimited} | hasAccess: ${usage.hasAccess} | FinalAccess: ${hasAccess} | Plan: ${usage.planType}`);
            
            if (!hasAccess) {
                console.error(`🚫 [CREDITS] BLOCKED: ${userId} | ${featureType} | Plan: ${usage.planType} | Limit: ${usage.limit} | Used: ${usage.usage}`);
            }
            
            if (!hasAccess && usage.limit === 0) {
                console.warn(`⚠️ [CREDITS] Feature ${featureType} might be misconfigured. Limit is 0 for plan ${usage.planType}`);
            }
            
            return hasAccess;
        } catch (error) {
            console.error(`💥 [CREDITS] Error checking feature access for ${userId} (${featureType}):`, error);
            return false;
        }
    }

    async incrementFeatureUsage(userId, featureType, runId = null) {
        if (!userId) return { success: false };
        userId = userId.toLowerCase();
        try {
            const currentUsage = await this.getFeatureUsage(userId, featureType);
            
            console.log(`🚀 [SERVICE] Incrementing ${featureType} for ${userId}. Current: ${currentUsage.usage}/${currentUsage.limit}`);

            if (currentUsage.isUnlimited) return { success: true, isUnlimited: true };
            if (!currentUsage.hasAccess) {
                console.error(`🔴 [SERVICE] Blocked increment: Limit reached for ${userId} (${featureType})`);
                return { success: false, error: 'Limit reached' };
            }

            // Idempotency: prevent rapid double-counting (within 3 seconds)
            const now = new Date();
            if (currentUsage.updatedAt) {
                const lastUsed = new Date(currentUsage.updatedAt);
                const diffSeconds = (now.getTime() - lastUsed.getTime()) / 1000;
                
                if (diffSeconds < 3 && !runId) {
                    console.log(`🛡️ [SERVICE] Throttling rapid increment for ${userId} : ${featureType} (RunID: ${runId})`);
                    return { success: true, newUsage: currentUsage.usage, throttled: true };
                }
            }

            const subscription = await this.getUserSubscription(userId);
            const plan = PLANS[currentUsage.planType] || PLANS.free;
            const featureLimits = plan.limits[featureType];

            if (!featureLimits) {
                console.error(`❌ [SERVICE] No feature limits found for ${featureType} on plan ${currentUsage.planType}`);
                return { success: false, error: 'Feature configuration error' };
            }

            const todayStr = now.toISOString().split('T')[0];
            let periodStart = todayStr;
            let periodEnd = todayStr;

            if (subscription) {
                periodStart = subscription.subscription_started_at.split('T')[0];
                periodEnd = subscription.subscription_ends_at.split('T')[0];
            } else {
                // Free tier
                const monthStart = new Date();
                monthStart.setDate(1);
                periodStart = monthStart.toISOString().split('T')[0];
                periodEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).toISOString().split('T')[0];
            }

            const newUsageCount = (currentUsage.usage || 0) + 1;

            const usageObj = {
                user_id: userId,
                feature_type: featureType,
                usage_count: newUsageCount,
                last_reset_date: todayStr,
                period_start: (featureLimits && featureLimits.period === 'daily') ? todayStr : periodStart,
                period_end: (featureLimits && featureLimits.period === 'daily') ? todayStr : periodEnd,
                updated_at: now.toISOString(),
            };

            let updateResult;
            if (currentUsage.id) {
                updateResult = await this.supabase
                    .from('user_feature_usage')
                    .update(usageObj)
                    .eq('id', currentUsage.id);
            } else {
                updateResult = await this.supabase
                    .from('user_feature_usage')
                    .upsert(usageObj, { onConflict: 'user_id,feature_type,period_start' });
            }

            if (updateResult.error) {
                console.error(`❌ [SERVICE] DB update failed for ${userId}:`, updateResult.error);
                throw updateResult.error;
            }

            console.log(`✅ [SERVICE] Usage incremented to ${newUsageCount} for ${userId} (${featureType})`);
            return { success: true, newUsage: newUsageCount };
        } catch (error) {
            console.error('Error in incrementFeatureUsage:', error);
            return { success: false, error: error.message };
        }
    }

    async decrementFeatureUsage(userId, featureType, amount) {
        if (!userId) return { success: false };
        userId = userId.toLowerCase();
        try {
            const currentUsage = await this.getFeatureUsage(userId, featureType);
            const todayStr = new Date().toISOString().split('T')[0];

            // If we have an existing row, we can just subtract from it
            if (currentUsage.id) {
                const { error } = await this.supabase
                    .from('user_feature_usage')
                    .update({ 
                        usage_count: Math.max(-1000000, currentUsage.usage - amount),
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', currentUsage.id);
                
                return { success: !error };
            }

            // If no row exists, we create one with negative usage (bonus credits for the period)
            const plan = PLANS[currentUsage.planType];
            const featureLimits = plan.limits[featureType];
            
            const usageObj = {
                user_id: userId,
                feature_type: featureType,
                usage_count: -amount,
                last_reset_date: todayStr,
                period_start: (featureLimits && featureLimits.period === 'daily') ? todayStr : todayStr, // Simplification
                period_end: (featureLimits && featureLimits.period === 'daily') ? todayStr : todayStr,
                updated_at: new Date().toISOString()
            };

            await this.supabase.from('user_feature_usage').upsert(usageObj, { onConflict: 'user_id,feature_type,period_start' });
            return { success: true };
        } catch (error) {
            console.error('Error in decrementFeatureUsage:', error);
            return { success: false };
        }
    }

    async getAllFeatureUsage(userId) {
        if (!userId) return { hasActiveSubscription: false, planType: 'free', features: {} };
        userId = userId.toLowerCase();

        // Owner emails always get Pro with real usage counts but unlimited limits
        if (isOwnerEmail(userId)) {
            const features = {};
            for (const featureType of Object.values(FEATURE_TYPES)) {
                try {
                    const usage = await this.getFeatureUsage(userId, featureType);
                    features[featureType] = { ...usage, isUnlimited: true, limit: -1, hasAccess: true };
                } catch {
                    features[featureType] = { usage: 0, limit: -1, remaining: -1, isUnlimited: true, hasAccess: true, period: 'daily', planType: 'pro' };
                }
            }
            return {
                hasActiveSubscription: true,
                planType: 'pro',
                subscriptionId: 'owner',
                subscriptionEndsAt: null,
                subscriptionStartedAt: null,
                daysRemaining: 9999,
                features,
            };
        }

        try {
            const subscription = await this.getUserSubscription(userId);
            const planType = await this.getUserPlanType(userId);
            const isActive = await this.isSubscriptionActive(userId);

            const features = {};
            for (const featureType of Object.values(FEATURE_TYPES)) {
                features[featureType] = await this.getFeatureUsage(userId, featureType);
            }

            return {
                hasActiveSubscription: isActive || planType === 'free',
                planType,
                subscriptionId: subscription?.whop_membership_id || subscription?.id || null,
                subscriptionEndsAt: subscription?.subscription_ends_at,
                subscriptionStartedAt: subscription?.subscription_started_at,
                status: subscription?.status || null,
                isTrialing: subscription?.status === 'trialing',
                daysRemaining: subscription ? this.getDaysRemaining(subscription.subscription_ends_at) : 0,
                paymentMethodLast4: subscription?.payment_method_last4 || null,
                paymentMethodBrand: subscription?.payment_method_brand || null,
                features
            };
        } catch (error) {
            return { hasActiveSubscription: false, planType: 'free', features: {} };
        }
    }

    getDaysRemaining(endDate) {
        if (!endDate) return 0;
        const now = new Date();
        const end = new Date(endDate);
        const diff = end - now;
        return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
    }

    async isSubscriptionEndingSoon(userId, daysThreshold = 3) {
        const subscription = await this.getUserSubscription(userId);
        if (!subscription || !await this.isSubscriptionActive(userId)) return false;
        const daysRemaining = this.getDaysRemaining(subscription.subscription_ends_at);
        return daysRemaining <= daysThreshold && daysRemaining > 0;
    }

    async logTokenUsage(userId, tokenCount) {
        if (!userId || !tokenCount) return;
        try {
            // We reuse the feature usage system but for tokens
            const { data: existing } = await this.supabase
                .from('user_feature_usage')
                .select('id, usage_count')
                .eq('user_id', userId.toLowerCase())
                .eq('feature_type', FEATURE_TYPES.OPENAI_TOKENS)
                .maybeSingle();

            if (existing) {
                await this.supabase
                    .from('user_feature_usage')
                    .update({ usage_count: (existing.usage_count || 0) + tokenCount, updated_at: new Date().toISOString() })
                    .eq('id', existing.id);
            } else {
                await this.supabase
                    .from('user_feature_usage')
                    .insert({
                        user_id: userId.toLowerCase(),
                        feature_type: FEATURE_TYPES.OPENAI_TOKENS,
                        usage_count: tokenCount,
                        period_start: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    });
            }
        } catch (e) {
            console.error('Error logging token usage:', e);
        }
    }

    async getRecentPayments(userId) {
        if (!userId) return [];
        userId = userId.toLowerCase();
        try {
            const subscription = await this.getUserSubscription(userId);
            if (!subscription || subscription.plan_type === 'free' || subscription.plan_type === 'none') {
                return [];
            }

            // Build payment entry from subscription record
            const payments = [];
            if (subscription.status === 'active' || subscription.status === 'cancelled') {
                const last4 = subscription.payment_method_last4;
                const brand = subscription.payment_method_brand;
                payments.push({
                    id: subscription.id,
                    date: subscription.subscription_started_at || subscription.created_at,
                    amount: subscription.plan_price || 0,
                    method: last4 ? `${(brand || 'card').charAt(0).toUpperCase() + (brand || 'card').slice(1)} ending in ${last4}` : null,
                    last4: last4 || null,
                    brand: brand || null,
                    status: 'paid',
                    planType: subscription.plan_type
                });
            }
            return payments;
        } catch (error) {
            console.error('Error in getRecentPayments:', error);
            return [];
        }
    }

    async getInvoices(userId) {
        if (!userId) return [];
        userId = userId.toLowerCase();
        try {
            const subscription = await this.getUserSubscription(userId);
            if (!subscription || subscription.plan_type === 'free' || subscription.plan_type === 'none') {
                return [];
            }

            // Build invoice from subscription data
            const invoices = [];
            if (subscription.plan_price && subscription.plan_price > 0) {
                invoices.push({
                    id: subscription.id,
                    number: `INV-${(subscription.whop_membership_id || subscription.id || '').slice(-8).toUpperCase()}`,
                    date: subscription.subscription_started_at || subscription.created_at,
                    amount: subscription.plan_price,
                    status: 'paid',
                    planType: subscription.plan_type
                });
            }
            return invoices;
        } catch (error) {
            console.error('Error in getInvoices:', error);
            return [];
        }
    }

    validateWebhookSignature(payload, headers, secret) {
        try {
            if (!secret || !headers) return false;
            const webhookId = headers['webhook-id'];
            const webhookTimestamp = headers['webhook-timestamp'];
            const webhookSignature = headers['webhook-signature'];

            if (!webhookId || !webhookTimestamp || !webhookSignature) return false;

            let key = secret.trim();
            if (key.startsWith('polar_whs_')) key = key.slice('polar_whs_'.length);
            else if (key.startsWith('whsec_')) key = key.slice('whsec_'.length);

            const keyBytes = Buffer.from(key, 'base64');
            const toSign = `${webhookId}.${webhookTimestamp}.${payload}`;
            const expected = crypto.createHmac('sha256', keyBytes).update(toSign).digest('base64');

            const candidates = String(webhookSignature).split(' ').map(s => s.trim()).filter(Boolean);
            for (const candidate of candidates) {
                const [version, sig] = candidate.split(',', 2);
                if (version === 'v1' && sig === expected) return true;
            }
            return false;
        } catch (e) {
            return false;
        }
    }
}

export const subscriptionService = new SubscriptionService();
