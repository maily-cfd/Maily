"use client";

import React, { useEffect, useState, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { CheckCircle, Sparkles, ArrowRight, Loader2, RefreshCw, Shield } from 'lucide-react';
import confetti from 'canvas-confetti';

function PaymentSuccessContent() {
    const router = useRouter();
    const [isActivating, setIsActivating] = useState(true);
    const [planName, setPlanName] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [retryCount, setRetryCount] = useState(0);
    const [showRetryMessage, setShowRetryMessage] = useState(false);
    const [isVerifyingWithPolar, setIsVerifyingWithPolar] = useState(false);
    const [verificationMessage, setVerificationMessage] = useState<string | null>(null);

    // Maximum retries and timing configuration
    const MAX_RETRIES = 15; // 15 retries x 2 seconds = 30 seconds max wait
    const RETRY_INTERVAL = 2000; // 2 seconds between retries
    const INITIAL_DELAY = 1500; // 1.5 seconds initial delay

    const celebrateSuccess = (plan: string) => {
        setPlanName(plan === 'pro' ? 'Pro' : 'Starter');
        setIsActivating(false);
        setShowRetryMessage(false);
        setError(null);

        // Celebrate!
        confetti({
            particleCount: 150,
            spread: 70,
            origin: { y: 0.6 },
            colors: ['#ffffff', '#a855f7', '#6366f1']
        });

        // Return the user to where they started checkout (e.g. their onboarding
        // step) if we stored one; otherwise the dashboard. Read it BEFORE the
        // 3s delay so a late localStorage clear can't wipe it.
        let dest = '/home-feed';
        try {
            const ret = localStorage.getItem('maily_checkout_return');
            if (ret) dest = ret;
            localStorage.removeItem('maily_checkout_return');
            localStorage.setItem('onboarding_completed', 'true');
        } catch { /* */ }
        setTimeout(() => {
            router.push(dest);
        }, 3000);
    };

    useEffect(() => {
        // Clear any stale localStorage data
        localStorage.removeItem('pending_plan');
        localStorage.removeItem('pending_plan_timestamp');

        let currentRetry = 0;
        let timeoutId: NodeJS.Timeout;

        const checkSubscriptionStatus = async () => {
            try {
                console.log(`🔄 Checking subscription status (attempt ${currentRetry + 1}/${MAX_RETRIES})...`);

                // SECURITY FIX: Check subscription status from server
                const response = await fetch('/api/subscription/status');
                if (!response.ok) {
                    throw new Error('Failed to check subscription status');
                }

                const data = await response.json();

                // STRICT: `hasActiveSubscription` is polluted (true for free
                // users) and must NOT grant access. Activation is confirmed only
                // by a real paid/trial plan type that hasn't expired — same gate
                // the home feed uses. This is what stops a checkout-visitor who
                // never paid from being celebrated through to the app.
                const planType: string | undefined = data.subscription?.planType;
                const isExpired: boolean = !!data.subscription?.isExpired;
                const isPaidPlan = !!planType && planType !== 'free' && planType !== 'none' && !isExpired;

                if (isPaidPlan) {
                    // Mark this tab as durably allowed so the home feed reveals
                    // instantly without re-running its own verification race.
                    try { localStorage.setItem('maily_access_ok', String(Date.now())); sessionStorage.removeItem('maily_access_denied'); } catch { /* */ }
                    celebrateSuccess(planType!);
                } else {
                    // Subscription not yet active - webhook may be delayed
                    currentRetry++;
                    setRetryCount(currentRetry);

                    // If we've tried 3 times and still nothing, try direct verification automatically
                    if (currentRetry === 3) {
                        console.log('⚡ Proactive check: Triggering direct verification...');
                        handleVerifyWithPolar();
                    }

                    if (currentRetry >= MAX_RETRIES) {
                        // Max retries reached - show helpful message instead of error
                        console.log('⚠️ Max retries reached, showing verification options...');
                        setShowRetryMessage(true);
                        setIsActivating(false);
                    } else {
                        // Wait a bit and retry
                        console.log(`⏳ Subscription not yet active, retrying in ${RETRY_INTERVAL / 1000}s... (${currentRetry}/${MAX_RETRIES})`);
                        timeoutId = setTimeout(checkSubscriptionStatus, RETRY_INTERVAL);
                    }
                }

            } catch (err) {
                console.error('Error checking subscription status:', err);
                setError('There was an issue verifying your subscription. Please try verifying with Polar below.');
                setIsActivating(false);
                setShowRetryMessage(true);
            }
        };

        // Start checking after a brief delay to give webhook time to process
        timeoutId = setTimeout(checkSubscriptionStatus, INITIAL_DELAY);

        // Cleanup timeout on unmount
        return () => {
            if (timeoutId) clearTimeout(timeoutId);
        };
    }, [router]);

    // Handler to verify directly with Polar API
    const handleVerifyWithPolar = async () => {
        setIsVerifyingWithPolar(true);
        setVerificationMessage(null);

        try {
            console.log('🔍 Verifying payment directly with Polar...');

            const response = await fetch('/api/subscription/verify', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            const data = await response.json();

            const vPlan: string | undefined = data?.subscription?.planType;
            const vPaid = !!vPlan && vPlan !== 'free' && vPlan !== 'none';
            if (response.ok && data.success && vPaid) {
                // Success! Polar confirmed a real paid/trial subscription.
                console.log('✅ Polar verification successful!');
                try { localStorage.setItem('maily_access_ok', String(Date.now())); sessionStorage.removeItem('maily_access_denied'); } catch { /* */ }
                celebrateSuccess(vPlan!);
            } else if (response.ok && data.success && !vPaid) {
                // Reconciled, but no paid plan — do not grant access.
                setVerificationMessage('No active paid subscription was found on your account. If you just paid, give it a moment and try again, or contact support.');
            } else if (response.status === 404) {
                // No valid subscription found in Whop
                setVerificationMessage(data.suggestion || 'No valid subscription found. Please ensure your payment was completed.');
            } else if (response.status === 503) {
                // Polar API not configured
                setVerificationMessage('Payment verification is temporarily unavailable. Please contact support.');
            } else {
                setVerificationMessage(data.error || 'Verification failed. Please contact support.');
            }
        } catch (err) {
            console.error('Error verifying with Polar:', err);
            setVerificationMessage('Unable to verify payment. Please contact support.');
        } finally {
            setIsVerifyingWithPolar(false);
        }
    };

    // Handler to manually retry subscription check
    const handleManualRetry = () => {
        setShowRetryMessage(false);
        setIsActivating(true);
        setRetryCount(0);
        setVerificationMessage(null);

        // Trigger a fresh check
        const checkAgain = async () => {
            try {
                const response = await fetch('/api/subscription/status');
                if (response.ok) {
                    const data = await response.json();
                    // STRICT: use planType check, not the polluted hasActiveSubscription flag
                    const pt = data.subscription?.planType;
                    const isPaid = !!pt && pt !== 'free' && pt !== 'none' && !data.subscription?.isExpired;
                    if (isPaid) {
                        celebrateSuccess(pt);
                        return;
                    }
                }
                // Still not active, show message again
                setShowRetryMessage(true);
                setIsActivating(false);
            } catch (err) {
                setError('There was an issue verifying your subscription. Please contact support.');
                setIsActivating(false);
            }
        };

        setTimeout(checkAgain, 1000);
    };

    return (
        <div className="min-h-screen bg-black flex items-center justify-center p-6">
            <div className="absolute inset-0 overflow-hidden">
                <div className="absolute -top-40 -right-40 w-80 h-80 bg-purple-500/10 rounded-full blur-3xl" />
                <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-violet-500/10 rounded-full blur-3xl" />
            </div>

            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="relative z-10 max-w-md w-full"
            >
                <div className="bg-[#0a0a0a] border border-white/10 rounded-3xl p-8 text-center">
                    {isActivating ? (
                        <>
                            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-purple-500/20 flex items-center justify-center">
                                <Loader2 className="w-8 h-8 text-purple-400 animate-spin" />
                            </div>
                            <h1 className="text-2xl font-bold text-white mb-2">Activating Your Plan</h1>
                            <p className="text-white/60 mb-4">Please wait while we verify your subscription...</p>
                            {retryCount > 0 && (
                                <div className="space-y-2">
                                    <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-purple-500 transition-all duration-500"
                                            style={{ width: `${Math.min((retryCount / MAX_RETRIES) * 100, 100)}%` }}
                                        />
                                    </div>
                                    <p className="text-white/40 text-xs">Verifying payment... ({retryCount}/{MAX_RETRIES})</p>
                                </div>
                            )}
                        </>
                    ) : showRetryMessage ? (
                        <>
                            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-yellow-500/20 flex items-center justify-center">
                                <span className="text-3xl">⏳</span>
                            </div>
                            <h1 className="text-2xl font-bold text-white mb-2">Almost There!</h1>
                            <p className="text-white/60 mb-6">
                                Your payment was likely received, but we're having trouble confirming it automatically.
                                Click below to verify directly with Polar.
                            </p>

                            {verificationMessage && (
                                <div className="mb-4 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-xl">
                                    <p className="text-yellow-400/90 text-sm">{verificationMessage}</p>
                                </div>
                            )}

                            <div className="space-y-3">
                                {/* Primary action - verify with Polar */}
                                <button
                                    onClick={handleVerifyWithPolar}
                                    disabled={isVerifyingWithPolar}
                                    className="w-full py-3 bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white font-semibold rounded-xl flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                                >
                                    {isVerifyingWithPolar ? (
                                        <>
                                            <Loader2 className="w-4 h-4 animate-spin mr-2" />
                                            Verifying with Polar...
                                        </>
                                    ) : (
                                        <>
                                            <Shield className="w-4 h-4" />
                                            Verify My Payment
                                        </>
                                    )}
                                </button>

                                {/* Secondary action - simple retry */}
                                <button
                                    onClick={handleManualRetry}
                                    className="w-full py-3 bg-white/10 hover:bg-white/20 text-white rounded-xl flex items-center justify-center gap-2 transition-colors"
                                >
                                    <RefreshCw className="w-4 h-4" />
                                    Try Again
                                </button>

                                {/* Removed: "Go to Dashboard Anyway" — this was a direct
                                   paywall bypass. Unpaid users must verify payment or
                                   contact support; they cannot skip into the app. */}

                                <p className="text-white/40 text-xs pt-2">
                                    Need help? Contact us at{' '}
                                    <a href="mailto:support.maily@gmail.com" className="text-purple-400 hover:underline">
                                        support.maily@gmail.com
                                    </a>
                                </p>
                            </div>
                        </>
                    ) : error ? (
                        <>
                            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-red-500/20 flex items-center justify-center">
                                <span className="text-3xl">⚠️</span>
                            </div>
                            <h1 className="text-2xl font-bold text-white mb-2">Oops!</h1>
                            <p className="text-white/60 mb-6">{error}</p>
                            <div className="space-y-3">
                                <button
                                    onClick={handleVerifyWithPolar}
                                    disabled={isVerifyingWithPolar}
                                    className="w-full py-3 bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white font-semibold rounded-xl flex items-center justify-center gap-2 transition-all"
                                >
                                    <Shield className="w-4 h-4" />
                                    Verify My Payment
                                </button>
                                <button
                                    onClick={() => router.push('/pricing')}
                                    className="w-full py-3 bg-white/10 hover:bg-white/20 text-white rounded-xl transition-colors"
                                >
                                    Go to Pricing
                                </button>
                            </div>
                        </>
                    ) : (
                        <>
                            <motion.div
                                initial={{ scale: 0 }}
                                animate={{ scale: 1 }}
                                transition={{ type: "spring", delay: 0.2 }}
                                className="w-20 h-20 mx-auto mb-6 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center"
                            >
                                <CheckCircle className="w-10 h-10 text-white" />
                            </motion.div>
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                transition={{ delay: 0.3 }}
                            >
                                <h1 className="text-3xl font-bold text-white mb-2 flex items-center justify-center gap-2">
                                    <Sparkles className="w-6 h-6 text-yellow-400" />
                                    Welcome to {planName}!
                                </h1>
                                <p className="text-white/60 mb-8">
                                    Your subscription is now active. Enjoy all premium features!
                                </p>
                                <button
                                    onClick={() => router.push('/home-feed')}
                                    className="w-full py-3 bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white font-semibold rounded-xl flex items-center justify-center gap-2 transition-all group"
                                >
                                    Go to Dashboard
                                    <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                                </button>
                            </motion.div>
                        </>
                    )}
                </div>
            </motion.div>
        </div>
    );
}

export default function PaymentSuccessPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen bg-black flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-purple-400 animate-spin" />
            </div>
        }>
            <PaymentSuccessContent />
        </Suspense>
    );
}
