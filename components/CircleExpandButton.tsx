"use client";

import { ArrowRight } from "lucide-react";
import React from "react";
import { cn } from "@/lib/utils";

/**
 * The site's pill CTA.
 *
 * Fill is owned by an explicit `variant`:
 *   primary   — solid white, black label
 *   secondary — outlined grey ramp
 *
 * No framer-motion — CSS hover keeps this out of the landing LCP/INP path.
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
        "group/cta relative inline-flex items-center justify-center gap-2",
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
      <span className="relative flex items-center justify-center -rotate-45 transition-transform duration-150 group-hover/cta:rotate-0">
        <ArrowRight className="w-4 h-4" aria-hidden="true" />
      </span>
    </ButtonWrapper>
  );
}
