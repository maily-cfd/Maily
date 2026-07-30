"use client";

import React, { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Per-word blur-in reveal, triggered on scroll.
 *
 * Each word ramps opacity 0 -> 1 and blur 7px -> 0, staggered left to right so
 * the reveal sweeps across the line. Replays every time the block enters the
 * viewport, in either scroll direction.
 *
 * WHY NOT WordBlurStream (src/WordBlurStream.tsx):
 * That component implements the same visual, but drives it from a
 * requestAnimationFrame loop that setStates every frame and recomputes every
 * word's inline style. It also loops forever. That is correct for the one FAQ
 * answer it powers; putting it on every text block on the landing page would
 * reintroduce exactly the per-frame-setState jank removed in 71a8d04.
 *
 * Here the stagger is an animation-delay per word and the animation itself is
 * CSS (see .wbr-word in globals.css). React renders once; the browser owns the
 * animation. Cost is flat no matter how many of these are on the page.
 *
 * ONLY TAKES A STRING. It has to split text into word spans, so it cannot wrap
 * arbitrary JSX.
 *
 * NOT FOR GRADIENT HEADINGS: text using `bg-clip-text text-transparent` clips
 * the gradient to the parent's text box. Splitting it into per-word inline
 * blocks with their own opacity changes how that clip resolves. Gradient
 * headings use element-level BlurFade instead — same family of reveal, one
 * unit rather than per word.
 */

interface WordBlurRevealProps {
  text: string;
  className?: string;
  /** ms between each word starting. Lower = faster sweep. */
  staggerMs?: number;
  /** Delay before the first word starts, ms. */
  delayMs?: number;
}

export function WordBlurReveal({
  text,
  className,
  staggerMs = 55,
  delayMs = 0,
}: WordBlurRevealProps) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setPlaying(entry.isIntersecting),
      { threshold: 0.15 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Split on whitespace but KEEP it, so spacing between words survives being
  // wrapped in inline-block spans.
  const tokens = text.split(/(\s+)/).filter((t) => t.length > 0);
  let wordIndex = 0;

  return (
    <p
      ref={ref}
      className={cn(playing && "wbr-play", className)}
      // The full sentence stays available to screen readers and to copy/paste
      // as one string, rather than as a pile of fragmented spans.
      aria-label={text}
    >
      {tokens.map((token, i) => {
        if (!token.trim()) {
          return <span key={i} aria-hidden="true">{token}</span>;
        }
        const delay = delayMs + wordIndex * staggerMs;
        wordIndex += 1;
        return (
          <span
            key={i}
            aria-hidden="true"
            className="wbr-word"
            style={{ animationDelay: `${delay}ms` }}
          >
            {token}
          </span>
        );
      })}
    </p>
  );
}
