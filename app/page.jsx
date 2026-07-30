import { LinearLanding } from "@/components/LinearLanding";
import { LandingHero } from "@/components/landing-hero";
import { LandingHeader } from "@/components/LandingHeader";
import { landingFaqs } from "@/lib/landing-faqs";

// FAQPage structured data — built from the SAME array the landing accordion
// renders, so the schema can never drift from the visible copy.
const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: landingFaqs.map((f) => ({
    "@type": "Question",
    name: f.q,
    acceptedAnswer: { "@type": "Answer", text: f.a },
  })),
};

export default function Home() {
  return (
    <>
      {/* Do not preload the hero poster — it is desktop-only and was stealing
          mobile LCP from the H1 (PSI mobile LCP ~4.9s on the video). */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <div className="min-h-screen bg-[#000000] text-white flex flex-col items-center justify-start overflow-x-hidden font-sans relative selection:bg-white selection:text-black">
        <LandingHeader />
        <main id="main-content" className="w-full flex flex-col items-center">
          <LandingHero />
          <LinearLanding />
        </main>
      </div>
    </>
  );
}
