'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Zap, Sparkles, Copy, Check, Link2, Loader2, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';

interface RewardsCardProps {
    onClose: () => void;
    usageData: {
        planType: 'free' | 'starter' | 'pro' | 'none';
        features: Record<string, { usage: number; limit: number; remaining: number; isUnlimited: boolean; period: string }>;
    };
}

export function RewardsCard({ onClose, usageData }: RewardsCardProps) {
    const [copied, setCopied] = useState(false);
    const [profile, setProfile] = useState<any>(null);
    const [isLoading, setIsLoading] = useState(true);

    // The referral code comes from /api/referrals/me — the SAME source the
    // /referrals page uses. This card used to build its link from
    // `profile.username || email.split('@')[0]`, which is a guess at an
    // identifier rather than a real code; once attribution moved to the
    // referral_codes table those links resolved to nobody, so every invite
    // shared from this card paid out nothing. One source of truth now.
    const [referral, setReferral] = useState<any>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const [profRes, refRes] = await Promise.all([
                    fetch('/api/user/profile'),
                    fetch('/api/referrals/me'),
                ]);
                if (cancelled) return;
                if (profRes.ok) setProfile(await profRes.json());
                if (refRes.ok) setReferral(await refRes.json());
            } catch (err) {
                console.error('Error fetching referral data:', err);
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, []);

    const inviteLink: string = referral?.link || '';

    const handleCopyLink = () => {
        if (!inviteLink) {
            toast.error('Your invite link isn’t ready yet — try again in a moment');
            return;
        }
        navigator.clipboard.writeText(inviteLink);
        setCopied(true);
        toast.success('Invite link copied');
        setTimeout(() => setCopied(false), 2000);
    };

    // Display form: strip the scheme so the pill reads cleanly.
    const referralUrl = inviteLink.replace(/^https?:\/\//, '');

    const freeProUntil = referral?.freeUntil
        ? new Date(referral.freeUntil)
        : (profile?.free_pro_until ? new Date(profile.free_pro_until) : null);
    const freeProActive = !!freeProUntil && freeProUntil > new Date();
    const conversions = referral?.converted ?? profile?.conversion_count ?? 0;

    const steps = [
        { icon: Link2, text: "Share your invite link", bold: "" },
        { icon: Sparkles, text: "A friend signs up", bold: "free" },
        { icon: Zap, text: "When they upgrade to Pro, you get", bold: "1 month of Pro, free" },
        { icon: Zap, text: "It", bold: "stacks", extra: " — every conversion adds another free month" },
    ];

    return (
        <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md overflow-y-auto"
            onClick={onClose}
        >
            <motion.div 
                initial={{ scale: 0.95, y: 20, opacity: 0 }}
                animate={{ scale: 1, y: 0, opacity: 1 }}
                exit={{ scale: 0.95, y: 20, opacity: 0 }}
                className="w-full max-w-[480px] bg-white dark:bg-[#0E0E0E] md:rounded-[24px] rounded-t-[24px] shadow-[0_32px_128px_-12px_rgba(0,0,0,0.8)] overflow-hidden border border-neutral-200 dark:border-white/10 flex flex-col max-h-[90vh] md:max-h-none overflow-y-auto md:overflow-y-visible"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Hero Section */}
                <div className="relative h-56 bg-neutral-50 dark:bg-[#0E0E0E] p-8 flex flex-col justify-end overflow-hidden group">
                    {/* Visual Element (Premium Glassy Cube) */}
                    <div className="absolute top-0 right-0 w-80 h-full pointer-events-none opacity-80 transition-transform duration-700 group-hover:scale-105">
                        <img 
                            src="/maily_cube.png" 
                            className="w-full h-full object-cover scale-[1.7] translate-x-12 translate-y-2 rotate-[-12deg] brightness-110 dark:brightness-100"
                            style={{ 
                                maskImage: 'radial-gradient(circle at 65% 50%, black 10%, transparent 80%), linear-gradient(to right, transparent, black 40%)',
                                WebkitMaskImage: 'radial-gradient(circle at 65% 50%, black 10%, transparent 80%), linear-gradient(to right, transparent, black 40%)',
                                maskComposite: 'intersect',
                                WebkitMaskComposite: 'source-in'
                            }}
                            alt=""
                        />
                    </div>
                    
                    {/* Theme-aware overlay for text clarity */}
                    <div className="absolute inset-0 bg-gradient-to-r from-neutral-50 dark:from-[#0E0E0E] via-neutral-50/80 dark:via-[#0E0E0E]/80 to-transparent z-[5]" />

                    <div className="relative z-10 space-y-3">
                        <div className="inline-flex items-center px-3 py-1 rounded-full bg-neutral-100 dark:bg-white/5 border border-neutral-200 dark:border-white/10 backdrop-blur-md">
                            <span className="text-[10px] font-bold text-neutral-500 dark:text-white tracking-widest uppercase opacity-80">Give a month · Get a month</span>
                        </div>
                        {/* Same words as the /referrals screen on purpose. This card and
                            that page were describing the deal differently ("Affiliate ·
                            Free Pro" vs "Give a friend a free month"), which read as two
                            separate schemes. Lead with the GIFT in both. */}
                        <h2 className="text-4xl font-bold text-black dark:text-white tracking-tight leading-[1.1]">
                            Give a friend<br />a free month
                        </h2>
                        <p className="text-neutral-500 dark:text-white/40 text-sm font-medium">they get a month free — you get one when they stay</p>
                    </div>

                    <button 
                        onClick={onClose}
                        className="absolute top-6 right-6 p-2 rounded-full bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/20 border border-neutral-200 dark:border-white/10 transition-all z-20"
                    >
                        <X className="w-4 h-4 text-black dark:text-white/60" />
                    </button>
                </div>

                {/* Content Section */}
                <div className="p-8 space-y-8">
                    <div className="space-y-6">
                        <h4 className="text-[11px] font-bold text-neutral-400 dark:text-white/30 tracking-[0.2em] uppercase">How it works:</h4>
                        
                        <div className="space-y-6">
                            {steps.map((step, i) => (
                                <motion.div 
                                    key={i}
                                    initial={{ x: -10, opacity: 0 }}
                                    animate={{ x: 0, opacity: 1 }}
                                    transition={{ delay: 0.1 * i }}
                                    className="flex items-start gap-4"
                                >
                                    <div className="mt-0.5 p-1 rounded-md bg-black/5 dark:bg-white/5 border border-neutral-200 dark:border-white/10">
                                        <step.icon className="w-3.5 h-3.5 text-black/70 dark:text-white/70" />
                                    </div>
                                    <p className="text-sm text-neutral-500 dark:text-white/60 leading-tight flex-1">
                                        {step.text}
                                        <span className="text-black dark:text-white font-bold ml-1">{step.bold}</span>
                                        {step.extra && <span className="text-neutral-400 dark:text-white/40 ml-1">{step.extra}</span>}
                                    </p>
                                </motion.div>
                            ))}
                        </div>
                    </div>

                    <div className="pt-2 border-t border-neutral-200 dark:border-white/5 space-y-3">
                        <div className="flex items-center justify-between">
                            <p className="text-[13px] font-medium text-neutral-500 dark:text-white/50">
                                <span className="text-black dark:text-white font-bold">{referral?.invited ?? profile?.invite_count ?? 0}</span> signed up, <span className="text-black dark:text-white font-bold">{conversions}</span> went Pro
                            </p>
                            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-neutral-100 dark:bg-white/5 border border-neutral-200 dark:border-white/5">
                                <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                                <span className="text-[10px] font-bold text-neutral-500 dark:text-white/40 uppercase tracking-tighter">Live</span>
                            </div>
                        </div>
                        {freeProActive && (
                            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-500/10 border border-green-500/20">
                                <Sparkles className="w-3.5 h-3.5 text-green-600 dark:text-green-400" />
                                <span className="text-[12px] font-semibold text-green-700 dark:text-green-300">
                                    Your Pro is free until {freeProUntil!.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                                </span>
                            </div>
                        )}
                    </div>

                    {/* Copy Box */}
                    <div className="relative group">
                        <div className="flex h-12 bg-black/5 dark:bg-white/5 rounded-xl border border-neutral-200 dark:border-white/10 focus-within:border-black/20 dark:focus-within:border-white/20 transition-all p-1 shadow-inner">
                            <div className="flex-1 flex items-center px-4 gap-3 overflow-hidden">
                                <Link2 className="w-4 h-4 text-black/30 dark:text-white/30" />
                                {/* Never print a bare "https://" while the code loads or if it
                                    failed — an empty link beside a live Copy button reads as a
                                    working control that silently copies nothing. */}
                                <span className="text-xs text-neutral-500 dark:text-white/50 truncate font-mono tracking-tight">
                                    {isLoading ? 'Loading your link…' : referralUrl ? referralUrl : 'Link unavailable — try again shortly'}
                                </span>
                            </div>
                            <button
                                onClick={handleCopyLink}
                                disabled={!inviteLink}
                                className="px-6 h-full bg-black text-white hover:bg-black/90 rounded-[10px] text-xs font-bold transition-all shadow-lg active:scale-95 border-none inline-flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100"
                            >
                                {copied ? 'Copied' : 'Copy link'}
                            </button>
                        </div>
                    </div>

                    {/* The two surfaces are the same system, not two schemes. This card is
                        the quick grab; /referrals is the full screen with the pre-written
                        message and per-channel share. Linking them removes the "which one
                        is real?" confusion. */}
                    <a
                        href="/referrals"
                        className="flex items-center justify-center gap-1.5 text-[12.5px] font-medium text-neutral-500 dark:text-white/50 hover:text-black dark:hover:text-white transition-colors"
                    >
                        Open share screen
                        <ArrowRight className="w-3.5 h-3.5" />
                    </a>
                </div>
            </motion.div>
        </motion.div>
    );
}
