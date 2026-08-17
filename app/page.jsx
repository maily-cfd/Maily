import { LinearLanding } from "@/components/LinearLanding";
import { landingFaqs } from "@/lib/landing-faqs";
import Script from "next/script";

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
      <Script
        id="faq-jsonld"
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <LinearLanding />
    </>
  );
}
