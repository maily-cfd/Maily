"use client";

import React, { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Soft per-word fade-in on scroll.
 *
 * Replaces the old blur-per-word reveal: `filter: blur()` on dozens of word
 * spans was the main landing scroll jank. Opacity + a 4px rise is GPU-cheap
 * and still reads as a premium sweep.
 *
 * CSS owns the animation (.wsr-word in globals.css). React renders once.
 */

interface WordSoftRevealProps {
  text: string;
  className?: string;
  staggerMs?: number;
  delayMs?: number;
}

/** @deprecated Prefer WordSoftReveal — kept as alias so call sites keep working. */
export function WordBlurReveal(props: WordSoftRevealProps) {
  return <WordSoftReveal {...props} />;
}

export function WordSoftReveal({
  text,
  className,
  staggerMs = 40,
  delayMs = 0,
}: WordSoftRevealProps) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [playing, setPlaying] = useState(false);
  const seen = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        // Play once when first visible — replaying on every scroll pass was
        // churn for no design gain.
        if (entry.isIntersecting && !seen.current) {
          seen.current = true;
          setPlaying(true);
        }
      },
      { threshold: 0.12 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const tokens = text.split(/(\s+)/).filter((t) => t.length > 0);
  let wordIndex = 0;

  return (
    <p ref={ref} className={cn(playing && "wsr-play", className)}>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {tokens.map((token, i) => {
          if (!token.trim()) {
            return <span key={i}>{token}</span>;
          }
          const delay = delayMs + wordIndex * staggerMs;
          wordIndex += 1;
          return (
            <span
              key={i}
              className="wsr-word"
              style={{ animationDelay: `${delay}ms` }}
            >
              {token}
            </span>
          );
        })}
      </span>
    </p>
  );
}
