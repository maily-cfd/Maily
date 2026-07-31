"use client";

import React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { BlurFade } from "@/components/ui/blur-fade";
import { WordSoftReveal } from "@/components/ui/word-blur-reveal";

/**
 * The landing page's one and only section header.
 * Soft opacity reveals only — no blur filters (those tanked scroll perf).
 */

interface SectionHeaderProps {
  pill: string;
  icon?: LucideIcon;
  heading: React.ReactNode;
  subtitle?: React.ReactNode;
  className?: string;
}

export function SectionHeader({
  pill,
  icon: Icon,
  heading,
  subtitle,
  className,
}: SectionHeaderProps) {
  return (
    <div
      className={cn(
        "w-full flex flex-col items-center text-center mb-10 md:mb-16",
        className,
      )}
    >
      <BlurFade inView duration={0.4}>
        <span className="gradient-pill inline-flex items-center gap-2 rounded-full px-4 py-1.5">
          {Icon ? (
            <Icon className="w-3 h-3 text-neutral-400 shrink-0" aria-hidden="true" />
          ) : null}
          <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-neutral-600 dark:text-neutral-300">
            {pill}
          </span>
        </span>
      </BlurFade>

      <BlurFade inView duration={0.45} delay={0.06}>
        <h2 className="mt-6 text-3xl md:text-[44px] font-medium tracking-[-0.025em] leading-tight max-w-3xl bg-gradient-to-b from-neutral-900 via-neutral-700 to-neutral-400 dark:from-white dark:via-neutral-100 dark:to-neutral-500 bg-clip-text text-transparent">
          {heading}
        </h2>
      </BlurFade>

      {typeof subtitle === "string" ? (
        <WordSoftReveal
          text={subtitle}
          delayMs={120}
          className="mt-4 text-sm md:text-base text-neutral-500 dark:text-[#8a8f98] font-light leading-relaxed font-sans max-w-xl"
        />
      ) : subtitle ? (
        <BlurFade inView duration={0.45} delay={0.1}>
          <p className="mt-4 text-sm md:text-base text-neutral-500 dark:text-[#8a8f98] font-light leading-relaxed font-sans max-w-xl">
            {subtitle}
          </p>
        </BlurFade>
      ) : null}
    </div>
  );
}
