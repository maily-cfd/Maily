import { CircleExpandButton } from "@/components/CircleExpandButton"

/**
 * Closing CTA. Previously mounted a continuous WebGL dithering shader
 * (@paper-design/shaders-react) under the whole section — that alone kept the
 * GPU busy every frame and stacked with the hero video decoder on desktop
 * Lighthouse runs. Static CSS atmosphere keeps the look without the cost.
 */
export function CTASection() {
  return (
    <section className="py-24 w-full flex justify-center items-center bg-black relative z-10 border-t border-white/[0.06]">
      <div className="w-full relative">
        <div className="relative overflow-hidden bg-neutral-950/40 min-h-[520px] flex flex-col items-center justify-center">
          {/* CSS-only atmosphere — replaces the WebGL dithering canvas */}
          <div
            className="absolute inset-0 z-0 pointer-events-none opacity-60"
            aria-hidden="true"
            style={{
              background:
                "radial-gradient(ellipse 80% 60% at 50% 40%, rgba(80,80,80,0.35), transparent 70%), radial-gradient(ellipse 50% 40% at 20% 80%, rgba(255,255,255,0.04), transparent 60%), radial-gradient(ellipse 50% 40% at 80% 20%, rgba(255,255,255,0.03), transparent 60%)",
              maskImage:
                "linear-gradient(to bottom, transparent 0%, #000 18%, #000 82%, transparent 100%)",
              WebkitMaskImage:
                "linear-gradient(to bottom, transparent 0%, #000 18%, #000 82%, transparent 100%)",
            }}
          />

          <div className="relative z-10 px-6 max-w-4xl mx-auto text-center flex flex-col items-center">
            <h2 className="text-4xl md:text-5xl lg:text-[56px] font-medium tracking-[-0.035em] mb-6 leading-[1.08] max-w-3xl font-sans select-none bg-gradient-to-b from-white via-neutral-100 to-neutral-500 bg-clip-text text-transparent">
              Go ship. Go sell. Go build. <br />
              We&apos;ll handle the inbox.
            </h2>

            <p className="text-[#b0b4bc] text-sm md:text-base max-w-xl mb-10 leading-relaxed font-sans font-light select-none">
              Mailient removes email from your to-do list entirely. Connect your Gmail tonight — tomorrow morning, open one briefing. Not Gmail.
            </p>

            <div className="flex flex-col items-center gap-3">
              <div className="flex flex-wrap items-center justify-center gap-4">
                <CircleExpandButton href="/auth/signup" variant="primary">
                  Get started free
                </CircleExpandButton>

                <CircleExpandButton
                  href="https://x.com/maulik_5"
                  target="_blank"
                  rel="noopener noreferrer"
                  variant="secondary"
                >
                  Talk to Founder
                </CircleExpandButton>
              </div>
              <p className="text-[13px] text-[#b0b4bc] tracking-wide select-none">
                3-day free trial · cancel anytime
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
