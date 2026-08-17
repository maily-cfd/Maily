"use client";

import React, { useState, useEffect } from "react";
import {
    Trophy,
    Users,
    Gift,
    Copy,
    Check,
    Info,
    ExternalLink,
    Share2,
    DollarSign,
    Zap,
    Award
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";

const MILESTONES = [
    { invites: 5, reward: "Day 1 Badge", description: "Early supporter recognition" },
    { invites: 25, reward: "1 Month Ultra", description: "Full access to all premium features" },
    { invites: 50, reward: "Founding Member", description: "Permanent status and special perks" },
    { invites: 100, reward: "3 Months Ultra", description: "Extended premium coverage" },
    { invites: 250, reward: "4% Lifetime Earning", description: "Participate in revenue sharing" },
    { invites: 1000, reward: "Get Hired", description: "Direct interview with the founders" },
];

export function RewardsSection({
    username = "Username",
    inviteCount = 0
}: {
    username?: string;
    inviteCount?: number;
}) {
    const [copied, setCopied] = useState(false);
    const [leaderboard, setLeaderboard] = useState<any[]>([]);
    const [loadingLeaderboard, setLoadingLeaderboard] = useState(true);
    const referralLink = `https://maily.cfd?ref=${username}`;

    useEffect(() => {
        fetch("/api/leaderboard")
            .then(res => res.json())
            .then(data => {
                setLeaderboard(data.users || []);
            })
            .catch(() => { })
            .finally(() => setLoadingLeaderboard(false));
    }, []);

    const handleCopyLink = () => {
        navigator.clipboard.writeText(referralLink);
        setCopied(true);
        toast.success("Referral link copied to clipboard!");
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-700">
            {/* Hero Header */}
            <div className="relative overflow-hidden rounded-3xl p-8 border border-white/10 bg-gradient-to-br from-zinc-950 via-black to-black">
                <div className="absolute top-0 right-0 p-4">
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm font-medium">
                        <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                        </span>
                        Exclusive Program
                    </div>
                </div>

                <div className="max-w-xl">
                    <h2 className="text-3xl font-bold text-white mb-4">Refer friends, unlock rewards</h2>
                    <div className="flex items-center gap-3 mb-6">
                        <div className="px-4 py-2 rounded-2xl bg-white/5 border border-white/10">
                            <p className="text-[10px] text-neutral-500 uppercase font-bold tracking-widest">Your Invites</p>
                            <p className="text-2xl font-black text-white">{inviteCount}</p>
                        </div>
                        <div className="h-full w-px bg-white/10 mx-2" />
                        <div>
                            <p className="text-sm text-neutral-400">Next milestone: {
                                MILESTONES.find(m => m.invites > inviteCount)?.invites || "Max reached"
                            } invites</p>
                            <div className="w-32 h-1.5 bg-white/10 rounded-full mt-2 overflow-hidden">
                                <div
                                    className="h-full bg-emerald-500 transition-all duration-1000"
                                    style={{ width: `${Math.min(100, (inviteCount / (MILESTONES.find(m => m.invites > inviteCount)?.invites || inviteCount)) * 100)}%` }}
                                />
                            </div>
                        </div>
                    </div>
                    <p className="text-neutral-400 text-lg mb-8">
                        Share the magic of Maily with your network and unlock exclusive perks, lifetime status, and career opportunities.
                    </p>

                    <div className="flex flex-col sm:flex-row gap-3">
                        <div className="flex-1 flex items-center gap-3 px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-neutral-300 font-mono text-sm overflow-hidden whitespace-nowrap">
                            <span className="opacity-50 select-none">https://</span>
                            <span>maily.cfd?ref={username}</span>
                        </div>
                        <Button
                            onClick={handleCopyLink}
                            className="px-6 py-6 rounded-xl bg-black dark:bg-white text-white dark:text-black hover:bg-black/90 dark:hover:bg-neutral-200 transition-all font-semibold shrink-0 gap-2 border-none"
                        >
                            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                            {copied ? "Copied" : "Copy link"}
                        </Button>
                    </div>
                </div>
            </div>

            {/* Leaderboard Podium - Only show if there's data */}
            {leaderboard.length > 0 ? (
                <div className="space-y-6 relative">
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-12 w-64 h-64 bg-emerald-500/10 blur-[100px] rounded-full pointer-events-none" />

                    <div className="flex items-end justify-center gap-2 sm:gap-6 pt-16 pb-8 px-2">
                        {/* 2nd Place */}
                        {leaderboard[1] ? (
                            <div className="flex flex-col items-center w-full max-w-[120px] sm:max-w-none">
                                <div className="mb-4 text-center">
                                    <div className="inline-block px-3 py-1 rounded-full bg-neutral-100 text-black text-[10px] sm:text-xs font-bold mb-3 shadow-[0_4px_12px_rgba(255,255,255,0.1)]">
                                        Active
                                    </div>
                                    <p className="font-semibold text-white text-xs sm:text-base truncate w-full">{leaderboard[1].username}</p>
                                    <p className="text-[10px] sm:text-xs text-neutral-500">{leaderboard[1].invite_count} invites</p>
                                </div>
                                <div className="w-24 sm:w-40 h-24 sm:h-36 rounded-t-2xl bg-gradient-to-b from-white/10 to-transparent border-x border-t border-white/10 flex items-center justify-center relative">
                                    <span className="text-4xl sm:text-6xl font-bold text-white/10">2</span>
                                    <div className="absolute bottom-0 left-0 right-0 h-1/2 bg-gradient-to-t from-black to-transparent" />
                                </div>
                            </div>
                        ) : null}

                        {/* 1st Place */}
                        {leaderboard[0] ? (
                            <div className="flex flex-col items-center w-full max-w-[140px] sm:max-w-none -mb-1">
                                <div className="mb-4 text-center">
                                    <div className="inline-block px-4 py-1.5 rounded-full bg-neutral-950 border border-white/20 text-white text-xs sm:text-sm font-bold mb-3 shadow-[0_8px_20px_rgba(0,0,0,0.5)]">
                                        Top Inviter
                                    </div>
                                    <p className="font-bold text-white text-sm sm:text-xl truncate w-full">{leaderboard[0].username}</p>
                                    <p className="text-[10px] sm:text-sm text-neutral-500">{leaderboard[0].invite_count} invites</p>
                                </div>
                                <div className="w-28 sm:w-48 h-32 sm:h-52 rounded-t-2xl bg-gradient-to-b from-white/15 to-transparent border-x border-t border-white/20 flex items-center justify-center relative">
                                    <span className="text-6xl sm:text-8xl font-bold text-white/20">1</span>
                                    <div className="absolute inset-0 bg-gradient-to-b from-white/10 to-transparent opacity-20" />
                                    <div className="absolute bottom-0 left-0 right-0 h-1/2 bg-gradient-to-t from-black to-transparent" />
                                </div>
                            </div>
                        ) : null}

                        {/* 3rd Place */}
                        {leaderboard[2] ? (
                            <div className="flex flex-col items-center w-full max-w-[110px] sm:max-w-none">
                                <div className="mb-4 text-center">
                                    <div className="inline-block px-3 py-1 rounded-full bg-neutral-200/80 text-black text-[10px] sm:text-xs font-bold mb-3 shadow-[0_4px_12px_rgba(255,255,255,0.05)]">
                                        Active
                                    </div>
                                    <p className="font-semibold text-white text-xs sm:text-base truncate w-full">{leaderboard[2].username}</p>
                                    <p className="text-[10px] sm:text-xs text-neutral-500">{leaderboard[2].invite_count} invites</p>
                                </div>
                                <div className="w-20 sm:w-36 h-20 sm:h-28 rounded-t-2xl bg-gradient-to-b from-white/5 to-transparent border-x border-t border-white/5 flex items-center justify-center relative">
                                    <span className="text-3xl sm:text-5xl font-bold text-white/5">3</span>
                                    <div className="absolute bottom-0 left-0 right-0 h-1/2 bg-gradient-to-t from-black to-transparent" />
                                </div>
                            </div>
                        ) : null}
                    </div>
                    <div className="w-full h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
                </div>
            ) : null}

            {/* How it works */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {[
                    {
                        step: 1,
                        title: "Share your link",
                        desc: "Share your referral link with friends and on social media.",
                        icon: <Share2 className="w-6 h-6 text-blue-400" />,
                        preview: (
                            <div className="p-4 rounded-xl bg-white/5 border border-white/10 font-mono text-xs text-neutral-400">
                                https://maily.cfd?ref="{username}"
                            </div>
                        )
                    },
                    {
                        step: 2,
                        title: "Friends join",
                        desc: "When they sign up with your link, you unlock exclusive rewards.",
                        icon: <Users className="w-6 h-6 text-emerald-400" />,
                        preview: (
                            <div className="p-4 rounded-xl bg-white/5 border border-white/10 space-y-2">
                                <div className="p-2 rounded-lg bg-white/5 border border-white/10 text-xs text-neutral-300">
                                    friend@email.com
                                </div>
                                <div className="flex items-center gap-1.5 text-[10px] font-medium text-emerald-400 bg-emerald-500/10 w-fit px-2 py-0.5 rounded-full">
                                    <Check className="w-3 h-3" /> Signed up
                                </div>
                            </div>
                        )
                    },
                    {
                        step: 3,
                        title: "Unlock Rewards",
                        desc: "Grant perks at each milestone you reach.",
                        icon: <Gift className="w-6 h-6 text-purple-400" />,
                        preview: (
                            <div className="p-4 rounded-xl bg-white/5 border border-white/10 flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-orange-500 flex items-center justify-center text-white font-bold">D</div>
                                <div className="flex-1">
                                    <div className="flex items-center justify-between">
                                        <span className="text-[10px] font-bold text-white">Daewon</span>
                                        <span className="text-[8px] text-neutral-500">2m ago</span>
                                    </div>
                                    <p className="text-[10px] text-neutral-400">You unlocked Early Access!</p>
                                </div>
                            </div>
                        )
                    }
                ].map((item) => (
                    <div key={item.step} className="glass-panel p-6 space-y-6 hover:translate-y-[-4px] transition-all duration-300 group">
                        <div className="space-y-4">
                            <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center border border-white/10 group-hover:scale-110 transition-transform">
                                {item.icon}
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                    <span className="text-neutral-500">{item.step}.</span> {item.title}
                                </h3>
                                <p className="text-sm text-neutral-400 mt-2 leading-relaxed">
                                    {item.desc}
                                </p>
                            </div>
                        </div>
                        {item.preview}
                    </div>
                ))}
            </div>

            {/* Milestones Table */}
            <div className="glass-panel overflow-hidden border border-white/10 rounded-3xl">
                <div className="p-6 border-b border-white/10 flex items-center justify-between">
                    <h3 className="text-xl font-bold text-white">Invite Milestones</h3>
                    <div className="text-xs text-neutral-500 flex items-center gap-1">
                        <Info className="w-3 h-3" />
                        Terms apply
                    </div>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead>
                            <tr className="bg-white/5">
                                <th className="px-6 py-4 text-xs font-bold text-neutral-400 uppercase tracking-widest">Milestone</th>
                                <th className="px-6 py-4 text-xs font-bold text-neutral-400 uppercase tracking-widest text-right">Reward</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            {MILESTONES.map((row, idx) => {
                                const isCompleted = inviteCount >= row.invites;
                                return (
                                    <tr key={idx} className={cn(
                                        "hover:bg-white/[0.02] transition-colors group",
                                        isCompleted ? "bg-emerald-500/5" : ""
                                    )}>
                                        <td className="px-6 py-5">
                                            <div className="flex items-center gap-3">
                                                <div className={cn(
                                                    "w-8 h-8 rounded-lg border flex items-center justify-center text-sm font-bold transition-colors",
                                                    isCompleted
                                                        ? "bg-emerald-500 border-emerald-400 text-white"
                                                        : "bg-black border-white/10 text-neutral-400 group-hover:text-white"
                                                )}>
                                                    {isCompleted ? <Check className="w-4 h-4" /> : row.invites}
                                                </div>
                                                <span className={cn(
                                                    "text-base",
                                                    isCompleted ? "text-emerald-400 font-medium" : "text-neutral-300"
                                                )}>
                                                    {isCompleted ? "Milestone Unlocked" : `${row.invites} invites`}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-5 text-right">
                                            <div className="inline-flex items-center gap-2">
                                                <span className={cn(
                                                    "text-base font-semibold transition-colors",
                                                    isCompleted ? "text-emerald-400" : "text-white group-hover:text-emerald-400"
                                                )}>
                                                    {row.reward}
                                                </span>
                                                <TooltipProvider>
                                                    <Tooltip>
                                                        <TooltipTrigger asChild>
                                                            <Info className="w-4 h-4 text-neutral-600 hover:text-neutral-400 transition-colors cursor-help" />
                                                        </TooltipTrigger>
                                                        <TooltipContent>
                                                            <p>{row.description}</p>
                                                        </TooltipContent>
                                                    </Tooltip>
                                                </TooltipProvider>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Info Footer */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-6 rounded-2xl bg-blue-500/5 border border-blue-500/10 flex items-start gap-4">
                    <Info className="w-6 h-6 text-blue-400 shrink-0" />
                    <div>
                        <h4 className="font-bold text-white">How rewards work</h4>
                        <p className="text-sm text-neutral-400 mt-1 leading-relaxed">
                            Rewards are credited to your account instantly when the referred friend signs up and verifies their account. Milestone rewards like badges and roles are granted automatically.
                        </p>
                    </div>
                </div>

                <div className="p-6 rounded-2xl bg-orange-500/5 border border-orange-500/10 flex items-start gap-4">
                    <Zap className="w-6 h-6 text-orange-400 shrink-0" />
                    <div>
                        <h4 className="font-bold text-white">Rewards vs. Streaks</h4>
                        <p className="text-sm text-neutral-400 mt-1 leading-relaxed">
                            <strong>Note:</strong> These invite rewards are separate from your Daily Streak Badges. Streak badges found in your profile are earned by using Maily every day, while these are exclusive to growing our community.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
