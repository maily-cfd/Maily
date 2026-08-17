"use client";

import React, { useEffect } from "react";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { LayoutList } from "lucide-react";
import AnimatedGradient from "@/components/ui/animated-gradient";
import { BlurFade } from "@/components/ui/blur-fade";
import { CHANGELOG, type ChangelogTag } from "@/lib/changelog";

// Tag chips — accent carries meaning: New = shipped capability,
// Improved = better, Fixed = repaired. Tuned for the dark marketing stage.
const TAG_STYLES: Record<ChangelogTag, string> = {
  New:      "bg-emerald-500/10 text-emerald-300 border-emerald-500/20",
  Improved: "bg-blue-500/10 text-blue-300 border-blue-500/20",
  Fixed:    "bg-amber-500/10 text-amber-300 border-amber-500/20",
};

export default function ChangelogPage() {
  useEffect(() => {
    document.title = "Changelog / Maily";
  }, []);

  return (
    <div className="min-h-screen bg-[#030303] text-white flex flex-col items-center justify-start overflow-x-hidden font-satoshi strichpunkt-theme relative">
      {/* Top Navbar */}
      <Navbar theme="dark" />

      {/* Atmospheric backgrounds */}
      <div className="absolute inset-0 z-0 pointer-events-none select-none overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.015]"
          style={{
            backgroundImage: `radial-gradient(circle, #fff 1px, transparent 1px)`,
            backgroundSize: "24px 24px"
          }}
        />
        <div className="absolute top-[20%] left-1/4 w-[700px] h-[700px] rounded-full bg-neutral-900/10 blur-[130px]" />
      </div>

      <AnimatedGradient
        config={{ preset: "Prism", speed: 8 }}
        noise={{ opacity: 0.01 }}
        className="opacity-20 pointer-events-none"
      />

      {/* Hero Section */}
      <section className="relative z-10 pt-40 pb-16 md:pt-48 md:pb-20 px-6 text-center max-w-3xl mx-auto flex flex-col items-center space-y-4">
        <BlurFade delay={0.05} duration={0.8} yOffset={10} inView>
          <div className="inline-flex items-center gap-2.5 px-4.5 py-1.5 rounded-full bg-white/[0.02] border border-white/[0.06] shadow-2xl mb-4 group cursor-pointer hover:border-white/[0.12] transition-colors">
            <LayoutList className="w-3.5 h-3.5 text-neutral-300" />
            <span className="text-[10px] font-medium tracking-[0.2em] text-neutral-300 uppercase">
              Ship log // Changelog
            </span>
          </div>
        </BlurFade>

        <BlurFade delay={0.15} duration={0.8} yOffset={15} inView>
          <h1 className="text-4xl md:text-7xl font-light tracking-[-0.04em] text-white leading-tight">
            Product updates. <br />
            <span className="font-medium italic text-neutral-400">Shipped often.</span>
          </h1>
        </BlurFade>

        <BlurFade delay={0.28} duration={0.8} yOffset={12} inView>
          <p className="text-neutral-400 text-sm md:text-base max-w-xl mx-auto font-light leading-relaxed tracking-tight">
            Every upgrade to your inbox employee, as it lands. Go build — we&apos;ll handle the inbox, and we&apos;ll tell you exactly how it keeps getting better.
          </p>
        </BlurFade>
      </section>

      {/* Timeline */}
      <section className="relative z-10 w-full max-w-3xl px-6 pb-32">
        <div className="space-y-16">
          {CHANGELOG.map((group, gi) => (
            <BlurFade key={group.date} delay={0.35 + gi * 0.08} duration={0.8} yOffset={16} inView>
              <div className="md:grid md:grid-cols-[160px_1fr] md:gap-8">
                {/* Date rail */}
                <div className="mb-5 md:mb-0">
                  <p className="md:sticky md:top-28 text-[13px] font-medium text-neutral-400 tracking-tight">
                    {group.date}
                  </p>
                </div>

                {/* Entries */}
                <div className="space-y-4 border-l border-white/[0.06] pl-6 md:pl-8 relative">
                  {/* Timeline node */}
                  <span className="absolute -left-[5px] top-2 w-[9px] h-[9px] rounded-full bg-neutral-600 ring-4 ring-[#030303]" aria-hidden="true" />

                  {group.entries.map((entry) => (
                    <article
                      key={entry.title}
                      className="rounded-2xl border border-white/[0.05] bg-white/[0.015] backdrop-blur-xl p-6 hover:border-white/[0.10] transition-colors duration-300"
                    >
                      <div className="flex items-center gap-2.5 mb-2.5">
                        <span className={`px-2 py-0.5 rounded-full border text-[10px] font-semibold uppercase tracking-[0.08em] ${TAG_STYLES[entry.tag]}`}>
                          {entry.tag}
                        </span>
                        <h2 className="text-[15.5px] font-medium text-white tracking-tight leading-snug">
                          {entry.title}
                        </h2>
                      </div>
                      <ul className="space-y-1.5">
                        {entry.points.map((point, pi) => (
                          <li key={pi} className="flex gap-2.5 text-[13px] text-neutral-400 font-light leading-relaxed">
                            <span className="mt-[9px] w-1 h-1 rounded-full bg-neutral-600 shrink-0" aria-hidden="true" />
                            <span>{point}</span>
                          </li>
                        ))}
                      </ul>
                    </article>
                  ))}
                </div>
              </div>
            </BlurFade>
          ))}
        </div>

        {/* Earlier work note */}
        <BlurFade delay={0.6} duration={0.8} yOffset={12} inView>
          <p className="text-center text-[12px] text-neutral-600 font-light mt-16">
            Building since day one. The log starts here — everything above shipped to production.
          </p>
        </BlurFade>
      </section>

      {/* Footer */}
      <Footer />
    </div>
  );
}
