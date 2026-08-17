import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth.js';
import { subscriptionService, FEATURE_TYPES } from '@/lib/subscription-service.js';
import { DatabaseService } from '@/lib/supabase.js';
import { logEvent } from "@/lib/logsso";

export async function POST(request) {
    try {
        const session = await auth();
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const { rewardId } = body;

        if (!rewardId) {
            return NextResponse.json({ error: 'Reward ID is required' }, { status: 400 });
        }

        const userId = session.user.email.toLowerCase();
        const db = new DatabaseService();

        // Check if reward was already claimed
        const profile = await db.getUserProfile(userId);
        const preferences = profile?.preferences || {};
        const claimedRewards = preferences.claimed_rewards || [];

        if (claimedRewards.includes(rewardId)) {
            return NextResponse.json({ error: 'Reward already claimed' }, { status: 400 });
        }

        // Define reward amounts
        const REWARDS = {
            'referral_bonus_25': { amount: 25, feature: FEATURE_TYPES.BOULT_AI },
            'welcome_bonus_10': { amount: 10, feature: FEATURE_TYPES.BOULT_AI },
            'welcome_bonus_slot': { amount: 10, feature: FEATURE_TYPES.BOULT_AI }, // Generic slot
        };

        let rewardConfig = REWARDS[rewardId];
        
        // Handle referral slots dynamically
        if (rewardId.startsWith('referral_bonus_slot_')) {
            rewardConfig = { amount: 50, feature: FEATURE_TYPES.BOULT_AI };
        }

        if (!rewardConfig) {
            return NextResponse.json({ error: 'Invalid reward ID' }, { status: 400 });
        }

        // Apply reward: Permanent Limit Increase
        const bonusCredits = preferences.bonus_credits || {};
        const currentBonus = bonusCredits[rewardConfig.feature] || 0;
        bonusCredits[rewardConfig.feature] = currentBonus + rewardConfig.amount;
        
        preferences.bonus_credits = bonusCredits;
        preferences.claimed_rewards = [...claimedRewards, rewardId];

        // Update profile in DB
        const { error: updateError } = await db.supabase
            .from('user_profiles')
            .update({ preferences, updated_at: new Date().toISOString() })
            .ilike('user_id', userId);

        if (updateError) {
            console.error('Error updating profile with reward:', updateError);
            return NextResponse.json({ error: 'Failed to apply reward to account' }, { status: 500 });
        }

        // Return new status
        const usage = await subscriptionService.getFeatureUsage(userId, rewardConfig.feature);

        return NextResponse.json({ 
            success: true, 
            message: `Successfully claimed ${rewardConfig.amount} credits`,
            newTotalLimit: usage.limit,
            newTotalRemaining: usage.remaining
        });

    } catch (error) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(error) });
        console.error('Error claiming reward:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

export async function GET() {
    try {
        const session = await auth();
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const userId = session.user.email.toLowerCase();
        const db = new DatabaseService();
        const profile = await db.getUserProfile(userId);
        const preferences = profile?.preferences || {};
        const claimed = preferences.claimed_rewards || [];
        const inviteCount = profile?.invite_count || 0;

        // Dynamic rewards list
        const rewards = [
            { 
                id: 'standard', 
                title: "Standard Credit Pack", 
                value: `Status: Active`, 
                desc: "Your baseline daily allowance enabled by default.", 
                icon: 'CreditCard', 
                status: 'claimed' 
            }
        ];

        // 1. Welcome Bonus - Available if never claimed
        if (!claimed.includes('welcome_bonus_10')) {
            rewards.push({
                id: 'welcome_bonus_10',
                title: "Welcome Gift",
                value: "+10 Boult Credits",
                desc: "One-time account creation gift.",
                icon: 'Gift',
                status: 'available'
            });
        }

        // 2. Referral Rewards - Based on real counts
        // If they have invites, check if they claimed the bonuses
        const totalReferralBonus = inviteCount * 50; 
        if (inviteCount > 0) {
            // Check if they already claimed the slots for these invites
            // We'll use a dynamic ID like 'referral_bonus_slot_1'
            for (let i = 1; i <= inviteCount; i++) {
                const slotId = `referral_bonus_slot_${i}`;
                if (!claimed.includes(slotId)) {
                    rewards.push({
                        id: slotId,
                        title: `Referral Bonus #${i}`,
                        value: "+50 Boult Credits",
                        desc: `Reward for your ${i}${i === 1 ? 'st' : i === 2 ? 'nd' : i === 3 ? 'rd' : 'th'} successful invite.`,
                        icon: 'Sparkles',
                        status: 'available'
                    });
                }
            }
        }

        // Include some claimed history for UI
        claimed.forEach(rid => {
            if (rid === 'welcome_bonus_10') {
                rewards.push({ id: rid, title: "Welcome Gift", value: "+10 Boult Credits", desc: "First-time account gift.", icon: 'Gift', status: 'claimed' });
            } else if (rid.startsWith('referral_bonus_slot_')) {
                const idx = rid.split('_').pop();
                rewards.push({ id: rid, title: `Referral Bonus #${idx}`, value: "+50 Boult Credits", desc: "Successfully claimed.", icon: 'Sparkles', status: 'claimed' });
            }
        });

        // Dedup and sort
        const seen = new Set();
        const finalRewards = rewards.filter(r => {
            if (seen.has(r.id)) return false;
            seen.add(r.id);
            return true;
        });

        return NextResponse.json({ rewards: finalRewards });

    } catch (error) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(error) });
        console.error('Error fetching rewards list:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
