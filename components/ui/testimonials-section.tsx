"use client";

import { Star, Heart } from "lucide-react";
import { SectionHeader } from "@/components/ui/section-header";
import { BlurFade } from "@/components/ui/blur-fade";
import { TESTIMONIALS, type Testimonial } from "@/lib/testimonials";

/**
 * Customer testimonials.
 *
 * Renders NOTHING while lib/testimonials.ts is empty — see the note in that
 * file. The section appears the moment a real quote is added, and never shows
 * placeholder people in the meantime.
 */

function initialsOf(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function TestimonialCard({ item }: { item: Testimonial }) {
  return (
    <div className="linear-grid-card linear-grid-card-lift p-8 flex flex-col gap-6 h-full">
      {typeof item.rating === "number" ? (
        <div
          className="flex items-center gap-1 relative z-10"
          aria-label={`${item.rating} out of 5`}
        >
          {Array.from({ length: 5 }).map((_, i) => (
            <Star
              key={i}
              aria-hidden="true"
              className={
                i < item.rating!
                  ? "w-3.5 h-3.5 fill-white text-white"
                  : "w-3.5 h-3.5 text-neutral-700"
              }
            />
          ))}
        </div>
      ) : null}

      <p className="text-sm md:text-base text-neutral-700 dark:text-neutral-200 font-light leading-relaxed font-sans relative z-10 flex-1">
        {item.quote}
      </p>

      <div className="flex items-center gap-3 relative z-10">
        {item.avatar ? (
          <img
            src={item.avatar}
            alt=""
            className="w-9 h-9 rounded-full object-cover border border-white/10 shrink-0"
          />
        ) : (
          <span className="gradient-tile w-9 h-9 !rounded-full text-[11px] font-semibold text-white shrink-0">
            {initialsOf(item.name)}
          </span>
        )}
        <span className="flex flex-col">
          <span className="text-sm font-semibold text-neutral-900 dark:text-white leading-tight">{item.name}</span>
          <span className="text-[11px] text-neutral-500 font-sans leading-tight">{item.role}</span>
        </span>
      </div>
    </div>
  );
}

export function TestimonialsSection() {
  // No real testimonials yet -> the page skips this section entirely rather
  // than rendering invented ones.
  if (TESTIMONIALS.length === 0) return null;

  return (
    <section className="py-16 md:py-32 px-6 w-full max-w-7xl mx-auto border-t border-neutral-200 dark:border-white/[0.06] z-10 relative">
      <BlurFade delay={0.1} duration={0.8} inView>
        <SectionHeader
          pill="Customers"
          icon={Heart}
          heading="What founders say."
          subtitle="From people running their inbox on Maily every day."
        />
      </BlurFade>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl mx-auto items-stretch">
        {TESTIMONIALS.map((item, i) => (
          <BlurFade key={item.name + i} delay={0.1 + i * 0.08} duration={0.7} inView>
            <TestimonialCard item={item} />
          </BlurFade>
        ))}
      </div>
    </section>
  );
}
