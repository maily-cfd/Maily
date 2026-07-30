import { useState, useRef, useEffect, Suspense, lazy } from "react"
import { CircleExpandButton } from "@/components/CircleExpandButton"

const Dithering = lazy(() =>
  import("@paper-design/shaders-react").then((mod) => ({ default: mod.Dithering }))
)

export function CTASection() {
  const [isHovered, setIsHovered] = useState(false)
  const sectionRef = useRef<HTMLElement>(null)
  // The dithering shader is a WebGL canvas animating every frame; only mount it
  // while the section is near the viewport so it never renders unseen.
  const [shaderActive, setShaderActive] = useState(false)

  useEffect(() => {
    const el = sectionRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => setShaderActive(entry.isIntersecting),
      { rootMargin: "200px" }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    /* Full-bleed. This was an inset card — section px-4/md:px-6, a max-w-7xl
       wrapper, and rounded-[48px] + overflow-hidden on the panel — so the
       dithering shader was clipped into a rounded rectangle floating in black
       with visible margins on all four sides. All three constraints are gone;
       the shader now runs edge to edge.

       The rounded card is replaced by a top hairline, which is how every other
       section on the page separates itself. */
    <section ref={sectionRef} className="py-24 w-full flex justify-center items-center bg-black relative z-10 border-t border-white/[0.06]">
      <div
        className="w-full relative"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <div className="relative overflow-hidden bg-neutral-950/40 min-h-[520px] flex flex-col items-center justify-center duration-500">

          {shaderActive && (
            <Suspense fallback={<div className="absolute inset-0 bg-neutral-900/10 pointer-events-none" />}>
              {/* Oversized past 100% so the warp never shows its own edge, and
                  masked vertically so a full-bleed shader melts into the black
                  sections above and below instead of hard-banding against them. */}
              <div
                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[160%] md:w-[130%] h-[250%] md:h-[180%] z-0 pointer-events-none opacity-50 dark:opacity-40 mix-blend-multiply dark:mix-blend-screen"
                style={{
                  maskImage:
                    "linear-gradient(to bottom, transparent 0%, #000 22%, #000 78%, transparent 100%)",
                  WebkitMaskImage:
                    "linear-gradient(to bottom, transparent 0%, #000 22%, #000 78%, transparent 100%)",
                }}
              >
                <Dithering
                  colorBack="#00000000" // Transparent
                  colorFront="#4a4a4a"  // Lighter gray instead of ultra-dark metallic gray
                  shape="warp"
                  type="4x4"
                  speed={isHovered ? 0.35 : 0.12}
                  className="size-full"
                  minPixelRatio={1}
                />
              </div>
            </Suspense>
          )}

          <div className="relative z-10 px-6 max-w-4xl mx-auto text-center flex flex-col items-center">
            
            {/* Premium Linear Gradient Headline */}
            {/* Capped at 56px. This was 76px — larger than the hero h1 (60px),
                which made the loudest type on the page the closing CTA and
                inverted the hierarchy. 56px keeps it emphatic as the final
                beat while staying below the hero. */}
            <h2 className="text-4xl md:text-5xl lg:text-[56px] font-medium tracking-[-0.035em] mb-6 leading-[1.08] max-w-3xl font-sans select-none bg-gradient-to-b from-white via-neutral-100 to-neutral-500 bg-clip-text text-transparent">
              Go ship. Go sell. Go build. <br />
              We&apos;ll handle the inbox.
            </h2>

            {/* Description */}
            <p className="text-[#8a8f98] text-sm md:text-base max-w-xl mb-10 leading-relaxed font-sans font-light select-none">
              Mailient removes email from your to-do list entirely. Connect your Gmail tonight — tomorrow morning, open one briefing. Not Gmail.
            </p>

            {/* Buttons row matching the screenshot */}
            <div className="flex flex-wrap items-center justify-center gap-4">
              {/* Left Button: Obsidian Pill */}
              <CircleExpandButton href="/auth/signup" variant="primary">
                Get started free
              </CircleExpandButton>

              {/* Right Button: Transparent/Black Pill */}
              <CircleExpandButton
                href="https://x.com/maulik_5"
                target="_blank"
                rel="noopener noreferrer"
                variant="secondary"
              >
                Talk to Founder
              </CircleExpandButton>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
