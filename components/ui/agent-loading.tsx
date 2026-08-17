"use client";

import { useState } from "react";
import { HomeFeedSidebar } from "@/components/ui/home-feed-sidebar";
import { motion } from "framer-motion";

const SHIMMER =
    "linear-gradient(110deg, transparent 18%, color-mix(in srgb, var(--boult-fg) 14%, transparent) 50%, transparent 82%)";

function ShimmerBar({ className = "", delay = 0 }: { className?: string; delay?: number }) {
    return (
        <div className={`relative overflow-hidden bg-boult-fg/[0.06] ${className}`}>
            <motion.div
                className="absolute inset-0 w-[220%]"
                style={{ background: SHIMMER }}
                animate={{ x: ["-55%", "55%"] }}
                transition={{ repeat: Infinity, duration: 1.6, ease: "easeInOut", delay }}
            />
        </div>
    );
}

export function AgentLoading() {
    const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

    return (
        <div className="flex h-screen w-full bg-boult-bg text-boult-fg overflow-hidden relative">
            <HomeFeedSidebar onCollapse={setIsSidebarCollapsed} />

            <div className={`flex-1 flex flex-col transition-[margin] duration-300 px-3 sm:px-6 py-4 relative ${
                isSidebarCollapsed ? 'md:ml-20' : 'md:ml-64'
            }`}>
                {/* Top bar */}
                <div className="flex items-center justify-between w-full h-14 mb-12">
                    <ShimmerBar className="w-28 h-6 rounded-lg" />
                    <div className="flex items-center gap-3">
                        <ShimmerBar className="w-9 h-9 rounded-full" delay={0.1} />
                        <ShimmerBar className="w-9 h-9 rounded-full" delay={0.18} />
                        <ShimmerBar className="w-9 h-9 rounded-full" delay={0.26} />
                        <ShimmerBar className="w-24 h-9 rounded-xl" delay={0.34} />
                    </div>
                </div>

                {/* Main content */}
                <div className="flex flex-col gap-5 w-full max-w-3xl mt-8">
                    <div className="flex items-center gap-3 mb-2">
                        <ShimmerBar className="w-6 h-6 rounded-md" />
                        <ShimmerBar className="w-24 h-4 rounded-full" delay={0.1} />
                    </div>

                    <ShimmerBar className="h-3.5 w-full rounded-full" delay={0.14} />
                    <ShimmerBar className="h-3.5 w-[92%] rounded-full" delay={0.22} />
                    <ShimmerBar className="h-3.5 w-[78%] rounded-full" delay={0.3} />
                    <ShimmerBar className="h-3.5 w-[45%] rounded-full" delay={0.38} />

                    {/* Card placeholder */}
                    <div className="mt-6 rounded-2xl border border-boult-border bg-boult-fg/[0.03] p-5 flex flex-col gap-3">
                        <ShimmerBar className="h-3 w-[34%] rounded-full" delay={0.24} />
                        <ShimmerBar className="h-3 w-[72%] rounded-full" delay={0.32} />
                        <ShimmerBar className="h-3 w-[56%] rounded-full" delay={0.4} />
                    </div>
                </div>

                {/* Bottom prompt box */}
                <div className="absolute bottom-10 left-6 right-6 md:left-12 md:right-12">
                    <div className="h-20 w-full max-w-3xl mx-auto rounded-[28px] border border-boult-border bg-boult-fg/[0.03] relative overflow-hidden flex items-center justify-between px-7">
                        <div className="flex items-center gap-3">
                            <ShimmerBar className="w-8 h-8 rounded-full" />
                            <ShimmerBar className="w-8 h-8 rounded-full" delay={0.12} />
                        </div>
                        <ShimmerBar className="h-2.5 w-44 rounded-full" delay={0.22} />
                        <div className="flex items-center gap-3">
                            <ShimmerBar className="w-8 h-8 rounded-full" delay={0.3} />
                            <div className="w-9 h-9 rounded-full bg-boult-fg/[0.12]" />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
