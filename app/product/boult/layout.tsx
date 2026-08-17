import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Boult — the AI running your inbox | Maily",
  description:
    "It reads every thread, drafts replies in your voice, books your meetings, and runs on schedule while you sleep. Nothing sends without your approval.",
  alternates: { canonical: "https://maily.dev/product/boult" },
  openGraph: {
    title: "Boult — the AI running your inbox | Maily",
    description:
      "Reads every thread, drafts in your voice, books meetings, runs while you sleep. Nothing sends without your approval.",
    url: "https://maily.dev/product/boult",
    images: [{ url: "/logo-maily.png", width: 1200, height: 630, alt: "Boult — the AI running your inbox" }],
  },
};

export default function BoultLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
