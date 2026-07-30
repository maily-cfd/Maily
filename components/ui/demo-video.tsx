"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * A looping product demo clip.
 *
 * - Does not attach `src` until near the viewport (LCP / network).
 * - Pauses when scrolled away so decoders are not stacked offscreen.
 * - No continuous autoplay fighting other media on first paint.
 */

interface DemoVideoProps {
  src: string;
  poster: string;
  /** Describe what the clip SHOWS — it stands in for the video for screen readers. */
  label: string;
  className?: string;
  /** object-cover crops to fill; object-contain letterboxes. */
  fit?: "cover" | "contain";
}

export function DemoVideo({
  src,
  poster,
  label,
  className,
  fit = "cover",
}: DemoVideoProps) {
  const ref = useRef<HTMLVideoElement>(null);
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setArmed(true);
          // play() after src is set — next effect / same tick after arm
          requestAnimationFrame(() => {
            video.play().catch(() => {});
          });
        } else if (!video.paused) {
          video.pause();
        }
      },
      { threshold: 0.2, rootMargin: "100px" },
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const video = ref.current;
    if (!armed || !video) return;
    video.play().catch(() => {});
  }, [armed]);

  return (
    <video
      ref={ref}
      src={armed ? src : undefined}
      poster={poster}
      loop
      muted
      playsInline
      preload="none"
      aria-label={label}
      className={cn(
        "w-full h-full",
        fit === "cover" ? "object-cover" : "object-contain",
        className,
      )}
    />
  );
}
