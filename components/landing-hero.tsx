import Link from "next/link";

/**
 * Server-rendered landing hero. Kept out of the LinearLanding client bundle so
 * the H1 is in the first HTML flush and is not delayed by hydrating framer-motion
 * / below-fold sections (mobile PSI LCP was stuck ~4.1s on element render delay).
 */
export function LandingHero() {
  return (
    <section className="relative w-full pt-40 pb-0 md:pt-48 flex flex-col items-center text-center z-10 bg-gradient-to-b from-[#000000] via-[#09090b] to-[#16161a] overflow-hidden">
      <div
        className="absolute inset-x-0 bottom-0 h-[250px] bg-[radial-gradient(ellipse_at_bottom,rgba(255,255,255,0.08),transparent_70%)] pointer-events-none z-10"
        aria-hidden="true"
      />

      <div className="w-full flex flex-col items-center max-w-5xl z-10 mx-auto px-6">
        <h1 className="text-4xl md:text-[60px] font-medium tracking-[-0.035em] leading-[1.08] max-w-3xl text-white pb-2">
          You run your company,
          <br />
          We run your inbox.
        </h1>

        <p className="text-lg md:text-[22px] text-[#c8ccd4] leading-relaxed max-w-4xl mt-8 font-light min-h-[4rem] flex items-center justify-center">
          Mailient is the AI employee that runs your inbox while you run your company.
        </p>

        <div className="flex flex-col items-center gap-3 mt-12">
          <div className="flex flex-wrap items-center justify-center gap-4">
            <Link
              href="/auth/signup"
              className="inline-flex items-center justify-center gap-2 px-8 py-3 rounded-full font-semibold text-sm bg-white text-black hover:bg-neutral-200 shadow-[0_8px_24px_rgba(0,0,0,0.45)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
            >
              Get started free
              <span aria-hidden="true">→</span>
            </Link>
            <Link
              href="#demos"
              className="inline-flex items-center justify-center gap-2 px-8 py-3 rounded-full font-semibold text-sm bg-white/[0.03] text-white border border-white/15 hover:bg-white/[0.08] hover:border-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
            >
              Watch Mailient handle a real inbox
              <span aria-hidden="true">→</span>
            </Link>
          </div>
          <p className="text-[13px] text-[#c8ccd4] tracking-wide">
            3-day free trial · cancel anytime
          </p>
        </div>

        <a
          href="#demos"
          className="md:hidden mt-14 inline-flex items-center gap-2 text-sm font-semibold text-white underline underline-offset-4 decoration-white/30 hover:decoration-white"
        >
          Watch Mailient handle a real inbox
          <span aria-hidden="true">→</span>
        </a>
      </div>

      <div className="w-full h-px bg-gradient-to-r from-transparent via-white/[0.12] to-transparent relative z-25 mt-16 md:mt-24" />
    </section>
  );
}
