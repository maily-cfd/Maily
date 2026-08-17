"use client";

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Sparkles, Crown, ArrowRight, AlertCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';

interface UsageLimitModalProps {
    isOpen: boolean;
    onClose: () => void;
    featureName: string;
    currentUsage: number;
    limit: number;
    period: 'daily' | 'monthly';
    currentPlan?: 'free' | 'starter' | 'pro' | 'annual' | 'lifetime' | 'none';
}

export function UsageLimitModal({
    isOpen,
    onClose,
    featureName,
    currentUsage,
    limit,
    period,
    currentPlan = 'free'
}: UsageLimitModalProps) {
    const router = useRouter();

    const handleUpgrade = () => {
        onClose();
        router.push('/pricing');
    };

    const periodText = period === 'daily' ? 'today' : 'this month';
    const resetText = period === 'daily' ? 'at midnight' : (currentPlan === 'free' ? 'at the start of next month' : 'when your subscription renews');

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[2000]"
                        onClick={onClose}
                    />

                    {/* Modal */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 20 }}
                        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                        className="fixed inset-0 flex items-center justify-center z-[2000] p-4 md:p-8 overflow-y-auto"
                        onClick={(e: React.MouseEvent) => e.stopPropagation()}
                    >
                        <div className="bg-white dark:bg-[#0a0a0a] border border-neutral-200 dark:border-white/10 rounded-[2.5rem] w-full max-w-md flex flex-col shadow-[0_32px_128px_-16px_rgba(0,0,0,0.8)]">
                            {/* Header with gradient */}
                            <div className="relative bg-gradient-to-br from-orange-500/20 via-red-500/10 to-transparent p-6 pb-0">
                                <button
                                    onClick={onClose}
                                    className="absolute top-4 right-4 p-2 rounded-full bg-black/5 hover:bg-black/10 dark:bg-white/10 transition-colors"
                                >
                                    <X className="w-4 h-4 text-black dark:text-white/60" />
                                </button>

                                <div className="flex items-center gap-3 mb-4">
                                    <div className="w-12 h-12 rounded-2xl bg-orange-500/20 flex items-center justify-center">
                                        <AlertCircle className="w-6 h-6 text-orange-400" />
                                    </div>
                                    <div>
                                        <h3 className="text-lg font-semibold text-black dark:text-white">Usage Limit Reached</h3>
                                        <p className="text-sm text-black dark:text-white/50">{featureName}</p>
                                    </div>
                                </div>
                            </div>

                            {/* Content */}
                            <div className="p-6 space-y-6">
                                <div className="text-center space-y-2">
                                    <p className="text-black dark:text-white font-medium text-lg leading-relaxed">
                                        Sorry, but you've exhausted all the credits {period === 'daily' ? 'of the day' : 'of the month'}.
                                    </p>
                                    <p className="text-sm text-black dark:text-white/40">
                                        Your {featureName.toLowerCase()} credits will reset {resetText}.
                                    </p>
                                </div>

                                {/* Usage indicator */}
                                <div className="bg-black/5 dark:bg-white/5 rounded-2xl p-4">
                                    <div className="flex justify-between text-sm mb-2">
                                        <span className="text-black dark:text-white/50">Credits</span>
                                        <span className="text-black dark:text-white/80">{limit - currentUsage} remaining</span>
                                    </div>
                                    <div className="h-2 bg-black/10 dark:bg-white/10 rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-gradient-to-r from-orange-500 to-red-500 rounded-full"
                                            style={{ width: `${((limit - currentUsage) / limit) * 100}%` }}
                                        />
                                    </div>
                                </div>

                                {/* Upgrade CTA */}
                                {currentPlan !== 'pro' && (
                                    <div className="space-y-4">
                                        <div className="h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

                                        <div className="bg-gradient-to-br from-white/5 to-transparent rounded-2xl p-4 border border-neutral-200 dark:border-white/5">
                                            <div className="flex items-center gap-3 mb-3">
                                                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
                                                    <Crown className="w-5 h-5 text-black dark:text-white" />
                                                </div>
                                                <div>
                                                    <h4 className="font-medium text-black dark:text-white">
                                                        Subscribe Now
                                                    </h4>
                                                    <p className="text-xs text-black dark:text-white/50">
                                                        {currentPlan === 'free' || currentPlan === 'none' ? 'Get unlimited AI credits starting at $29/mo' : 'Unlimited access to all features'}
                                                    </p>
                                                </div>
                                            </div>

                                            <ul className="space-y-2 mb-4">
                                                {[
                                                    'Unlimited Draft Replies',
                                                    'Unlimited Boult AI Access',
                                                    'Unlimited Schedule Calls',
                                                    'Full Sift email triage'
                                                ].map((feature) => (
                                                    <li key={feature} className="flex items-center gap-2 text-sm text-black dark:text-white/60">
                                                        <Sparkles className="w-3 h-3 text-purple-400" />
                                                        {feature}
                                                    </li>
                                                ))}
                                            </ul>

                                            <button
                                                onClick={handleUpgrade}
                                                className="w-full py-3 bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-black dark:text-white font-semibold rounded-xl flex items-center justify-center gap-2 transition-all group"
                                            >
                                                {currentPlan === 'free' || currentPlan === 'none' ? 'View Plans' : 'Subscribe Now'}
                                                <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}

// Hook for checking feature usage before performing actions
export function useFeatureUsage() {
    const [showLimitModal, setShowLimitModal] = React.useState(false);
    const [limitModalData, setLimitModalData] = React.useState<{
        featureName: string;
        currentUsage: number;
        limit: number;
        period: 'daily' | 'monthly';
        currentPlan: 'free' | 'starter' | 'pro' | 'annual' | 'lifetime' | 'none';
    } | null>(null);

    const checkAndUseFeature = async (
        featureType: string,
        featureName: string
    ): Promise<{ canUse: boolean; isUnlimited?: boolean }> => {
        try {
            const response = await fetch('/api/subscription/usage', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ featureType, increment: false })
            });

            const data = await response.json();

            if (!data.success) {
                return { canUse: false };
            }

            if (data.isUnlimited) {
                return { canUse: true, isUnlimited: true };
            }

            if (!data.canUse) {
                // Show limit modal
                setLimitModalData({
                    featureName,
                    currentUsage: data.usage,
                    limit: data.limit,
                    period: data.period,
                    currentPlan: data.planType || 'starter'
                });
                setShowLimitModal(true);
                return { canUse: false };
            }

            return { canUse: true };
        } catch (error) {
            console.error('Error checking feature usage:', error);
            return { canUse: true }; // Allow on error to not block user
        }
    };

    const incrementUsage = async (featureType: string): Promise<boolean> => {
        try {
            const response = await fetch('/api/subscription/usage', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ featureType, increment: true })
            });

            const data = await response.json();
            return data.success;
        } catch (error) {
            console.error('Error incrementing usage:', error);
            return false;
        }
    };

    const closeModal = () => setShowLimitModal(false);

    return {
        showLimitModal,
        limitModalData,
        checkAndUseFeature,
        incrementUsage,
        closeModal,
        LimitModal: limitModalData ? (
            <UsageLimitModal
                isOpen={showLimitModal}
                onClose={closeModal}
                {...limitModalData}
            />
        ) : null
    };
}

export default UsageLimitModal;
