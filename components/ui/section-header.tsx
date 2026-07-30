"use client";

import React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { BlurFade } from "@/components/ui/blur-fade";
import { WordBlurReveal } from "@/components/ui/word-blur-reveal";

/**
 * The landing page's one and only section header.
 *
 * WHY THIS EXISTS: every section used to invent its own header. There were
 * four different label treatments (emerald ping-dot pill, bare mono caps,
 * bordered pill, none), three alignments (left / centered / inside a grid
 * column), and two sections — the demo switcher and the integrations orbit —
 * that had no label at all, one of them with no heading whatsoever. Each
 * section was fine on its own; together they read as several different pages.
 *
 * The regularity IS the design. Sections vary in what sits BELOW the header
 * (card grid, tab switcher, orbit, accordion, pricing table) and never in the
 * header itself. Always centered, always the same three parts:
 *
 *     [ pill ]      icon + uppercase mono label
 *     Heading       44px, white -> neutral-500 gradient
 *     subtitle      one grey sentence — keep it to ONE
 *
 * Deliberately has no `align` prop. Being unable to opt out is the point; an
 * escape hatch here is how the page drifted apart the first time.
 */

interface SectionHeaderProps {
  /** Uppercase mono label in the pill, e.g. "HOW IT WORKS". */
  pill: string;
  /** Small icon rendered inside the pill, left of the label. */
  icon?: LucideIcon;
  heading: React.ReactNode;
  /** One sentence. If it needs two, it belongs in the section body. */
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
      {/* Each part reveals on its own with a slight stagger, and re-reveals on
          every scroll pass in either direction (repeat). These are small
          subtrees — a pill, a heading, one line — which is the only grain at
          which a repeating blur reveal is cheap enough to run everywhere. See
          the `repeat` note in BlurFade. */}

      {/* .gradient-pill is real glass, not decorative blur: section headers sit
          over the page's atmospheric radial glows, so there is something behind
          these to refract. Cards elsewhere use gradient instead — blurring flat
          black just produces black. */}
      <BlurFade inView repeat duration={0.5} blur="6px">
        <span className="gradient-pill inline-flex items-center gap-2 rounded-full px-4 py-1.5">
          {Icon ? (
            <Icon className="w-3 h-3 text-neutral-400 shrink-0" aria-hidden="true" />
          ) : null}
          <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-neutral-300">
            {pill}
          </span>
        </span>
      </BlurFade>

      <BlurFade inView repeat duration={0.6} delay={0.08} blur="8px">
        <h2 className="mt-6 text-3xl md:text-[44px] font-medium tracking-[-0.025em] leading-tight max-w-3xl bg-gradient-to-b from-white via-neutral-100 to-neutral-500 bg-clip-text text-transparent">
          {heading}
        </h2>
      </BlurFade>

      {/* A plain-string subtitle gets the per-word blur sweep. Anything richer
          (the chaos/clarity section passes a <WordBlurStream> element) falls
          back to the element-level reveal, since WordBlurReveal has to split a
          string into word spans and cannot wrap arbitrary JSX. */}
      {typeof subtitle === "string" ? (
        <WordBlurReveal
          text={subtitle}
          delayMs={160}
          className="mt-4 text-sm md:text-base text-[#8a8f98] font-light leading-relaxed font-sans max-w-xl"
        />
      ) : subtitle ? (
        <BlurFade inView repeat duration={0.6} delay={0.16} blur="6px">
          <p className="mt-4 text-sm md:text-base text-[#8a8f98] font-light leading-relaxed font-sans max-w-xl">
            {subtitle}
          </p>
        </BlurFade>
      ) : null}
    </div>
  );
}
