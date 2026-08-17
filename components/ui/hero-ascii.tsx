'use client';

import Link from 'next/link';

export default function HeroASCII() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-black">
      <style>{`
        .dither-pattern {
          background-image:
            repeating-linear-gradient(0deg, transparent 0px, transparent 1px, white 1px, white 2px),
            repeating-linear-gradient(90deg, transparent 0px, transparent 1px, white 1px, white 2px);
          background-size: 3px 3px;
        }
        .stars-bg {
          background-image:
            radial-gradient(1px 1px at 20% 30%, white, transparent),
            radial-gradient(1px 1px at 60% 70%, white, transparent),
            radial-gradient(1px 1px at 50% 50%, white, transparent),
            radial-gradient(1px 1px at 80% 10%, white, transparent),
            radial-gradient(1px 1px at 90% 60%, white, transparent),
            radial-gradient(1px 1px at 33% 80%, white, transparent),
            radial-gradient(1px 1px at 15% 60%, white, transparent),
            radial-gradient(1px 1px at 70% 40%, white, transparent);
          background-size: 200% 200%, 180% 180%, 250% 250%, 220% 220%, 190% 190%, 240% 240%, 210% 210%, 230% 230%;
          background-position: 0% 0%, 40% 40%, 60% 60%, 20% 20%, 80% 80%, 30% 30%, 70% 70%, 50% 50%;
          opacity: 0.25;
        }
      `}</style>

      {/* Background Image Container */}
      <div className="absolute inset-0 w-full h-full z-0">
        <img 
          src="/hero-bg.png" 
          alt="Maily Hero Background" 
          className="w-full h-full object-cover object-center opacity-90 mix-blend-lighten"
        />
      </div>

      {/* Left-side overlay so text stays legible without hiding the animation */}
      <div className="absolute inset-0 z-[1] bg-gradient-to-r from-black/80 via-black/30 to-transparent pointer-events-none hidden lg:block" />

      {/* Corner Frame Accents */}
      <div className="absolute top-0 left-0 w-8 h-8 lg:w-14 lg:h-14 border-t-2 border-l-2 border-white/25 z-20" />
      <div className="absolute top-0 right-0 w-8 h-8 lg:w-14 lg:h-14 border-t-2 border-r-2 border-white/25 z-20" />
      <div className="absolute left-0 w-8 h-8 lg:w-14 lg:h-14 border-b-2 border-l-2 border-white/25 z-20" style={{ bottom: '5vh' }} />
      <div className="absolute right-0 w-8 h-8 lg:w-14 lg:h-14 border-b-2 border-r-2 border-white/25 z-20" style={{ bottom: '5vh' }} />

      {/* ── Main content ────────────────────────────────────────────────────── */}
      {/* pt-24 accounts for the existing Navbar on top */}
      <div className="relative z-10 flex min-h-screen items-center pt-24 pb-24">
        <div className="max-w-7xl mx-auto w-full px-6 lg:px-16">
          <div className="max-w-xl relative">

            {/* Top decorative rule */}
            <div className="flex items-center gap-3 mb-4 opacity-50">
              <div className="w-6 h-px bg-white" />
              <span className="text-white text-[9px] font-mono tracking-widest uppercase">System / Inbox</span>
              <div className="flex-1 h-px bg-white/30" />
            </div>

            {/* Dither accent bar */}
            <div className="hidden lg:block absolute -left-4 top-8 bottom-12 w-[3px] dither-pattern opacity-30 rounded-full" />

            {/* Headline */}
            <h1 className="text-[28px] lg:text-[64px] font-bold text-white leading-[1.06] font-mono mb-4 lg:mb-5 tracking-tight">
              YOUR INBOX,
              <span className="block text-white/75 mt-1">ON AUTOPILOT.</span>
            </h1>

            {/* Dot row */}
            <div className="hidden lg:flex gap-[3px] mb-5 opacity-30">
              {Array.from({ length: 48 }).map((_, i) => (
                <div key={i} className="w-0.5 h-0.5 bg-white rounded-full" />
              ))}
            </div>

            {/* Description */}
            <div className="relative mb-7 lg:mb-8">
              <p className="text-[11px] lg:text-[15px] text-white/60 leading-relaxed font-mono max-w-sm">
                Maily reads, triages, drafts, and delegates your email.{' '}
                <span className="text-white/40">While you build your company.</span>
              </p>
              {/* Corner reticle */}
              <div className="hidden lg:block absolute -right-6 top-1/2 -translate-y-1/2 w-3 h-3 border border-white/20">
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1 h-1 bg-white/40" />
              </div>
            </div>

            {/* CTA Buttons */}
            <div className="flex flex-col sm:flex-row gap-3">
              <Link
                href="/auth/signup"
                className="relative px-6 py-2.5 bg-white text-black font-mono text-[11px] lg:text-xs font-bold tracking-widest uppercase transition-all duration-200 hover:bg-white/90 group inline-flex items-center gap-2"
              >
                <span className="hidden lg:block absolute -top-[3px] -left-[3px] w-2 h-2 border-t-2 border-l-2 border-black/20 opacity-0 group-hover:opacity-100 transition-opacity" />
                <span className="hidden lg:block absolute -bottom-[3px] -right-[3px] w-2 h-2 border-b-2 border-r-2 border-black/20 opacity-0 group-hover:opacity-100 transition-opacity" />
                ▶ GET STARTED FREE
              </Link>

              <Link
                href="/product/boult"
                className="px-6 py-2.5 bg-transparent border border-white/30 text-white/80 font-mono text-[11px] lg:text-xs font-semibold tracking-widest uppercase hover:border-white hover:text-white transition-all duration-200 inline-flex items-center gap-2"
              >
                SEE HOW IT WORKS
              </Link>
            </div>

            {/* Bottom notation */}
            <div className="hidden lg:flex items-center gap-3 mt-7 opacity-30">
              <span className="text-white text-[9px] font-mono">∞</span>
              <div className="flex-1 h-px bg-white" />
              <span className="text-white text-[9px] font-mono tracking-widest">OPEN SOURCE — FREE FOREVER</span>
            </div>

          </div>
        </div>
      </div>

      {/* ── Bottom status bar ───────────────────────────────────────────────── */}
      <div className="absolute left-0 right-0 z-20 border-t border-white/10 bg-black/50 backdrop-blur-sm" style={{ bottom: '5vh' }}>
        <div className="max-w-7xl mx-auto px-5 lg:px-10 py-2 lg:py-3 flex items-center justify-between">
          <div className="flex items-center gap-4 lg:gap-6 text-[8px] lg:text-[9px] font-mono text-white/40">
            <span className="hidden lg:inline tracking-widest">MAILY.SYSTEM.ACTIVE</span>
            <span className="lg:hidden tracking-widest">SYS.ACTIVE</span>
            <div className="hidden lg:flex items-end gap-px h-4">
              {[6, 10, 4, 12, 8, 5, 11, 7].map((h, i) => (
                <div key={i} className="w-[3px] bg-white/25 rounded-sm" style={{ height: `${h}px` }} />
              ))}
            </div>
            <span>BUILD 2.0.0</span>
          </div>
          <div className="flex items-center gap-2 lg:gap-5 text-[8px] lg:text-[9px] font-mono text-white/40">
            <span className="hidden lg:inline">◐ RENDERING</span>
            <div className="flex gap-[5px]">
              <div className="w-[5px] h-[5px] bg-white/60 rounded-full animate-pulse" />
              <div className="w-[5px] h-[5px] bg-white/35 rounded-full animate-pulse" style={{ animationDelay: '0.25s' }} />
              <div className="w-[5px] h-[5px] bg-white/15 rounded-full animate-pulse" style={{ animationDelay: '0.5s' }} />
            </div>
            <span className="hidden lg:inline tracking-widest">FRAME: ∞</span>
          </div>
        </div>
      </div>

    </main>
  );
}
