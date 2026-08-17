import type { Metadata } from "next";

// Server-side metadata for the pricing page. The page itself is a client
// component (document.title only works after hydration) — this layout is what
// social cards and non-JS crawlers actually see.
export const metadata: Metadata = {
  title: "Pricing — Your next hire costs $29 a month | Maily",
  description:
    "One plan, everything included. Monthly $29, Annual $199/year, or Lifetime Founder $499 once. Maily removes email from your to-do list entirely. 3-day free trial.",
  alternates: { canonical: "https://maily.dev/pricing" },
  openGraph: {
    title: "Pricing — Your next hire costs $29 a month | Maily",
    description:
      "One plan, everything included. Monthly $29, Annual $199/year, or Lifetime Founder $499 once. 3-day free trial.",
    url: "https://maily.dev/pricing",
    images: [{ url: "/logo-maily.png", width: 1200, height: 630, alt: "Maily pricing" }],
  },
};

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
