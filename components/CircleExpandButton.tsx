"use client";

import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import React from "react";
import { cn } from "@/lib/utils";

/**
 * The site's pill CTA.
 *
 * BACKGROUND FILL WAS BROKEN: the base class was `bg-[rgb(77, 77, 77)]`.
 * Tailwind arbitrary values cannot contain spaces — the className string
 * tokenizes on whitespace into `bg-[rgb(77,` / `77,` / `77)]`, none of which
 * are valid utilities, so NO background was ever generated. Every call site
 * had independently papered over this by passing its own `bg-*` in className,
 * and the two that didn't ("Get started free" on the landing hero and in the
 * closing CTA) rendered as a transparent pill with only an inset highlight.
 *
 * Fill is now owned by an explicit `variant` instead of by className patches:
 *
 *   primary   — solid white, black label. Mailient's palette has no hue, so
 *               LUMINANCE is the accent: pure white is reserved for the thing
 *               we want clicked and is deliberately the brightest element on
 *               any given screen.
 *   secondary — outlined, stays in the grey ramp. For navigational CTAs that
 *               should not compete with the primary action.
 *
 * Keep primary rare — roughly one per viewport. If everything is white,
 * nothing is.
 */

type CircleExpandButtonVariant = "primary" | "secondary";

interface CircleExpandButtonProps {
  children: React.ReactNode;
  href?: string;
  onClick?: () => void;
  className?: string;
  target?: string;
  rel?: string;
  disabled?: boolean;
  variant?: CircleExpandButtonVariant;
}

const VARIANT_STYLES: Record<CircleExpandButtonVariant, string> = {
  primary:
    "bg-white text-black hover:bg-neutral-200 shadow-[0_8px_24px_rgba(0,0,0,0.45)]",
  secondary:
    "bg-white/[0.03] text-white border border-white/15 hover:bg-white/[0.08] hover:border-white/25",
};

export function CircleExpandButton({
  children,
  href,
  onClick,
  className = "",
  target,
  rel,
  disabled = false,
  variant = "primary",
}: CircleExpandButtonProps) {
  const ButtonWrapper = href ? "a" : "button";

  return (
    <ButtonWrapper
      href={href}
      onClick={onClick}
      target={target}
      rel={rel}
      disabled={disabled}
      className={cn(
        "relative inline-flex items-center justify-center gap-2",
        "px-8 py-3 rounded-full",
        "font-semibold text-sm",
        "overflow-hidden cursor-pointer",
        "transition-all duration-200 hover:scale-[1.02]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-offset-2 focus-visible:ring-offset-black",
        VARIANT_STYLES[variant],
        disabled && "opacity-50 cursor-not-allowed",
        className,
      )}
    >
      <span className="relative z-10">{children}</span>

      {/* Arrow inherits the label colour — it was hardcoded text-white, which
          left an invisible white-on-white arrow on the primary variant. */}
      <motion.div
        className="relative flex items-center justify-center"
        initial={{ rotate: -45 }}
        whileHover={{ rotate: 0 }}
        transition={{ duration: 0.15 }}
      >
        <ArrowRight className="w-4 h-4" />
      </motion.div>
    </ButtonWrapper>
  );
}
